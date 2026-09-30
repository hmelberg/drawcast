# A picture to point into

Read this when the drawcast explains a picture (a screenshot, a diagram, a painting) part by part.
Two worked examples to copy from:
`docs/examples/2026-09-30-picture-regions-{microdata,arnolfini}.yaml`; the design
behind it: `docs/superpowers/specs/2026-09-30-picture-regions-design.md`.

- **Look at it yourself.** Download the picture (`curl -sL -o …`; Wikimedia
  serves only fixed thumbnail widths — 960, 1280, 1920, 3840) into `dev-casts/`
  and view it; the spec's `url` stays the public URL (the player fetches it).
  You are the app's mapper here: the prompt's line that "the app maps a
  picture URL for you" does not apply in the skill — nothing maps it, and `regions: auto` stays
  unmapped (the frames warn, and gestures on it point at nothing). Never
  write `regions: auto`.
- **Write the parts as boxes:** `image` with `url`, `look: screen`, `credit`,
  and `regions: {name: [x, y, w, h]}` — fractions of the WHOLE picture from
  its top-left, short English snake_case names; `view` to crop (fractions of
  the whole too). Aim with `"md:name"` in highlight/focus/`camera.on`, and
  `{ref: "md:name"}` in `point.at`/`camera.center`; `md@top` or
  `md@[x, y, w, h]` for an unnamed spot. Several places in one highlight are
  stops the light travels through.
- **Check every box in the frames** (SKILL.md step 6 draws each gesture
  mid-sentence): the light, the arrow and each zoom must land on the part the
  voice names — a box one button off is the usual slip; fix the numbers,
  not the story. Parts nested in parts (a mirror's glass) are fine.
- **Rights:** a site may refuse AI use of its pictures (microdata.no says so
  in its robots.txt). Tell the user when a picture comes from such a site; they
  decide. Always keep `credit`.
