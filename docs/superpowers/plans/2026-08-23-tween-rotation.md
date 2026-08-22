# 3D Primitives + Tween Rotation Implementation Plan (tier 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) 3D primitives that read as SOLIDS — spheres become balls (crescent shadow + highlight), and box/face primitives with normal-based flat shading land in `project3d` — then (2) a spec command `{"tween": {"azimuth": 200}, "duration": 2.5, "speak": "…"}` animates any numeric template param by re-running the template layout per frame — true smooth rotation for 3D molecules (live and in video export), and the same power for every parametrized template.

**Architecture:** Rotation is parameter animation, not a 3D feature. The Player gains a per-frame primitive: re-run `layoutSpec` with the item's spec plus interpolated param overrides, render the result FILTERED to the already-drawn element set, and swap the item's drawable SVG content (depth order is recomputed per frame by the template itself — occlusion correct by construction, per the Collingridge-style z-reorder but via full re-layout so shape-changing params also work). Boiling is prevented by pinning rough.js's `seed` per element id in the sketchy backend — same id, same jitter, frames morph instead of shimmering (the link's mutate-don't-rebuild idea, translated to rough). After the tween, the item's stored spec params are updated so all later draws/gestures/annotations target the new positions. Export drives the same tween by timestamp on its frame clock, so the motion is deterministic on video. `project3d` also gains optional sphere highlights (Collingridge's two-translucent-circles trick, one-circle sketchy version).

**Tech Stack:** existing Player/plan/renderer machinery; rough.js `seed` option; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-22-templates-design.md` §3a (the deferred "smooth rotate verb"), generalized to param tweening as analyzed 2026-08-23 (chat + Collingridge link review).

## Global Constraints

- No new npm dependencies; NEVER create or commit a package-lock.json (untracked one exists — leave it).
- Gate before every commit: `npx tsc && npx vitest run` (final task adds `npm run build`). Never pipe tsc through tail.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- The tween only OVERRIDES numeric values for keys already present-or-defaulted in the template's params; a tween on a spec with no `template` is a plan-time warning and a no-op step (never a crash).
- Frame re-layout must reuse the SAME pipeline (`layoutSpec`) — no parallel layout path.
- Abort discipline (the wait-verb lesson): a tween must resolve immediately on scrub/abort signal, leaving the END state applied.
- Instant mode: jump straight to the end state (no frames). Silent mode: same timing as narrated (duration holds).
- Seed pinning must not change any CURRENTLY rendered drawing's appearance-stability expectations: pinned seeds make repeated renders of the same element identical — the existing visual character stays (each element still looks hand-drawn), only cross-render randomness disappears. If any existing test asserts randomness, stop and re-check (none is expected to).
- Determinism: seed derived from element id via a small string hash — no Math.random.

## File Structure

- Modify `src/render/svg-backend.ts` — sketchy path generation passes `seed: hash(elementId)` into rough options.
- Modify `src/render/player.ts` (and `src/render/plan.ts`) — `tween` step kind; drawn-set exposure; per-frame re-render primitive.
- Modify `src/spec/schema.ts` — `tween` command (object of string→number) + `duration`; prompt-side docs in `src/llm/prompts/compiler-v1.md` ({{SCHEMA}} carries the schema; add one usage rule + molecule_3d routing note).
- Modify `src/scenes/kit.ts` — `project3d` sphere `highlight?: boolean` (default false; a smaller translucent-paper circle offset up-left, drawn immediately after its sphere at epsilon-nearer depth).
- Modify `src/scenes/molecule_3d/template.yaml` — highlights on; description mentions tweening azimuth for rotation.
- Modify `src/export/video.ts` — timestamp-driven tween frames (investigation-led; see T3).
- Modify `src/examples.json` — the methane example gains a closing rotation beat.
- Tests: extend `tests/plan.test.ts`-adjacent coverage (find the real file names: plan/player-sync tests exist), `tests/scene-kit.test.ts`, `tests/molecule3d.test.ts`.

---

### Task 1: Solid-looking 3D primitives (balls, boxes, faces)

**Files:** `src/scenes/kit.ts` (project3d), `src/scenes/molecule_3d/template.yaml`; tests in `tests/scene-kit.test.ts` + `tests/molecule3d.test.ts`.

**Interfaces produced:**
- Sphere prims gain `shade?: boolean` (DEFAULT true): each shaded sphere emits, immediately nearer in depth than its base circle, (a) `<id>__sh` — a crescent-shadow AREA on the lower-right (away-from-light) side: outer arc along the sphere's screen circle for angles φ±90° around φ = −45° screen direction, inner arc pulled toward the center by 0.45·r; fill = the sphere's stroke color, opacity 0.22; and (b) `<id>__hl` — a small highlight ellipse (0.32r × 0.22r) offset up-left by 0.42r, fill "#fbf8f1", opacity 0.55, strokeWidth 0. Light direction is FIXED screen-space up-left (camera-independent, v1 ruling).
- New prim `{ kind: "face3", id, pts: Vec3[], color?, fill?, opacity?, ms? }` — a flat 3D polygon: projected as closed stroke + fill area; its FILL brightness scales with the face normal's alignment to the light direction ([-0.5, 0.7, 0.5] world, normalized): brightness factor 0.55 + 0.45·max(0, n·l); implement `shadeColor(hex, factor)` helper (exported for tests) that lightens/darkens a hex color toward white/black.
- New prim `{ kind: "box3", id, c: Vec3, size: Vec3, color?, fill?, hidden_edges?: boolean }` — expands to face3s for the visible faces (normal pointing toward the camera after rotation) and, when `hidden_edges`, dashed seg strokes for the hidden edges (the geometry-textbook wireframe cue, spec §3a). Face ids `<id>__f<i>`, hidden edge ids `<id>__e<i>`; the box's `order` contribution stays depth-sorted with everything else.
- molecule_3d: shading on by default (no yaml change needed beyond version bump if any), verified visually.

**Steps:**
- [ ] Step 1: Failing tests — shaded sphere emits __sh (area, below-right centroid) and __hl (up-left centroid) nearer in order than the base circle; `shade: false` suppresses both; `shadeColor("#808080", 1.0)` lighter than factor 0.55; face3 fill brightness differs between a camera-facing and an oblique face; box3 emits ≤3 visible faces at a generic angle and dashed hidden edges when asked; existing molecule3d tests still pass (atom_\d regex unaffected by __sh/__hl ids).
- [ ] Step 2: Implement in project3d; keep every new drawable flowing through the same pieces/depth-sort path.
- [ ] Step 3: Visual check (throwaway render, repo convention): methane — balls must read as balls; a demo box3 at azimuth 30/elevation 20 — three shaded faces + dashed hidden edges. Screenshot(s) referenced in the task report.
- [ ] Step 4: Gate; commit (`feat: project3d solids — shaded balls, face3/box3 with flat shading + hidden edges`).

---

### Task 2: Seed-pinned sketchy rendering + the re-render primitive

**Files:** `src/render/svg-backend.ts`, `src/render/player.ts`; tests extending the existing render/player test files.

**Interfaces produced (T3 relies on):**
- svg-backend: every rough-rendered element's options include a deterministic `seed` derived from its drawable id (`export function seedFor(id: string): number` — 32-bit FNV-ish hash, exported for tests).
- player: `Player` (or the render-handle layer — INVESTIGATE which owns the mounted item SVG; follow how `render()`/`RenderHandle` mounts drawables) gains:
  - `drawnElementIds(): Set<string>` — element ids whose draw steps have completed (plus everything when the item finished).
  - `reprojectWithParams(overrides: Record<string, number>): void` — re-runs `layoutSpec` on the item's spec with `params: {...spec.params, ...overrides}`, renders INSTANTLY (no progressive animation) only the drawables whose top-level element id ∈ drawn set (plus placed labels belonging to drawn ids), and replaces the item's drawable nodes. Labels/lint layers: reuse the normal layout result — labels re-place per frame (they are part of layoutSpec).

**Steps (TDD where the seam is testable in node; the DOM-render specifics verify via existing test harness patterns — the repo's player-sync tests run with stubbed rAF and no real DOM rendering; follow their approach):**

- [ ] Step 1: Investigate + write down (in the task report): where rough options are built in svg-backend; where a mounted item keeps its per-element SVG nodes; how player-sync tests stub the render layer. Name file:line anchors.
- [ ] Step 2: Failing test — `seedFor` is deterministic, non-zero, and id-sensitive; and (via whatever seam the investigation found) two renders of the same drawable produce identical path data while different ids differ. If path-data equality is not reachable in node tests, pin `seedFor` + the options-plumbing by unit test and record a manual-verification note.
- [ ] Step 3: Implement seeding. Run the FULL suite — any snapshot/visual-dependent test that breaks gets examined (expected: none).
- [ ] Step 4: Failing test for `drawnElementIds` and `reprojectWithParams` end-state behavior at the plan/player level (stubbed clock): after reproject with `{azimuth: 90}`, the handle's layout reflects the new params (assert via a probe template — molecule_3d anchors differ) and only drawn ids are present.
- [ ] Step 5: Implement; gate; commit (`feat: seed-pinned sketchy rendering + param-reprojection primitive`).

---

### Task 3: The `tween` command end-to-end

**Files:** `src/spec/schema.ts`, `src/render/plan.ts`, `src/render/player.ts`; tests in the plan/player test files.

**Interfaces:**
- Schema: command property `tween: { type: "object", additionalProperties-free form — mirror how existing open param objects are handled given the structured-output constraint (check how `params` is declared; follow the same pattern) }` + reuse existing `duration` field; document in the schema description: "animate numeric template params to these target values; ONLY for specs with a template".
- Plan step: `{ kind: "tween", targets: Record<string, number>, durationMs: number, narration?: … }` — normalizeSpec warns and drops a tween without a template context (spec-level: template missing) at plan build (a `warnings` entry, consistent with existing plan warnings).
- Player.runAction: tween runs like a narrated action (Promise.all with paired speak via the existing narrated-action machinery): each rAF (or stubbed clock) tick computes `t = clamp(elapsed/duration)`, eased (smoothstep), interpolates each target from its START value — start values resolved as `spec.params[key]` if numeric, else the template's default is UNKNOWN statically: RULING — resolve missing start values by requiring the tween's keys to exist numerically in `spec.params`; the compiler prompt instructs the model to always write explicit start params when it plans a tween; a missing/non-numeric start makes that key jump to target at t=0 (documented, not a crash). Calls `reprojectWithParams(current)` per tick; on completion (or abort) applies end values AND persists them into the item's spec params.
- Instant mode: apply end state once. Abort/scrub: resolve immediately with end state (match the wait-verb contract).

- [ ] Step 1: Failing tests: schema accepts the command; normalize keeps it; plan builds the step with duration default (2s) and warns without template; player (stubbed clock, following player-sync test patterns) runs a tween — assert ≥2 intermediate reprojections occurred, end params persisted, paired speak awaited (both-finish semantics), abort mid-tween still ends at target.
- [ ] Step 2: Implement schema+normalize+plan.
- [ ] Step 3: Implement player behavior.
- [ ] Step 4: Full suite; gate; commit (`feat: tween command — param animation with narrated pairing`).

---

### Task 4: Export, prompt, example

**Files:** `src/export/video.ts`, `src/llm/prompts/compiler-v1.md`, `src/scenes/kit.ts`, `src/scenes/molecule_3d/template.yaml`, `src/examples.json`; tests: `tests/scene-kit.test.ts`, `tests/molecule3d.test.ts`, export test file if one covers step timing.

- [ ] Step 1: Investigate video.ts's clock (how steps advance and frames rasterize; the M-era exportVideo takes Spec[] and replays). Wire tween: during a tween step, per exported frame compute t from the export timeline and call the same reprojection before rasterizing. Acceptance: an export of a tween spec produces frames whose middle frame differs from first and last (testable if export internals allow headless-node execution; else trace + manual-note, consistent with repo convention for DOM-bound paths).
- [ ] Step 2: (Sphere shading landed in Task 1 — verify here that tween frames keep the __sh/__hl pieces consistent through reprojection, i.e. they regenerate per frame with their sphere.)
- [ ] Step 3: molecule_3d description gains: "Rotate it by tweening azimuth: {\"tween\": {\"azimuth\": 200}, \"duration\": 2.5}." Prompt (compiler-v1.md): one rule — tween animates numeric template params; always set the starting values explicitly in params; ideal for molecule_3d rotation and 'what happens as X changes' moments.
- [ ] Step 4: examples.json methane example: add explicit `azimuth: 32` to params and a final beat `{ "tween": { "azimuth": 240 }, "duration": 3, "speak": "Now watch — as we circle the molecule, every hydrogen keeps the same distance from all the others." }`. The examples validity test must pass (tween ids need no draw-id validation; extend the test only if it rejects unknown command keys).
- [ ] Step 5: Full gates incl. build; commit (`feat: tween-powered rotation for 3D molecules — export, prompt, highlights, example`).

---

### Task 5: Final verification + push

- [ ] `npx tsc && npx vitest run && npm run build`; focused suites (plan/player tests, scene-kit, molecule3d). `git push`. Smoke notes: load the "Methane in 3D" example → the closing beat rotates smoothly while narrating; export it to video and confirm the rotation is in the file; `#template=molecule_3d show me methane and rotate it` generates a tween.

---

## Self-Review Notes

- **Design source:** chat analysis 2026-08-23 + Collingridge 3d-svg pages (validated per-frame recompute + z-reorder; contributed the mutate-don't-rebuild insight → seed pinning; sphere highlights). Our deltas: perspective + depth fade (already shipped), narration-driven timestamped animation (export-deterministic), generalization to any numeric param.
- **Scope honesty:** T1/T3 carry named investigation steps with acceptance criteria because Player/export internals weren't re-read at plan time — the implementer records file:line anchors in the report and the reviewer checks the investigation's conclusions against source, per this repo's established pattern for DOM-bound seams.
- **Rulings embedded:** tween start values must be explicit numeric spec params (jump-to-target otherwise, documented); tween without template = warn + no-op; abort ends at target state; silent mode keeps duration.
