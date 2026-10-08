"""heat-engine: wet-bulb temperature, heat flags, and canonical audit records."""
import json
import math
from decimal import Decimal
from fractions import Fraction

SPEC_VERSION = "0.2.0"
SPECIAL = {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf}
FLAG_CITATION = "USMC 6200.1E Table 3-1"
WB_CITATION = "Stull (2011) eq. 1"
FLAG_CONSTANTS = {"white_max": 80, "green_max": 85, "yellow_max": 88, "red_max": 90}
WB_CONSTANTS = {
    "stull_a": 0.151977,
    "stull_b": 8.313659,
    "stull_c": 1.676331,
    "stull_d": 0.00391838,
    "stull_e": 0.023101,
    "stull_offset": -4.686035,
}


def num_text(x):
    """ECMAScript Number::toString for a finite number."""
    x = float(x)
    if x == 0:
        return "0"
    if x < 0:
        return "-" + num_text(-x)
    _, digits, exp = Decimal(repr(x)).as_tuple()
    n = len(digits) + exp
    s = "".join(map(str, digits)).strip("0")
    k = len(s)
    if k <= n <= 21:
        return s + "0" * (n - k)
    if 0 < n <= 21:
        return s[:n] + "." + s[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + s
    e = n - 1
    mant = s[0] + ("." + s[1:] if k > 1 else "")
    return mant + "e" + ("+" if e >= 0 else "-") + str(abs(e))


def fixed_text(x, places):
    """ECMAScript Number.prototype.toFixed for a finite number."""
    x = float(x)
    if abs(x) >= 1e21:
        return num_text(x)
    if x < 0:
        return "-" + fixed_text(-x, places)
    scale = 10 ** places
    m = math.floor(Fraction(x) * scale + Fraction(1, 2))
    t = str(m).rjust(places + 1, "0")
    return t[:-places] + "." + t[-places:] if places else t


_ESC = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}


def _str_text(s):
    out = []
    for ch in s:
        if ch in _ESC:
            out.append(_ESC[ch])
        elif ord(ch) < 0x20 or 0xD800 <= ord(ch) <= 0xDFFF:
            out.append("\\u%04x" % ord(ch))
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'


def canon(v):
    """Canonical JSON text (keys in UTF-16 order, ECMAScript numbers)."""
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        return num_text(v) if math.isfinite(v) else "null"
    if isinstance(v, str):
        return _str_text(v)
    if isinstance(v, list):
        return "[" + ",".join(canon(e) for e in v) + "]"
    keys = sorted(v, key=lambda k: k.encode("utf-16-be", "surrogatepass"))
    return "{" + ",".join(_str_text(k) + ":" + canon(v[k]) for k in keys) + "}"


def _inp(x):
    """An input value as it appears in audit inputs."""
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    return x


def _audit(function, inputs, constants, citation, summary, clock, children=None):
    a = {
        "spec_version": SPEC_VERSION,
        "function": function,
        "inputs": inputs,
        "constants": constants,
        "citation": citation,
        "result_summary": summary,
        "computed_at": clock,
    }
    if children is not None:
        a["children"] = children
    return a


def wet_bulb(temp_c, rh_percent, clock):
    inputs = {"tempC": _inp(temp_c), "rhPercent": _inp(rh_percent)}
    if not math.isfinite(temp_c) or not math.isfinite(rh_percent):
        bad = "tempC" if not math.isfinite(temp_c) else "rhPercent"
        return None, _audit("calculateWetBulb", inputs, {}, WB_CITATION, "invalid_input:" + bad, clock)
    rh = min(max(rh_percent, 5), 100)
    rh = float(rh)
    t = temp_c
    term1 = t * math.atan(0.151977 * math.sqrt(rh + 8.313659))
    term2 = math.atan(t + rh)
    term3 = math.atan(rh - 1.676331)
    term4 = 0.00391838 * math.pow(rh, 1.5) * math.atan(0.023101 * rh)
    wb_c = term1 + term2 - term3 + term4 + (-4.686035)
    wb_f = (wb_c * 9) / 5 + 32
    result = {"wetBulbC": wb_c, "wetBulbF": wb_f}
    clamped = rh != rh_percent
    constants = dict(WB_CONSTANTS)
    if clamped:
        result["clampedRhPct"] = rh
        constants["rh_clamp_min"] = 5
        constants["rh_clamp_max"] = 100
        rh_txt = num_text(rh_percent) + "→" + num_text(rh) + "%"
    else:
        rh_txt = num_text(rh) + "%"
    markers = []
    if clamped:
        markers.append("rh_clamped")
    if t < -20 or t > 50:
        markers.append("out_of_validity_range")
    mk = " (" + ",".join(markers) + ")" if markers else ""
    summary = "T=%s°C RH=%s%s → Tw=%s°C" % (fixed_text(t, 1), rh_txt, mk, fixed_text(wb_c, 2))
    return result, _audit("calculateWetBulb", inputs, constants, WB_CITATION, summary, clock)


def wet_bulb_f(temp_f, rh_percent, clock):
    if math.isfinite(temp_f):
        temp_c = ((temp_f - 32) * 5) / 9
    else:
        temp_c = math.nan
    return wet_bulb(temp_c, rh_percent, clock)


def classify(w):
    if w < 80:
        return "white", "low"
    if w < 85:
        return "green", "moderate"
    if w < 88:
        return "yellow", "high"
    if w < 90:
        return "red", "extreme"
    return "black", "critical"


def flag_f(w, clock):
    fn = "flagFromWetBulbF"
    if not math.isfinite(w):
        return None, _audit(fn, {"wetBulbF": _inp(w)}, {}, FLAG_CITATION, "invalid_input:wetBulbF", clock)
    flag, label = classify(w)
    summary = "wetBulbF=%s → %s" % (num_text(w), flag)
    if w < -50 or w > 200:
        summary += " (out_of_observed_range)"
    return ({"flag": flag, "flagDartLabel": label},
            _audit(fn, {"wetBulbF": w}, dict(FLAG_CONSTANTS), FLAG_CITATION, summary, clock))


def flag_c(c, clock):
    fn = "flagFromWetBulbC"
    if not math.isfinite(c):
        return None, _audit(fn, {"wetBulbC": _inp(c)}, {}, FLAG_CITATION, "invalid_input:wetBulbC", clock)
    f = (c * 9) / 5 + 32
    result, child = flag_f(f, clock)
    if result is None:  # overflow (OPEN-FL-001)
        return None, _audit(fn, {"wetBulbC": c}, {}, FLAG_CITATION, "invalid_input:wetBulbC", clock)
    summary = "wetBulbC=%s → wetBulbF=%s → %s" % (num_text(c), fixed_text(f, 4), result["flag"])
    return result, _audit(fn, {"wetBulbC": c}, dict(FLAG_CONSTANTS), FLAG_CITATION, summary, clock, [child])


def canon_response(resp):
    """One response line: ASCII-only JSON, so no encoding trouble."""
    return json.dumps(resp, ensure_ascii=True, separators=(",", ":"), allow_nan=False)


class _Bad(Exception):
    pass


def _num(input_obj, name):
    if name not in input_obj:
        raise _Bad
    v = input_obj[name]
    if isinstance(v, bool):
        raise _Bad
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str) and v in SPECIAL:
        return SPECIAL[v]
    raise _Bad


OPS = {
    "wetBulb": (("tempC", "rhPercent"), wet_bulb),
    "wetBulbF": (("tempF", "rhPercent"), wet_bulb_f),
    "flagF": (("wetBulbF",), flag_f),
    "flagC": (("wetBulbC",), flag_c),
}


def _no_constant(name):
    raise ValueError(name)


def handle_line(line):
    """Handle one request line (str); return the response object."""
    try:
        req = json.loads(line, parse_int=float, parse_constant=_no_constant)
    except (ValueError, RecursionError):
        return {"id": None, "error": "bad_request"}
    if not isinstance(req, dict) or not isinstance(req.get("id"), str):
        return {"id": None, "error": "bad_request"}
    rid = req["id"]
    op = req.get("op")
    if not isinstance(op, str) or (op != "canonical" and op not in OPS):
        return {"id": rid, "error": "unknown_op"}
    inp = req.get("input")
    if not isinstance(inp, dict):
        return {"id": rid, "error": "bad_request"}
    if op == "canonical":
        if "value" not in inp:
            return {"id": rid, "error": "bad_request"}
        return {"id": rid, "result": canon(inp["value"])}
    clock = req.get("clock")
    if not isinstance(clock, str):
        return {"id": rid, "error": "bad_request"}
    names, fn = OPS[op]
    try:
        args = [_num(inp, n) for n in names]
    except _Bad:
        return {"id": rid, "error": "bad_request"}
    result, audit = fn(*args, clock)
    return {"id": rid, "result": result, "audit": canon(audit)}
