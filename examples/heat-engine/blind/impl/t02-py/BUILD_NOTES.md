# Build notes

- Build: nothing to build (`build` in REGEN.json is empty).
- Test: `python3 -m unittest discover -p "test_*.py"` (on Windows `py -3 -m unittest discover -p test_*.py`). The tests start `driver.py` as a subprocess.
- Run: `python3 driver.py`, with one JSON request per line on stdin.
- Layout: `heat.py` holds number text, fixed text, canonical JSON, wet-bulb and flags. `driver.py` is the protocol layer.

Surprises:
- Python's `repr` already gives the shortest round-trip digits, so number text only reformats it. `toFixed` is done with exact `Fraction` arithmetic.
- `json.loads` accepts bare `NaN` and `Infinity`; the driver rejects them (CHOICES C-3).
- Parsing every JSON number with `parse_int=float` also keeps `true` and `false` from passing as numbers, because `bool` is not `float`.
- The wet-bulb marker comes right after the RH text, before the arrow (REQ-WB-003). My first test had it after `Tw`.
- Shell heredocs were refused here, so files were written with the file tools.
