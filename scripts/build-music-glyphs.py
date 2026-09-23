#!/usr/bin/env python3
"""Music symbols as SVG path data, for the `music` engine (src/scenes/music/),
from a SMuFL font — the W3C community standard for music fonts: every symbol
has a standard name, and the font ships metadata saying exactly where a stem
meets a notehead (design 2026-09-24-music-notation-and-staff §4.1).

  scripts/fonts/petaluma/Petaluma.otf            (SIL OFL 1.1, © 2018 Steinberg)
  scripts/fonts/petaluma/petaluma_metadata.json  (anchors, boxes, engraving defaults)
  scripts/fonts/petaluma/glyphnames.json         (SMuFL: name → codepoint)
  → src/scenes/music/glyphs.json

Everything is written in STAFF SPACES, y-up, each glyph at its own origin — a
SMuFL em is four staff spaces, so font units divide by upm / 4. The font file
itself is never shipped; only these outlines. The licence travels with them
(src/scenes/music/OFL.txt), and the data is not called "Petaluma" — the name
is reserved by the licence.

Run again only if the font or GLYPHS changes:  python3 scripts/build-music-glyphs.py
"""
import json, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, "scripts", "fonts", "petaluma")
out_dir = os.path.join(root, "src", "scenes", "music")

GLYPHS = [
    "noteheadWhole", "noteheadHalf", "noteheadBlack",
    "flag8thUp", "flag8thDown", "flag16thUp", "flag16thDown",
    "restWhole", "restHalf", "restQuarter", "rest8th", "rest16th",
    "gClef", "fClef", "cClef",
    "accidentalSharp", "accidentalFlat", "accidentalNatural", "accidentalDoubleSharp", "accidentalDoubleFlat",
    "augmentationDot",
    *[f"timeSig{d}" for d in range(10)], "timeSigCommon", "timeSigCutCommon",
    "fermataAbove", "brace",
    "dynamicPiano", "dynamicMezzo", "dynamicForte",
    "repeatLeft", "repeatRight", "segno", "coda",
]

def main():
    font = TTFont(os.path.join(src, "Petaluma.otf"))
    meta = json.load(open(os.path.join(src, "petaluma_metadata.json")))
    names = json.load(open(os.path.join(src, "glyphnames.json")))
    upm = font["head"].unitsPerEm
    k = 4 / upm  # font units → staff spaces
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    glyphs = {}
    for name in GLYPHS:
        cp = int(names[name]["codepoint"][2:], 16)
        gname = cmap.get(cp)
        if gname is None:
            raise SystemExit(f"{name}: U+{cp:04X} not in the font")
        pen = SVGPathPen(gs, ntos=lambda v: f"{round(v, 3):g}")
        gs[gname].draw(TransformPen(pen, (k, 0, 0, k, 0, 0)))
        bb = meta["glyphBBoxes"].get(name)
        entry = {"d": pen.getCommands()}
        if bb:
            entry["bbox"] = [round(bb["bBoxSW"][0], 3), round(bb["bBoxSW"][1], 3), round(bb["bBoxNE"][0], 3), round(bb["bBoxNE"][1], 3)]
        anchors = meta["glyphsWithAnchors"].get(name)
        if anchors:
            entry["anchors"] = {a: [round(v, 3) for v in p] for a, p in anchors.items() if a.startswith("stem") or a == "opticalCenter"}
        glyphs[name] = entry
    ed = meta["engravingDefaults"]
    data = {
        "source": "Petaluma (SIL OFL 1.1, © 2018 Steinberg Media Technologies GmbH) — outlines converted to staff spaces",
        "engravingDefaults": {key: ed[key] for key in ["stemThickness", "staffLineThickness", "legerLineThickness", "legerLineExtension", "thinBarlineThickness"]},
        "glyphs": glyphs,
    }
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "glyphs.json")
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"{len(glyphs)} glyphs → {os.path.relpath(path, root)} ({os.path.getsize(path)} bytes)")

if __name__ == "__main__":
    main()
