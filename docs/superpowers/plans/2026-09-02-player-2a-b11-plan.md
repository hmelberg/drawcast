# Player Part 2a + B11 — plan (2026-09-02)

Scope, from `ROADMAP-2026-09.md` §F (split per the review's R4 + revision 2):

- **Part 2a** = all-SVG control icons + the subtitle band. NOT in scope
  (that is 2b): progress-bar row, title move, chapter gates, hover-scrub.
- **B11** = `render()` resolves portraits/sources on the document's own
  spec objects; fix once by resolving on clones at render entry.

## Task 1 — B11: render resolves on a clone

`render()` (`src/render/index.ts:117`) calls `resolvePortraits(spec)` /
`resolveSources(spec)` on whatever spec it was handed, and
`playlist/session.ts` hands it the document's own objects. Both resolvers
fill `strokes`/`source`/`of`/links IN PLACE, so *viewing* a drawcast
rewrote the author's document: strokes leaked into library saves
(`autosave()` serializes `doc.playlist`), and the embed count lied until
it was patched to re-parse the editor text (`main.ts:4048`).

Fix mirrors `publish/embed.ts`: new `src/render/resolve.ts` with
`resolvedRenderSpec(spec, deps)` — structuredClone, resolve on the clone
(failures swallowed, as today), return the clone. `render()` uses it at
entry with the real resolvers; everything downstream (layout, plan,
`handle.spec`) reads the resolved clone. Deps injected so a node test can
prove the guarantee with scribbling fakes (same idiom as
`tests/publish-embed.test.ts`).

Test: `tests/render-resolve.test.ts` — input spec byte-untouched, clone
scribbled, a rejecting resolver does not throw.

## Task 2 — Part 2a icons: one material, every glyph

`ui/controls.ts` mixes geometric text glyphs (`▶ ⏸ ▭ ⛶ ⋯ ↺`) with true
emoji (`🔊 🔇`, and `⏮ ⏭` are emoji-class too) — macOS renders the emoji
as full-colour bitmaps that ignore `currentColor` (C8, D6.1, review R4:
widen to every glyph in one pass).

- New `src/ui/icons.ts`: `ICON_PATHS` (pure data, 24×24 material-style
  paths) + `icon(name)` factory → inline `<svg class="cs-icon"
  fill="currentColor" aria-hidden>`. Names: play, pause, replay, prev,
  next, volume, muted, theater, fullscreen, more.
- `ui/controls.ts`: every bar glyph + bigPlay swap from textContent to
  `replaceChildren(icon(...))`. CC stays the "CC" wordmark (it is one,
  like YouTube's).
- `src/styles.css`: `.cs-icon` sizing (1em box), flex-center
  `.cs-bar-btn`/`.cs-bigplay` so icons sit like the text did.

Test: `tests/icons.test.ts` — inventory drift test on the pure data
(every name non-empty, states distinct: play≠pause, volume≠muted).

## Task 3 — Part 2a subtitle band (A6/D1)

`render/figure-style.ts:35` — band alpha 0.82 is nearly opaque ink over
the drawing. D1: keep contrast, lose visual weight — lower alpha + a
stronger text shadow. Alpha is chosen by computation, not eyeball: the
worst case is the band over bare paper `#fffefb`, and the white caption
text `#fbf8f1` must keep ≥ 4.5:1 against the blend (WCAG AA, computed
with `tests/contrast.ts` — never claimed unmeasured).

- Export the band constants from `figure-style.ts`; interpolate into
  `FIGURE_CSS`.
- `tests/caption-band.test.ts`: blend band over paper, assert ≥ 4.5:1
  AND alpha ≤ 0.65 (drift both directions: readable, but never back to
  a wall of ink).

Note: the roadmap's worry that the band is burnt into exports is stale —
`export/video.ts` paints captions *below* the figure in ink on paper and
never draws the CSS band. Player-only change.

## Order and verification

B11 → icons → band; one commit each; `npx vitest run` green between
tasks; roadmap ticks (A6, B11, C8) + ledger at the end.
