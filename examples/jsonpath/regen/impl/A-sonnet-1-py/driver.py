"""Line-oriented JSON driver for jsonpath: requests on stdin, responses on stdout."""
import json
import sys
import threading
from decimal import Decimal

from jsonpath import QueryError, query


def _reject_constant(name):
    raise ValueError("invalid JSON constant " + name)


def parse_json(text):
    return json.loads(text, parse_float=Decimal, parse_constant=_reject_constant)


def ser(v):
    """Serialize a parsed JSON value to ASCII-only JSON text, keeping numbers exact."""
    t = type(v)
    if t is str:
        return json.dumps(v)
    if t is bool:
        return "true" if v else "false"
    if v is None:
        return "null"
    if t is int:
        return str(v)
    if t is Decimal:
        return str(v)
    if t is list:
        return "[" + ",".join(ser(x) for x in v) + "]"
    return "{" + ",".join(json.dumps(k) + ":" + ser(x) for k, x in v.items()) + "}"


def handle(raw):
    """Return the response text for one non-blank request line (bytes)."""
    try:
        req = parse_json(raw.decode("utf-8"))
    except (ValueError, RecursionError):
        req = None
    if type(req) is not dict or type(req.get("id")) is not str:
        return '{"id":null,"error":"bad_request"}'
    rid = json.dumps(req["id"])

    def err(code):
        return '{"id":%s,"error":"%s"}' % (rid, code)

    if req.get("op") != "query" or type(req.get("op")) is not str:
        return err("unknown_op")
    inp = req.get("input")
    if type(inp) is not dict or type(inp.get("query")) is not str or "document" not in inp:
        return err("bad_request")
    try:
        values, paths = query(inp["query"], inp["document"])
    except (QueryError, RecursionError):
        return err("invalid_query")
    return '{"id":%s,"result":{"values":%s,"paths":%s}}' % (rid, ser(values), ser(paths))


def main():
    sys.set_int_max_str_digits(0)
    out = sys.stdout.buffer
    for raw in sys.stdin.buffer:
        raw = raw[:-1] if raw.endswith(b"\n") else raw
        if raw.strip(b" \t") == b"":
            continue
        try:
            resp = handle(raw)
        except Exception:
            resp = '{"id":null,"error":"bad_request"}'
        out.write(resp.encode("ascii") + b"\n")
        out.flush()


if __name__ == "__main__":
    sys.setrecursionlimit(200000)
    threading.stack_size(512 * 1024 * 1024)
    t = threading.Thread(target=main)
    t.start()
    t.join()
