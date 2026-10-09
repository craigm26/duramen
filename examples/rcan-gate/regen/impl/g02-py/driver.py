"""Line-oriented JSON driver for rcan-gate (see SPEC.md, Driver protocol)."""
import json
import sys

import gate


def _no_constant(name):
    raise ValueError(name)


def _number(text):
    v = float(text)
    if v - v != 0:
        raise ValueError(text)
    return v


def handle(line):
    """Return the response object for one non-blank request line."""
    try:
        req = json.loads(line, parse_int=_number, parse_float=_number, parse_constant=_no_constant)
    except (ValueError, RecursionError):
        return {"id": None, "error": "bad_request"}
    if not isinstance(req, dict) or not isinstance(req.get("id"), str):
        return {"id": None, "error": "bad_request"}
    rid = req["id"]
    if req.get("op") != "decide":
        return {"id": rid, "error": "unknown_op"}
    inp = req.get("input")
    if not isinstance(inp, dict):
        return {"id": rid, "error": "bad_request"}
    try:
        return {"id": rid, "result": gate.decide(inp.get("state"), inp.get("command"))}
    except gate.BadRequest:
        return {"id": rid, "error": "bad_request"}


def main():
    out = sys.stdout.buffer
    for raw in sys.stdin.buffer:
        line = raw.decode("utf-8", errors="replace").rstrip("\n")
        if line.strip(" \t\r") == "":
            continue
        resp = handle(line)
        out.write((json.dumps(resp, separators=(",", ":")) + "\n").encode("utf-8"))
        out.flush()


if __name__ == "__main__":
    main()
