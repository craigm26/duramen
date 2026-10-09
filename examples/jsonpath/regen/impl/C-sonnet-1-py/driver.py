"""Line-oriented JSON driver for jsonpath."""
import json
import sys

import jsonpath


def _reject_constant(name):
    raise ValueError(name)


def handle(line):
    """Return the response object for one non-blank request line."""
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
    if not isinstance(inp, dict) or not isinstance(inp.get("query"), str) or "document" not in inp:
        return {"id": rid, "error": "bad_request"}
    try:
        values, paths = jsonpath.query(inp["query"], inp["document"])
    except jsonpath.InvalidQuery:
        return {"id": rid, "error": "invalid_query"}
    except RecursionError:
        return {"id": rid, "error": "invalid_query"}
    return {"id": rid, "result": {"values": values, "paths": paths}}


def main():
    for raw in sys.stdin.buffer:  # binary iteration splits on LF only
        line = raw.decode("utf-8", errors="replace").rstrip("\n")
        if line.strip(" \t") == "":
            continue
        try:
            text = json.dumps(handle(line), ensure_ascii=True, separators=(",", ":"))
        except Exception:
            text = json.dumps({"id": None, "error": "bad_request"})
        sys.stdout.buffer.write((text + "\n").encode("ascii"))
        sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
