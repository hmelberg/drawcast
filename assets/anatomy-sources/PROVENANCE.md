# Anatomy sources

## human-skeleton-front.svg

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
