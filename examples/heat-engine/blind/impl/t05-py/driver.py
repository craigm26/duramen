"""heat-engine driver: JSON-lines protocol on stdin/stdout."""
import json
import math
import sys
from decimal import Decimal
from fractions import Fraction

NONFINITE = {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf}
SPEC_VERSION = "0.2.0"
FLAG_CONSTANTS = {"white_max": 80, "green_max": 85, "yellow_max": 88, "red_max": 90}


class BadRequest(Exception):
    pass


def number_text(x):
    """ECMAScript Number::toString for a finite number."""
    x = float(x)
    if x == 0:
        return "0"
    if x < 0:
        return "-" + number_text(-x)
    t = Decimal(repr(x)).as_tuple()
    digits = "".join(map(str, t.digits)).rstrip("0") or "0"
    n = len(t.digits) + t.exponent
    k = len(digits)
    if k <= n <= 21:
        return digits + "0" * (n - k)
    if 0 < n <= 21:
        return digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + digits
    e = n - 1
    out = digits[0] + ("." + digits[1:] if k > 1 else "")
    return out + "e" + ("+" if e >= 0 else "-") + str(abs(e))


def fixed_text(x, f):
    """ECMAScript Number.prototype.toFixed for a finite number."""
    x = float(x)
    if abs(x) >= 1e21:
        return number_text(x)
    if x < 0:
        return "-" + fixed_text(-x, f)
    if x == 0:
        x = 0.0
    q = Fraction(x) * 10 ** f + Fraction(1, 2)
    m = q.numerator // q.denominator
    s = str(m).rjust(f + 1, "0")
    return s[:-f] + "." + s[-f:] if f else s


def json_string(s):
    out = ['"']
    for ch in s:
        c = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif c in (8, 12, 10, 13, 9):
            out.append({8: "\\b", 12: "\\f", 10: "\\n", 13: "\\r", 9: "\\t"}[c])
        elif c < 0x20 or 0xD800 <= c <= 0xDFFF:
            out.append("\\u%04x" % c)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def canon(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        return number_text(v) if math.isfinite(v) else "null"
    if isinstance(v, str):
        return json_string(v)
    if isinstance(v, list):
        return "[" + ",".join(canon(e) for e in v) + "]"
    keys = sorted(v, key=lambda k: k.encode("utf-16-be", "surrogatepass"))
    return "{" + ",".join(json_string(k) + ":" + canon(v[k]) for k in keys) + "}"


def input_value(x):
    """Audit form of a numeric input: non-finite becomes its string."""
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    return x


def audit(function, inputs, constants, citation, summary, clock, children=None):
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


def wet_bulb(t, rh_in, clock):
    cite = "Stull (2011) eq. 1"
    inputs = {"tempC": input_value(t), "rhPercent": input_value(rh_in)}
    if not math.isfinite(t) or not math.isfinite(rh_in):
        bad = "tempC" if not math.isfinite(t) else "rhPercent"
        return None, audit("calculateWetBulb", inputs, {}, cite, "invalid_input:" + bad, clock)
    rh = min(max(rh_in, 5.0), 100.0)
    term1 = t * math.atan(0.151977 * math.sqrt(rh + 8.313659))
    term2 = math.atan(t + rh)
    term3 = math.atan(rh - 1.676331)
    term4 = 0.00391838 * math.pow(rh, 1.5) * math.atan(0.023101 * rh)
    wc = term1 + term2 - term3 + term4 + (-4.686035)
    wf = (wc * 9) / 5 + 32
    result = {"wetBulbC": wc, "wetBulbF": wf}
    constants = {
        "stull_a": 0.151977, "stull_b": 8.313659, "stull_c": 1.676331,
        "stull_d": 0.00391838, "stull_e": 0.023101, "stull_offset": -4.686035,
    }
    clamped = rh != rh_in
    markers = []
    if clamped:
        result["clampedRhPct"] = rh
        constants["rh_clamp_min"] = 5
        constants["rh_clamp_max"] = 100
        markers.append("rh_clamped")
    if t < -20 or t > 50:
        markers.append("out_of_validity_range")
    rh_txt = (number_text(rh_in) + "→" if clamped else "") + number_text(rh) + "%"
    mk = " (" + ",".join(markers) + ")" if markers else ""
    summary = "T=%s°C RH=%s%s → Tw=%s°C" % (fixed_text(t, 1), rh_txt, mk, fixed_text(wc, 2))
    return result, audit("calculateWetBulb", inputs, constants, cite, summary, clock)


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


CITE_FLAG = "USMC 6200.1E Table 3-1"


def flag_f(w, clock):
    inputs = {"wetBulbF": input_value(w)}
    if not math.isfinite(w):
        return None, audit("flagFromWetBulbF", inputs, {}, CITE_FLAG, "invalid_input:wetBulbF", clock)
    flag, label = classify(w)
    summary = "wetBulbF=%s → %s" % (number_text(w), flag)
    if w < -50 or w > 200:
        summary += " (out_of_observed_range)"
    return ({"flag": flag, "flagDartLabel": label},
            audit("flagFromWetBulbF", inputs, dict(FLAG_CONSTANTS), CITE_FLAG, summary, clock))


def flag_c(c, clock):
    inputs = {"wetBulbC": input_value(c)}
    if not math.isfinite(c):
        return None, audit("flagFromWetBulbC", inputs, {}, CITE_FLAG, "invalid_input:wetBulbC", clock)
    f = (c * 9) / 5 + 32
    result, child = flag_f(f, clock)
    flag = result["flag"] if result else "invalid"
    fx = fixed_text(f, 4) if math.isfinite(f) else input_value(f)
    summary = "wetBulbC=%s → wetBulbF=%s → %s" % (number_text(c), fx, flag)
    return result, audit("flagFromWetBulbC", inputs, dict(FLAG_CONSTANTS), CITE_FLAG, summary, clock, [child])


def num_field(inp, name):
    if name not in inp:
        raise BadRequest
    v = inp[name]
    if isinstance(v, bool):
        raise BadRequest
    if isinstance(v, float):
        return v
    if isinstance(v, str) and v in NONFINITE:
        return NONFINITE[v]
    raise BadRequest


def _reject(_):
    raise ValueError("non-standard constant")


def handle(line):
    try:
        req = json.loads(line, parse_int=float, parse_constant=_reject)
    except (ValueError, RecursionError):
        return {"id": None, "error": "bad_request"}
    if not isinstance(req, dict) or not isinstance(req.get("id"), str):
        return {"id": None, "error": "bad_request"}
    rid = req["id"]
    op = req.get("op")
    if op not in ("canonical", "wetBulb", "wetBulbF", "flagF", "flagC") or not isinstance(op, str):
        return {"id": rid, "error": "unknown_op"}
    inp = req.get("input")
    try:
        if not isinstance(inp, dict):
            raise BadRequest
        if op == "canonical":
            if "value" not in inp:
                raise BadRequest
            return {"id": rid, "result": canon(inp["value"])}
        clock = req.get("clock")
        if not isinstance(clock, str):
            raise BadRequest
        if op == "wetBulb":
            res, au = wet_bulb(num_field(inp, "tempC"), num_field(inp, "rhPercent"), clock)
        elif op == "wetBulbF":
            tf = num_field(inp, "tempF")
            rh = num_field(inp, "rhPercent")
            res, au = wet_bulb(((tf - 32) * 5) / 9, rh, clock)
        elif op == "flagF":
            res, au = flag_f(num_field(inp, "wetBulbF"), clock)
        else:
            res, au = flag_c(num_field(inp, "wetBulbC"), clock)
    except BadRequest:
        return {"id": rid, "error": "bad_request"}
    return {"id": rid, "result": res, "audit": canon(au)}


def main():
    data = sys.stdin.buffer.read().decode("utf-8", errors="replace")
    out = sys.stdout.buffer
    for line in data.split("\n"):
        if line.strip(" \t\r") == "":
            continue
        out.write((canon(handle(line)) + "\n").encode("utf-8", errors="replace"))
        out.flush()


if __name__ == "__main__":
    main()
