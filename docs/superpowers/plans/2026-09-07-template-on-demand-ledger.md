# Ledger — template on demand (2026-09-07)

Step 3 of the plan in ROADMAP.md "Template on demand" (spike:
`2026-09-07-template-on-demand-spike-ledger.md`; step 1 parts drill:
`2026-09-07-parts-drill-ledger.md`; step 2 router:
`2026-09-07-template-router-ledger.md`). Hans: "gjør 3", with the ruling
that every generated template is saved automatically.

## The flow

1. A request is generated as usual. The router (step 2) says `none_fits`
   and the compiler drew freehand → the status line offers **"Author a
   template and redraw (~4 min)"**. An offer, never automatic.
2. On yes, `src/llm/on-demand.ts` `authorOnDemand()`:
   - **brief** — the repair model (Sonnet) reads the request plus a
     summary of the freehand spec's elements (its ids, words, attachments
     are the parts the compiler already found) and writes the brief a
     template author needs: an untaken snake_case id, the parts, the
     params, the requests to catch, what to leave out. Closed JSON schema;
     `parseBrief` rejects an illegal or taken id or a thin brief.
   - **author** — the shipped authoring pipeline (`llm/author.ts`), the
     brief prefixed with "Use the template id …".
   - **register + save** — `registerUserTemplateYaml` (never shadows a
     built-in); the editor then `saveMyTemplate`s it unconditionally and
     refreshes the Templates panel and the picker.
   - **redraw** — the same request through the app's own `generateSpec`
     with the new template forced (pedagogy pass, style, exemplars, brief
     and priority packs exactly as the first generation had them).
   - the template document is EMBEDDED in the redrawn spec:
     `spec.templates = [doc]`.
3. The editor replaces the document with the redraw (a new history entry
   "… (with a new template)"), status names the template and the rounds.

## The template travels with the cast

- `Spec.templates?: TemplateDoc[]` — document-only: in `documentSchema`
  (what `validateSpec` checks), never in the schema the model sees; each
  entry is validated as a TemplateDoc in `semanticErrors`.
- `src/scenes/cast-templates.ts` `registerCastTemplates(spec)`: registers
  every carried document, skipping any id a built-in, pack or My-templates
  copy already owns (the author's own later improvements win over the
  cast's snapshot), replacing an earlier cast's copy, reporting malformed
  ones without throwing and leaving no stub behind.
- Called from `render()` (render/index.ts — the editor, the playlist
  session, the viewer, embeds) and from `ensureEnginesForSpecs` (engines
  load before render, and a carried template's engines exist only once it
  is registered).
- Publishing needs nothing: a cast is the document text, and `templates`
  is a field of the spec.

## The authoring prompt, refreshed (`author-v1.md`)

- The seven engines named as the closed set, with the engine INTERFACES
  verbatim (engines.ts plus the anatomy/elements/space type files) instead
  of one prose paragraph about smilesdrawer.
- Fields not to declare: `interactions`, `explore`, `model3d`;
  `accepts_data` only for charts.
- **The parts rule**: a part is its own outlined drawable with a meaningful
  id plus a `label_<part>` label; offer a `labels` list param and a
  `language` names dictionary. This is what makes the identify drill,
  click/drag asks and info cards work on an authored figure for free.
- Never draw a title; keep clear of the subtitle band.
- Two exemplars: cell_diagram and the bundled violin from the spike.
- A repair-feedback section that says how to fix warnings.

Pipeline changes: `needsAuthorRepair(errors, lint, repairsUsed)` — warnings
earn exactly one repair round (the spike left label-on-stroke warnings on
2 of 5 templates); `partsIssues()` — the `drillable-parts` warn-level
lint fires when a figure of five or more top-level drawables exposes no
named outlined part (charts and curves pass; a figure of a thing with no
parts gets told what to add).

## Findings while running it

- **The 32k output ceiling was not enough.** The first live run's brief
  named twelve parts plus rigging and two arrows; Opus with thinking on
  ran past 32 000 output tokens and the authoring call failed. Three
  changes: `AUTHOR_MAX_TOKENS = 64000` (every call streams, so a large
  ceiling costs nothing until used; Opus 5 allows up to 128k), the brief
  prompt caps the parts at ten and the author prompt asks for a compact
  body, and `generateTemplate` retries ONCE after a cut-off with the last
  user turn amended ("smaller document, at most eight parts") at medium
  effort — the cut-off reply never reached the conversation, so the note
  rides on the existing user turn rather than a new one (turns alternate).
- **A mid-stream network error** killed the second run's authoring call
  after ~3 minutes ("Network error — check your connection (or CORS)", the
  SDK's connection error). Transient; the third run is the record below.
- **The effort dial** (Hans, mid-run): Settings gains `effort`
  (high / medium / low, default high = the API default), a select beside
  the model in the generate menu, threaded into the creative round of
  generate, revise and author (and template on demand); repairs and the
  pedagogy pass stay low; a cut-off retry runs one step lower. It changes
  thinking depth and spend — the output ceiling is a separate knob and is
  simply generous now.

## Verified

- 5341 vitest (cast-templates, on-demand with injected steps,
  author-rules, effort), tsc clean.
- End to end in the app page (Playwright, headless, real Opus calls),
  request "Show the parts of a sailing boat and what each does.":
  freehand generation with the router saying `none_fits` (1 round) →
  brief `sailboat_anatomy` (1 077 chars) → authored in ONE round, no
  repair → redrawn with the template forced in one round, the document
  carried in `spec.templates` → the carried spec rendered in a FRESH
  browser context (empty localStorage, template not in the registry
  before): no warnings, lint clean, 24 drawables. 398 s wall for the whole
  chain, of which the authoring call is most. Third attempt: the first
  overran the 32k ceiling, the second lost its stream (both above).

## Follow-up the same evening (Hans): progress, cost, courses

- **What the model is writing, visible.** The spec pane always streamed the
  reply, but it sits inside the editor, which is folded while one waits.
  Now a `.editor-live` tail (last ~420 chars) shows under the status line
  during any streamed call, and `GenerateConfig.onPhase` names the phase
  between deltas: "choosing templates", "writing the spec", "repairing
  (schema | layout)", "teaching pass"; a multi-part run names the part
  ("part 3: authoring a template", "part 5: redrawing with …").
- **What it cost.** `llm/client.ts` keeps a call ledger — every call's
  model, uncached input, cache reads/writes and output — reset when a
  generation starts and summarised when it ends: "≈ $0.84 · 140k tokens
  in (124k cached) · 2k out · 3 calls" on the benzene-ring smoke (a cold
  cache: the first call writes ~46k tokens of prefix at 1.25×; a warm one
  is a few cents). List prices by model prefix, unknown models priced as
  Opus, always an estimate. Appended to the status of generate, multi-part,
  revise and template on demand.
- **Templates on demand, decided before Generate.** A checkbox in the
  generate menu ("Author templates when none fits", `settings.
  templatesOnDemand`, default off). On: a single figure the router found
  nothing for is authored a template and redrawn at once (no offer); a
  multi-part drawcast or a COURSE handles every such part after the
  parallel pass, one after another (`llm/multi.ts authorTemplatesForParts`):
  each part is first re-routed, because a template authored for an earlier
  part may fit it — then it is simply regenerated with the router's
  shortlist — otherwise it gets its own template. Every authored document
  is saved to My templates through `onTemplateAuthored` and embedded in
  every part that uses it. Off: the single-figure offer only; courses
  never stop to ask either way.
- **Courses now use the router.** The course panel built its config
  without `route` (so every lecture part shortlisted by keywords); it now
  gets the router, the effort setting and the on-demand switch through its
  deps, the same as Generate.
- The choices button's summary now names the effort and the on-demand
  switch beside the model.

Verified: 5348 tests; Playwright smoke of a real "Draw a benzene ring."
generation — phases seen in the status, the live tail visible on 28 of
the polls, the cost line at the end. The course path is wired but not
smoked live (a course run is ~20 Opus calls).

## Not done / follow-ups

- The offer appears only in the editor's single-figure flow. Multi-part
  (course) generation and host embeds log `route.noneFits` but do not
  offer; a lecture with several template-less parts would need a batch
  form of the offer.
- The brief goes to the repair model (Sonnet). If briefs prove thin, the
  main model is one config change away.
- No Wikipedia reference image yet (the recommendation was to measure it
  on an author bench first, after real `none_fits` requests accumulate).
- Sharing to a central library: roadmap item 4, not started.
- The Templates panel shows the saved template like any other; there is
  no marker that it was authored on demand.

## 2026-09-08 — the cap and the shared run (Hans: "bygg alle tre bitene, med låsen")

Hans asked for an off switch or a cap on templates authored in a course, and
that a template authored for one part be available at once to the other
drawcasts in the same course. Reading the code for the design found the
second was NOT the case: `authorTemplatesForParts` kept a local `authored`
map, and its re-route condition was `authored.size > 0` — so a lecture
re-routed only after it had itself authored something. Lectures run in
parallel (run.ts pours every part into one pool), so lecture A's template
was never tried on lecture B, and two lectures finishing together could
author twins for the same figure. The registry itself was live all along
(`routerIndexText` reads `scenes` directly); what was missing was the
shared state and the wait.

- **`src/llm/on-demand-run.ts`** — `createOnDemandRun(max)`: the cap
  (`take()`, a slot is spent whether the authoring succeeds or not — the cap
  bounds spend), `authored`/`skipped` counts, the `docs` map a re-routed
  part embeds from, and `lock(fn)` — a promise chain that runs callers one at
  a time in arrival order and survives a throw. `onDemandSummary(run)` is
  the status tail. `DEFAULT_ON_DEMAND_MAX = 3`.
- **`GenerateConfig.onDemandRun` + `templatesOnDemandMax`.** The course
  panel creates ONE run per `runCourse` and spreads it into the config; the
  multi-part Generate creates one per generation; `generateFromOutline`
  makes a private one from `templatesOnDemandMax` when none is given, so
  tests and embeds keep behaving.
- **The loop.** Per template-less part: inside the lock — re-route if
  `run.authored > 0` (returns the id to reuse), else `take()` or count as
  skipped with a phase line naming the cap, else author (docs/authored/
  onTemplateAuthored). The redraw of a REUSING part runs outside the lock,
  so a lecture that merely reuses does not hold the others. A skipped part
  still got its re-route first.
- **Setting** `templatesOnDemandMax` (store.ts literal 3, pinned equal to
  the module default by tests/settings-migration.test.ts; an older blob
  gets 3 on load). Generate menu: "at most [3] per run" beside the
  checkbox, whole numbers 0–20; choices summary "Templates on demand (≤3
  per run)". End status of a course or multi-part run appends
  " · 2 templates authored · 1 part left freehand (cap 3)".
- **Speed.** Nothing changes with the checkbox off. On: parts with a
  template are untouched; authoring is now sequential for the run (cap × ~4
  min worst case, was parallel across lectures with unbounded count and
  possible twins). One Haiku re-route (~1 s) per template-less part once
  anything was authored.

Tests: tests/on-demand-run.test.ts (cap, lock order, throw release,
summary), tests/on-demand-course.test.ts (two parallel lectures author ONCE
and both embed the document; cap 1 of 3 → 1 authored 2 skipped with a "cap"
phase; cap 0 authors nothing; a skipped part still reuses; the config cap
alone; the default of three; switch off). 5924 vitest, tsc clean.

Not done: a live course smoke with the switch on (~20 Opus calls plus the
authoring); the offer form for courses (roadmap item 5); help.html says
nothing about the cap (it says nothing about the checkbox either).

## 2026-09-09 — the trigger is the result, not the router (Hans: "gjør 1")

Hans's smoke: "Vis delene i en symaskin og hva hver gjør", switch on. A good
freehand drawcast, no template. Routed the request afterwards
(scratch script over vite's ssrLoadModule, one Haiku call each):

| request | router | none_fits |
|---|---|---|
| Vis delene i en symaskin og hva hver gjør | violin_anatomy | no |
| Show the parts of a sewing machine and what each does. | — | yes |
| Forklar hvordan en toalettsisterne fungerer. | hydraulic_press | no |
| Tegn en vulkan i tverrsnitt med navn på delene. | — | yes |
| Vis delene i en middelalderborg. | anatomy | no |

The compiler was shown the violin in full and composed freehand — the right
call — but the trigger in both main.ts and multi.ts was `route.noneFits`,
so neither the automatic path nor the offer fired. The English request
would have authored.

- **`on-demand.ts namedParts(spec)` / `templateWorthy(spec)`**: freehand
  (no `template`) and at least `MIN_PARTS` (3, imported from
  ui/parts-model) distinct drawables named by authored labels — the drill's
  reading of a label (meaningfulName, not on words, not a sub-drawable;
  `NEVER_A_PART` now exported) minus the drill's other sources: a node's
  words name a flowchart box, not a part of a thing, and a template for
  "the flowchart about X" is worth nothing. Both trigger sites use it; the
  router's verdict now only colours the status line.
- Tests: on-demand.test.ts (rule = MIN_PARTS; template → never; two labels
  on one drawable = one part; label on nothing/text/sub-drawable = none;
  three nodes = not worthy), on-demand-course.test.ts (freehand WITH parts
  handled though the router offered violin_anatomy; freehand WITHOUT parts
  left alone though the router said none_fits). The course fixture's
  freehand outcome gained three labelled parts.

Open (from the same smoke, not built): the router's precision in Norwegian
— a prompt line ("the template must draw THIS thing") plus Norwegian
freehand cases in the bench so it can be measured; the generation log
records no route, so after the fact only the status line ever said what
the router offered.
