# Anatomy sources

## BodyParts3D 3.0 (the atlas source since round 2, 2026-09-06)

- Title: BodyParts3D / Anatomography, release 3.0 (20110915), one adult male
- Publisher: The Database Center for Life Science (DBCLS), Japan
- Obtained via: https://github.com/Kevin-Mattheus-Moerman/BodyParts3D
  (binary STL conversions of the original OBJ files, plus `parts_list_e.txt`,
  `composite_parts.txt`, `conventional_part_of.txt`)
- Licence: **CC BY-SA 2.1 Japan**. Attribution: "BodyParts3D, © The Database
  Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan".
  Citation: Mitsuhashi N et al., Nucleic Acids Res. 2009;37:D782-5,
  doi:10.1093/nar/gkn613; archive doi:10.18908/lsdba.nbdc00837-000.
- Downloaded on demand by `scripts/build-anatomy-atlas.mjs` into
  `.cache/bodyparts3d/` (gitignored, ~150 MB, never committed). The derived
  atlas lives in `src/scenes/anatomy/atlas/` under its own LICENSE.
- Axes (measured 2026-09-06): patient's left is +x, anterior is −y, up is +z,
  millimetres. The frontal view is X = x, Y_down = z_top − z; draw depth is
  mean −y.
- Only leaf element files exist in the mirror; composites (heart, brain, skull,
  rib cage, vertebra sets, hand and foot bone sets) are assembled from
  `composite_parts.txt`. Sided hand/foot bones are the elements whose names
  carry "right"/"left". Not in the dataset: coccyx, thyroid gland, uterus (the
  uterus is the one authored part).

## human-skeleton-front.svg (RESERVE — no longer used by the build)

- Title: Human skeleton front en.svg
- Author: LadyofHats (Mariana Ruiz Villarreal)
- Source: https://commons.wikimedia.org/wiki/File:Human_skeleton_front_en.svg
- Licence: **public domain** (released by the author)
- Retrieved: 2026-09-06
- Verified on retrieval: viewBox 435.687 × 841.89; 909 `<path>` elements; 45
  named `<g>` groups on the skeleton layer (`layer3`) plus six unnamed ones and
  35 loose paths (one of them `id="Sternum"`); 28 `<text>` labels on `layer1`
  with leader lines drawn as `fill:none` paths; no embedded raster. Every
  path parses through `src/scenes/svgpath.ts` without error.
- Structure that the build relies on: every group carries its own `matrix` or
  `translate`; each bone is painted as several overlapping paths (base fill
  `#dcc06d`, shading `#ccb25c`, highlights `#f3d48c`/`#f9e3b7`, cartilage
  `#e1e2e3`); the bone's silhouette is the UNION of those paths.
- Not used: `Human skeleton (svg template).svg` (Häggström), derived from this
  file — its limbs are parked off-page and it embeds a 975×991 reference photo.

Public domain owes no attribution. The provenance is kept so the next person
knows what the atlas was derived from and can rebuild it.
