#!/usr/bin/env python3
"""Patrick Hand's glyph outlines as SVG path data, for formulas in the
drawing's own hand (src/scenes/engines.ts substitutes them into MathJax's
layout). Reads the bundled TTF (public/fonts/patrickhand, OFL) and writes
src/scenes/mathjax-fonts/patrickhand.json: one entry per character the
formula engine may swap — ASCII letters, digits, punctuation, and the few
operators the face has — as {d, adv} in the font's own 1000-units-per-em,
y-up coordinates, which is also the space MathJax's glyph paths use.

Run again only if the TTF changes:  python3 scripts/build-patrickhand-glyphs.py
"""
import json, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
f = TTFont(os.path.join(root, "public/fonts/patrickhand/PatrickHand-Regular.ttf"))
upm = f["head"].unitsPerEm
cmap = f.getBestCmap()
gs = f.getGlyphSet()
os2 = f["OS/2"]
chars = [chr(c) for c in range(0x21, 0x7F)] + list("×÷±°−·")
out = {"upm": upm, "x_height": os2.sxHeight, "cap_height": os2.sCapHeight, "glyphs": {}}
for ch in chars:
    gn = cmap.get(ord(ch))
    if gn is None:
        continue
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.0f}")
    gs[gn].draw(pen)
    d = pen.getCommands()
    if not d:
        continue
    out["glyphs"][ch] = {"d": d, "adv": f["hmtx"][gn][0]}
path = os.path.join(root, "src/scenes/mathjax-fonts/patrickhand.json")
with open(path, "w") as fh:
    json.dump(out, fh, separators=(",", ":"), ensure_ascii=False)
print(f"{len(out['glyphs'])} glyphs → {path} ({os.path.getsize(path)} bytes); missing: {[c for c in chars if c not in out['glyphs']]}")
