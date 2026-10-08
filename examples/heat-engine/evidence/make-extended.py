#!/usr/bin/env python3
"""Write evidence/wet-bulb-extended.csv: wet-bulb values outside Stull's validity range
(-20 to 50 degrees C), computed by the reference formula of HeatCompass/heat-engine-spec.

stull() and c_to_f() below are copied unchanged from that repository's
scripts/build-fixtures.py at f621520 (MIT License, Copyright (c) 2026 HeatCompass). They are a
Python program written independently of this specification's oracle (oracle.mjs), which is why
their values are evidence. Run from this folder: python3 make-extended.py
"""

import csv
import math
import os


def stull(T: float, RH: float) -> float:
    """Stull (2011) wet-bulb temperature, Celsius. T in °C, RH in %."""
    return (
        T * math.atan(0.151977 * math.sqrt(RH + 8.313659))
        + math.atan(T + RH)
        - math.atan(RH - 1.676331)
        + 0.00391838 * (RH ** 1.5) * math.atan(0.023101 * RH)
        - 4.686035
    )


def c_to_f(c: float) -> float:
    return c * 9.0 / 5.0 + 32.0


ROWS = [(t, rh) for t in (-60.0, -40.0, -25.0, 55.0, 60.0, 70.0) for rh in (10.0, 50.0, 90.0)] + [(t, rh) for t in (-100.0, 100.0) for rh in (5.0, 50.0)]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wet-bulb-extended.csv")
with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f, lineterminator="\n")
    w.writerow(["id", "temp_c", "rh_percent", "expected_wet_bulb_c", "expected_wet_bulb_f", "tolerance_c"])
    for t, rh in ROWS:
        c = stull(t, rh)
        w.writerow([f"ext-T{t:g}-RH{rh:g}", f"{t:.2f}", f"{rh:.2f}", f"{c:.6f}", f"{c_to_f(c):.6f}", "0.000010"])
