# Templates M2 Implementation Plan — AI authoring, My templates, export/import

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users create full templates by describing them and/or pasting an image — the AI generates a TemplateDoc, the app previews it through the real pipeline with repair rounds, and saved templates live in localStorage, registered into the catalog, exportable/importable as YAML.

**Architecture:** Three layers, mirroring the existing generation pipeline. (1) `store.ts` + `src/scenes/my-templates.ts`: personal-template persistence and safe registration (user templates may never silently overwrite built-ins). (2) `src/llm/author.ts` + `src/llm/prompts/author-v1.md`: an authoring pipeline shaped exactly like `generateSpec` — cached system prompt (kit source + doc format + the cell_diagram exemplar), `callForJson`, then a validation chain (doc validation → compile → run → preview lint via temporary registration) feeding capped repair rounds on `repairModelFor`. (3) `main.ts`: a native `<dialog>` authoring flow (text + pasted/dropped image → generate → preview → refine → save) plus a "My templates" panel with Improve/Export/Delete/Import.

**Tech Stack:** TypeScript strict, vite `?raw` imports, js-yaml 4, `@anthropic-ai/sdk` (images as base64 content blocks — no client changes), vitest (node env; localStorage stubbed in tests).

**Spec:** `docs/superpowers/specs/2026-08-22-templates-design.md` — §6 (authoring pipeline) is this milestone; §1/§2 (format/runtime) landed in M1. The Templates panel with pack toggles is M3 — NOT in scope; M2's "My templates" list is deliberately minimal.

## Global Constraints

- No new npm dependencies; the repo deliberately has NO package-lock.json committed — never commit one (an untracked one exists locally; leave it).
- Verification gate before every commit: `npx tsc && npx vitest run` — NEVER pipe tsc through tail (masks exit status).
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- The authoring prompt MUST spell out the TemplateDoc JSON form in prose text — structured outputs can be off for the whole session (known trap), and the open `params` object will likely 400 the structured-output grammar; `callForJson` handles the fallback.
- Images are authoring-context only: they ride in the in-session message history, are NEVER stored in localStorage or in the saved template (spec §6).
- YAML serialization uses js-yaml `dump` with `{ lineWidth: -1, noRefs: true }` (the playlist convention) and every produced YAML must round-trip through `parseTemplateDoc` before it is offered to the user (serializer-quoting guard).
- User templates may never overwrite a non-user registry entry (built-ins and pack templates are protected); the authoring loop and the import path both enforce this.
- `kit` is frozen (M1) — nothing here may attempt to mutate it.

## File Structure

- Modify `src/store.ts` — `MyTemplate` interface + `loadMyTemplates`/`saveMyTemplate`/`deleteMyTemplate` (exact mirror of the library trio; new key `drawcast.myTemplates.v1`).
- Create `src/scenes/my-templates.ts` — user-owned-id tracking, `registerUserTemplateYaml` (collision-safe), `unregisterUserTemplate`, `registerMyTemplatesAtStartup`.
- Create `src/llm/prompts/author-v1.md` — the authoring system prompt (data; placeholders `{{KIT_SOURCE}}`, `{{EXEMPLAR_YAML}}`, `{{BUILTIN_IDS}}`). Deliberately NOT named `compiler-*.md` so the variant glob ignores it.
- Create `src/llm/author.ts` — `TEMPLATE_DOC_API_SCHEMA`, `buildAuthorSystem`, `buildAuthorUserContent`, `processAuthorDoc`, `withPreviewRegistration`, `templateDocToYaml`, `generateTemplate`.
- Modify `src/main.ts` — authoring dialog, "New template" button, "My templates" panel, startup registration.
- Modify `src/styles.css` — dialog/image-drop styles (append only).
- Tests: `tests/my-templates.test.ts`, `tests/author.test.ts`.

---

### Task 1: My-templates storage + safe registration

**Files:**
- Modify: `src/store.ts` (KEYS object ~line 11; new section after the library trio ~line 129)
- Create: `src/scenes/my-templates.ts`
- Test: `tests/my-templates.test.ts`

**Interfaces:**
- Consumes: `readArray<T>(key)` private helper pattern in store.ts (mirror the SavedDrawing trio verbatim); `scenes`, `registerTemplateYaml` from `src/scenes/registry.ts`; `parseTemplateDoc` from `src/scenes/doc.ts`.
- Produces (later tasks rely on these exact names):
  - store.ts: `export interface MyTemplate { id: string; yaml: string; ts: string }`, `loadMyTemplates(): MyTemplate[]`, `saveMyTemplate(t: MyTemplate): void` (upsert by id, newest first), `deleteMyTemplate(id: string): void`
  - my-templates.ts: `isUserTemplateId(id: string): boolean`, `registerUserTemplateYaml(yaml: string): { ok: boolean; id?: string; errors: string[] }`, `unregisterUserTemplate(id: string): void`, `registerMyTemplatesAtStartup(): { id: string; ok: boolean; errors: string[] }[]`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/my-templates.test.ts
import { beforeEach, describe, expect, test, vi } from "vitest";

// store.ts touches localStorage at call time — give the node env a real-enough stub.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

import { loadMyTemplates, saveMyTemplate, deleteMyTemplate } from "../src/store";
import { isUserTemplateId, registerUserTemplateYaml, unregisterUserTemplate, registerMyTemplatesAtStartup } from "../src/scenes/my-templates";
import { scenes } from "../src/scenes/registry";

const USER_YAML = `
template: my_test_widget
version: 1
kit: 1
status: ready
description: A test widget.
params: { type: object }
element_ids: { dot: the dot }
examples:
  - request: "Draw the widget."
    params: {}
layout: |
  return { drawables: [kit.stroke("dot", [[500, 400]], { shapeHint: { type: "circle", c: [500, 400], r: 10 } })], labels: [], anchors: {}, order: ["dot"] };
`;

beforeEach(() => {
  mem.clear();
  unregisterUserTemplate("my_test_widget");
});

describe("store: my templates", () => {
  test("save/load/delete round-trip, upsert by id, newest first", () => {
    saveMyTemplate({ id: "a", yaml: "ya", ts: "1" });
    saveMyTemplate({ id: "b", yaml: "yb", ts: "2" });
    saveMyTemplate({ id: "a", yaml: "ya2", ts: "3" });
    const all = loadMyTemplates();
    expect(all.map((t) => t.id)).toEqual(["a", "b"]);
    expect(all[0].yaml).toBe("ya2");
    deleteMyTemplate("a");
    expect(loadMyTemplates().map((t) => t.id)).toEqual(["b"]);
  });
});

describe("registerUserTemplateYaml", () => {
  test("registers a valid user template and marks the id user-owned", () => {
    const r = registerUserTemplateYaml(USER_YAML);
    expect(r).toEqual({ ok: true, id: "my_test_widget", errors: [] });
    expect(scenes.my_test_widget.layout).toBeDefined();
    expect(isUserTemplateId("my_test_widget")).toBe(true);
  });

  test("re-registering the same user id is allowed (iterate/improve)", () => {
    registerUserTemplateYaml(USER_YAML);
    const r = registerUserTemplateYaml(USER_YAML.replace("A test widget.", "A better widget."));
    expect(r.ok).toBe(true);
    expect(scenes.my_test_widget.manifest.description).toContain("better");
  });

  test("refuses to overwrite a built-in id", () => {
    const r = registerUserTemplateYaml(USER_YAML.replace("my_test_widget", "supply_demand"));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/built-in|existing template/);
    expect(scenes.supply_demand.layout).toBeDefined(); // untouched
  });

  test("invalid yaml reports errors and registers nothing", () => {
    const r = registerUserTemplateYaml("template: [broken");
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("unregister + startup registration", () => {
  test("unregister removes a user template from the registry", () => {
    registerUserTemplateYaml(USER_YAML);
    unregisterUserTemplate("my_test_widget");
    expect(scenes.my_test_widget).toBeUndefined();
    expect(isUserTemplateId("my_test_widget")).toBe(false);
  });

  test("unregister never touches non-user entries", () => {
    unregisterUserTemplate("supply_demand");
    expect(scenes.supply_demand).toBeDefined();
  });

  test("startup registers everything stored, reporting per-id results", () => {
    saveMyTemplate({ id: "my_test_widget", yaml: USER_YAML, ts: "1" });
    saveMyTemplate({ id: "broken", yaml: "template: [broken", ts: "2" });
    const results = registerMyTemplatesAtStartup();
    expect(results.find((r) => r.id === "my_test_widget")?.ok).toBe(true);
    expect(results.find((r) => r.id === "broken")?.ok).toBe(false);
    expect(scenes.my_test_widget.layout).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/my-templates.test.ts`
Expected: FAIL — `loadMyTemplates` is not exported / cannot resolve `../src/scenes/my-templates`.

- [ ] **Step 3: Implement**

In `src/store.ts`: add to the `KEYS` object:

```ts
  myTemplates: "drawcast.myTemplates.v1",
```

After the SavedDrawing trio (~line 129), add:

```ts
// ---- My templates (user-authored TemplateDocs, M2) ----

export interface MyTemplate {
  /** The doc's template id — one entry per id. */
  id: string;
  /** The full template document as YAML (never contains images). */
  yaml: string;
  ts: string;
}

export function loadMyTemplates(): MyTemplate[] {
  return readArray<MyTemplate>(KEYS.myTemplates);
}

export function saveMyTemplate(t: MyTemplate): void {
  const all = loadMyTemplates().filter((x) => x.id !== t.id);
  all.unshift(t);
  localStorage.setItem(KEYS.myTemplates, JSON.stringify(all));
}

export function deleteMyTemplate(id: string): void {
  localStorage.setItem(KEYS.myTemplates, JSON.stringify(loadMyTemplates().filter((x) => x.id !== id)));
}
```

Create `src/scenes/my-templates.ts`:

```ts
// User-authored templates: registration that can never clobber a built-in,
// and startup loading from localStorage. The authoring UI (main.ts) and the
// authoring pipeline (llm/author.ts) both go through here.

import { loadMyTemplates } from "../store";
import { parseTemplateDoc } from "./doc";
import { registerTemplateYaml, scenes } from "./registry";

/** Ids owned by the user this session. Only these may be re-registered or removed. */
const userIds = new Set<string>();

export function isUserTemplateId(id: string): boolean {
  return userIds.has(id);
}

/**
 * Parse + register a user template. Refuses ids that belong to a non-user
 * registry entry — a user template must never shadow a built-in.
 */
export function registerUserTemplateYaml(yaml: string): { ok: boolean; id?: string; errors: string[] } {
  const { doc, errors } = parseTemplateDoc(yaml);
  if (!doc) return { ok: false, errors };
  if (scenes[doc.template] && !userIds.has(doc.template)) {
    return { ok: false, id: doc.template, errors: [`"${doc.template}" is a built-in (or otherwise existing template) — choose a different template id`] };
  }
  const r = registerTemplateYaml(yaml);
  if (r.ok) userIds.add(doc.template);
  return { ok: r.ok, id: doc.template, errors: r.errors };
}

/** Remove a USER template from the live registry (no-op for anything else). */
export function unregisterUserTemplate(id: string): void {
  if (!userIds.has(id)) return;
  delete scenes[id];
  userIds.delete(id);
}

/** Load every stored personal template into the registry. Call once at startup. */
export function registerMyTemplatesAtStartup(): { id: string; ok: boolean; errors: string[] }[] {
  return loadMyTemplates().map((t) => {
    const r = registerUserTemplateYaml(t.yaml);
    return { id: r.id ?? t.id, ok: r.ok, errors: r.errors };
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/my-templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
npx tsc && npx vitest run
git add src/store.ts src/scenes/my-templates.ts tests/my-templates.test.ts
git commit -m "feat: My templates — localStorage store + collision-safe registration

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: The authoring pipeline (`src/llm/author.ts` + prompt)

**Files:**
- Create: `src/llm/prompts/author-v1.md`
- Create: `src/llm/author.ts`
- Test: `tests/author.test.ts`

**Interfaces:**
- Consumes: `callForJson`, `makeClient`, `describeApiError`, `type JsonCallMeta` from `./client`; `repairModelFor` from `./compile`; `validateTemplateDoc`, `parseTemplateDoc`, `type TemplateDoc` from `../scenes/doc`; `compileTemplateDoc` from `../scenes/compile`; `scenes` from `../scenes/registry`; `isUserTemplateId` from `../scenes/my-templates`; `layoutSpec` from `../layout/layout`; `lintReportText, type LintIssue` from `../lint/lint`; `makeBrowserMeasure` from `../render/svg-backend` — call it lazily inside `generateTemplate` (it needs a DOM; the pure functions must import without one); `dump` from `js-yaml`; raw imports: `../scenes/kit.ts?raw`, `../scenes/cell_diagram/template.yaml?raw`, `./prompts/author-v1.md?raw`.
- Produces (Task 3 relies on these exact names):
  - `export interface AuthorImage { mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; dataBase64: string }`
  - `export interface AuthorRound { label: "initial" | "repair"; doc: unknown; errors: string[]; lintIssues: LintIssue[]; meta: JsonCallMeta }`
  - `export interface AuthorOutcome { doc: TemplateDoc | null; yaml: string | null; rounds: AuthorRound[]; history: Anthropic.MessageParam[]; error?: string }`
  - `export interface AuthorConfig { apiKey: string; model: string; maxRepairs?: number; existingYaml?: string; history?: Anthropic.MessageParam[] }`
  - `export function buildAuthorUserContent(description: string, image: AuthorImage | null, existingYaml?: string): Anthropic.MessageParam["content"]`
  - `export function processAuthorDoc(json: unknown): { doc: TemplateDoc | null; errors: string[]; lintIssues: LintIssue[] }` — takes an optional second arg `measure?: MeasureFn` (default `heuristicMeasure` from `../layout/measure`) so tests run without a DOM.
  - `export function templateDocToYaml(doc: TemplateDoc): { yaml: string | null; error?: string }`
  - `export function generateTemplate(description: string, image: AuthorImage | null, cfg: AuthorConfig): Promise<AuthorOutcome>`

- [ ] **Step 1: Write `src/llm/prompts/author-v1.md`**

```markdown
You are drawcast's template author. You write TEMPLATE DOCUMENTS: reusable,
parametrized figure generators for a hand-drawn-style educational drawing app.
The user describes a figure type (sometimes with a reference image); you return
ONE template document as a SINGLE minified JSON object — no prose, no fences.

## The template document (return exactly this JSON shape)

{"template": "<id: lowercase snake_case, unique>", "title": "<short name>",
"version": 1, "kit": 1, "status": "ready",
"description": "<2-4 sentences: what the figure is AND when to choose it — this text routes future requests to your template, so name the concepts, synonyms and typical requests it should catch>",
"params": {<JSON schema, type object: CONTENT-ONLY parameters — labels, counts, toggles, domain notations. NEVER coordinates, sizes or colors>},
"element_ids": {"<id>": "<what it is>", ...},
"examples": [{"request": "<a realistic user request>", "params": {<params for it>}}, {<a second, different example>}],
"layout": "<a JavaScript FUNCTION BODY — see below>"}

## The layout function body

Your layout string is the body of: new Function("params", "kit", "engines").
It must `return { drawables, labels, anchors, order }`.

- No imports, no globals, no Math.random, no Date — everything comes through
  `kit` (frozen), and determinism is required: same params, identical output.
- Canvas is 1000×750, y-UP (y=0 is the bottom). Keep all geometry within it.
- drawables: array from kit factories. labels: array from kit.label. anchors:
  { id: [x, y] } points for gestures. order: every drawable and label id, in
  natural draw order (this drives the narrated drawing sequence).
- Ids must be unique, including inside groups.

Rules distilled from the built-in templates:
1. Text that IS geometry (atom symbols, axis letters, termini) = kit.text at
   an exact position. Text that NAMES things (organelle labels, curve names) =
   kit.label — the collision solver may move those and add leader lines.
2. Repeated micro-strokes (ring bonds, dots, hatching, cristae) go in ONE
   kit.group(id, children) — groups are the narration/annotation beats.
3. Defaults for every param — `params.x ?? fallback` everywhere; an empty
   params object must render a good default figure.
4. Where a standard notation exists, take it as the param (kit.parseSS,
   kit.parseNewick, kit.parseEdgeList) instead of inventing structure.

## The kit (this is the complete API available to your body)

{{KIT_SOURCE}}

## A complete exemplar template (YAML form for readability — you return JSON)

{{EXEMPLAR_YAML}}

## Existing template ids — your "template" id must NOT be any of these

{{BUILTIN_IDS}}

## When the user provides a reference image

Recreate the STRUCTURE — the parts, their arrangement, what connects to what —
as a parametrized schematic in drawcast's sketch style. Decide what should be
adjustable (counts, labels, optional parts) and make those the params. Do not
trace pixels; draw the idea.

## When asked to improve an existing template

The current document is included in the conversation. Return the COMPLETE
revised document (same template id, bump "version" by 1), not a diff.
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/author.test.ts
import { describe, expect, test } from "vitest";
import { buildAuthorUserContent, processAuthorDoc, templateDocToYaml } from "../src/llm/author";
import { parseTemplateDoc, type TemplateDoc } from "../src/scenes/doc";
import { scenes } from "../src/scenes/registry";

function goodDoc(): TemplateDoc {
  return {
    template: "author_test_ring",
    title: "Test ring",
    version: 1,
    kit: 1,
    status: "ready",
    description: "A test ring figure.",
    params: { type: "object", properties: { n: { type: "number" } } },
    element_ids: { ring: "the ring" },
    examples: [{ request: "Draw a ring.", params: { n: 6 } }],
    layout: `return { drawables: [kit.stroke("ring", kit.polygon([500, 400], 120, params.n ?? 6), { closed: true })], labels: [], anchors: { ring_center: [500, 400] }, order: ["ring"] };`,
  };
}

describe("buildAuthorUserContent", () => {
  test("text only", () => {
    expect(buildAuthorUserContent("a cell", null)).toBe("a cell");
  });

  test("image + text becomes a content-block array with the image first", () => {
    const c = buildAuthorUserContent("like this", { mediaType: "image/png", dataBase64: "AAAA" });
    expect(Array.isArray(c)).toBe(true);
    const blocks = c as { type: string }[];
    expect(blocks[0].type).toBe("image");
    expect(blocks[1]).toMatchObject({ type: "text", text: "like this" });
  });

  test("improve mode appends the current yaml", () => {
    const c = buildAuthorUserContent("make it rounder", null, "template: x\n");
    expect(c).toContain("make it rounder");
    expect(c).toContain("template: x");
  });
});

describe("processAuthorDoc", () => {
  test("a good doc validates, compiles, runs and lints clean; registry is untouched after", () => {
    const before = Object.keys(scenes).length;
    const r = processAuthorDoc(goodDoc());
    expect(r.errors).toEqual([]);
    expect(r.doc?.template).toBe("author_test_ring");
    expect(Object.keys(scenes).length).toBe(before);
    expect(scenes.author_test_ring).toBeUndefined();
  });

  test("id colliding with a built-in is an error", () => {
    const d = { ...goodDoc(), template: "supply_demand" };
    const r = processAuthorDoc(d);
    expect(r.errors.some((e) => /different template id|built-in/.test(e))).toBe(true);
  });

  test("invalid doc shape reports validation errors", () => {
    const r = processAuthorDoc({ template: "x" });
    expect(r.doc).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  test("a layout that throws at runtime reports the error", () => {
    const d = { ...goodDoc(), layout: `throw new Error("boom");` };
    const r = processAuthorDoc(d);
    expect(r.errors.some((e) => /boom/.test(e))).toBe(true);
  });

  test("a layout with invalid output reports the guard's message", () => {
    const d = { ...goodDoc(), layout: `return { nope: true };` };
    const r = processAuthorDoc(d);
    expect(r.errors.some((e) => /drawables/.test(e))).toBe(true);
  });
});

describe("templateDocToYaml", () => {
  test("round-trips through parseTemplateDoc with the layout intact", () => {
    const { yaml, error } = templateDocToYaml(goodDoc());
    expect(error).toBeUndefined();
    const back = parseTemplateDoc(yaml!);
    expect(back.errors).toEqual([]);
    expect(back.doc?.layout).toContain("kit.polygon");
    expect(back.doc?.template).toBe("author_test_ring");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/author.test.ts`
Expected: FAIL — cannot resolve `../src/llm/author`.

- [ ] **Step 4: Implement `src/llm/author.ts`**

```ts
// The template-authoring pipeline (spec §6): description and/or image →
// TemplateDoc, with the same call → validate → repair shape as generateSpec.
// The validation chain: doc validation → id collision → compile → run the
// first example → preview lint through the REAL layoutSpec (temporary
// registration, always restored).

import type Anthropic from "@anthropic-ai/sdk";
import { dump } from "js-yaml";
import { callForJson, describeApiError, makeClient, type JsonCallMeta } from "./client";
import { repairModelFor } from "./compile";
import { parseTemplateDoc, validateTemplateDoc, type TemplateDoc } from "../scenes/doc";
import { compileTemplateDoc } from "../scenes/compile";
import { scenes } from "../scenes/registry";
import { isUserTemplateId } from "../scenes/my-templates";
import { layoutSpec } from "../layout/layout";
import { heuristicMeasure, type MeasureFn } from "../layout/measure";
import { lintReportText, type LintIssue } from "../lint/lint";
import kitSource from "../scenes/kit.ts?raw";
import exemplarYaml from "../scenes/cell_diagram/template.yaml?raw";
import authorPromptSource from "./prompts/author-v1.md?raw";

export interface AuthorImage {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  dataBase64: string;
}

export interface AuthorRound {
  label: "initial" | "repair";
  doc: unknown;
  errors: string[];
  lintIssues: LintIssue[];
  meta: JsonCallMeta;
}

export interface AuthorOutcome {
  doc: TemplateDoc | null;
  yaml: string | null;
  rounds: AuthorRound[];
  /** Full conversation (image included) — pass back for refine rounds. */
  history: Anthropic.MessageParam[];
  error?: string;
}

export interface AuthorConfig {
  apiKey: string;
  model: string;
  maxRepairs?: number;
  /** Improve mode: the current template's YAML. */
  existingYaml?: string;
  /** Refine mode: prior authoring conversation to continue. */
  history?: Anthropic.MessageParam[];
}

/** Closed shape for structured outputs; the open params object may 400 — callForJson falls back. */
export const TEMPLATE_DOC_API_SCHEMA = {
  type: "object",
  properties: {
    template: { type: "string" },
    title: { type: "string" },
    version: { type: "integer" },
    kit: { type: "integer" },
    status: { type: "string", enum: ["ready"] },
    description: { type: "string" },
    params: { type: "object" },
    element_ids: { type: "object" },
    examples: {
      type: "array",
      items: {
        type: "object",
        properties: { request: { type: "string" }, params: { type: "object" } },
        required: ["request", "params"],
      },
    },
    layout: { type: "string" },
  },
  required: ["template", "version", "kit", "status", "description", "params", "element_ids", "examples", "layout"],
} as const;

export function buildAuthorSystem(): Anthropic.TextBlockParam[] {
  const text = authorPromptSource
    .replaceAll("{{KIT_SOURCE}}", kitSource)
    .replaceAll("{{EXEMPLAR_YAML}}", exemplarYaml)
    .replaceAll("{{BUILTIN_IDS}}", Object.keys(scenes).sort().join(", "));
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

export function buildAuthorUserContent(description: string, image: AuthorImage | null, existingYaml?: string): Anthropic.MessageParam["content"] {
  const text = existingYaml
    ? `${description}\n\nCurrent template to improve:\n\`\`\`yaml\n${existingYaml}\n\`\`\``
    : description;
  if (!image) return text;
  return [
    { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.dataBase64 } },
    { type: "text", text },
  ];
}

/** Register the doc's compiled module, run fn, ALWAYS restore the previous registry state. */
function withPreviewRegistration<T>(doc: TemplateDoc, layout: NonNullable<ReturnType<typeof compileTemplateDoc>["module"]>["layout"], fn: () => T): T {
  const id = doc.template;
  const prev = scenes[id];
  scenes[id] = { manifest: { name: id, status: "ready", description: doc.description, params_schema: doc.params, element_ids: doc.element_ids, examples: doc.examples }, layout };
  try {
    return fn();
  } finally {
    if (prev) scenes[id] = prev;
    else delete scenes[id];
  }
}

/** The full authoring validation chain. Pure of API concerns; DOM-free by default. */
export function processAuthorDoc(json: unknown, measure: MeasureFn = heuristicMeasure): { doc: TemplateDoc | null; errors: string[]; lintIssues: LintIssue[] } {
  const v = validateTemplateDoc(json);
  if (!v.doc) return { doc: null, errors: v.errors, lintIssues: [] };
  const doc = v.doc;

  if (scenes[doc.template] && !isUserTemplateId(doc.template)) {
    return { doc, errors: [`the id "${doc.template}" is a built-in template — return the document with a different template id`], lintIssues: [] };
  }

  const compiled = compileTemplateDoc(doc);
  if (!compiled.module?.layout) return { doc, errors: compiled.errors.length > 0 ? compiled.errors : ["the document compiled to a stub (no layout)"], lintIssues: [] };

  const params = doc.examples[0]?.params ?? {};
  try {
    compiled.module.layout(params);
  } catch (err) {
    return { doc, errors: [`the layout failed on examples[0].params: ${(err as Error).message}`], lintIssues: [] };
  }

  const lintIssues = withPreviewRegistration(doc, compiled.module.layout, () => {
    const res = layoutSpec({ template: doc.template, params, elements: [] } as never, measure);
    return res.warnings.length > 0 ? [...res.issues, ...res.warnings.map((w): LintIssue => ({ rule: "author-warning", ids: [], message: w, severity: "error" }))] : res.issues;
  });
  return { doc, errors: [], lintIssues };
}

const YAML_OPTS = { lineWidth: -1, noRefs: true } as const;

/** Serialize + round-trip guard: never hand the user YAML that will not parse back. */
export function templateDocToYaml(doc: TemplateDoc): { yaml: string | null; error?: string } {
  const yaml = dump(doc, YAML_OPTS);
  const back = parseTemplateDoc(yaml);
  if (!back.doc) return { yaml: null, error: `serialized YAML failed to re-parse: ${back.errors[0]}` };
  return { yaml };
}

function needsAuthorRepair(errors: string[], lintIssues: LintIssue[]): boolean {
  return errors.length > 0 || lintIssues.some((i) => i.severity === "error");
}

export async function generateTemplate(description: string, image: AuthorImage | null, cfg: AuthorConfig): Promise<AuthorOutcome> {
  const client = makeClient(cfg.apiKey);
  const system = buildAuthorSystem();
  const maxRepairs = cfg.maxRepairs ?? 2;
  const messages: Anthropic.MessageParam[] = [
    ...(cfg.history ?? []),
    { role: "user", content: buildAuthorUserContent(description, image, cfg.existingYaml) },
  ];
  const rounds: AuthorRound[] = [];
  let best: { doc: TemplateDoc; yaml: string } | null = null;
  let repairsUsed = 0;

  try {
    while (true) {
      const roundModel = rounds.length === 0 ? cfg.model : repairModelFor(cfg.model);
      const { json, raw, meta } = await callForJson(client, roundModel, system, messages, TEMPLATE_DOC_API_SCHEMA as unknown as object);
      const { doc, errors, lintIssues } = processAuthorDoc(json);
      rounds.push({ label: rounds.length === 0 ? "initial" : "repair", doc: json, errors, lintIssues, meta });

      if (doc && errors.length === 0) {
        const y = templateDocToYaml(doc);
        if (y.yaml) best = { doc, yaml: y.yaml };
        else errors.push(y.error!);
      }

      if (!needsAuthorRepair(errors, lintIssues) || repairsUsed >= maxRepairs) {
        messages.push({ role: "assistant", content: raw });
        break;
      }
      repairsUsed++;
      const lintErrors = lintIssues.filter((i) => i.severity === "error");
      const feedback =
        errors.length > 0
          ? `The template document has problems:\n${errors.join("\n")}\n\nReturn the corrected COMPLETE template document as minified JSON.`
          : `The template renders with visual problems:\n${lintReportText(lintErrors)}\n\nReturn the corrected COMPLETE template document as minified JSON.`;
      messages.push({ role: "assistant", content: raw }, { role: "user", content: feedback });
    }
  } catch (err) {
    return { doc: best?.doc ?? null, yaml: best?.yaml ?? null, rounds, history: messages, error: describeApiError(err) };
  }

  return {
    doc: best?.doc ?? null,
    yaml: best?.yaml ?? null,
    rounds,
    history: messages,
    error: best ? undefined : "The model never produced a working template (see rounds).",
  };
}
```

Note for the implementer: check `layoutSpec`'s signature — it takes `(spec, measure?)`; pass the measure through. Check `LintIssue`'s exact shape in `src/lint/lint.ts` before constructing the `author-warning` issue object; adjust the literal to match its fields (the test doesn't depend on it).

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/author.test.ts`
Expected: PASS.

- [ ] **Step 6: Gate and commit**

```bash
npx tsc && npx vitest run
git add src/llm/author.ts src/llm/prompts/author-v1.md tests/author.test.ts
git commit -m "feat: template-authoring pipeline — text+image to TemplateDoc with repair rounds

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Authoring UI + My templates panel (`src/main.ts`)

**Files:**
- Modify: `src/main.ts` (toolbar row ~line 392-404; after the Library `details` panel ~line 419; startup near the top after `initialDoc()`)
- Modify: `src/styles.css` (append only)

**Interfaces:**
- Consumes: from Task 1 `registerUserTemplateYaml`, `unregisterUserTemplate`, `registerMyTemplatesAtStartup`, `isUserTemplateId` (`./scenes/my-templates`), `loadMyTemplates`, `saveMyTemplate`, `deleteMyTemplate` (`./store`); from Task 2 `generateTemplate`, `type AuthorImage`, `type AuthorOutcome` (`./llm/author`); existing: `h` (`./ui/dom`), `singlePlaylist` (already imported from `./playlist/playlist`), `mountPlaylist` (already imported), `requireKey()` (~line 652), `modelSel` (the toolbar model select), `settings`, `speech`, `playbackPrefs()`, `setStatus`.
- Produces: UI only — no exports.

No unit tests (main.ts has none by convention; vitest env is node). Verification is `npx tsc`, the full suite (no regressions), `npm run build`, and a documented manual smoke.

- [ ] **Step 1: Startup registration**

Right after the `doc` / `initialDoc()` setup (before the first `present()` call), add:

```ts
// Personal templates must be in the registry before anything renders.
for (const r of registerMyTemplatesAtStartup()) {
  if (!r.ok) console.warn(`My template "${r.id}" failed to load:`, r.errors.join("; "));
}
```

- [ ] **Step 2: The authoring dialog**

Add after the settings-dialog section. This is complete code; adapt only where a named symbol differs:

```ts
// ---------- template authoring (M2) ----------

const authorDescEl = h("textarea", { placeholder: 'Describe the reusable figure… e.g. "A titration setup: burette, flask, stand — with adjustable labels"' });
const authorImgThumb = h("img", { class: "author-thumb", hidden: "", alt: "Reference image" });
const authorImgClear = h("button", { class: "small", hidden: "" }, "Remove image");
const authorDrop = h("div", { class: "author-drop" }, "Paste or drop a reference image here (optional) — or ", h("button", { class: "small author-pick" }, "choose a file"));
const authorImgInput = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: "" });
const authorGenBtn = h("button", { class: "primary" }, "Generate template");
const authorStatus = h("div", { class: "hint" });
const authorPreviewHost = h("div", { class: "player-figure author-preview" });
const authorRefineEl = h("textarea", { placeholder: "Refine it… e.g. \"make the flask bigger and add an indicator-color param\"", hidden: "" });
const authorRefineBtn = h("button", { hidden: "" }, "Refine");
const authorSaveBtn = h("button", { class: "primary", hidden: "" }, "Save to My templates");
const authorCloseBtn = h("button", {}, "Close");

const authorDialog = h(
  "dialog",
  { class: "author-dialog" },
  h("h2", {}, "New template"),
  authorDescEl,
  h("div", { class: "row" }, authorDrop, authorImgInput, authorImgThumb, authorImgClear),
  h("div", { class: "row" }, authorGenBtn, authorCloseBtn),
  authorStatus,
  authorPreviewHost,
  h("div", { class: "row" }, authorRefineEl, authorRefineBtn, authorSaveBtn),
);
document.body.appendChild(authorDialog);

let authorImage: AuthorImage | null = null;
let authorOutcome: AuthorOutcome | null = null;
let authorImproveId: string | null = null;
let authorMount: { destroy(): void } | null = null;

function setAuthorImage(img: AuthorImage | null): void {
  authorImage = img;
  authorImgThumb.hidden = !img;
  authorImgClear.hidden = !img;
  authorDrop.hidden = !!img;
  if (img) authorImgThumb.src = `data:${img.mediaType};base64,${img.dataBase64}`;
  else authorImgThumb.removeAttribute("src");
}

function readImageFile(file: File): Promise<AuthorImage | null> {
  const ok = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  if (!ok.includes(file.type)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      const comma = url.indexOf(",");
      resolve({ mediaType: file.type as AuthorImage["mediaType"], dataBase64: url.slice(comma + 1) });
    };
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

authorDialog.addEventListener("paste", (e) => {
  const file = [...(e.clipboardData?.files ?? [])][0];
  if (file) void readImageFile(file).then(setAuthorImage);
});
authorDrop.addEventListener("dragover", (e) => e.preventDefault());
authorDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) void readImageFile(file).then(setAuthorImage);
});
authorDrop.querySelector(".author-pick")!.addEventListener("click", () => authorImgInput.click());
authorImgInput.addEventListener("change", () => {
  const file = authorImgInput.files?.[0];
  if (file) void readImageFile(file).then(setAuthorImage);
});
authorImgClear.addEventListener("click", () => setAuthorImage(null));

async function renderAuthorPreview(): Promise<void> {
  authorMount?.destroy();
  authorMount = null;
  authorPreviewHost.replaceChildren();
  const doc = authorOutcome?.doc;
  if (!doc || !authorOutcome?.yaml) return;
  // Preview through the real pipeline: temporarily registered under its id.
  const reg = registerUserTemplateYaml(authorOutcome.yaml);
  if (!reg.ok) {
    authorStatus.textContent = `Preview failed: ${reg.errors.join("; ")}`;
    return;
  }
  const spec = { title: doc.title ?? doc.template, template: doc.template, params: doc.examples[0]?.params ?? {} } as unknown as Spec;
  try {
    authorMount = await mountPlaylist(authorPreviewHost, singlePlaylist(spec), {
      style: settings.style,
      mode: "instant",
      speed: settings.speed,
      speech,
      prefs: playbackPrefs(),
    });
  } catch (err) {
    authorStatus.textContent = `Preview render failed: ${(err as Error).message}`;
  }
}

async function runAuthor(description: string, refine: boolean): Promise<void> {
  const apiKey = requireKey();
  if (!apiKey) return;
  if (!description.trim()) return;
  authorGenBtn.disabled = authorRefineBtn.disabled = true;
  authorStatus.textContent = "Generating template…";
  try {
    const existing = authorImproveId && !refine ? loadMyTemplates().find((t) => t.id === authorImproveId)?.yaml : undefined;
    authorOutcome = await generateTemplate(description, refine ? null : authorImage, {
      apiKey,
      model: modelSel.value,
      existingYaml: existing,
      history: refine ? (authorOutcome?.history ?? undefined) : undefined,
    });
    const n = authorOutcome.rounds.length;
    if (authorOutcome.error) {
      authorStatus.textContent = `${authorOutcome.error} (${n} round${n === 1 ? "" : "s"})`;
    } else {
      authorStatus.textContent = `Template "${authorOutcome.doc!.template}" ready after ${n} round${n === 1 ? "" : "s"} — check the preview, refine, or save.`;
      authorRefineEl.hidden = authorRefineBtn.hidden = authorSaveBtn.hidden = false;
      await renderAuthorPreview();
    }
  } catch (err) {
    authorStatus.textContent = describeApiError(err);
  } finally {
    authorGenBtn.disabled = authorRefineBtn.disabled = false;
  }
}

authorGenBtn.addEventListener("click", () => void runAuthor(authorDescEl.value, false));
authorRefineBtn.addEventListener("click", () => {
  const t = authorRefineEl.value.trim();
  if (t) {
    authorRefineEl.value = "";
    void runAuthor(t, true);
  }
});

authorSaveBtn.addEventListener("click", () => {
  if (!authorOutcome?.yaml || !authorOutcome.doc) return;
  const id = authorOutcome.doc.template;
  const reg = registerUserTemplateYaml(authorOutcome.yaml);
  if (!reg.ok) {
    authorStatus.textContent = `Save failed: ${reg.errors.join("; ")}`;
    return;
  }
  saveMyTemplate({ id, yaml: authorOutcome.yaml, ts: new Date().toISOString() });
  refreshMyTemplates();
  authorStatus.textContent = `Saved. "${id}" is now in the catalog — try: use the ${id} template.`;
});

function openAuthorDialog(improve?: { id: string }): void {
  authorImproveId = improve?.id ?? null;
  authorOutcome = null;
  setAuthorImage(null);
  authorDescEl.value = "";
  authorStatus.textContent = authorImproveId ? `Improving "${authorImproveId}" — describe what to change.` : "";
  authorRefineEl.hidden = authorRefineBtn.hidden = authorSaveBtn.hidden = true;
  authorMount?.destroy();
  authorMount = null;
  authorPreviewHost.replaceChildren();
  (authorDialog.querySelector("h2") as HTMLElement).textContent = authorImproveId ? `Improve template: ${authorImproveId}` : "New template";
  authorDialog.showModal();
}

authorCloseBtn.addEventListener("click", () => {
  authorMount?.destroy();
  authorMount = null;
  // The preview registered the draft for real (the preview player re-renders on
  // replay, so a temporary registration cannot be restored early). Clean up:
  // a draft that was never saved leaves the registry; an improved template
  // reverts to its stored version.
  const draftId = authorOutcome?.doc?.template;
  if (draftId && isUserTemplateId(draftId)) {
    const stored = loadMyTemplates().find((t) => t.id === draftId);
    if (!stored) unregisterUserTemplate(draftId);
    else registerUserTemplateYaml(stored.yaml);
  }
  authorDialog.close();
});
```

Then add the toolbar entry point: in the `toolbar-row` (after `importInput`), insert:

```ts
const newTemplateBtn = h("button", { title: "Create a reusable template with AI (describe it, optionally paste an image)" }, "✦ New template");
newTemplateBtn.addEventListener("click", () => openAuthorDialog());
```

and place `newTemplateBtn` in the row next to `exportVideoBtn`.

- [ ] **Step 3: The My templates panel**

After the Library `details` panel (~line 419), add a sibling panel:

```ts
const myTemplatesList = h("div", { class: "library-list" });
const myTplImportBtn = h("button", { class: "small" }, "Import template…");
const myTplImportInput = h("input", { type: "file", accept: ".yaml,.yml", hidden: "" });
myTplImportBtn.addEventListener("click", () => myTplImportInput.click());
myTplImportInput.addEventListener("change", () => {
  const file = myTplImportInput.files?.[0];
  if (!file) return;
  void file.text().then((yaml) => {
    const r = registerUserTemplateYaml(yaml);
    if (!r.ok) {
      setStatus(`Template import failed: ${r.errors.join("; ")}`, "error");
      return;
    }
    saveMyTemplate({ id: r.id!, yaml, ts: new Date().toISOString() });
    refreshMyTemplates();
    setStatus(`Imported template "${r.id}".`, "ok");
  });
  myTplImportInput.value = "";
});

function refreshMyTemplates(): void {
  myTemplatesList.replaceChildren();
  const all = loadMyTemplates();
  if (all.length === 0) {
    myTemplatesList.appendChild(h("div", { class: "hint" }, "No templates yet — create one with ✦ New template."));
    return;
  }
  for (const t of all) {
    const improveBtn = h("button", { class: "small" }, "Improve");
    improveBtn.addEventListener("click", () => openAuthorDialog({ id: t.id }));
    const exportBtn2 = h("button", { class: "small" }, "Export");
    exportBtn2.addEventListener("click", () => {
      const blob = new Blob([t.yaml], { type: "text/yaml" });
      const a = h("a", { href: URL.createObjectURL(blob), download: `${t.id}.yaml` });
      a.click();
      URL.revokeObjectURL(a.href);
    });
    const delBtn2 = h("button", { class: "small" }, "Delete");
    delBtn2.addEventListener("click", () => {
      deleteMyTemplate(t.id);
      unregisterUserTemplate(t.id);
      refreshMyTemplates();
    });
    myTemplatesList.appendChild(h("div", { class: "library-item" }, h("span", { class: "library-title" }, t.id), improveBtn, exportBtn2, delBtn2));
  }
}
refreshMyTemplates();
```

Insert into `editorWrap` right after the Library `details`:

```ts
h("details", { class: "panel editor-extra" }, h("summary", {}, "My templates"), h("div", { class: "row" }, myTplImportBtn, myTplImportInput), myTemplatesList),
```

Note: match the Library panel's actual item markup/classes (read the `refreshLibrary` function ~line 837 first and mirror its classes exactly; the class names above are the expected ones — verify).

- [ ] **Step 4: Styles**

Append to `src/styles.css`:

```css
/* ---------- template authoring (M2) ---------- */
.author-dialog { width: min(880px, 92vw); }
.author-dialog textarea { width: 100%; min-height: 64px; }
.author-drop { border: 2px dashed var(--ink-faint, #8f887c); border-radius: 8px; padding: 10px 14px; font-size: 0.9em; color: #8f887c; }
.author-thumb { max-height: 120px; max-width: 220px; border-radius: 6px; }
.author-preview { min-height: 280px; }
```

(If the app's dialog styling uses shared classes for the settings dialog, reuse those class names instead — check how the settings `dialog` is styled first.)

- [ ] **Step 5: Gate**

Run: `npx tsc && npx vitest run && npm run build`
Expected: all green (no unit tests added; the suite guards regressions).

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/styles.css
git commit -m "feat: template-authoring UI — New template dialog, refine loop, My templates panel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Final verification + push

**Files:** none new.

- [ ] **Step 1: Full gate from a clean state**

```bash
npx tsc && npx vitest run && npm run build
```

Expected: typecheck clean, all tests pass, production build succeeds.

- [ ] **Step 2: Focused M2 suites**

```bash
npx vitest run tests/my-templates.test.ts tests/author.test.ts tests/template-doc.test.ts tests/domain-scenes.test.ts
```

Expected: PASS.

- [ ] **Step 3: Push**

```bash
git push
```

Expected: CI deploys to GitHub Pages. Manual smoke for Hans (document in the final report): (1) ✦ New template → "A simple seesaw with two weights, labels adjustable" → preview appears → Save → generate a drawing "use the seesaw template to explain torque"; (2) same flow with a pasted image; (3) Export the template, delete it, re-import it.

---

## Self-Review Notes

- **Spec §6 coverage:** input text+image (T2 `buildAuthorUserContent`, T3 paste/drop/pick) ✓; dedicated authoring prompt with contract + kit docs + exemplar + the two spike rules + determinism + JSON form in prose (T2 prompt) ✓; preview loop with validator+lint feeding repair rounds on the repair model (T2 `generateTemplate`) ✓; conversational iteration with image persisting via history (T2 history + T3 refine) ✓; save → localStorage, immediately enabled and in the catalog (T1+T3; `sceneCatalogText` reads the live registry per generation, so no extra wiring) ✓; export/import YAML (T3) ✓; images never persisted (only in in-memory history) ✓. "Improve this template" scoped to My templates only — built-ins would need a copy-with-new-id flow; deliberately deferred, noted in the dialog scope.
- **Type consistency:** `AuthorImage`/`AuthorOutcome`/`generateTemplate`/`registerUserTemplateYaml`/`unregisterUserTemplate`/`loadMyTemplates`/`saveMyTemplate`/`deleteMyTemplate` names match across T1→T2→T3. `processAuthorDoc` default measure `heuristicMeasure` keeps tests DOM-free; `generateTemplate` uses the same default (a lint pass with heuristic measure is what `layoutSpec` tests use throughout the repo).
- **Placeholder scan:** clean — every step carries real code; the two "check the neighboring code first" notes (LintIssue shape, library item markup) are verification instructions with concrete fallbacks, not gaps.
- **Known risk, named for the implementer:** `mountPlaylist`'s option object in T3 is written from `present()`'s call shape minus `controls`; if `controls` is required by the type, pass `{ speech }` — check `src/playlist/session.ts` before wiring.
