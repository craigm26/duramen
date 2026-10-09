"""Line-oriented JSON driver for jsonpath: reads requests on stdin, writes responses on stdout."""
import json
import sys
import threading

import jsonpath
from jsonpath import Num, QueryError


def _reject_constant(name):
    raise ValueError(name)


def dumps(v, out):
    if v is None:
        out.append("null")
    elif v is True:
        out.append("true")
    elif v is False:
        out.append("false")
    elif isinstance(v, Num):
        out.append(v.text)
    elif isinstance(v, str):
        out.append(json.dumps(v))
    elif isinstance(v, list):
        out.append("[")
        for i, x in enumerate(v):
            if i:
                out.append(",")
            dumps(x, out)
        out.append("]")
    else:
        out.append("{")
        for i, (k, x) in enumerate(v.items()):
            if i:
                out.append(",")
            out.append(json.dumps(k))
            out.append(":")
            dumps(x, out)
        out.append("}")


def error(id_, code):
    return '{"id":%s,"error":"%s"}' % (json.dumps(id_), code)


def handle_line(line):
    """Return the response line for one request line (without LF), or None for a blank line."""
    line = line.rstrip("\r")
    if line.strip(" \t\r") == "":
        return None
    try:
        req = json.loads(line, parse_int=Num, parse_float=Num, parse_constant=_reject_constant)
    except (ValueError, RecursionError):
        return error(None, "bad_request")
    if not isinstance(req, dict) or not isinstance(req.get("id"), str):
        return error(None, "bad_request")
    id_ = req["id"]
    if not isinstance(req.get("op"), str) or req["op"] != "query":
        return error(id_, "unknown_op")
    inp = req.get("input")
    if (not isinstance(inp, dict) or not isinstance(inp.get("query"), str)
            or "document" not in inp):
        return error(id_, "bad_request")
    try:
        segs = jsonpath.parse_query(inp["query"])
    except (QueryError, RecursionError):
        return error(id_, "invalid_query")
    values, paths = jsonpath.evaluate(segs, inp["document"])
    out = ['{"id":', json.dumps(id_), ',"result":{"values":']
    dumps(values, out)
    out.append(',"paths":')
    dumps(paths, out)
    out.append("}}")
    return "".join(out)


def serve():
    stdout = sys.stdout.buffer
    for raw in sys.stdin.buffer:
        try:
            line = raw.rstrip(b"\n").decode("utf-8")
        except UnicodeDecodeError:
            resp = error(None, "bad_request")
        else:
            resp = handle_line(line)
        if resp is not None:
            stdout.write(resp.encode("utf-8") + b"\n")
            stdout.flush()


def main():
    sys.setrecursionlimit(100000)
    try:
        threading.stack_size(256 * 1024 * 1024)
    except (ValueError, RuntimeError):
        pass
    t = threading.Thread(target=serve)
    t.start()
    t.join()


if __name__ == "__main__":
    main()
    sys.exit(0)
