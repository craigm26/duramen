import sys

from heat import handle_line, canon_response


def main():
    out = sys.stdout.buffer
    for raw in sys.stdin.buffer.read().split(b"\n"):
        line = raw.decode("utf-8", errors="replace")
        if line.strip(" \t") == "":
            continue
        out.write(canon_response(handle_line(line)).encode("utf-8") + b"\n")
        out.flush()


if __name__ == "__main__":
    main()
