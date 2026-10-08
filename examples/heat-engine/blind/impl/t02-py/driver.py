"""Line-oriented JSON driver for heat-engine."""
import json
import math
import sys

import heat


class Bad(Exception):
    pass


def _const(name):
    raise ValueError(name)


def num_field(inp, name):
    if name not in inp:
        raise Bad
    v = inp[name]
    if isinstance(v, float):
        return v
    if isinstance(v, str) and v in heat.NONFINITE:
        return float(v)
    raise Bad


OPS = {
    "wetBulb": (("tempC", "rhPercent"), heat.wet_bulb),
    "wetBulbF": (("tempF", "rhPercent"), heat.wet_bulb_f),
    "flagF": (("wetBulbF",), heat.flag_f),
    "flagC": (("wetBulbC",), heat.flag_c),
}


def handle(line):
    try:
        # every JSON number becomes a binary64 float (ints too)
        req = json.loads(line, parse_int=float, parse_float=float, parse_constant=_const)
    except (ValueError, RecursionError):
        return {"id": None, "error": "bad_request"}
    if not isinstance(req, dict) or not isinstance(req.get("id"), str):
        return {"id": None, "error": "bad_request"}
    rid = req["id"]
    op = req.get("op")
    if not isinstance(op, str) or (op != "canonical" and op not in OPS):
        return {"id": rid, "error": "unknown_op"}
    inp = req.get("input")
    try:
        if not isinstance(inp, dict):
            raise Bad
        if op == "canonical":
            if "value" not in inp:
                raise Bad
            return {"id": rid, "result": heat.canonical(inp["value"])}
        clock = req.get("clock")
        if not isinstance(clock, str):
            raise Bad
        fields, fn = OPS[op]
        args = [num_field(inp, f) for f in fields]
    except Bad:
        return {"id": rid, "error": "bad_request"}
    result, audit = fn(*args, clock)
    return {"id": rid, "result": result, "audit": heat.canonical(audit)}


def main():
    out = sys.stdout.buffer
    data = sys.stdin.buffer.read().decode("utf-8", errors="replace")
    for line in data.split("\n"):
        if not line.strip():
            continue
        out.write(heat.canonical(handle(line.rstrip("\r"))).encode("utf-8") + b"\n")
    out.flush()


if __name__ == "__main__":
    main()
