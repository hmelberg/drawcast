# Code element — run Python/R scripts inside a drawcast

Date: 2026-09-02. Status: draft for review.

## 1. Goal

A new tier-2 element type `code`: a script (Python or R) whose **code and/or
output** appears inside a drawcast figure. The storyboard can reveal the code
line by line with narration, or skip the code and show only the output. The
container is an ordinary element — sized and positioned like any other, from a
small panel beside a diagram up to effectively the whole canvas.

Ruling answers that shaped this design (Hans, 2026-09-02):

- **Mostly AI-written code.** The compiler prompt and repair loop must carry
  this element, not just the schema.
- **Whole-script execution is fine for v1.** Per-block incremental output is v2.
- **Live execution is the default.** Running on the viewer's machine gives
  flexibility (future: viewer-supplied parameters/code). Bake-on-publish is an
  optional later feature, not the core mechanism.
- **Plotly matters.** Pure-Python plotly express suits a future Brython tier;
  plotly.js is used with pyodide today; R can emit plotly via ggplotly.
  Plotly's SVG export fits drawcast's SVG-only constraint perfectly.

## 2. Principles (constraints from the house architecture)

1. **Isolated and modular.** All machinery lives in a new `src/code/` module.
   Core changes are additive registrations only (type union, schema enum,
   one dispatch case, one resolver injection, engine-registry entries).
2. **Lazy.** A spec with no `code` element loads zero extra bytes. A Python
   spec never fetches webR and vice versa. Runtime modules are reached only
   via dynamic `import()` inside `src/code/` (the same code-split effect as
   the `ENGINE_DEFS` loaders — but the template-engine registry itself stays
   untouched; it is template machinery), and the runtimes themselves load
   from pinned CDN URLs — never bundled, so `dist-engine` stays small and the
   vendored engine (xplainer) works unchanged.
3. **SVG only.** Code lines are text drawables, stdout is text drawables,
   plots are image drawables with data URIs. No HTML overlay — that is the
   only way scrub, step-back, and video export stay exact
   (`src/export/video.ts` serializes only the SVG).
4. **Execution happens in the resolve phase, never during playback.**
   Same seam as `source` PDF fetching: `resolvedRenderSpec` clones the spec
   (B11 — never mutate the author's document), an injected `resolveCode`
   runs the script and stashes results on the clone, layout stays synchronous,
   export starts only after resolution. Failures degrade to a visible error
   panel and a warning — never a throw.
5. **Deterministic where it counts.** Results cached in IndexedDB keyed by
   `hash(language, code, runtimeVersion, CODE_VERSION)` (the `sourceCacheKey`
   pattern), so replays, scrubs, and re-renders never re-execute. The prompt
   instructs the model to seed randomness.

## 3. Spec surface (model-facing)

New element fields on the flat `SpecElement`:

| Field | Type | Meaning |
|---|---|---|
| `type` | `"code"` | new literal in the `ElementType` union |
| `language` | `"python" \| "r"` | required; future tiers (`brython`, `micropython`) slot in behind the same interface |
| `code` | `string` | required; the script, newline-separated |
| `show` | `"output" \| "split" \| "code"` | default `"output"`; `split` = code pane left, output pane right |
| `x`, `y`, `width` | number | usual logical geometry; default large and centered (≈ `x:500, y:400, width:880`); height computed from content |
| `font_size` | number | optional, code text size |

Sub-drawable ids, addressable by every visibility verb:

- `<id>_line_1 … <id>_line_n` — one per code line (only when code is shown)
- `<id>_out` — the whole output group (stdout text + figures)
- v2: `<id>_out_1 … <id>_out_k` per top-level block

No new command verbs. Line-by-line stepping is ordinary storyboard:

```yaml
elements:
  - id: demo
    type: code
    language: python
    show: split
    code: |
      import pandas as pd
      df = pd.DataFrame({"x": [1,2,3], "y": [2,4,9]})
      print(df.describe())
      df.plot.scatter(x="x", y="y")
commands:
  - draw: [demo_line_1]
    speak: "First we import pandas."
  - draw: [demo_line_2]
    speak: "Then a tiny data frame."
  - draw: [demo_line_3, demo_line_4]
    speak: "Describe it — and plot it."
  - draw: [demo_out]
    speak: "And here is what comes out."
```

`draw: [demo]` shows everything at once; `show: output` with `draw: [demo_out]`
is the "just the result" mode. Scrub and step-back are exact because
`plan.states` already records visibility at every step boundary.

## 4. Execution architecture (`src/code/`)

One facade, pluggable runtimes:

```ts
runCode({ language, code, onStatus? })
  → { ok, stdout, stderr, figures: Figure[], error? }
// Figure = { kind: "png" | "svg", dataUri: string, w?, h? }
```

- **Runtime loaders** registered in `ENGINE_DEFS` (`src/scenes/engines.ts`):
  `pyodide`, `webr`, `plotlyjs`. Dynamic import / injected script from pinned
  CDN URLs. `ensureEnginesForSpecs` is extended to detect `code` elements so
  prewarming starts as soon as a spec is known.
- **Bootstrap hardening** ported from openstat, not xplainer: memoized
  in-flight promise (no half-initialized interpreter race), eager base
  package load for pyodide, status callbacks for the loading pill.
- **Versions pinned.** Modern pyodide (not xplainer's 0.24.1); webR pinned to
  a specific version (xplainer's unpinned `latest` is a known hazard).
- **Serialization.** One promise queue per runtime; runs never interleave.
- **Timeouts.** A watchdog per run (generous — first run includes runtime
  boot). `webR.interrupt()` is real; Python interrupt only works with
  SharedArrayBuffer + COOP/COEP headers — best-effort in v1, noted for later.
- **Packages.** Python: `loadPackagesFromImports` + micropip. R: regex
  `library()/require()` → `installPackages` (documented limitation:
  `pkg::fn`-only usage is invisible).
- **Trust model:** same as xplainer/openstat — author/AI code runs in the
  browser WASM sandbox on the viewer's machine. Documented, accepted.

### Output capture

- **Python stdout/stderr:** `setStdout`/`setStderr` batched; AST wrapper for
  notebook-style last-expression echo (port from xplainer). **Keep full
  tracebacks** — xplainer's `e.message`-only error handling loses them.
- **matplotlib:** post-run harvest `plt.get_fignums()` → PNG data URIs
  (`bbox_inches="tight"`), then `plt.close("all")`. Probe is a no-op when
  matplotlib was never imported (skip it entirely unless the code mentions
  matplotlib/plt — cheaper than xplainer's run-always probe).
- **plotly (Python):** detect plotly figure objects → `fig.to_json()` →
  lazy-load plotly.js → offscreen render → `Plotly.toImage(format: "svg")` →
  `data:image/svg+xml` URI. Vector-crisp in export. PNG fallback.
- **R:** webR `Shelter.captureR(code, { withAutoprint: true })` — base
  graphics and ggplot2 both arrive as ImageBitmaps from the canvas device →
  PNG data URIs. Keep stdout/stderr entries distinguishable (xplainer merges
  them). **Purge the shelter after each run** (xplainer never does — R objects
  accumulate all session).
- **Known xplainer bug to not copy:** its webR handler's output-only branch
  runs Pyodide on R source. The facade here has one dispatch point.

## 5. Rendering (`codeDrawables` in the tier-2 dispatch)

- **Geometry.** `show: "split"`: code pane ≈ 55 % of width on the left,
  output pane on the right. `"output"` / `"code"`: single pane, full element
  width. Height computed from line count and output size, capped to the
  canvas; figures fitted into the output pane preserving aspect.
- **Code lines** are `TextDrawable`s in a **monospace font**. This needs one
  small generic backend addition: a `font: "sketch" | "mono"` field on
  `TextDrawable`, threaded through `drawLeaf`, `makeBrowserMeasure`, and
  `heuristicMeasure`. Long lines wrap with hanging indent (a wrapped line is
  still one `_line_i` drawable). No syntax highlighting in v1.
- **Output**: stdout as monospace text lines; figures as `ImageDrawable`s
  (data URI — required by the model) with the existing `reveal` fades;
  stderr/error state renders as a visibly distinct error panel (the figure
  still plays — degrade, don't die).
- A light frame/background area drawable gives the container its "panel" look,
  consistent with the sketchy/clean style toggle.

## 6. AI generation

- **Schema descriptions** in the house voice (what it is, when to use it,
  when not to), including: keep scripts short (≤ ~14 lines), seed randomness,
  `print()` what the narration will mention, at most one plot per element
  unless asked.
- **Prompt bullet** in `compiler-v1.md` beside the `portrait`/`source`
  bullets, with a worked snippet; one few-shot pair in `fewshots.json` /
  `examples.json`.
- **Execute-in-repair-loop:** during `generateSpec` validation, if the spec
  contains `code` elements, actually run them (authoring time, bounded by the
  usual timeout, at most once) and feed stderr into the existing repair round.
  AI-written code that errors gets repaired before the author ever sees it.
  Flag-gated; on by default in the app, off in embedded/engine contexts.
- **Blob hoisting:** resolved outputs (stdout, figure data URIs) are stamped
  fields → add to `carriesBlob` in `src/llm/hoist.ts`. The `code` string
  itself stays visible to the model (it is semantics, not blob).

## 7. Player, loading UX, viewer cost

- **Player:** nothing new. Line stepping, `parallel`, highlight, erase, focus
  all work on the sub-ids for free.
- **Loading UX:** resolution happens before mount, and a first-ever Python
  run costs a multi-MB download. The resolver reports status
  (`loading runtime → installing packages → running`) which the app surfaces
  in its existing loading affordance; prewarm starts at spec load.
- **Cost table:** no code element → 0 bytes. Pyodide ≈ 12 MB CDN (browser-
  cached across figures and sessions); webR similar class; plotly.js ≈ 1 MB.
  IndexedDB result cache means each unique script executes once per machine.

## 8. Explicitly out of v1 (designed-for, not built)

1. **Per-block incremental output** (`<id>_out_k`, cumulative execution at
   resolve time — still deterministic and export-safe).
2. **Brython/MicroPython tier** (donor: brython-engine repo), including
   pure-Python plotly express — tiny payload, instant boot, emulated libs.
3. **R plotly / ggplotly** (htmlwidget JSON → plotly.js path).
4. **Input-driven live figures:** viewer supplies parameters or code via the
   existing `ask`/`explore` gates → re-run → update. `runCode` is stateless
   and cacheable precisely so this composes later via `RenderHandle.update`.
5. **Bake-on-publish option** (outputs stamped into the published YAML, like
   the narration audio bake) for frozen, runtime-free published documents.
6. **Interactive output overlay** (`interactive: true`): in the player, a
   live plotly div (or other widget) is positioned exactly over the static
   image's rect (via `clientPointFor`) — hover, zoom, widgets — while export,
   scrubbing, and step-back keep using the static SVG underneath. This is the
   house "SVG truth + HTML enhancement" pattern (media modal, quiz card):
   the fallback exists by construction, no hand-maintained export painter.
   Ruled 2026-09-02: HTML-first was considered and rejected — it would forfeit
   free line stepping/scrub/camera integration and require a duplicate canvas
   renderer for video export; interactivity arrives as enhancement instead.
   A scrollable long-output overlay can use the same trick if ever needed.
7. Syntax highlighting; editable code cells.

## 9. Testing

- Facade behind injected deps (the `SourceDeps` pattern): tests never load
  WASM — a fake runtime returns canned `{stdout, figures}`.
- Layout tests for `codeDrawables`: geometry per `show` mode, sub-id naming,
  wrapping, error panel (node env, mini-dom).
- Schema/lint/prompt drift tests modeled on `tests/source-element.test.ts`.
- Live pyodide/webR runs are verified by a manual smoke checklist (vitest is
  node-only by design).

## 10. Milestones

- **M1 — Python end-to-end:** element + schema + lint, `src/code/` facade,
  pyodide runner (stdout + matplotlib), all three `show` modes, line sub-ids,
  mono font, IndexedDB cache, prompt + few-shot, execute-in-repair-loop.
- **M2 — R:** webR runner, stdout/stderr distinction, shelter purge.
- **M3 — plotly (Python)** → SVG data URIs.
- **M4+ —** per-block outputs, Brython tier, input-driven figures, bake
  option (ordered by appetite at the time).

## 11. Core touch points (isolation audit)

| File | Change |
|---|---|
| `src/spec/types.ts` | `"code"` literal + element fields (additive) |
| `src/spec/schema.ts` | enum + properties + `elementErrors` case |
| `src/layout/tier2.ts` | one `case "code"` → delegates to new module |
| `src/render/index.ts` / `resolve.ts` | inject `resolveCode` resolver |
| `src/llm/hoist.ts` | output fields in `carriesBlob` |
| `src/render/svg-backend.ts` + measure | `font: "mono"` on text (small, generic) |
| `src/llm/prompts/*` | one bullet + one few-shot |
| **new** `src/code/*`, `src/layout/code.ts`, tests | all the actual machinery |
