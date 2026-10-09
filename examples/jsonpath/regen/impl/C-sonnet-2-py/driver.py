"""Line-oriented JSON driver for jsonpath."""
import json
import sys

import jp


def _reject_constant(name):
    raise ValueError(name)


def handle(line):
    try:
        req = json.loads(line, parse_constant=_reject_constant)
    except (ValueError, RecursionError):
        return {"id": None, "error": "bad_request"}
    if not isinstance(req, dict) or not isinstance(req.get("id"), str):
        return {"id": None, "error": "bad_request"}
    rid = req["id"]
    if req.get("op") != "query" or "op" not in req:
        return {"id": rid, "error": "unknown_op"}
    inp = req.get("input")
    if (not isinstance(inp, dict) or not isinstance(inp.get("query"), str)
            or "document" not in inp):
        return {"id": rid, "error": "bad_request"}
    try:
        values, paths = jp.query(inp["query"], inp["document"])
    except (jp.QueryError, RecursionError):
        return {"id": rid, "error": "invalid_query"}
    return {"id": rid, "result": {"values": values, "paths": paths}}


def main():
    data = sys.stdin.buffer.read().decode("utf-8", errors="replace")
    out = sys.stdout
    for line in data.split("\n"):
        if line.strip(" \t") == "":
            continue
        try:
            resp = handle(line)
            text = json.dumps(resp, ensure_ascii=True, allow_nan=False)
        except Exception:
            try:
                rid = json.loads(line).get("id")
            except Exception:
                rid = None
            text = json.dumps({"id": rid if isinstance(rid, str) else None,
                               "error": "bad_request"})
        out.write(text + "\n")
    out.flush()


if __name__ == "__main__":
    main()
