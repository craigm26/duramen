import json
import subprocess
import sys
import unittest

CLK = "2026-05-26T17:00:00.000Z"


def run(lines):
    p = subprocess.run([sys.executable, "driver.py"], input="\n".join(lines) + "\n",
                       capture_output=True, text=True, encoding="utf-8")
    assert p.returncode == 0
    return [json.loads(l) for l in p.stdout.split("\n") if l]


def req(op, inp, clock=CLK, **kw):
    r = {"id": "x", "op": op, "input": inp}
    if clock is not None:
        r["clock"] = clock
    r.update(kw)
    return json.dumps(r)


def one(op, inp, **kw):
    return run([req(op, inp, **kw)])[0]


def summ(op, inp):
    return json.loads(one(op, inp)["audit"])["result_summary"]


class T(unittest.TestCase):
    def test_clock(self):
        c = "1999-12-31T23:59:59.999Z"
        a = json.loads(one("flagF", {"wetBulbF": 70}, clock=c)["audit"])
        self.assertEqual(a["computed_at"], c)
        a = json.loads(one("flagC", {"wetBulbC": 30}, clock=c)["audit"])
        self.assertEqual(a["children"][0]["computed_at"], c)

    def test_numbers(self):
        self.assertEqual(summ("wetBulb", {"tempC": 2.0e1, "rhPercent": 50.000}), "T=20.0°C RH=50% → Tw=13.70°C")
        r = one("flagC", {"wetBulbC": "-Infinity"})
        self.assertIsNone(r["result"])
        self.assertEqual(json.loads(r["audit"])["inputs"], {"wetBulbC": "-Infinity"})

    def test_errors(self):
        out = run(["{not json", "[1,2]", json.dumps({"op": "flagF", "input": {"wetBulbF": 80}, "clock": CLK}),
                   json.dumps({"id": "a", "op": "heatIndex", "input": {}}),
                   json.dumps({"id": "a", "input": {}}),
                   json.dumps({"id": "a", "op": "flagF", "clock": CLK}),
                   json.dumps({"id": "a", "op": "flagF", "input": {"wetBulbF": 80}}),
                   req("wetBulb", {"tempC": 20}), req("flagF", {"wetBulbF": True}),
                   req("flagF", {"wetBulbF": "80"}), "NaN", "  \t ", req("flagF", {"wetBulbF": 80})])
        self.assertEqual([o.get("error") for o in out],
                         ["bad_request", "bad_request", "bad_request", "unknown_op", "unknown_op",
                          "bad_request", "bad_request", "bad_request", "bad_request", "bad_request",
                          "bad_request", None])
        self.assertIsNone(out[0]["id"])
        self.assertEqual(set(out[3]), {"id", "error"})

    def test_extra(self):
        line = '{"id":"extra","op":"flagF","input":{"wetBulbF":86,"note":"x"},"clock":"%s","trace":true}' % CLK
        self.assertEqual(run([line])[0]["result"], {"flag": "yellow", "flagDartLabel": "high"})

    def test_canonical(self):
        f = lambda v: one("canonical", {"value": v}, clock=None)["result"]
        self.assertEqual(f({"b": [1, 2.5, 1e21], "a": None}), '{"a":null,"b":[1,2.5,1e+21]}')
        self.assertEqual(f({"y": "Infinity", "x": "NaN"}), '{"x":"NaN","y":"Infinity"}')
        self.assertEqual(f(None), "null")
        self.assertEqual(one("canonical", {}, clock=None)["error"], "bad_request")
        for v, t in [(1e-7, "1e-7"), (123456789012345680000.0, "123456789012345680000"), (0.000001, "0.000001"),
                     (-0.0, "0"), (1.5e300, "1.5e+300"), (100.0, "100"), (0.1, "0.1")]:
            self.assertEqual(f(v), t)
        self.assertEqual(f("a\"\\\b\f\n\r\t\x01/\x7f "), '"a\\"\\\\\\b\\f\\n\\r\\t\\u0001/\x7f "')
        r = run(['{"id":"s","op":"canonical","input":{"value":"\\ud800 \\ud83d\\ude00"}}'])[0]["result"]
        self.assertEqual(r, '"\\ud800 \U0001F600"')
        r = run(['{"id":"s","op":"canonical","input":{"value":{"\\ue000":1,"\\ud83d\\ude00":2}}}'])[0]["result"]
        self.assertEqual(r, '{"\U0001F600":2,"":1}')

    def test_audit_members(self):
        r = one("flagF", {"wetBulbF": 85})
        a = json.loads(r["audit"])
        self.assertEqual(a["spec_version"], "0.2.0")
        self.assertEqual(a["function"], "flagFromWetBulbF")
        self.assertEqual(set(a), {"spec_version", "function", "inputs", "constants", "citation",
                                  "result_summary", "computed_at"})
        self.assertEqual(r["audit"], json.dumps(a, sort_keys=True, ensure_ascii=False, separators=(",", ":")))

    def test_nonfinite_inputs(self):
        a = one("wetBulb", {"tempC": "Infinity", "rhPercent": "NaN"})["audit"]
        self.assertEqual(json.loads(a)["inputs"], {"rhPercent": "NaN", "tempC": "Infinity"})

    def test_wetbulb(self):
        for t, rh, w, c in [(20, 50, 13.69934, None), (25, 120, 25.04558, 100), (30, 2.5, 10.77218, 5),
                            (25, 99.5, 24.97823, None), (60, 50, 48.08736, None), (-30, 50, -29.31486, None)]:
            r = one("wetBulb", {"tempC": t, "rhPercent": rh})["result"]
            self.assertAlmostEqual(r["wetBulbC"], w, delta=1e-5)
            self.assertEqual(r.get("clampedRhPct"), c)
            self.assertAlmostEqual(r["wetBulbF"], w * 1.8 + 32, delta=2e-5)

    def test_wb_audit(self):
        a = json.loads(one("wetBulb", {"tempC": 25, "rhPercent": 120})["audit"])
        self.assertEqual(a["inputs"], {"rhPercent": 120, "tempC": 25})
        self.assertEqual(a["constants"], {"rh_clamp_max": 100, "rh_clamp_min": 5, "stull_a": 0.151977,
                                          "stull_b": 8.313659, "stull_c": 1.676331, "stull_d": 0.00391838,
                                          "stull_e": 0.023101, "stull_offset": -4.686035})
        self.assertEqual(a["citation"], "Stull (2011) eq. 1")
        for t, rh, s in [(20, 50, "T=20.0°C RH=50% → Tw=13.70°C"),
                         (25, 120, "T=25.0°C RH=120→100% (rh_clamped) → Tw=25.05°C"),
                         (60, 2.5, "T=60.0°C RH=2.5→5% (rh_clamped,out_of_validity_range) → Tw=25.97°C"),
                         (20.25, 50, "T=20.3°C RH=50% → Tw=13.91°C"),
                         (-0.04, 50, "T=-0.0°C RH=50% → Tw=-3.53°C")]:
            self.assertEqual(summ("wetBulb", {"tempC": t, "rhPercent": rh}), s)

    def test_wb_invalid(self):
        for t, rh, s in [("NaN", 50, "tempC"), (20, "NaN", "rhPercent"), ("Infinity", 50, "tempC"),
                         (20, "-Infinity", "rhPercent"), ("NaN", "NaN", "tempC")]:
            r = one("wetBulb", {"tempC": t, "rhPercent": rh})
            self.assertIsNone(r["result"])
            a = json.loads(r["audit"])
            self.assertEqual(a["result_summary"], "invalid_input:" + s)
            self.assertEqual(a["constants"], {})

    def test_wb_f(self):
        a = json.loads(one("wetBulbF", {"tempF": 68, "rhPercent": 50})["audit"])
        self.assertEqual(a["result_summary"], "T=20.0°C RH=50% → Tw=13.70°C")
        self.assertEqual(a["inputs"], {"rhPercent": 50, "tempC": 20})
        self.assertEqual(a["function"], "calculateWetBulb")
        a = json.loads(one("wetBulbF", {"tempF": 100, "rhPercent": 40})["audit"])
        self.assertEqual(a["inputs"]["tempC"], 37.77777777777778)
        a = json.loads(one("wetBulbF", {"tempF": 98.6, "rhPercent": 50})["audit"])
        self.assertEqual(a["inputs"]["tempC"], 37)
        r = one("wetBulbF", {"tempF": "NaN", "rhPercent": 50})
        self.assertIsNone(r["result"])
        self.assertEqual(json.loads(r["audit"])["result_summary"], "invalid_input:tempC")

    def test_flags(self):
        for w, f, l in [(79.99, "white", "low"), (80, "green", "moderate"), (84.99, "green", "moderate"),
                        (85, "yellow", "high"), (88, "red", "extreme"), (89.99, "red", "extreme"),
                        (90, "black", "critical")]:
            self.assertEqual(one("flagF", {"wetBulbF": w})["result"], {"flag": f, "flagDartLabel": l})

    def test_flag_audit(self):
        for w, s in [(85, "wetBulbF=85 → yellow"), (250, "wetBulbF=250 → black (out_of_observed_range)"),
                     (-60, "wetBulbF=-60 → white (out_of_observed_range)"), (200, "wetBulbF=200 → black")]:
            self.assertEqual(summ("flagF", {"wetBulbF": w}), s)
        a = json.loads(one("flagF", {"wetBulbF": 85})["audit"])
        self.assertEqual(a["citation"], "USMC 6200.1E Table 3-1")
        self.assertEqual(a["constants"], {"white_max": 80, "green_max": 85, "yellow_max": 88, "red_max": 90})

    def test_flag_nonfinite(self):
        r = one("flagF", {"wetBulbF": "NaN"})
        self.assertIsNone(r["result"])
        a = json.loads(r["audit"])
        self.assertEqual((a["result_summary"], a["constants"]), ("invalid_input:wetBulbF", {}))
        r = one("flagC", {"wetBulbC": "NaN"})
        a = json.loads(r["audit"])
        self.assertIsNone(r["result"])
        self.assertEqual(a["result_summary"], "invalid_input:wetBulbC")
        self.assertNotIn("children", a)

    def test_flag_c(self):
        for c, f in [(26.66666666666666, "white"), (30, "yellow"), (29.444444444444443, "yellow"),
                     (29.444444443444443, "green")]:
            self.assertEqual(one("flagC", {"wetBulbC": c})["result"]["flag"], f)
        a = json.loads(one("flagC", {"wetBulbC": 30})["audit"])
        self.assertEqual(a["result_summary"], "wetBulbC=30 → wetBulbF=86.0000 → yellow")
        self.assertEqual(a["children"][0]["result_summary"], "wetBulbF=86 → yellow")
        self.assertEqual(a["function"], "flagFromWetBulbC")
        self.assertEqual(summ("flagC", {"wetBulbC": 26.66666666666666}),
                         "wetBulbC=26.66666666666666 → wetBulbF=80.0000 → white")


if __name__ == "__main__":
    unittest.main()
