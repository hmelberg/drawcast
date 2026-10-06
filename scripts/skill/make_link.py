#!/usr/bin/env python3
"""Print the drawcast.app link that plays a drawcast.

    python3 make_link.py cast.yaml
    python3 make_link.py < cast.yaml
    python3 make_link.py --base http://localhost:5199/ cast.yaml   (another player)

The link is https://www.drawcast.app/#cast=<data>: <data> is the UTF-8 text of the
YAML, compressed with raw DEFLATE (level 9, no zlib/gzip header) and written as
base64url without padding. Standard library only. make_link.mjs (Node) prints
the same link for the same file.
"""
import base64
import re
import sys
import zlib

BASE = "https://www.drawcast.app/"


def make_link(data: bytes, base: str = BASE) -> str:
    if data.startswith(b"\xef\xbb\xbf"):  # a byte-order mark is not part of the YAML
        data = data[3:]
    data.decode("utf-8")  # fail loudly on text that is not UTF-8
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    raw = c.compress(data) + c.flush()
    return base + "#cast=" + base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def spoken_lines(text: str) -> int:
    """How many `speak:` fields the drawcast has — its spoken lines, near enough."""
    return len(re.findall(r'(?<![\w-])"?speak"?\s*:', text))


def main(argv):
    base = BASE
    args = list(argv)
    if "--base" in args:
        i = args.index("--base")
        base = args[i + 1]
        del args[i : i + 2]
    if args and args[0] != "-":
        with open(args[0], "rb") as f:
            data = f.read()
    else:
        data = sys.stdin.buffer.read()
    if not data.strip():
        sys.exit("make_link: no YAML given (a file name, or the YAML on stdin)")
    link = make_link(data, base)
    print(link)
    n = spoken_lines(data.decode("utf-8", "replace"))
    print(f"{n} spoken lines (the default brief is 14–20; a length the user asked for wins)", file=sys.stderr)
    if len(link) > 16000:
        print(
            f"note: the link is {len(link)} characters; if the chat cuts it, give the YAML and https://www.drawcast.app/#paste instead",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main(sys.argv[1:])
