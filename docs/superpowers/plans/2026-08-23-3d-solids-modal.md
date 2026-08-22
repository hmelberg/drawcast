# 3D Solids + Explore-in-3D Modal Implementation Plan (tier 3, re-cut 2026-08-23)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) 3D primitives that read as SOLIDS — spheres become balls (crescent shadow + highlight), boxes/faces get normal-based flat shading — improving every static 3D figure and exported video; (2) an opt-in "Explore in 3D" modal: figures whose template declares a 3D model get a small affordance that opens an interactive, spinnable WebGL model (3Dmol.js, lazy chunk) — live viewing only, deliberately OUTSIDE the narration/export pipeline.

**Architecture:** Task 1 is contained in `project3d` (pure geometry emission — no player/renderer risk). Task 2 is an island by design: templates carry optional `model3d` metadata in their manifests; the player-side chrome shows the affordance when the CURRENT item's template declares it, deriving the model input from the item's spec params (preset molecules → XYZ text built from the template's own coordinates; SMILES molecules → PubChem 3D SDF fetch, `/compound/smiles/<smiles>/SDF?record_type=3d`, CORS verified open 2026-08-22); a native dialog hosts the 3Dmol viewer (lazy code-split import, cached per session, spin on open, built-in orbit controls, destroyed on close). Nothing here touches the Player timeline, narration, or the exporter.

**Cost/benefit ruling (2026-08-23, with Hans):** the tween (param animation) is PARKED — see the appendix. Its real case is 2D param animation in exported videos (first revival use case recorded there); the 3D-feel goals are met more cheaply by solids + the modal.

**Tech Stack:** existing project3d; 3dmol (npm `3dmol`, BSD-3, ~60KB gz) as THE ONE new dependency, lazy-loaded; PubChem PUG REST (CORS open).

## Global Constraints

- `3dmol` is the one new dependency (install `npm install --no-package-lock --save 3dmol`); NEVER create or commit a package-lock.json (untracked one exists — leave it).
- Gate before every commit: `npx tsc && npx vitest run` (final task adds `npm run build` and MUST verify 3dmol lands in its own lazy chunk, absent from the main bundle — the smilesDrawer precedent).
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- The modal never blocks or alters playback: opening pauses nothing structurally (the user may pause), closing restores nothing — it is chrome, not pipeline. No modal code may import player internals beyond the existing controls/mount hooks.
- Offline/failure honesty: if the 3dmol chunk or a PubChem fetch fails, the modal shows a plain message ("3D model unavailable offline") — never a broken viewer, never a crash.
- Determinism rules apply to Task 1's geometry as everywhere (no Math.random/Date).

## File Structure

- Modify `src/scenes/kit.ts` — project3d sphere shading + face3/box3 + shadeColor (Task 1).
- Modify `src/scenes/molecule_3d/template.yaml` — shading verified; manifest gains `model3d: { kind: "molecule", source: "preset" }`.
- Modify `src/scenes/types.ts` + `src/scenes/doc.ts` — optional `model3d` metadata on TemplateDoc/SceneManifest (validated shape; passthrough in docToManifest).
- Modify `src/scenes/packs/chemistry.yaml` — molecule template gains `model3d: { kind: "molecule", source: "smiles" }`.
- Create `src/ui/model3d.ts` — lazy 3dmol loader (cached), `xyzFromPreset`, `qualifiesFor3d(spec)`, modal open/close lifecycle.
- Modify `src/main.ts` — the affordance (item chrome via the existing controls/onItemMounted hooks) + dialog host.
- Tests: extend `tests/scene-kit.test.ts`, `tests/molecule3d.test.ts`; create `tests/model3d.test.ts` (pure parts only: xyz builder, qualification/input derivation, loader caching with a fake def; the WebGL viewer itself is browser-only, repo convention).

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

---

### Task 2: Explore-in-3D modal (3Dmol.js island)

**Files:** `package.json`, `src/scenes/types.ts`, `src/scenes/doc.ts`, `src/scenes/molecule_3d/template.yaml`, `src/scenes/packs/chemistry.yaml`, `src/ui/model3d.ts` (new), `src/main.ts`, `src/styles.css`; test `tests/model3d.test.ts`.

**Interfaces produced:**
- types/doc: `SceneManifest.model3d?: { kind: "molecule"; source: "preset" | "smiles" }`; TemplateDoc carries the same optional field, validated (kind must be "molecule", source one of the two) and passed through by docToManifest. Additive; no existing manifest changes required.
- `src/ui/model3d.ts`:
  - `export function qualifiesFor3d(spec: { template?: string; params?: Record<string, unknown> }): { kind: "molecule"; input: { xyz: string } | { smiles: string } } | null` — reads the registry manifest's model3d; preset source builds XYZ from the SAME coordinate table as molecule_3d (duplicated as a small exported PRESET_XYZ map here — the yaml body cannot be imported; keep the two tables in sync via a test that renders molecule_3d and cross-checks atom counts per preset); smiles source requires a non-empty string `spec.params.smiles`.
  - `export function xyzFromPreset(name: string): string | null` — standard XYZ text (count line, comment line, `El x y z` rows).
  - `export async function ensure3dmol(): Promise<unknown>` — lazy cached `import("3dmol")` (module shape: investigate the package's export — likely `import * as $3Dmol`; record in report).
  - `export async function openModel3d(host: HTMLDialogElement, container: HTMLElement, q: NonNullable<ReturnType<typeof qualifiesFor3d>>): Promise<() => void>` — resolves input (fetch PubChem 3D SDF for smiles — https-only, 15s timeout, clear failure text), creates the viewer (stick+sphere style, `viewer.spin(true)`, user orbit via built-in controls), returns a destroy function.
- main.ts: per mounted item (the `onItemMounted` / controls-trailing hook pattern used by present()'s editor/player switch button — investigate and reuse), when `qualifiesFor3d(item.spec)` is non-null show a small "⬡ 3D" control; click → open the shared dialog + `openModel3d`; close (button/ESC via the dialog's close event, the M2 lesson) → destroy viewer + clear container.

**Steps:**
- [ ] Step 1: `npm install --no-package-lock --save 3dmol`; verify no lockfile appears; note installed version.
- [ ] Step 2: Failing tests (`tests/model3d.test.ts`): xyzFromPreset("methane") has 5 atoms, first line "5", element symbols C/H, coordinates matching molecule_3d's preset table (cross-check test as described); qualifiesFor3d null for supply_demand, {xyz} for molecule_3d preset specs, {smiles} for a registered chemistry molecule spec with smiles param, null when smiles missing; ensure3dmol caches (fake the dynamic import seam the same way engines tests fake ENGINE_DEFS — put the importer behind an injectable/module-mutable hook).
- [ ] Step 3: Implement model3d.ts + metadata plumbing (types/doc/docToManifest + the two template yaml manifests). Doc-validation test additions: model3d accepted with valid shape, rejected with unknown kind.
- [ ] Step 4: main.ts affordance + dialog wiring (close-event cleanup discipline per the M2 author-dialog lesson). Styles: minimal (.model3d-dialog sizing, container fills).
- [ ] Step 5: Gate incl. `npm run build`; verify 3dmol is a separate lazy chunk absent from main; commit (`feat: Explore-in-3D modal — 3Dmol island for molecule figures`).

---

### Task 3: Final verification + push

- [ ] `npx tsc && npx vitest run && npm run build` (chunk check evidence in report); focused suites (scene-kit, molecule3d, model3d, packs, template-doc). `git push`. Smoke notes for Hans: load the "Methane in 3D" example → balls read as balls; the ⬡ 3D control opens a spinnable methane; a generated aspirin (chemistry pack) offers 3D via PubChem; offline click shows the plain unavailable message.

---

## PARKED — the `animate` command (param animation; renamed from "tween" 2026-08-23, Hans's call — plain verb over animator jargon)

Tasks live in git history (plan versions a5fff86/0adf3c5): seed-pinned sketchy rendering + Player reprojection primitive; the `animate` command (narrated pairing, abort-at-end-state, instant-jump); export timestamp integration. Parked 2026-08-23 by cost/benefit ruling: ~500-700 lines with ~300 in the Player/exporter (the app's most delicate seams) plus a permanent mid-flight-tween invariant on all future player work.

**First revival use case (Hans, 2026-08-23):** a demand curve that SLIDES right while the voice speaks — `{"animate": {"shift_amount": 1}, "duration": 2, "speak": …}`. Prerequisite when revived: numeric shift params on supply_demand (current shift is qualitative right/left). The command's true value is 2D param animation in exported videos (traveling waves, object-distance sweeps past the focal point, catalyst overlays) — revive it as its own milestone when that value is wanted, independent of 3D.

## Library assessment addendum (2026-08-23, Hans's links)

- tscircuit/simple-3d-svg: boxes-only, flat unlit faces, perspective. Nothing to import; their affine-text caveat confirms our billboard-text ruling.
- seflless/skewed (MIT): boxes/spheres/cylinders/text with Ambient+Directional lights — validates Task 1's normal·light flat shading. NOT imported: React peer dependency, orthographic-only, renders its own SVG (would bypass sketchy/narration/export). Banked: a cylinder prim; per-point planar embedding of 2D templates onto 3D faces.
- 3Dmol.js (BSD-3): CHOSEN for the modal — molecules with orbit/spin in ~5 lines vs hand-built three.js scenes; assessed in the M4-era survey. three.js reconsidered only if non-molecule interactive models are ever wanted.
