# Templates M3 Implementation Plan — packs, lazy loading, selection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Domain packs (starting with physics: ray diagram + wave diagram as doc-format templates) load lazily when enabled; the compiler catalog becomes two-level above a threshold (complete one-line index + full entries for a hot set, with an escalation marker); template selection gains `#template=` tag, a toolbar picker, and a Settings-backed default-domain preference.

**Architecture:** Packs are multi-document YAML files (`src/scenes/packs/<id>.yaml`: header doc + TemplateDocs) loaded via code-split dynamic `?raw` imports — same-origin, lazy, cached by the browser, testable via static `?raw` in vitest. A new `src/scenes/packs.ts` owns pack definitions, registration/unregistration with the same never-clobber discipline as user templates. A new `src/scenes/catalog.ts` (moved out of registry.ts to avoid an import cycle with packs.ts) builds the catalog: below the threshold exactly today's full entries; above it, a complete one-line index + full entries for the hot set (forced ∪ keyword-matched ∪ priority-pack ∪ core) + available-but-disabled pack lines + an escalation instruction. `generateSpec` learns `forcedTemplate` (single-entry catalog + mismatch validation error) and the `need_template` escalation round.

**Tech Stack:** TypeScript strict, vite dynamic `?raw` imports (code-split), js-yaml `loadAll` (the playlist multi-doc pattern), vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-templates-design.md` — §5 (packs/tiers/catalog) and §5a (selection) are this milestone. Engines stay M4: physics templates use ZERO engines. External packs stay M5.

## Global Constraints

- No new npm dependencies; the repo deliberately has NO package-lock.json committed — never commit one (an untracked one exists locally; leave it).
- Verification gate before every commit: `npx tsc && npx vitest run` — NEVER pipe tsc through tail.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Layout bodies deterministic (no Math.random/Date); coordinates y-up on 1000×750.
- Pack templates may never clobber an existing non-pack registry entry, and unregistering a pack removes exactly the ids it registered (mirror the my-templates ownership discipline; snapshot/rollback on failure — the registry-always-writes trap from M2).
- The two-level catalog activates only when the count of READY enabled templates exceeds `TEMPLATE_FULL_THRESHOLD = 10`; below that the catalog must be byte-identical to today's output (existing prompt caching must not be perturbed for current users).
- The escalation marker (`need_template`) must be documented in the catalog PROSE (structured outputs can be off — the session-wide trap), may fire at most once per generation, and its round must not consume a repair round.
- Selection precedence (spec §5a): explicit (#template tag beats picker) > inference > priority packs > core. Inference and priority only ever ADD full entries — they never hide anything (the index is always complete).

## File Structure

- Create `src/scenes/packs/physics.yaml` — pack header + `ray_diagram` + `wave_diagram` TemplateDocs.
- Create `src/scenes/packs.ts` — `PACK_DEFS`, `parsePack`, `registerPack`, `unregisterPack`, `ensureEnabledPacks`, `packTemplateIds`, `isPackTemplateId`.
- Create `src/scenes/catalog.ts` — `TEMPLATE_FULL_THRESHOLD`, `selectTemplates`, `catalogText(opts)`; the old `sceneCatalogText` body moves here as the full-entry renderer.
- Modify `src/scenes/registry.ts` — remove `sceneCatalogText` (moved); nothing else.
- Modify `src/llm/tags.ts` — `#template=<id>` tag (+ ParsedTags.template).
- Modify `src/llm/compile.ts` — `GenerateConfig.forcedTemplate/priorityIds`, `catalogText` wiring, forced-mismatch validation error, `need_template` escalation round.
- Modify `src/store.ts` — `Settings.enabledPacks: string[]`, `Settings.priorityPacks: string[]` (defaults `[]`).
- Modify `src/main.ts` — startup `ensureEnabledPacks`, Templates panel (pack rows: Enabled + Default-domain checkboxes), toolbar template picker, `generate()` passes forced/priority.
- Tests: `tests/packs.test.ts`, `tests/catalog.test.ts`; extend `tests/tags.test.ts`-equivalent (check the existing tags test file name — `tests/tags.test.ts`) and `tests/latency.test.ts` only if it snapshots catalog text (check; adjust minimally).

---

### Task 1: Physics pack + packs module

**Files:**
- Create: `src/scenes/packs/physics.yaml`
- Create: `src/scenes/packs.ts`
- Test: `tests/packs.test.ts`

**Interfaces:**
- Consumes: `loadAll, CORE_SCHEMA` from js-yaml; `validateTemplateDoc, type TemplateDoc` from `./doc`; `registerTemplateDoc, scenes` from `./registry`.
- Produces (Tasks 2–3 rely on these exact names):
  - `export interface PackDef { id: string; title: string; description: string; load: () => Promise<string> }`
  - `export const PACK_DEFS: Record<string, PackDef>` (one entry: `physics`)
  - `export interface ParsedPack { id: string; title: string; description: string; templates: TemplateDoc[] }`
  - `export function parsePack(yamlText: string): { pack?: ParsedPack; errors: string[] }`
  - `export function registerPack(id: string, yamlText: string): { ok: boolean; templateIds: string[]; errors: string[] }` — registers every template with snapshot/rollback per template; on ANY template failure, rolls back the whole pack (all-or-nothing) and returns ok:false.
  - `export function unregisterPack(id: string): void` — removes exactly the ids this pack registered.
  - `export function isPackTemplateId(tid: string): boolean` and `export function packTemplateIds(id: string): string[]`
  - `export async function ensureEnabledPacks(ids: string[]): Promise<{ id: string; ok: boolean; errors: string[] }[]>` — loads via `PACK_DEFS[id].load()` and registers packs not yet registered; ignores unknown ids with an error entry.

- [ ] **Step 1: Write `src/scenes/packs/physics.yaml`**

A multi-document YAML stream (`---` separators): header doc first, then one doc per template — the playlist convention.

```yaml
pack: physics
title: Physics
description: Optics ray diagrams and wave diagrams — classroom physics figures with computed geometry.
---
template: ray_diagram
title: Lens ray diagram
version: 1
kit: 1
status: ready
description: >-
  A converging-lens ray diagram with the geometry COMPUTED from the thin-lens
  equation: object arrow, lens, both focal points, the two principal rays
  (parallel→focal and center-straight), and the image — real and inverted when
  the object is outside the focal length, virtual, upright and dashed when
  inside. Choose this scene for ANY request about lenses, ray diagrams, image
  formation, real vs virtual images, magnification, or "what happens when the
  object moves inside the focal length". Vary focal_length and object_distance
  and the figure re-derives itself.
params:
  type: object
  properties:
    focal_length:
      type: number
      description: "Focal length in arbitrary units (default 10)."
    object_distance:
      type: number
      description: "Object distance from the lens, same units (default 25). Less than focal_length gives a virtual image."
    object_height:
      type: number
      description: "Object height in units (default 6)."
    show_labels:
      type: boolean
      description: "F / object / image labels (default true)."
element_ids:
  axis: the optical axis
  lens: the lens (vertical double-headed arrow)
  focal_left / focal_right: the focal-point ticks with F labels
  object: the object arrow
  ray_parallel: the parallel-then-through-focus principal ray
  ray_center: the straight-through-center principal ray
  ray_parallel_ext / ray_center_ext: dashed back-extensions (virtual case only)
  image: the image arrow (dashed when virtual)
  label_object / label_image / label_f_left / label_f_right: the labels
examples:
  - request: "Draw a ray diagram for a converging lens with the object outside the focal length."
    params: { focal_length: 10, object_distance: 25, object_height: 6 }
  - request: "Show why a magnifying glass makes a virtual image when the object is inside the focal length."
    params: { focal_length: 12, object_distance: 7, object_height: 5 }
layout: |
  const f = Math.max(1, params.focal_length ?? 10);
  const dObj = Math.max(1.2, params.object_distance ?? 25);
  const hObj = Math.max(1, params.object_height ?? 6);
  const showLabels = params.show_labels !== false;
  const virtual = dObj < f;
  const dImg = (f * dObj) / (dObj - f);           // thin lens; negative when virtual
  const m = -dImg / dObj;
  const hImg = m * hObj;
  // Scale to fit: horizontal span from object to image (or 2f), vertical from heights.
  const leftU = dObj, rightU = Math.max(virtual ? 2 * f : dImg, 2 * f);
  const sx = 780 / (leftU + rightU);
  const sy = Math.min(sx, 250 / Math.max(hObj, Math.abs(hImg)));
  const lensX = 110 + leftU * sx, axisY = 375;
  const X = (u) => lensX + u * sx;                 // u<0 left of lens
  const Y = (h) => axisY + h * sy;
  const C = kit.COLORS, MS = kit.SKETCH_MS;
  const drawables = [], labels = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };
  const label = (id, anchor, side, text, color) => {
    if (!showLabels) return;
    labels.push(kit.label(id, anchor, side, text, { color, fontSize: 24 }));
    order.push(id);
  };
  push(kit.stroke("axis", [[70, axisY], [930, axisY]], { strokeWidth: 2.5, color: C.guide, ms: MS.axis }));
  push(kit.stroke("lens", [[lensX, axisY - 210], [lensX, axisY + 210]], { arrowhead: "both", strokeWidth: 4, ms: MS.axis }));
  for (const [id, u] of [["focal_left", -f], ["focal_right", f]]) {
    push(kit.stroke(id, [[X(u), axisY - 9], [X(u), axisY + 9]], { strokeWidth: 3, ms: MS.dot }));
    label("label_" + id.slice(6), [X(u), axisY - 26], "below", "F");
  }
  const tip = [X(-dObj), Y(hObj)];
  push(kit.stroke("object", [[X(-dObj), axisY], tip], { arrowhead: "end", strokeWidth: 5, color: C.supply, ms: MS.arrow }));
  anchors.object = tip;
  label("label_object", [tip[0], tip[1] + 26], "above", "Object", C.supply);
  const imgTip = [X(dImg), Y(hImg)];
  // Ray 1: parallel to axis, refracts through far focal point.
  push(kit.stroke("ray_parallel", virtual
    ? [tip, [lensX, tip[1]], [X(2 * f + 2), Y(hObj - ((2 * f + 2 - 0) * (hObj - 0)) / f)]]
    : [tip, [lensX, tip[1]], imgTip], { arrowhead: "end", strokeWidth: 3, color: C.demand, ms: MS.connector }));
  // Ray 2: straight through the lens center.
  push(kit.stroke("ray_center", virtual
    ? [tip, [X(Math.max(2 * f, 1.6 * dObj)), Y(-(hObj / dObj) * Math.max(2 * f, 1.6 * dObj))]]
    : [tip, imgTip], { arrowhead: "end", strokeWidth: 3, color: C.accent, ms: MS.connector }));
  if (virtual) {
    push(kit.stroke("ray_parallel_ext", [[lensX, tip[1]], imgTip], { dash: true, strokeWidth: 2.5, color: C.demand, ms: MS.guides }));
    push(kit.stroke("ray_center_ext", [tip, imgTip], { dash: true, strokeWidth: 2.5, color: C.accent, ms: MS.guides }));
  }
  push(kit.stroke("image", [[X(dImg), axisY], imgTip], { arrowhead: "end", strokeWidth: 5, color: C.ink, dash: virtual, ms: MS.arrow }));
  anchors.image = imgTip;
  label("label_image", [imgTip[0], imgTip[1] + (hImg >= 0 ? 26 : -26)], hImg >= 0 ? "above" : "below", virtual ? "Virtual image" : "Real image");
  return { drawables, labels, anchors, order };
---
template: wave_diagram
title: Wave diagram
version: 1
kit: 1
status: ready
description: >-
  A transverse wave with labeled amplitude and wavelength: a sine curve on an
  axis, a double-headed amplitude arrow, a wavelength bracket between crests,
  and optional crest/trough labels or a second dashed wave with a phase shift
  (interference/superposition setups). Choose this scene for requests about
  waves, wavelength, amplitude, frequency, phase, or interference.
params:
  type: object
  properties:
    amplitude:
      type: number
      description: "Amplitude in units 1–10 (default 5)."
    cycles:
      type: number
      description: "How many wavelengths to draw, 1–5 (default 3)."
    second_wave_phase_deg:
      type: number
      description: "If set, a second dashed wave shifted by this phase (e.g. 180 for destructive interference)."
    label_parts:
      type: boolean
      description: "Label amplitude, wavelength, crest and trough (default true)."
element_ids:
  axis: the horizontal axis
  wave: the main wave curve
  wave2: the second (dashed) wave when second_wave_phase_deg is set
  amp_arrow: double-headed amplitude arrow
  wl_arrow: double-headed wavelength arrow between crests
  label_amp / label_wl / label_crest / label_trough: the labels
examples:
  - request: "Draw a wave and label the wavelength and amplitude."
    params: { amplitude: 5, cycles: 3 }
  - request: "Show destructive interference of two waves."
    params: { amplitude: 4, cycles: 3, second_wave_phase_deg: 180, label_parts: false }
layout: |
  const ampU = Math.min(10, Math.max(1, params.amplitude ?? 5));
  const cycles = Math.min(5, Math.max(1, Math.round(params.cycles ?? 3)));
  const phase2 = params.second_wave_phase_deg;
  const labelParts = params.label_parts !== false;
  const C = kit.COLORS, MS = kit.SKETCH_MS;
  const x0 = 90, len = 800, midY = 375;
  const wl = len / cycles;
  const amp = ampU * 22;
  const drawables = [], labels = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };
  push(kit.stroke("axis", [[x0 - 20, midY], [x0 + len + 30, midY]], { arrowhead: "end", strokeWidth: 2.5, color: C.guide, ms: MS.axis }));
  push(kit.stroke("wave", kit.wave([x0, midY], len, amp, wl), { strokeWidth: 4.5, color: C.supply, ms: MS.curve }));
  anchors.wave = [x0 + wl / 4, midY + amp];
  if (phase2 !== undefined) {
    const sh = (((phase2 % 360) + 360) % 360) / 360 * wl;
    const pts = kit.wave([x0, midY], len, amp, wl).map(([x, y]) => [x, midY + (y - midY)]);
    const shifted = [];
    for (let t = 0; t <= len; t += 4) shifted.push([x0 + t, midY + amp * Math.sin(((t - sh) / wl) * 2 * Math.PI)]);
    push(kit.stroke("wave2", shifted, { strokeWidth: 3.5, color: C.demand, dash: true, ms: MS.curve }));
  }
  if (labelParts) {
    const crestX = x0 + wl / 4;
    push(kit.stroke("amp_arrow", [[crestX + wl, midY], [crestX + wl, midY + amp]], { arrowhead: "both", strokeWidth: 2.5, color: C.accent, ms: MS.guides }));
    labels.push(kit.label("label_amp", [crestX + wl + 8, midY + amp / 2], "right", "Amplitude A", { color: C.accent, fontSize: 24 }));
    order.push("label_amp");
    push(kit.stroke("wl_arrow", [[crestX, midY + amp + 26], [crestX + wl, midY + amp + 26]], { arrowhead: "both", strokeWidth: 2.5, color: C.accent, ms: MS.guides }));
    labels.push(kit.label("label_wl", [crestX + wl / 2, midY + amp + 34], "above", "Wavelength λ", { color: C.accent, fontSize: 24 }));
    order.push("label_wl");
    labels.push(kit.label("label_crest", [crestX, midY + amp], "above", "Crest", { fontSize: 22 }));
    order.push("label_crest");
    labels.push(kit.label("label_trough", [crestX + wl / 2, midY - amp], "below", "Trough", { fontSize: 22 }));
    order.push("label_trough");
  }
  return { drawables, labels, anchors, order };
```

Note for the implementer: the `kit.label` helper signature is `label(id, anchor, side, s, o?)` — the calls above already match. The unused `pts` variable in wave2 must be removed (typo guard: build the shifted wave only with the `shifted` loop).

- [ ] **Step 2: Write the failing tests**

```ts
// tests/packs.test.ts
import { beforeEach, describe, expect, test } from "vitest";
import physicsYaml from "../src/scenes/packs/physics.yaml?raw";
import { parsePack, registerPack, unregisterPack, isPackTemplateId, packTemplateIds, PACK_DEFS } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";

beforeEach(() => unregisterPack("physics"));

describe("parsePack", () => {
  test("parses header + two ready templates", () => {
    const { pack, errors } = parsePack(physicsYaml);
    expect(errors).toEqual([]);
    expect(pack?.id).toBe("physics");
    expect(pack?.templates.map((t) => t.template)).toEqual(["ray_diagram", "wave_diagram"]);
  });

  test("reports YAML errors instead of throwing", () => {
    const r = parsePack("pack: [broken");
    expect(r.pack).toBeUndefined();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  test("missing header doc is an error", () => {
    const r = parsePack("template: x\nversion: 1\nkit: 1\nstatus: stub\ndescription: d\nparams: {}\nelement_ids: {}\nexamples: []");
    expect(r.errors[0]).toMatch(/header|pack/);
  });
});

describe("registerPack / unregisterPack", () => {
  test("registers both templates, tracks ownership, unregisters exactly them", () => {
    const r = registerPack("physics", physicsYaml);
    expect(r).toMatchObject({ ok: true, templateIds: ["ray_diagram", "wave_diagram"] });
    expect(scenes.ray_diagram.layout).toBeDefined();
    expect(isPackTemplateId("ray_diagram")).toBe(true);
    expect(packTemplateIds("physics")).toEqual(["ray_diagram", "wave_diagram"]);
    unregisterPack("physics");
    expect(scenes.ray_diagram).toBeUndefined();
    expect(scenes.wave_diagram).toBeUndefined();
    expect(isPackTemplateId("ray_diagram")).toBe(false);
  });

  test("a pack template colliding with an existing id rolls the WHOLE pack back", () => {
    const clash = physicsYaml.replace("template: wave_diagram", "template: supply_demand");
    const before = scenes.supply_demand;
    const r = registerPack("physics", clash);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /supply_demand/.test(e))).toBe(true);
    expect(scenes.supply_demand).toBe(before);   // untouched
    expect(scenes.ray_diagram).toBeUndefined();  // rolled back
  });

  test("re-registering an already-registered pack is a no-op success", () => {
    registerPack("physics", physicsYaml);
    const r = registerPack("physics", physicsYaml);
    expect(r.ok).toBe(true);
  });
});

describe("physics templates through the real pipeline", () => {
  test("every example renders with zero warnings and no error lint, deterministically", () => {
    registerPack("physics", physicsYaml);
    for (const tid of ["ray_diagram", "wave_diagram"]) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        expect(res.warnings).toEqual([]);
        expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
        for (const d of flattenDrawables(res.drawables)) {
          if (d.kind === "stroke" || d.kind === "area") {
            for (const [x, y] of d.pts) {
              expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
              expect(Math.abs(x)).toBeLessThan(2000);
              expect(Math.abs(y)).toBeLessThan(2000);
            }
          }
        }
      }
      const a = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      const b = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test("virtual-image case draws dashed extensions; real case does not", () => {
    registerPack("physics", physicsYaml);
    const real = scenes.ray_diagram.layout!({ focal_length: 10, object_distance: 25 });
    const virt = scenes.ray_diagram.layout!({ focal_length: 12, object_distance: 7 });
    expect(flattenDrawables(real.drawables).map((d) => d.id)).not.toContain("ray_parallel_ext");
    expect(flattenDrawables(virt.drawables).map((d) => d.id)).toContain("ray_parallel_ext");
    const img = flattenDrawables(virt.drawables).find((d) => d.id === "image");
    expect(img?.kind === "stroke" && img.style.dash).toBe(true);
  });
});

test("PACK_DEFS has physics with a loader", () => {
  expect(PACK_DEFS.physics.title).toBe("Physics");
  expect(typeof PACK_DEFS.physics.load).toBe("function");
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run tests/packs.test.ts` → cannot resolve `../src/scenes/packs`.

- [ ] **Step 4: Implement `src/scenes/packs.ts`**

```ts
// Domain packs: multi-doc YAML (header + TemplateDocs), loaded lazily as
// code-split ?raw chunks, registered with the same never-clobber discipline
// as user templates. All-or-nothing per pack: one bad template rolls back
// the whole pack (the registry-always-writes trap from M2 applies per id).

import { CORE_SCHEMA, loadAll } from "js-yaml";
import { validateTemplateDoc, type TemplateDoc } from "./doc";
import { registerTemplateDoc, scenes } from "./registry";
import type { SceneModule } from "./types";

export interface PackDef {
  id: string;
  title: string;
  description: string;
  load: () => Promise<string>;
}

export const PACK_DEFS: Record<string, PackDef> = {
  physics: {
    id: "physics",
    title: "Physics",
    description: "Optics ray diagrams and wave diagrams — classroom physics figures with computed geometry.",
    load: async () => (await import("./packs/physics.yaml?raw")).default,
  },
};

export interface ParsedPack {
  id: string;
  title: string;
  description: string;
  templates: TemplateDoc[];
}

export function parsePack(yamlText: string): { pack?: ParsedPack; errors: string[] } {
  let docs: unknown[];
  try {
    docs = loadAll(yamlText, undefined, { schema: CORE_SCHEMA }).filter((d) => d != null);
  } catch (err) {
    return { errors: [`YAML: ${(err as Error).message}`] };
  }
  const [header, ...rest] = docs;
  const h = header as { pack?: unknown; title?: unknown; description?: unknown } | undefined;
  if (!h || typeof h.pack !== "string") {
    return { errors: ["the first document must be the pack header ({ pack, title, description })"] };
  }
  const errors: string[] = [];
  const templates: TemplateDoc[] = [];
  rest.forEach((raw, i) => {
    const v = validateTemplateDoc(raw);
    if (v.doc) templates.push(v.doc);
    else errors.push(`template ${i}: ${v.errors.join("; ")}`);
  });
  if (errors.length > 0) return { errors };
  return {
    pack: {
      id: h.pack,
      title: typeof h.title === "string" ? h.title : h.pack,
      description: typeof h.description === "string" ? h.description : "",
      templates,
    },
    errors: [],
  };
}

/** pack id -> the template ids it registered. */
const packOwned = new Map<string, Set<string>>();

export function isPackTemplateId(tid: string): boolean {
  for (const ids of packOwned.values()) if (ids.has(tid)) return true;
  return false;
}

export function packTemplateIds(id: string): string[] {
  return [...(packOwned.get(id) ?? [])];
}

export function registerPack(id: string, yamlText: string): { ok: boolean; templateIds: string[]; errors: string[] } {
  if (packOwned.has(id)) return { ok: true, templateIds: packTemplateIds(id), errors: [] };
  const { pack, errors } = parsePack(yamlText);
  if (!pack) return { ok: false, templateIds: [], errors };
  const undo: { tid: string; prev: SceneModule | undefined }[] = [];
  const registered: string[] = [];
  for (const doc of pack.templates) {
    if (scenes[doc.template]) {
      rollback(undo);
      return { ok: false, templateIds: [], errors: [`pack "${id}": template id "${doc.template}" already exists in the registry — pack not loaded`] };
    }
    undo.push({ tid: doc.template, prev: scenes[doc.template] });
    const r = registerTemplateDoc(doc);
    if (!r.ok) {
      rollback(undo);
      return { ok: false, templateIds: [], errors: [`pack "${id}": template "${doc.template}" failed to compile: ${r.errors.join("; ")}`] };
    }
    registered.push(doc.template);
  }
  packOwned.set(id, new Set(registered));
  return { ok: true, templateIds: registered, errors: [] };
}

function rollback(undo: { tid: string; prev: SceneModule | undefined }[]): void {
  for (const { tid, prev } of undo.reverse()) {
    if (prev) scenes[tid] = prev;
    else delete scenes[tid];
  }
}

export function unregisterPack(id: string): void {
  const ids = packOwned.get(id);
  if (!ids) return;
  for (const tid of ids) delete scenes[tid];
  packOwned.delete(id);
}

/** Load + register every listed pack (skipping already-registered ones). */
export async function ensureEnabledPacks(ids: string[]): Promise<{ id: string; ok: boolean; errors: string[] }[]> {
  const out: { id: string; ok: boolean; errors: string[] }[] = [];
  for (const id of ids) {
    const def = PACK_DEFS[id];
    if (!def) {
      out.push({ id, ok: false, errors: [`unknown pack "${id}"`] });
      continue;
    }
    if (packOwned.has(id)) {
      out.push({ id, ok: true, errors: [] });
      continue;
    }
    try {
      const yaml = await def.load();
      const r = registerPack(id, yaml);
      out.push({ id, ok: r.ok, errors: r.errors });
    } catch (err) {
      out.push({ id, ok: false, errors: [`failed to load pack: ${(err as Error).message}`] });
    }
  }
  return out;
}
```

- [ ] **Step 5: Run to verify pass** — `npx vitest run tests/packs.test.ts`. Iterate on the two YAML layout bodies until every pipeline test passes (lint-clean may need label-position nudges; that is expected authoring work, not a plan deviation — keep element ids and params stable).

- [ ] **Step 6: Gate and commit**

```bash
npx tsc && npx vitest run
git add src/scenes/packs src/scenes/packs.ts tests/packs.test.ts
git commit -m "feat: physics pack (ray_diagram, wave_diagram) + lazy pack module

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Two-level catalog + selection in the pipeline

**Files:**
- Create: `src/scenes/catalog.ts`
- Modify: `src/scenes/registry.ts` (delete `sceneCatalogText`)
- Modify: `src/llm/tags.ts` (template tag), `src/llm/compile.ts` (wiring, forced check, escalation)
- Test: `tests/catalog.test.ts`; extend the existing tags test file with `#template=` cases; check `tests/prompt.test.ts` and `tests/latency.test.ts` for callers of `sceneCatalogText` (they stub catalog strings — likely untouched; fix imports if they import it).

**Interfaces:**
- Consumes: `scenes` from `./registry`; `PACK_DEFS`, `packTemplateIds` (registered-pack detection via `packTemplateIds(id).length > 0`) from `./packs`; keyword matching mirrors `selectExemplars`'s approach in `src/llm/prompt.ts` (reimplement locally on manifests — do NOT import llm code into scenes/).
- Produces:
  - `export const TEMPLATE_FULL_THRESHOLD = 10`
  - `export interface CatalogOpts { request?: string; forced?: string; priorityIds?: string[] }`
  - `export function selectTemplates(request: string, n: number): string[]` — ready-template ids ranked by keyword overlap of the request against `description + examples[].request`; empty for no overlap.
  - `export function catalogText(opts?: CatalogOpts): string` — see behavior below.
  - `export const NEED_TEMPLATE_KEY = "need_template"` and `export function detectNeedTemplate(json: unknown): string | null`
- Behavior of `catalogText`:
  - Ready count ≤ threshold AND no `forced`: byte-identical output to the old `sceneCatalogText()` (full entries for ready, stub lines for stubs).
  - `forced` set (and the id is ready): ONE full entry (the forced template) + one line: `You MUST set "template" to "<id>" for this request.` + stub lines omitted.
  - Ready count > threshold: complete one-line index (`- <id>: <first sentence of description>` for EVERY ready template), then full entries for the hot set = dedupe(forced ∪ selectTemplates(request, 3) ∪ priorityIds ∪ CORE_IDS) where `CORE_IDS = ["supply_demand", "decision_tree", "qaly_profiles"]`, then stub lines, then unregistered-pack lines (`Pack available but not enabled: <title> — <description>` for each PACK_DEFS entry with no registered templates), then the escalation prose: `If the best template for the request appears ONLY in the index above, do not guess its parameters: return exactly {"need_template": "<id>"} and nothing else; you will receive its full definition.`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/catalog.test.ts
import { afterEach, describe, expect, test } from "vitest";
import { catalogText, detectNeedTemplate, selectTemplates, TEMPLATE_FULL_THRESHOLD } from "../src/scenes/catalog";
import { scenes } from "../src/scenes/registry";
import { registerTemplateDoc } from "../src/scenes/registry";
import type { TemplateDoc } from "../src/scenes/doc";

const added: string[] = [];
function addFake(id: string): void {
  const doc: TemplateDoc = {
    template: id, version: 1, kit: 1, status: "ready",
    description: `Fake ${id} figure. Second sentence.`,
    params: {}, element_ids: {},
    examples: [{ request: `Draw the ${id} thing.`, params: {} }],
    layout: `return { drawables: [], labels: [], anchors: {}, order: [] };`,
  };
  registerTemplateDoc(doc);
  added.push(id);
}
afterEach(() => {
  for (const id of added.splice(0)) delete scenes[id];
});

describe("catalogText below the threshold", () => {
  test("matches the legacy full-entry format (no index, no escalation)", () => {
    const t = catalogText();
    expect(t).toContain("### Scene template: supply_demand (READY");
    expect(t).toContain("STUB — do NOT set template");
    expect(t).not.toContain("need_template");
  });

  test("forced yields exactly one full entry plus the MUST line", () => {
    const t = catalogText({ forced: "free_body" });
    expect(t).toContain("### Scene template: free_body (READY");
    expect(t).not.toContain("### Scene template: supply_demand");
    expect(t).toContain('You MUST set "template" to "free_body"');
  });
});

describe("catalogText above the threshold", () => {
  test("complete index + hot-set full entries + escalation prose", () => {
    for (let i = 0; i < 8; i++) addFake(`fake_${i}`);   // pushes ready count past 10
    const t = catalogText({ request: "Draw the fake_3 thing." });
    for (let i = 0; i < 8; i++) expect(t).toContain(`- fake_${i}:`);   // index complete
    expect(t).toContain("- free_body:");
    expect(t).toContain("### Scene template: fake_3 (READY");           // matched → full
    expect(t).toContain("### Scene template: supply_demand (READY");    // core → full
    expect(t).not.toContain("### Scene template: fake_6 (READY");       // unmatched non-core → index only
    expect(t).toContain("need_template");
  });

  test("priorityIds join the hot set", () => {
    for (let i = 0; i < 8; i++) addFake(`fake_${i}`);
    const t = catalogText({ request: "unrelated words entirely", priorityIds: ["fake_6"] });
    expect(t).toContain("### Scene template: fake_6 (READY");
  });

  test("unregistered packs get an availability line", () => {
    for (let i = 0; i < 8; i++) addFake(`fake_${i}`);
    const t = catalogText({ request: "x" });
    expect(t).toMatch(/Pack available but not enabled: Physics/);
  });
});

describe("selectTemplates", () => {
  test("ranks by keyword overlap against description and example requests", () => {
    const hits = selectTemplates("show the forces on a block on an incline", 3);
    expect(hits[0]).toBe("free_body");
  });
  test("no overlap yields empty", () => {
    expect(selectTemplates("zzz qqq", 3)).toEqual([]);
  });
});

describe("detectNeedTemplate", () => {
  test("detects the marker object", () => {
    expect(detectNeedTemplate({ need_template: "free_body" })).toBe("free_body");
  });
  test("anything else is null", () => {
    expect(detectNeedTemplate({ template: "x", commands: [] })).toBeNull();
    expect(detectNeedTemplate(null)).toBeNull();
    expect(detectNeedTemplate({ need_template: 7 })).toBeNull();
  });
});

test("threshold is 10", () => {
  expect(TEMPLATE_FULL_THRESHOLD).toBe(10);
});
```

Also extend the existing tags tests (find the file — `grep -rl "parseTags" tests/`) with:

```ts
test("#template=free_body is parsed out and exposed", () => {
  const p = parseTags("show forces #template=free_body");
  expect(p.template).toBe("free_body");
  expect(p.clean).toBe("show forces");
});
test("no template tag yields null", () => {
  expect(parseTags("plain request").template).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`src/scenes/catalog.ts` — move the body of `sceneCatalogText` here as a private `fullEntry(manifest)` renderer (one manifest → the existing `### Scene template: …` block) plus `stubLine(manifest)`; build `catalogText` per the behavior spec above. `selectTemplates`: lowercase-keyword sets (reuse the stopword approach from `src/llm/prompt.ts` by copying the tiny `keywords()` helper — 8 lines; do not import across layers), score = overlap / sqrt(sizes), filter > 0, sort desc, take n. `detectNeedTemplate`: object with a single string-valued `need_template` key → the id (only if `scenes[id]?.manifest.status === "ready"`), else null.

`src/scenes/registry.ts` — delete `sceneCatalogText`; `src/llm/compile.ts` switches its import to `import { catalogText, detectNeedTemplate } from "../scenes/catalog"`; `assembleSystemPrompt` and `generateSpec` call `catalogText({ request, forced: cfg.forcedTemplate, priorityIds: cfg.priorityIds })`.

`src/llm/tags.ts` — add to `TAGS`: `{ tag: "template", group: "structure", hint: "force a specific template, e.g. #template=free_body", brief: "" }` and handle its value in `parseTags` the same way `#parts=N` is handled (find that code path); `ParsedTags` gains `template: string | null`.

`src/llm/compile.ts` — `GenerateConfig` gains `forcedTemplate?: string; priorityIds?: string[]`. In the loop after `validateSpec`: if `cfg.forcedTemplate` and `(json as Spec)?.template !== cfg.forcedTemplate`, push `validation.errors`: `the request requires template "<forced>" — set "template" to it and use its params`. Escalation, before validation: `const needed = detectNeedTemplate(json); if (needed && !escalated) { escalated = true; rebuild blocks/system with catalogText({ request, forced: needed }); messages.push({role:"assistant",content:raw},{role:"user",content:\`Full definition of "${needed}" is now in your instructions. Return the complete spec using it.\`}); rounds.push({label:"template-fetch", spec: json, validationErrors: [], lintIssues: [], meta}); continue; }` — add `"template-fetch"` to the `GenerationRound["label"]` union and make the label-derivation line tolerate it.

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/catalog.test.ts` and the tags test file, then the full suite (prompt/latency tests must be untouched or minimally re-pointed).

- [ ] **Step 5: Gate and commit**

```bash
npx tsc && npx vitest run
git add src/scenes/catalog.ts src/scenes/registry.ts src/llm/tags.ts src/llm/compile.ts tests/catalog.test.ts tests/*.test.ts
git commit -m "feat: two-level catalog, #template tag, forced-template + need_template escalation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Settings + Templates panel + picker (`src/main.ts`)

**Files:**
- Modify: `src/store.ts` (Settings + DEFAULT_SETTINGS)
- Modify: `src/main.ts`, `src/styles.css` (append)

**Interfaces:**
- Consumes: Task 1's `PACK_DEFS`, `ensureEnabledPacks`, `unregisterPack`, `packTemplateIds`; Task 2's `ParsedTags.template`, `GenerateConfig.forcedTemplate/priorityIds`; existing `settings`, `persist()`, `h`, `setStatus`, the `generate()` function (~line 687 pre-M2; find it) and the toolbar rows.
- Produces: UI only.

No unit tests (main.ts convention); gate = tsc + suite + build.

- [ ] **Step 1: Settings**

In `src/store.ts` add to `Settings`: `enabledPacks: string[];` and `priorityPacks: string[];` — and to `DEFAULT_SETTINGS`: `enabledPacks: [], priorityPacks: []`. Verify the `read()` merge gives old stored settings the new defaults (it spreads the fallback first — confirm in source; if not, normalize after load).

- [ ] **Step 2: Startup + Templates panel**

Startup (next to the My-templates registration): `void ensureEnabledPacks(settings.enabledPacks).then((rs) => { for (const r of rs) if (!r.ok) console.warn(\`pack "${r.id}" failed:\`, r.errors.join("; ")); refreshTemplatePicker(); });`

Templates panel — a `details` panel titled "Template packs" next to My templates. One row per `PACK_DEFS` entry: title + description hint + two checkboxes: **Enabled** (on change: add/remove from `settings.enabledPacks`, `persist()`; enabling → `await ensureEnabledPacks([id])` then `refreshTemplatePicker()` + status; disabling → `unregisterPack(id)`, also remove from `priorityPacks`, `refreshTemplatePicker()`) and **Default domain** (toggles membership in `settings.priorityPacks`, `persist()`; disabled when the pack is not enabled).

- [ ] **Step 3: Toolbar template picker**

```ts
const templateSel = h("select", { class: "cs-bar-select", title: "Force a template (Auto lets the AI choose; #template= in the request overrides this)" });
function refreshTemplatePicker(): void {
  const current = templateSel.value;
  templateSel.replaceChildren(h("option", { value: "" }, "Template: Auto"));
  for (const [id, mod] of Object.entries(scenes).sort(([a], [b]) => a.localeCompare(b))) {
    if (mod.manifest.status === "ready") templateSel.appendChild(h("option", { value: id }, id));
  }
  if ([...templateSel.options].some((o) => o.value === current)) templateSel.value = current;
}
refreshTemplatePicker();
```

Place `templateSel` in the toolbar row (near the Style select). Call `refreshTemplatePicker()` after My-template saves/deletes/imports too (template list changed).

In `generate()`: after `parseTags`, compute `const forcedTemplate = parsed.template ?? (templateSel.value || undefined);` and `const priorityIds = settings.priorityPacks.flatMap((p) => packTemplateIds(p));` — pass both in the `GenerateConfig`. If `forcedTemplate` names a template that is not registered/ready, `setStatus` an error and return early (don't burn a call).

- [ ] **Step 4: Styles** — append minimal rules for the pack rows if the existing panel classes don't cover them (check first; likely `.library-item`-style rows suffice).

- [ ] **Step 5: Gate and commit**

```bash
npx tsc && npx vitest run && npm run build
git add src/store.ts src/main.ts src/styles.css
git commit -m "feat: Template packs panel, toolbar picker, default-domain preference

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Final verification + push

- [ ] Step 1: `npx tsc && npx vitest run && npm run build` — all green.
- [ ] Step 2: `npx vitest run tests/packs.test.ts tests/catalog.test.ts tests/domain-scenes.test.ts tests/my-templates.test.ts tests/author.test.ts` — pass.
- [ ] Step 3: `git push`. Manual smoke notes for the report: enable Physics in the panel → "Draw a ray diagram for a converging lens" should route to `ray_diagram`; `#template=wave_diagram show me interference` forces the wave; picker + default-domain checkbox behave.

---

## Self-Review Notes

- **Spec §5/§5a coverage:** pack format + in-repo lazy tier (T1); catalog from enabled set only — unregistered packs appear as availability lines, never entries (T2); two-level with complete index, hot set, escalation prose + marker + one-shot escalation round (T2); #tag + picker + precedence tag>picker (T3 generate()); priority packs → priorityIds → hot set (T2+T3); ≤10 byte-identical legacy behavior pinned by test (T2). External-pack tier and confirm dialog are M5 by design.
- **Type consistency:** `PACK_DEFS/registerPack/unregisterPack/ensureEnabledPacks/packTemplateIds` (T1) match T2/T3 consumers; `catalogText`/`CatalogOpts`/`detectNeedTemplate` (T2) match compile.ts wiring; `ParsedTags.template` (T2) matches T3's `parsed.template`.
- **Placeholder scan:** clean; the two check-the-source notes (read() merge semantics; tags-parts value-handling path) are verification instructions with concrete outcomes.
- **Known risk:** the ray-diagram YAML geometry is authored in-plan and may need label nudges to pass lint — Step 5 of T1 explicitly authorizes iteration while freezing ids/params.
