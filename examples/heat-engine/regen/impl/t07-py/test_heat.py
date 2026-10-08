import json
import os
import random
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
CLOCK = "2026-05-26T17:00:00.000Z"


def run_lines(lines):
    data = ("\n".join(lines) + "\n").encode("utf-8")
    p = subprocess.run([sys.executable, os.path.join(HERE, "driver.py")], input=data,
                       capture_output=True, cwd=HERE, check=True)
    assert p.stdout.endswith(b"\n") and b"\r" not in p.stdout
    return [json.loads(x) for x in p.stdout.decode("utf-8").split("\n") if x]


def call(op, inp, clock=CLOCK, **extra):
    req = {"id": "t", "op": op, "input": inp}
    if clock is not None:
        req["clock"] = clock
    req.update(extra)
    return run_lines([json.dumps(req)])[0]


def audit(r):
    return json.loads(r["audit"])


class Canonical(unittest.TestCase):
    def canon(self, v):
        return call("canonical", {"value": v}, clock=None)["result"]

    def test_examples(self):
        self.assertEqual(self.canon({"b": [1, 2.5, 1e21], "a": None}), '{"a":null,"b":[1,2.5,1e+21]}')
        self.assertEqual(self.canon({"y": "Infinity", "x": "NaN"}), '{"x":"NaN","y":"Infinity"}')
        self.assertEqual(self.canon(None), "null")
        self.assertEqual(call("canonical", {}, clock=None)["error"], "bad_request")
        r = call("canonical", {"value": 1}, clock=None)
        self.assertEqual(set(r), {"id", "result"})

    def test_number_text(self):
        cases = {"0": "0", "-0.0": "0", "1e-7": "1e-7", "0.000001": "0.000001", "1e21": "1e+21",
                 "1e20": "100000000000000000000", "123456789012345680000": "123456789012345680000",
                 "1.5e300": "1.5e+300", "5e-324": "5e-324", "0.1": "0.1", "2e1": "20",
                 "-1.25e-10": "-1.25e-10", "1.7976931348623157e308": "1.7976931348623157e+308",
                 "100": "100", "12.5": "12.5"}
        for src, want in cases.items():
            r = run_lines([json.dumps({"id": "n", "op": "canonical", "input": {}}).replace(
                '"input": {}', '"input": {"value": %s}' % src)])[0]
            self.assertEqual(r["result"], want, src)

    def test_strings_and_keys(self):
        self.assertEqual(self.canon("a\"b\\c/\x7f "), '"a\\"b\\\\c/\x7f "')
        self.assertEqual(self.canon("\b\f\n\r\t\x01\x1f"), '"\\b\\f\\n\\r\\t\\u0001\\u001f"')
        line = '{"id":"s","op":"canonical","input":{"value":"\\ud800 \\ude00 \\ud83d\\ude00"}}'
        self.assertEqual(run_lines([line])[0]["result"], '"\\ud800 \\ude00 \U0001F600"')
        # U+FFFD (BMP) sorts after U+1F600 (surrogates D83D) in UTF-16 order
        self.assertEqual(self.canon({"�": 1, "\U0001F600": 2}), '{"\U0001F600":2,"�":1}')

    def test_fixed_point(self):
        v = {"a": [1, {"b": "x\ny", "a": [True, False, None, 0.5]}], "": ""}
        a = self.canon(v)
        self.assertEqual(self.canon(json.loads(a)), a)
        self.assertEqual(json.loads(a), v)


class WetBulb(unittest.TestCase):
    def wb(self, t, rh, op="wetBulb", key="tempC"):
        return call(op, {key: t, "rhPercent": rh})

    def test_values(self):
        for t, rh, c, clamp in [(20, 50, 13.69934, None), (25, 120, 25.04558, 100), (30, 2.5, 10.77218, 5),
                                (25, 99.5, 24.97823, None), (60, 50, 48.08736, None),
                                (-30, 50, -29.31486, None), (20, 80, 17.529271, None)]:
            r = self.wb(t, rh)["result"]
            self.assertAlmostEqual(r["wetBulbC"], c, delta=1e-5)
            self.assertEqual(r.get("clampedRhPct"), clamp)
            self.assertEqual(r["wetBulbF"], (r["wetBulbC"] * 9) / 5 + 32)
        self.assertAlmostEqual(self.wb(40, 20)["result"]["wetBulbF"], 72.867053, delta=1.8001e-5)
        self.assertAlmostEqual(self.wb(-60, 10)["result"]["wetBulbC"], -42.258361, delta=1e-5)

    def test_clamp_property(self):
        for rh in [4.999999, 5, 5.000001, 5.5, 6, 50, 99.999999, 100, 100.000001, 101]:
            r = self.wb(10, rh)["result"]
            self.assertEqual("clampedRhPct" in r, rh < 5 or rh > 100)
        a, b = self.wb(12, 500)["result"], self.wb(12, 100)["result"]
        self.assertEqual((a["wetBulbC"], a["wetBulbF"]), (b["wetBulbC"], b["wetBulbF"]))
        self.assertNotIn("clampedRhPct", b)
        self.assertEqual(self.wb(12, -50)["result"]["clampedRhPct"], 5)

    def test_monotonic(self):
        rnd = random.Random(1)
        for _ in range(30):
            t, rh = rnd.uniform(5, 50), rnd.uniform(5, 99)
            self.assertGreater(self.wb(t, rh + 1)["result"]["wetBulbC"], self.wb(t, rh)["result"]["wetBulbC"])

    def test_audit(self):
        a = audit(self.wb(25, 120))
        self.assertEqual(a["inputs"], {"rhPercent": 120, "tempC": 25})
        self.assertEqual(a["constants"], {"rh_clamp_max": 100, "rh_clamp_min": 5, "stull_a": 0.151977,
                                          "stull_b": 8.313659, "stull_c": 1.676331, "stull_d": 0.00391838,
                                          "stull_e": 0.023101, "stull_offset": -4.686035})
        self.assertEqual(set(a), {"spec_version", "function", "inputs", "constants", "citation",
                                  "result_summary", "computed_at"})
        self.assertEqual((a["function"], a["citation"]), ("calculateWetBulb", "Stull (2011) eq. 1"))
        self.assertEqual(a["spec_version"], "0.2.0")
        self.assertEqual(len(audit(self.wb(20, 50))["constants"]), 6)

    def test_summaries(self):
        for t, rh, s in [(20, 50, "T=20.0°C RH=50% → Tw=13.70°C"),
                         (25, 120, "T=25.0°C RH=120→100% (rh_clamped) → Tw=25.05°C"),
                         (60, 2.5, "T=60.0°C RH=2.5→5% (rh_clamped,out_of_validity_range) → Tw=25.97°C"),
                         (20.25, 50, "T=20.3°C RH=50% → Tw=13.91°C"),
                         (-0.04, 50, "T=-0.0°C RH=50% → Tw=-3.53°C"),
                         (2.0e1, 50.000, "T=20.0°C RH=50% → Tw=13.70°C")]:
            self.assertEqual(audit(self.wb(t, rh))["result_summary"], s)

    def test_validity_marker(self):
        for t in [-20, 50, -20.000001, 50.000001, -19.999999, 49.999999, -60, 60, 0]:
            s = audit(self.wb(t, 50))["result_summary"]
            self.assertEqual("out_of_validity_range" in s, t < -20 or t > 50)

    def test_inputs_as_given(self):
        a = audit(self.wb(-13.37, 77.7))
        self.assertEqual(a["inputs"], {"tempC": -13.37, "rhPercent": 77.7})

    def test_non_finite(self):
        for t, rh, s in [("NaN", 50, "tempC"), (20, "NaN", "rhPercent"), ("Infinity", 50, "tempC"),
                         (20, "-Infinity", "rhPercent"), ("NaN", "NaN", "tempC")]:
            r = self.wb(t, rh)
            self.assertIsNone(r["result"])
            a = audit(r)
            self.assertEqual(a["result_summary"], "invalid_input:" + s)
            self.assertEqual(a["constants"], {})
            self.assertEqual(a["inputs"], {"tempC": t, "rhPercent": rh})
            self.assertEqual((a["function"], a["citation"]), ("calculateWetBulb", "Stull (2011) eq. 1"))
        self.assertEqual(audit(self.wb("Infinity", "NaN"))["inputs"], {"rhPercent": "NaN", "tempC": "Infinity"})

    def test_fahrenheit(self):
        a = audit(call("wetBulbF", {"tempF": 68, "rhPercent": 50}))
        self.assertEqual(a["result_summary"], "T=20.0°C RH=50% → Tw=13.70°C")
        self.assertEqual(a["inputs"], {"rhPercent": 50, "tempC": 20})
        self.assertEqual(audit(call("wetBulbF", {"tempF": 100, "rhPercent": 40}))["inputs"]["tempC"],
                         37.77777777777778)
        self.assertEqual(audit(call("wetBulbF", {"tempF": 98.6, "rhPercent": 50}))["inputs"]["tempC"], 37)
        r = call("wetBulbF", {"tempF": "NaN", "rhPercent": 50})
        self.assertIsNone(r["result"])
        self.assertEqual(audit(r)["result_summary"], "invalid_input:tempC")
        rnd = random.Random(2)
        for _ in range(20):
            f, rh = rnd.uniform(-100, 200), rnd.uniform(0, 150)
            a = call("wetBulbF", {"tempF": f, "rhPercent": rh})
            b = call("wetBulb", {"tempC": (f - 32) * 5 / 9, "rhPercent": rh})
            self.assertEqual(a["result"], b["result"])
            self.assertEqual(a["audit"], b["audit"])


class Flags(unittest.TestCase):
    def test_bands(self):
        for w, f, l in [(79.99, "white", "low"), (80, "green", "moderate"), (84.99, "green", "moderate"),
                        (85, "yellow", "high"), (88, "red", "extreme"), (89.99, "red", "extreme"),
                        (90, "black", "critical"), (-60, "white", "low"), (250, "black", "critical")]:
            self.assertEqual(call("flagF", {"wetBulbF": w})["result"], {"flag": f, "flagDartLabel": l})

    def test_monotonic(self):
        order = ["white", "green", "yellow", "red", "black"]
        prev = -1
        for w in range(60, 100):
            i = order.index(call("flagF", {"wetBulbF": w * 1.0})["result"]["flag"])
            self.assertGreaterEqual(i, prev)
            prev = i

    def test_audit_f(self):
        r = call("flagF", {"wetBulbF": 86.5})
        a = audit(r)
        self.assertEqual(a["constants"], {"green_max": 85, "red_max": 90, "white_max": 80, "yellow_max": 88})
        self.assertEqual(a["inputs"], {"wetBulbF": 86.5})
        self.assertEqual((a["function"], a["citation"]), ("flagFromWetBulbF", "USMC 6200.1E Table 3-1"))
        self.assertNotIn("children", a)
        for w, s in [(85, "wetBulbF=85 → yellow"), (250, "wetBulbF=250 → black (out_of_observed_range)"),
                     (-60, "wetBulbF=-60 → white (out_of_observed_range)"), (200, "wetBulbF=200 → black")]:
            self.assertEqual(audit(call("flagF", {"wetBulbF": w}))["result_summary"], s)
        for w in [-50, -50.000001, -49.999999, -50.5, 200, 200.000001, 199.999999, 200.5, 0]:
            s = audit(call("flagF", {"wetBulbF": w}))["result_summary"]
            self.assertEqual("out_of_observed_range" in s, w < -50 or w > 200)

    def test_non_finite(self):
        r = call("flagF", {"wetBulbF": "NaN"})
        a = audit(r)
        self.assertIsNone(r["result"])
        self.assertEqual((a["result_summary"], a["constants"], a["inputs"]),
                         ("invalid_input:wetBulbF", {}, {"wetBulbF": "NaN"}))
        r = call("flagC", {"wetBulbC": "-Infinity"})
        a = audit(r)
        self.assertIsNone(r["result"])
        self.assertEqual(a["inputs"], {"wetBulbC": "-Infinity"})
        self.assertEqual((a["result_summary"], a["constants"], a["function"]),
                         ("invalid_input:wetBulbC", {}, "flagFromWetBulbC"))
        self.assertNotIn("children", a)

    def test_flag_c(self):
        for c, f in [(26.66666666666666, "white"), (30, "yellow"), (29.444444444444443, "yellow"),
                     (29.444444443444443, "green")]:
            self.assertEqual(call("flagC", {"wetBulbC": c})["result"]["flag"], f)
        a = audit(call("flagC", {"wetBulbC": 30}))
        self.assertEqual(a["result_summary"], "wetBulbC=30 → wetBulbF=86.0000 → yellow")
        self.assertEqual(a["children"][0]["result_summary"], "wetBulbF=86 → yellow")
        self.assertEqual(a["children"][0]["computed_at"], CLOCK)
        self.assertEqual(a["inputs"], {"wetBulbC": 30})
        self.assertEqual(audit(call("flagC", {"wetBulbC": 26.66666666666666}))["result_summary"],
                         "wetBulbC=26.66666666666666 → wetBulbF=80.0000 → white")
        rnd = random.Random(3)
        for _ in range(20):
            c = rnd.uniform(-50, 60)
            a = call("flagC", {"wetBulbC": c})
            b = call("flagF", {"wetBulbF": (c * 9) / 5 + 32})
            self.assertEqual(a["result"], b["result"])
            self.assertEqual(audit(a)["children"], [audit(b)])


class Protocol(unittest.TestCase):
    def test_clock(self):
        c = "1999-12-31T23:59:59.999Z"
        self.assertEqual(audit(call("flagF", {"wetBulbF": 70}, clock=c))["computed_at"], c)
        self.assertEqual(audit(call("flagC", {"wetBulbC": 30}, clock=c))["children"][0]["computed_at"], c)
        self.assertEqual(audit(call("wetBulb", {"tempC": 1, "rhPercent": 1}, clock=c))["computed_at"], c)

    def test_errors(self):
        rs = run_lines(['{not json', '[1,2]', '{"op":"flagF","input":{"wetBulbF":80},"clock":"c"}',
                        '{"id":"a","op":"heatIndex","input":{"tempC":20},"clock":"c"}',
                        '{"id":"b","input":{"wetBulbF":80},"clock":"c"}',
                        '{"id":"c","op":"heatIndex"}',
                        '{"id":"d","op":"flagF","clock":"c"}',
                        '{"id":"e","op":"flagF","input":{"wetBulbF":80}}',
                        '{"id":"f","op":"wetBulb","input":{"tempC":20},"clock":"c"}',
                        '{"id":"g","op":"flagF","input":{"wetBulbF":true},"clock":"c"}',
                        '{"id":"h","op":"flagF","input":{"wetBulbF":"80"},"clock":"c"}',
                        '{"id":"i","op":"flagF","input":{"wetBulbF":NaN},"clock":"c"}',
                        '{"id":5,"op":"flagF","input":{"wetBulbF":1},"clock":"c"}',
                        '{"id":"j","op":"flagF","input":[],"clock":"c"}'])
        want = [(None, "bad_request"), (None, "bad_request"), (None, "bad_request"), ("a", "unknown_op"),
                ("b", "unknown_op"), ("c", "unknown_op"), ("d", "bad_request"), ("e", "bad_request"),
                ("f", "bad_request"), ("g", "bad_request"), ("h", "bad_request"), (None, "bad_request"),
                (None, "bad_request"), ("j", "bad_request")]
        self.assertEqual([(r["id"], r["error"]) for r in rs], want)
        self.assertTrue(all(set(r) == {"id", "error"} for r in rs))

    def test_continues_blank_and_order(self):
        rs = run_lines(["", "  \t ", '{"id":"1","op":"flagF","input":{"wetBulbF":1},"clock":"c"}', "garbage",
                        '{"id":"2","op":"flagF","input":{"wetBulbF":99},"clock":"c"}\r'])
        self.assertEqual([r["id"] for r in rs], ["1", None, "2"])

    def test_extra_members(self):
        line = ('{"id":"extra","op":"flagF","input":{"wetBulbF":86,"note":"x"},'
                '"clock":"2026-05-26T17:00:00.000Z","trace":true}')
        self.assertEqual(run_lines([line])[0]["result"], {"flag": "yellow", "flagDartLabel": "high"})

    def test_response_members(self):
        r = call("flagF", {"wetBulbF": 85})
        self.assertEqual(set(r), {"id", "result", "audit"})
        self.assertIsInstance(r["audit"], str)
        a = audit(r)
        self.assertEqual((a["spec_version"], a["function"], a["computed_at"]),
                         ("0.2.0", "flagFromWetBulbF", CLOCK))

    def test_audit_is_canonical(self):
        rnd = random.Random(4)
        for _ in range(15):
            a = call("wetBulb", {"tempC": rnd.uniform(-20, 50), "rhPercent": rnd.uniform(0, 120)})
            b = call("flagC", {"wetBulbC": a["result"]["wetBulbC"]})
            for x in (a, b):
                self.assertEqual(call("canonical", {"value": json.loads(x["audit"])}, clock=None)["result"],
                                 x["audit"])


class Folder(unittest.TestCase):
    def test_regen(self):
        with open(os.path.join(HERE, "REGEN.json"), encoding="utf-8") as f:
            cfg = json.load(f)
        self.assertEqual(set(cfg), {"lang", "build", "test", "driver"})
        self.assertEqual(cfg["lang"], "py")
        for k in ("build", "test", "driver"):
            if isinstance(cfg[k], dict):
                self.assertIn("default", cfg[k])

    def test_size(self):
        total = 0
        for n in os.listdir(HERE):
            if n.endswith(".py") and not n.startswith("test_"):
                with open(os.path.join(HERE, n), encoding="utf-8") as f:
                    total += sum(1 for ln in f if ln.strip())
        self.assertLessEqual(total, 800)


if __name__ == "__main__":
    unittest.main()
