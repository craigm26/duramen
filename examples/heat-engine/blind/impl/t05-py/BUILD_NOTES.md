# Build notes

- Build: none (REGEN.json `build` is empty).
- Test: `python3 -m unittest test_heat` (Windows: `py -3 -m unittest test_heat`).
- Run: `python3 driver.py`, reading JSON lines on stdin and writing one JSON line per request.
- All code is in `driver.py` (stdlib only).

Surprises: Python's `repr` and `format` differ from ECMAScript number text and `toFixed`, so both are
reimplemented (`Decimal(repr(x))` for digits, `Fraction` for exact half-up rounding). Python's
`json.loads` accepts `NaN` by default; it is rejected here. Lone surrogates survive `json.loads`
and are escaped on output.
