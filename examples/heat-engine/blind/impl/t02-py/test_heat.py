import json
import os
import subprocess
import sys
import unittest

import heat

HERE = os.path.dirname(os.path.abspath(__file__))
CLOCK = "2026-05-26T17:00:00.000Z"


def run_lines(lines):
    p = subprocess.run([sys.executable, os.path.join(HERE, "driver.py")], cwd=HERE,
                       input=("\n".join(lines) + "\n").encode("utf-8"), capture_output=True)
    assert p.returncode == 0
    return [json.loads(x) for x in p.stdout.decode("utf-8").split("\n") if x]


def call(op, inp, clock=CLOCK, **extra):
    req = {"id": "t", "op": op, "input": inp}
    if clock is not None:
        req["clock"] = clock
    req.update(extra)
    return run_lines([json.dumps(req)])[0]


def audit(r):
    return json.loads(r["audit"])


class TextEdges(unittest.TestCase):
    def test_number_text(self):
        cases = [(0.0, "0"), (-0.0, "0"), (1e21, "1e+21"), (1e20, "100000000000000000000"),
                 (1e-7, "1e-7"), (1e-6, "0.000001"), (2.5, "2.5"), (-1.5, "-1.5"),
                 (123456.789, "123456.789"), (1.5e300, "1.5e+300"), (5e-324, "5e-324"),
                 (20.0, "20"), (0.1 + 0.2, "0.30000000000000004")]
        for x, s in cases:
            self.assertEqual(heat.num_text(x), s)

    def test_fixed_text(self):
        self.assertEqual(heat.fixed_text(20.25, 1), "20.3")
        self.assertEqual(heat.fixed_text(-0.04, 1), "-0.0")
        self.assertEqual(heat.fixed_text(-0.0, 1), "0.0")
        self.assertEqual(heat.fixed_text(1e21, 2), "1e+21")
        self.assertEqual(heat.fixed_text(0.5, 0), "1")
        self.assertEqual(heat.fixed_text(86, 4), "86.0000")

    def test_canonical_op(self):
        r = call("canonical", {"value": {"b": [1, 2.50, 1e21], "a": None}}, clock=None)
        self.assertEqual(r, {"id": "t", "result": '{"a":null,"b":[1,2.5,1e+21]}'})
        r = call("canonical", {"value": {"y": "Infinity", "x": "NaN"}}, clock=None)
        self.assertEqual(r["result"], '{"x":"NaN","y":"Infinity"}')

    def test_canonical_strings_and_order(self):
        self.assertEqual(heat.canonical("a/\x7f\u2028\x01\x08\"\\"), '"a/\x7f\u2028\\u0001\\b\\"\\\\"')
        self.assertEqual(heat.canonical("\ud800"), '"\\ud800"')
        self.assertEqual(heat.canonical("\U0001F600"), '"\U0001F600"')
        # U+1F600 (units D83D DE00) sorts before U+FF5E in UTF-16 order
        self.assertEqual(heat.canonical({"\uff5e": 1, "\U0001F600": 2}), '{"\U0001F600":2,"\uff5e":1}')
        r = run_lines(['{"id":"s","op":"canonical","input":{"value":"\\ud800\\ud83d\\ude00"}}'])[0]
        self.assertEqual(r["result"], '"\\ud800\U0001F600"')


class Requests(unittest.TestCase):
    def test_clock(self):  # REQ-IF-004
        c = "1999-12-31T23:59:59.999Z"
        self.assertEqual(audit(call("flagF", {"wetBulbF": 70}, clock=c))["computed_at"], c)
        a = audit(call("flagC", {"wetBulbC": 30}, clock=c))
        self.assertEqual(a["children"][0]["computed_at"], c)
        self.assertEqual(a["computed_at"], c)

    def test_numbers(self):  # REQ-IF-006
        r = call("wetBulb", {"tempC": 2.0e1, "rhPercent": 50.000})
        self.assertEqual(audit(r)["result_summary"], "T=20.0°C RH=50% → Tw=13.70°C")
        r = call("flagC", {"wetBulbC": "-Infinity"})
        self.assertIsNone(r["result"])
        self.assertEqual(r["audit"].count('"inputs":{"wetBulbC":"-Infinity"}'), 1)

    def test_errors(self):  # REQ-IF-007
        out = run_lines(['{not json', '[1,2]',
                         '{"op":"flagF","input":{"wetBulbF":80},"clock":"c"}',
                         '{"id":5,"op":"flagF"}',
                         '{"id":"a","op":"heatIndex","input":{"tempC":20},"clock":"c"}',
                         '{"id":"b","input":{},"clock":"c"}',
                         '{"id":"c","op":"heatIndex"}',
                         '{"id":"d","op":"flagF","clock":"c"}',
                         '{"id":"e","op":"flagF","input":[],"clock":"c"}',
                         '{"id":"f","op":"flagF","input":{"wetBulbF":80}}',
                         '{"id":"g","op":"wetBulb","input":{"tempC":20},"clock":"c"}',
                         '{"id":"h","op":"flagF","input":{"wetBulbF":true},"clock":"c"}',
                         '{"id":"i","op":"flagF","input":{"wetBulbF":"80"},"clock":"c"}',
                         '{"id":"j","op":"canonical","input":{}}'])
        exp = [(None, "bad_request")] * 4 + [("a", "unknown_op"), ("b", "unknown_op"), ("c", "unknown_op"),
                                              ("d", "bad_request"), ("e", "bad_request"), ("f", "bad_request"),
                                              ("g", "bad_request"), ("h", "bad_request"), ("i", "bad_request"),
                                              ("j", "bad_request")]
        self.assertEqual([(o["id"], o["error"]) for o in out], exp)
        for o in out:
            self.assertEqual(set(o), {"id", "error"})

    def test_blank_lines_and_continue(self):
        out = run_lines(["", "   ", "{bad", '{"id":"x","op":"flagF","input":{"wetBulbF":80},"clock":"c"}', "\t"])
        self.assertEqual([o["id"] for o in out], [None, "x"])

    def test_extra_members(self):  # REQ-IF-008
        line = ('{"id":"extra","op":"flagF","input":{"wetBulbF":86,"note":"x"},'
                '"clock":"2026-05-26T17:00:00.000Z","trace":true}')
        self.assertEqual(run_lines([line])[0]["result"], {"flag": "yellow", "flagDartLabel": "high"})


class Audit(unittest.TestCase):
    def test_members(self):  # REQ-AU-001
        r = call("flagF", {"wetBulbF": 85})
        a = audit(r)
        self.assertEqual(set(a), {"spec_version", "function", "inputs", "constants", "citation",
                                  "result_summary", "computed_at"})
        self.assertEqual((a["spec_version"], a["function"]), ("0.2.0", "flagFromWetBulbF"))
        self.assertEqual(r["audit"], heat.canonical(a))
        self.assertEqual(set(audit(call("flagC", {"wetBulbC": 30}))) - set(a), {"children"})

    def test_nonfinite_inputs(self):  # REQ-AU-002
        r = call("wetBulb", {"tempC": "Infinity", "rhPercent": "NaN"})
        self.assertIn('"inputs":{"rhPercent":"NaN","tempC":"Infinity"}', r["audit"])
        self.assertEqual(audit(r)["inputs"], {"tempC": "Infinity", "rhPercent": "NaN"})


class WetBulb(unittest.TestCase):
    def test_values(self):  # REQ-WB-001, 002
        rows = [(20, 50, 13.69934, None), (25, 120, 25.04558, 100), (30, 2.5, 10.77218, 5),
                (25, 99.5, 24.97823, None), (60, 50, 48.08736, None), (-30, 50, -29.31486, None)]
        for t, rh, w, cl in rows:
            res = call("wetBulb", {"tempC": t, "rhPercent": rh})["result"]
            self.assertAlmostEqual(res["wetBulbC"], w, delta=1e-5)
            self.assertAlmostEqual(res["wetBulbF"], w * 9 / 5 + 32, delta=1.8001e-5)
            self.assertEqual(res.get("clampedRhPct"), cl)

    def test_audit(self):  # REQ-WB-003
        a = audit(call("wetBulb", {"tempC": 25, "rhPercent": 120}))
        self.assertEqual(a["inputs"], {"tempC": 25, "rhPercent": 120})
        self.assertEqual(a["constants"], {"stull_a": 0.151977, "stull_b": 8.313659, "stull_c": 1.676331,
                                          "stull_d": 0.00391838, "stull_e": 0.023101,
                                          "stull_offset": -4.686035, "rh_clamp_min": 5, "rh_clamp_max": 100})
        self.assertEqual((a["function"], a["citation"]), ("calculateWetBulb", "Stull (2011) eq. 1"))
        rows = [(20, 50, "T=20.0°C RH=50% → Tw=13.70°C"),
                (25, 120, "T=25.0°C RH=120→100% (rh_clamped) → Tw=25.05°C"),
                (60, 2.5, "T=60.0°C RH=2.5→5% (rh_clamped,out_of_validity_range) → Tw=25.97°C"),
                (20.25, 50, "T=20.3°C RH=50% → Tw=13.91°C"),
                (-0.04, 50, "T=-0.0°C RH=50% → Tw=-3.53°C"),
                (-30, 50, "T=-30.0°C RH=50% (out_of_validity_range) → Tw=-29.31°C")]
        for t, rh, s in rows:
            self.assertEqual(audit(call("wetBulb", {"tempC": t, "rhPercent": rh}))["result_summary"], s)

    def test_nonfinite(self):  # REQ-WB-004
        rows = [("NaN", 50, "tempC"), (20, "NaN", "rhPercent"), ("Infinity", 50, "tempC"),
                (20, "-Infinity", "rhPercent"), ("NaN", "NaN", "tempC")]
        for t, rh, bad in rows:
            r = call("wetBulb", {"tempC": t, "rhPercent": rh})
            self.assertIsNone(r["result"])
            a = audit(r)
            self.assertEqual(a["result_summary"], "invalid_input:" + bad)
            self.assertEqual(a["constants"], {})
            self.assertEqual(a["function"], "calculateWetBulb")

    def test_from_f(self):  # REQ-WB-005
        a = audit(call("wetBulbF", {"tempF": 68, "rhPercent": 50}))
        self.assertEqual(a["result_summary"], "T=20.0°C RH=50% → Tw=13.70°C")
        self.assertEqual(a["inputs"], {"tempC": 20, "rhPercent": 50})
        self.assertEqual(a["function"], "calculateWetBulb")
        self.assertEqual(audit(call("wetBulbF", {"tempF": 100, "rhPercent": 40}))["inputs"]["tempC"],
                         37.77777777777778)
        self.assertEqual(audit(call("wetBulbF", {"tempF": 98.6, "rhPercent": 50}))["inputs"]["tempC"], 37)
        r = call("wetBulbF", {"tempF": "NaN", "rhPercent": 50})
        self.assertIsNone(r["result"])
        self.assertEqual(audit(r)["result_summary"], "invalid_input:tempC")
        r = call("wetBulbF", {"tempF": "-Infinity", "rhPercent": 50})
        self.assertEqual(audit(r)["result_summary"], "invalid_input:tempC")


class Flags(unittest.TestCase):
    def test_bands(self):  # REQ-FL-001
        rows = [(79.99, "white", "low"), (80, "green", "moderate"), (84.99, "green", "moderate"),
                (85, "yellow", "high"), (88, "red", "extreme"), (89.99, "red", "extreme"),
                (90, "black", "critical")]
        for w, f, lab in rows:
            self.assertEqual(call("flagF", {"wetBulbF": w})["result"], {"flag": f, "flagDartLabel": lab})

    def test_audit(self):  # REQ-FL-002
        for w, s in [(85, "wetBulbF=85 → yellow"), (250, "wetBulbF=250 → black (out_of_observed_range)"),
                     (-60, "wetBulbF=-60 → white (out_of_observed_range)"), (200, "wetBulbF=200 → black")]:
            a = audit(call("flagF", {"wetBulbF": w}))
            self.assertEqual(a["result_summary"], s)
            self.assertEqual(a["citation"], "USMC 6200.1E Table 3-1")
            self.assertEqual(a["inputs"], {"wetBulbF": w})
            self.assertEqual(a["constants"], {"white_max": 80, "green_max": 85, "yellow_max": 88, "red_max": 90})

    def test_nonfinite_f(self):  # REQ-FL-003
        r = call("flagF", {"wetBulbF": "NaN"})
        self.assertIsNone(r["result"])
        a = audit(r)
        self.assertEqual((a["result_summary"], a["constants"]), ("invalid_input:wetBulbF", {}))

    def test_flag_c(self):  # REQ-FL-004
        for c, f in [(26.66666666666666, "white"), (30, "yellow"), (29.444444444444443, "yellow"),
                     (29.444444443444443, "green")]:
            self.assertEqual(call("flagC", {"wetBulbC": c})["result"]["flag"], f)

    def test_flag_c_audit(self):  # REQ-FL-005
        a = audit(call("flagC", {"wetBulbC": 30}))
        self.assertEqual(a["result_summary"], "wetBulbC=30 → wetBulbF=86.0000 → yellow")
        self.assertEqual(a["function"], "flagFromWetBulbC")
        self.assertEqual(len(a["children"]), 1)
        self.assertEqual(a["children"][0]["result_summary"], "wetBulbF=86 → yellow")
        self.assertEqual(a["children"][0]["function"], "flagFromWetBulbF")
        a = audit(call("flagC", {"wetBulbC": 26.66666666666666}))
        self.assertEqual(a["result_summary"], "wetBulbC=26.66666666666666 → wetBulbF=80.0000 → white")

    def test_nonfinite_c(self):  # REQ-FL-006
        r = call("flagC", {"wetBulbC": "NaN"})
        self.assertIsNone(r["result"])
        a = audit(r)
        self.assertEqual(a["result_summary"], "invalid_input:wetBulbC")
        self.assertNotIn("children", a)
        self.assertEqual(a["function"], "flagFromWetBulbC")


if __name__ == "__main__":
    unittest.main()
