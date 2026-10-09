"""Line-oriented JSON driver for the jsonpath implementation."""
import json
import sys
import threading
from decimal import Decimal

import jsonpath


def bad_constant(name):
    raise ValueError("invalid JSON constant " + name)


def load(text):
    return json.loads(text, parse_float=Decimal, parse_constant=bad_constant)


def dump(v, out):
    if v is None:
        out.append("null")
    elif v is True:
        out.append("true")
    elif v is False:
        out.append("false")
    elif isinstance(v, int):
        out.append(str(v))
    elif isinstance(v, Decimal):
        out.append(str(v))
    elif isinstance(v, str):
        out.append(json.dumps(v))
    elif isinstance(v, list):
        out.append("[")
        for n, x in enumerate(v):
            if n:
                out.append(",")
            dump(x, out)
        out.append("]")
    else:
        out.append("{")
        for n, (k, x) in enumerate(v.items()):
            if n:
                out.append(",")
            out.append(json.dumps(k))
            out.append(":")
            dump(x, out)
        out.append("}")


def to_json(v):
    out = []
    dump(v, out)
    return "".join(out)


def respond(line):
    try:
        req = load(line)
    except (ValueError, RecursionError):
        return {"id": None, "error": "bad_request"}
    if not isinstance(req, dict) or not isinstance(req.get("id"), str):
        return {"id": None, "error": "bad_request"}
    rid = req["id"]
    if not isinstance(req.get("op"), str) or req["op"] != "query":
        return {"id": rid, "error": "unknown_op"}
    inp = req.get("input")
    if (not isinstance(inp, dict) or not isinstance(inp.get("query"), str)
            or "document" not in inp):
        return {"id": rid, "error": "bad_request"}
    try:
        segs = jsonpath.parse(inp["query"])
    except jsonpath.QueryError:
        return {"id": rid, "error": "invalid_query"}
    values, paths = jsonpath.evaluate(segs, inp["document"])
    return {"id": rid, "result": {"values": values, "paths": paths}}


def main():
    data = sys.stdin.buffer.read()
    out = sys.stdout.buffer
    for raw in data.split(b"\n"):
        try:
            line = raw.decode("utf-8")
        except UnicodeDecodeError:
            line = None
        if line is not None and line.strip(" \t") == "":
            continue
        if line is None:
            resp = {"id": None, "error": "bad_request"}
        else:
            try:
                resp = respond(line)
            except RecursionError:
                resp = {"id": None, "error": "bad_request"}
        out.write((to_json(resp) + "\n").encode("utf-8"))
    out.flush()


if __name__ == "__main__":
    sys.set_int_max_str_digits(0)
    sys.setrecursionlimit(60000)
    threading.stack_size(256 * 1024 * 1024)
    t = threading.Thread(target=main)
    t.start()
    t.join()
