"""heat-engine library: canonical JSON, wet-bulb (Stull 2011) and USMC heat flags."""
import math
from fractions import Fraction

NONFINITE = ("NaN", "Infinity", "-Infinity")


def num_text(x):
    """ECMAScript Number::toString."""
    x = float(x)
    if x == 0:
        return "0"
    if x < 0:
        return "-" + num_text(-x)
    m, _, e = repr(x).partition("e")
    e = int(e) if e else 0
    ip, _, fp = m.partition(".")
    digits = ip + fp
    n = len(ip) + e
    stripped = digits.lstrip("0")
    n -= len(digits) - len(stripped)
    digits = stripped.rstrip("0") or "0"
    k = len(digits)
    if k <= n <= 21:
        return digits + "0" * (n - k)
    if 0 < n <= 21:
        return digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + digits
    out = digits[0]
    if k > 1:
        out += "." + digits[1:]
    return out + "e" + ("+" if n - 1 >= 0 else "-") + str(abs(n - 1))


def fixed_text(x, f):
    """ECMAScript Number.prototype.toFixed."""
    x = float(x)
    if abs(x) >= 1e21:
        return num_text(x)
    if x < 0:
        return "-" + fixed_text(-x, f)
    m = math.floor(Fraction(x) * 10 ** f + Fraction(1, 2))
    t = str(m).rjust(f + 1, "0")
    return t[:-f] + "." + t[-f:] if f else t


_ESC = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}


def _str(s):
    out = []
    for ch in s:
        o = ord(ch)
        if ch in _ESC:
            out.append(_ESC[ch])
        elif o < 0x20 or 0xD800 <= o <= 0xDFFF:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'


def canonical(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        try:
            f = float(v)
        except OverflowError:
            f = math.inf
        return num_text(f) if math.isfinite(f) else "null"
    if isinstance(v, str):
        return _str(v)
    if isinstance(v, list):
        return "[" + ",".join(canonical(i) for i in v) + "]"
    keys = sorted(v, key=lambda k: k.encode("utf-16-be", "surrogatepass"))
    return "{" + ",".join(_str(k) + ":" + canonical(v[k]) for k in keys) + "}"


def audit_num(x):
    """A number as it appears in audit inputs."""
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    return x


def _record(function, citation, inputs, constants, summary, clock):
    return {"spec_version": "0.2.0", "function": function, "inputs": inputs,
            "constants": constants, "citation": citation,
            "result_summary": summary, "computed_at": clock}


WB_CITATION = "Stull (2011) eq. 1"


def wet_bulb(temp_c, rh, clock):
    inputs = {"tempC": audit_num(temp_c), "rhPercent": audit_num(rh)}
    bad = "tempC" if not math.isfinite(temp_c) else "rhPercent" if not math.isfinite(rh) else None
    if bad:
        return None, _record("calculateWetBulb", WB_CITATION, inputs, {}, "invalid_input:" + bad, clock)
    RH = min(max(rh, 5.0), 100.0)
    T = temp_c
    t1 = T * math.atan(0.151977 * math.sqrt(RH + 8.313659))
    t2 = math.atan(T + RH)
    t3 = math.atan(RH - 1.676331)
    t4 = 0.00391838 * math.pow(RH, 1.5) * math.atan(0.023101 * RH)
    wc = t1 + t2 - t3 + t4 + (-4.686035)
    wf = (wc * 9) / 5 + 32
    result = {"wetBulbC": wc, "wetBulbF": wf}
    consts = {"stull_a": 0.151977, "stull_b": 8.313659, "stull_c": 1.676331,
              "stull_d": 0.00391838, "stull_e": 0.023101, "stull_offset": -4.686035}
    clamped = RH != rh
    markers = []
    if clamped:
        result["clampedRhPct"] = RH
        consts["rh_clamp_min"] = 5
        consts["rh_clamp_max"] = 100
        markers.append("rh_clamped")
    if T < -20 or T > 50:
        markers.append("out_of_validity_range")
    rh_text = (num_text(rh) + "→" + num_text(RH) if clamped else num_text(RH)) + "%"
    mk = " (" + ",".join(markers) + ")" if markers else ""
    summary = "T=%s°C RH=%s%s → Tw=%s°C" % (fixed_text(T, 1), rh_text, mk, fixed_text(wc, 2))
    return result, _record("calculateWetBulb", WB_CITATION, inputs, consts, summary, clock)


def wet_bulb_f(temp_f, rh, clock):
    return wet_bulb(((temp_f - 32) * 5) / 9, rh, clock)


FLAG_CITATION = "USMC 6200.1E Table 3-1"
FLAG_CONSTS = {"white_max": 80, "green_max": 85, "yellow_max": 88, "red_max": 90}


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
    inputs = {"wetBulbF": audit_num(w)}
    if not math.isfinite(w):
        return None, _record("flagFromWetBulbF", FLAG_CITATION, inputs, {}, "invalid_input:wetBulbF", clock)
    flag, label = classify(w)
    summary = "wetBulbF=%s → %s" % (num_text(w), flag)
    if w < -50 or w > 200:
        summary += " (out_of_observed_range)"
    return ({"flag": flag, "flagDartLabel": label},
            _record("flagFromWetBulbF", FLAG_CITATION, inputs, dict(FLAG_CONSTS), summary, clock))


def flag_c(c, clock):
    inputs = {"wetBulbC": audit_num(c)}
    if not math.isfinite(c):
        return None, _record("flagFromWetBulbC", FLAG_CITATION, inputs, {}, "invalid_input:wetBulbC", clock)
    f = (c * 9) / 5 + 32
    result, child = flag_f(f, clock)
    name = result["flag"] if result else "invalid"
    summary = "wetBulbC=%s → wetBulbF=%s → %s" % (num_text(c), fixed_text(f, 4) if math.isfinite(f) else num_text(f), name)
    rec = _record("flagFromWetBulbC", FLAG_CITATION, inputs, dict(FLAG_CONSTS), summary, clock)
    rec["children"] = [child]
    return result, rec
