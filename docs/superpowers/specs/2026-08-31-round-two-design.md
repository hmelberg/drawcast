# Design: Where documents live, when things redraw, and what drawcast looks like

*2026-08-31, second round, after
`2026-08-31-editor-shell-design.md` shipped. Hans's brief: "save should save
to: disk, github, google doc. Same with open. The choice between yaml and json
(dropdown) can be made invisible. The insert portrait and pin images can be in
the insert menu. Rerender should (maybe?) also just be invisible and automatic.
Pressing play should always rerender the yaml (if it has changed). Also the
color theme and style is a bit ugly. Also the drawcast 'logo' is ugly."*

## Goals

1. **One home for documents.** `Open ▾` and `Save ▾` each reach disk, GitHub
   and Google Drive; Share keeps only the destinations that carry a drawcast
   to an audience.
2. **Saving the source to GitHub**, as a committed `.yaml` — real version
   history on the document, not just on the published page.
3. **Delete two controls that ask questions nobody wants asked**: the
   YAML/JSON picker and `↻ Re-render`.
4. **Redraw when it matters**, without redrawing on every keystroke.
5. **A palette with edges and readable text**, in light and dark, keeping the
   warm-paper identity.
6. **A mark drawcast draws itself**, usable as a favicon, an avatar and a
   video watermark.

## Non-goals

- **Google Docs.** "Google Doc" in the brief is read as Google **Drive**, which
  is what exists. A YAML spec inside a Doc is a wall of preformatted text with
  no gain. Flagged to Hans; revisit only if he meant it literally.
- **Inverting the figures in dark mode.** See §5.3 — the drawing keeps its
  paper. Changing that changes every exported video.
- **`Insert source…`.** The menu makes room for it; the element already
  exists; the insert UI is not built this round.
- **A build step for the mark.** §6 generates it once and commits the output.
- **Re-rendering on a timer or on every keystroke.** See §4.

## 0. What is actually there — verified, not assumed

- **`commitFiles(repo, token, branch, files, deletions, message, fetchImpl)`
  is already exported** from `src/publish/github.ts:252`, and takes
  `PublishFile { path, content }[]`. Saving source to GitHub is a new *caller*,
  not new machinery. `parseRepo`, `preflight`, `readFile`, `slugify` and the
  `courses.json` manifest helpers are all exported beside it.
- **`↻ Re-render` does more than redraw** (`main.ts:2584-2596`): it reparses
  the textarea, rebuilds `doc` carrying the id forward, **pushes a manual-edit
  history entry** (`pushManualEdit`) and **autosaves**. Any automatic
  replacement must keep all four, which is why a keystroke-driven version is
  wrong — it would mint a history entry per character.
- **Play lives inside the mounted session.** `present()` mounts a playlist into
  `previewHost` via `mountPlaylist`, and `attachPlayerControls` builds the play
  button inside it. Re-rendering **destroys and rebuilds that session** — the
  trap in §4.2.
- **The figure already owns its own ground.** `src/render/figure-style.ts`
  hardcodes `background: #fffefb` (lines 12 and 65) rather than reading a
  chrome token. So keeping paper in dark mode is nearly free.
- **But the figure's caption reads `var(--ink, #3d3833)`**
  (`figure-style.ts:77`). Flipping `--ink` for dark chrome would put light text
  on the figure's white paper. §5.3 fixes this explicitly; it is the one way
  dark mode could silently damage the drawings.
- **There is no `prefers-color-scheme` anywhere** in `styles.css` — dark is
  entirely new.
- **Measured contrast, current palette:**

  | Pair | Ratio | Required |
  |---|---|---|
  | `--line` `#d8d2c2` on `--paper` `#f5f1e6` | **1.33:1** | 3:1 (UI edges) |
  | `--muted` `#8f887c` on `--surface` `#fffdf6` | **3.45:1** | 4.5:1 (text) |

  These two numbers are the "ugly" feeling: nothing has an edge, and every
  hint and count in the app is set too light to read.
- **`--rust` does six jobs**: mode-toggle fill, `button.primary`, the squiggle,
  hovers, `.cs-progress-fill`, `.library-open:hover`.
- **Six type sizes below 1rem** are in use: 0.92, 0.85, 0.82, 0.78, 0.75rem
  and the 0.9rem course textarea.
- **The wordmark** is `h("div", { class: "wordmark squiggle" }, "drawcast")`,
  Patrick Hand at 2rem, over `.squiggle` — a **repeating** SVG background tile
  (`styles.css:38`) that tiles and clips wherever the word happens to end.
  The favicon is a `✏️` emoji data-URI in `index.html:7`. There is no mark.

## 1. Open and Save

```
Open ▾                        Save ▾
 ├─ From disk…                 ├─ To disk…
 ├─ From GitHub…               ├─ To GitHub…
 └─ From Google Drive…         └─ To Google Drive…
```

**Share loses its Spec file destination**, becoming Link · YouTube · Video
file — only ways a drawcast reaches an audience. Downloading your own source
is a save, and it now lives with the other saves.

Consequences, both of which bite if unhandled:

- **`Settings.shareTo` may hold `"spec"`** from the shipped build. `ShareTo`
  drops that member, so `loadSettings()` maps a stored `"spec"` to `"link"`.
  Without this, Share opens on a destination that no longer exists.
- **`Save → To disk` carries the format choice** (§2), so the download keeps
  working exactly as Share's Spec file did — same `formatPlaylist`, same
  filename rule.

### 1.1 Saving source to GitHub

A new caller of `commitFiles`, writing one file:

- **Path**: `joinPath(settings.coursesDir, "sources", `${slug}.yaml`)`, slug
  from `slugify(doc.title)`.
- **The document remembers its path.** `Doc` gains `sourcePath: string | null`,
  set after a successful save, exactly as `publishedAs` records the published
  slug. Re-saving overwrites that path instead of minting a second file; a
  retitled document keeps its original path until the author says otherwise.
- **Commit message**: `Save "<title>"`.
- This is **not** publishing. Publishing commits a rendered viewer page for an
  audience; this commits the source you are editing. Both may exist for one
  document, and the UI must never suggest one implies the other.

### 1.2 Opening from GitHub

The Contents API makes directory listing awkward and costs a call per entry.
Instead, **Save maintains `sources/index.json`** — the same manifest pattern
`courses.json` already uses (`github.ts:141-190`):

```json
{ "sources": [ { "path": "sources/ricardo.yaml", "title": "Ricardo on trade", "ts": "2026-08-31T…" } ] }
```

Saving writes the file and upserts its manifest entry in the **same commit**,
so the two can never disagree. Opening reads one file, lists what it names,
and fetches the chosen path with `readFile`. A repo whose manifest is missing
opens to "Nothing saved to this repository yet", not an error.

## 2. The format picker disappears

- The editor **always shows YAML**. `formatPlaylist(playlist, "yaml")`.
- **Parsing still accepts both**, unchanged — nothing about reading changes.
- `Settings.specFormat` survives as the remembered default inside **Save → To
  disk**, which is the only place the question is real.
- A document previously displayed as JSON comes back as YAML after its next
  render. Intended.

## 3. `🖼 Images ▾`

Replaces `＋ Insert` and absorbs `📌`:

```
🖼 Images ▾
 ├─ Insert portrait…
 └─ Pin all images
```

`Insert source…` joins the list when that UI is built.

**Pin's explanation leaves its tooltip.** It becomes visible text in a small
confirm dialog naming what will be embedded and what it costs — today the only
place it exists is a `title=` attribute, which touch never shows, and which
Hans (the author of the feature) had to ask about because it was invisible.
The dialog says, in substance: every portrait's traced strokes and every
source's page image are written into the spec text, so the drawcast renders
identically forever — offline, on any machine, and after a link dies or an API
is discontinued — at the cost of a larger document.

## 4. Redrawing

### 4.1 `↻ Re-render` disappears

It is replaced by `ensureRendered(): boolean`, which does exactly what the
button did — reparse, rebuild `doc` carrying the id, `pushManualEdit`,
`autosave`, `present()` — but only when `specArea.value` differs from the text
last rendered, and returns whether it re-rendered.

It runs at the moments something needs the current text:

- pressing **Play**
- switching to **Player** mode
- opening **Share**
- starting an **export**
- **Save**, to any destination

Not on a timer, not on a keystroke, not on a debounce: half-typed YAML is
invalid, so a debounce would flash parse errors while the author types, and a
keystroke-driven version would push a history entry per character (§0).

### 4.2 The Play trap

**Re-rendering destroys the session that owns the Play button.** A naive
"re-render, then play" makes the press vanish: the button the author clicked
belongs to a player that no longer exists, and a fresh idle one takes its
place.

So `present()` gains an "and then play" flag, and the Play path is:

1. `ensureRendered()` — if it returns false, play the existing session as now.
2. If it returns true, the new session **starts playing once mounted**.

This is the one genuinely fiddly mechanic in this round. Without it the visible
symptom is "pressing play does nothing", which reads as a broken player rather
than a stale render.

### 4.3 The edited dot

While `specArea.value` differs from the last rendered text, the preview pane
bar shows a small dot with the title "Edited — plays from the new text". It
disappears the moment `ensureRendered()` runs. Silent staleness is the only
real risk this change introduces; the dot is what removes it.

## 5. The palette

### 5.1 Tokens

| Token | Now | Becomes | Why |
|---|---|---|---|
| `--paper` | `#f5f1e6` | `#efe9da` | the page sits back so panels can lift |
| `--surface` | `#fffdf6` | `#fffdf8` | panels read as raised, not adjacent |
| `--line` | `#d8d2c2` | `#c2b9a4` | 1.33:1 → **3.0:1**, a real edge |
| `--muted` | `#8f887c` | `#6f685c` | 3.45:1 → **4.6:1**, readable |

Every ratio in this table is asserted by a test (§8), computed from the
tokens rather than eyeballed.

### 5.2 One job for the accent

`--rust` keeps `button.primary` and nothing else. Its five other uses become
structural: the active mode pill uses `--ink`; hovers use an `--ink`-mix step;
`.cs-progress-fill` uses `--ink`; `.library-open:hover` uses `--ink` with the
existing dotted underline; `.squiggle` is deleted with the wordmark (§6).

### 5.3 Dark — and the figure stays paper

A dark palette under `@media (prefers-color-scheme: dark)`, plus an explicit
**Appearance** setting (System / Light / Dark) writing `data-theme` on the
root, so the media query and the choice can both win in the right order.

**The figure keeps its paper ground.** `figure-style.ts` already hardcodes
`#fffefb`, so this is nearly free — a sheet of paper on a dark desk, and an
exported video that looks the same as the editor showed.

**The trap that makes it not quite free:** `figure-style.ts:77` sets the
figure's caption to `var(--ink, #3d3833)`. If `--ink` flips light for dark
chrome, that caption becomes light text on white paper — invisible, inside the
drawing, in the exported video. The figure's own styles must therefore stop
reading chrome tokens: `figure-style.ts` gets literal ink values, or a
figure-scoped `--fig-ink` that never changes with the theme. A test pins that
no chrome token leaks into the figure's styles.

### 5.4 Type scale

Three sizes replace six: **1rem** body, **0.875rem** secondary, **0.8rem**
dense (bar controls, counts). The 2rem wordmark stays.

## 6. The mark

`src/brand/mark.ts` draws the mark with **roughjs** — the same engine that
draws every figure — as an SVG string: a single sketched stroke resolving into
a play triangle. draw, and cast.

- **A fixed seed is mandatory.** roughjs randomises by design; without
  `options.seed` the logo reshapes itself on every reload, which reads as a
  rendering bug. The seed is a constant, and a test pins that two calls produce
  identical output.
- **Generated once, committed.** A script writes `public/mark.svg`; that file
  is what the topbar, the favicon and the video watermark use. The mark is
  genuinely drawn by the product without adding a build step to every deploy.
- **The favicon** stops being `✏️` and becomes the mark, so the tab, a YouTube
  channel avatar and an end-card watermark are finally one identity.
- **The squiggle is deleted.** With a drawn mark, Patrick Hand on the wordmark
  is the single hand-made signal instead of three stacked.

## 7. Settings

Additions to `Settings` and `DEFAULT_SETTINGS`:

```ts
/** Appearance: follow the OS, or force one. Written to data-theme on :root. */
theme: "system" | "light" | "dark";
```

`theme: "system"`. `specFormat` stays (§2). `shareTo` loses `"spec"` and
migrates on load (§1).

`Doc` gains `sourcePath: string | null` (§1.1), persisted with the rest of a
saved drawing.

Appearance belongs on the **Playback** tab, beside the other things about how
drawcast looks and sounds.

## 8. Testing

`vitest`, `environment: "node"` — no DOM. Pure functions and source-text drift
tests, as established.

**Pure functions, unit-tested:**

- `contrastRatio(hex, hex)` → the ratio. Then assert each pair in §5.1 from the
  token values parsed out of `styles.css`, so the palette cannot regress into
  unreadability. This is the test that would have caught today's 1.33:1.
- `sourcePathFor(title, existing)` → the GitHub path, and that an existing
  `sourcePath` wins over a retitled slug.
- `sourceManifest(existing, entry)` → upsert semantics: same path replaces,
  new path appends, order stable.
- `needsRender(currentText, lastRenderedText)` → the `ensureRendered` decision,
  including that whitespace-only differences still count (the author may have
  fixed indentation, which in YAML is meaning).
- `markSvg(seed)` → identical output for identical seed, and non-empty path
  data.

**Drift tests against source:**

- No `formatSel` / format `<select>` remains in the editor bar.
- No `↻ Re-render` button remains.
- `figure-style.ts` contains no `var(--ink` or other chrome token (§5.3).
- Exactly one `@media (prefers-color-scheme: dark)` block, and every token
  redefined in it also exists on bare `:root`.
- `--rust` appears in `button.primary` and nowhere else in `styles.css`.
- The `.squiggle` rule and the `✏️` favicon are both gone.

**Regression:** the existing suite (155 files / 2598 tests) stays green. In
particular `share-destinations.test.ts` must be updated, not deleted, when
`"spec"` leaves the union.

## 9. Risks

- **The Play trap (§4.2)** is the highest-risk item: its failure mode looks
  like a broken player, not a stale render.
- **Dark mode reaching the figures (§5.3)** would alter exported video.
  Contained by making the figure's styles token-free and testing it.
- **Two GitHub paths** — publish and save-source — could be confused. Their
  labels and their status messages must never imply one another.
- **The `shareTo` migration** is easy to forget and only shows on a machine
  with existing settings, which a fresh test environment never has.
- **`sources/index.json` and the file must land in one commit**, or an
  interrupted save leaves a manifest naming a file that does not exist.

## 10. Order of work

1. Palette tokens, contrast test, type scale, `--rust` demotion (§5.1, §5.2,
   §5.4) — visible immediately, no behaviour change.
2. Dark mode and the figure-token fix (§5.3), with its drift test.
3. `ensureRendered` + the Play flag + the edited dot (§4) — the trickiest, and
   independent of the rest.
4. Format picker removal (§2).
5. `🖼 Images ▾` and Pin's dialog (§3).
6. Open/Save disk + Drive, Share loses Spec file, `shareTo` migration (§1).
7. GitHub source save + manifest + open (§1.1, §1.2).
8. The mark, the favicon, the squiggle's deletion (§6).
