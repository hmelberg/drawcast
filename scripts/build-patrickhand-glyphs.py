#!/usr/bin/env python3
"""Glyph outlines for formulas in the drawing's own hand, as SVG path data
(src/scenes/engines.ts substitutes them into MathJax's layout via
src/scenes/math-hand.ts). Two faces, two JSON files, each entry {d, adv} in
the face's own units-per-em, y-up coordinates — the space MathJax's glyph
paths use — plus the face's x-height, which the engine scales to Fira's:

  public/fonts/patrickhand/PatrickHand-Regular.ttf (OFL) → patrickhand.json
    ASCII letters, digits, punctuation, every math symbol the face has
    (≤ ≥ ≠ ≈ ∞ ± × ÷ ∑ ∫ · −) and its four Greek letters (λ μ π Ω): the
    drawing's hand, the face labels use.
  scripts/fonts/PlaypenSans-Greek400.ttf (OFL; Playpen Sans instanced at
    weight 400 — the weight that matches Patrick Hand's stems — and subset
    to Greek) → playpen-greek.json: the Greek alphabet, ς and ∂, for the
    letters Patrick Hand lacks.

Run again only if a TTF changes:  python3 scripts/build-patrickhand-glyphs.py
"""
import json, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GREEK = [chr(c) for c in range(0x391, 0x3AA)] + [chr(c) for c in range(0x3B1, 0x3CA)] + list("∂")
# …plus the four Greek letters Patrick Hand does have (λ μ π Ω): preferred
# over Playpen's, since they match the labels and read more clearly.
LATIN = [chr(c) for c in range(0x21, 0x7F)] + list("×÷±°−·≤≥≠≈∞∑∫λμπΩ")

def build(ttf, chars, out_name):
    f = TTFont(os.path.join(root, ttf))
    cmap = f.getBestCmap()
    gs = f.getGlyphSet()
    out = {"upm": f["head"].unitsPerEm, "x_height": f["OS/2"].sxHeight, "cap_height": f["OS/2"].sCapHeight, "glyphs": {}}
    for ch in chars:
        gn = cmap.get(ord(ch))
        if gn is None:
            continue
        pen = SVGPathPen(gs, ntos=lambda v: f"{v:.0f}")
        gs[gn].draw(pen)
        d = pen.getCommands()
        if d:
            out["glyphs"][ch] = {"d": d, "adv": f["hmtx"][gn][0]}
    path = os.path.join(root, "src/scenes/mathjax-fonts", out_name)
    with open(path, "w") as fh:
        json.dump(out, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"{len(out['glyphs'])} glyphs → {path} ({os.path.getsize(path)} bytes); missing: {[c for c in chars if c not in out['glyphs']]}")

build("public/fonts/patrickhand/PatrickHand-Regular.ttf", LATIN, "patrickhand.json")
build("scripts/fonts/PlaypenSans-Greek400.ttf", GREEK, "playpen-greek.json")
