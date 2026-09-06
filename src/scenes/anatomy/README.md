# The anatomy atlas

Three generated JSON files. **Do not hand-edit them** — they are the output of
`scripts/build-anatomy-atlas.mjs`, and the next build will overwrite whatever
you typed.

To change the body:

- **Which source group is which bone, its names, parent or detail level** →
  `assets/anatomy-sources/skeleton-map.mjs`
- **A joint** → `assets/anatomy-sources/joints.mjs`
- **An organ** → `assets/anatomy-sources/viscera.mjs` (a blob, a hand-drawn
  polygon, or a tube; plus depth and colour)
- **The silhouette** → `BODY_OUTLINE` in `viscera.mjs`
- **How coarse the outlines are** → `TOL` / `MIN_AREA` in the build script

Then:

    node scripts/build-anatomy-atlas.mjs
    qlmanage -t -s 1000 -o assets/anatomy-sources assets/anatomy-sources/preview.svg
    npx vitest run tests/anatomy-atlas.test.ts

and LOOK at `preview.svg.png` before committing (delete the PNG afterwards; the
SVG is what is kept). No test can say whether a femur still looks like a femur.
Chrome headless renders it too, if QuickLook is not around:
`Google Chrome --headless=new --screenshot=<png> --window-size=1000,1000 file://<svg>`.

How a bone is extracted: every path in the source's skeleton layer is put
through its composed transforms; the paths of one bone (base fill, shading,
highlights, cartilage) are UNIONED with polygon-clipping; the union's outer
rings and holes are decimated. Regions are convex hulls of their bones. Joints
are the closest pair of vertices between two bones. Detail 1 draws regions,
2 bones and joints, 3 the small bones of hands and feet — a part is drawn at
the level where it is a leaf.

Adding a system (muscles, vessels, nerves): a fourth atlas file, a new value
in `AtlasSystem`, a new entry in the template's `systems` enum. The engine
merges by system already.
