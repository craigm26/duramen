"""Line-oriented JSON driver for the jsonpath `query` operation."""
import json
import sys
from decimal import Decimal

from jsonpath import QueryError, query

sys.setrecursionlimit(20000)
if hasattr(sys, "set_int_max_str_digits"):
    sys.set_int_max_str_digits(0)


def _reject_constant(name):
    raise ValueError(name)


def parse_request(text):
    return json.loads(text, parse_float=Decimal, parse_constant=_reject_constant)


def dump(v, out):
    if v is None:
        out.append("null")
    elif v is True:
        out.append("true")
    elif v is False:
        out.append("false")
    elif isinstance(v, (int, Decimal)):
        out.append(str(v))
    elif isinstance(v, str):
        out.append(json.dumps(v))
    elif isinstance(v, list):
        out.append("[")
        for i, x in enumerate(v):
            if i:
                out.append(",")
            dump(x, out)
        out.append("]")
    else:
        out.append("{")
        for i, (k, x) in enumerate(v.items()):
            if i:
                out.append(",")
            out.append(json.dumps(k))
            out.append(":")
            dump(x, out)
        out.append("}")


def render(obj):
    out = []
    dump(obj, out)
    return "".join(out)


def handle(raw):
    """Returns the response line (without LF) for one input line, or None for a blank line."""
    if raw.endswith(b"\r"):
        raw = raw[:-1]
    if raw.strip(b" \t\r") == b"":
        return None
    try:
        req = parse_request(raw.decode("utf-8"))
    except (ValueError, RecursionError):
        req = None
    if not isinstance(req, dict) or not isinstance(req.get("id"), str):
        return '{"id":null,"error":"bad_request"}'
    rid = req["id"]

    def error(code):
        return render({"id": rid, "error": code})

    if req.get("op") != "query" or not isinstance(req.get("op"), str):
        return error("unknown_op")
    inp = req.get("input")
    if (not isinstance(inp, dict) or not isinstance(inp.get("query"), str)
            or "document" not in inp):
        return error("bad_request")
    try:
        values, paths = query(inp["query"], inp["document"])
    except (QueryError, RecursionError):
        return error("invalid_query")
    return render({"id": rid, "result": {"values": values, "paths": paths}})


def main():
    out = sys.stdout.buffer
    for raw in sys.stdin.buffer:
        if raw.endswith(b"\n"):
            raw = raw[:-1]
        resp = handle(raw)
        if resp is not None:
            out.write(resp.encode("utf-8") + b"\n")
            out.flush()


if __name__ == "__main__":
    main()
