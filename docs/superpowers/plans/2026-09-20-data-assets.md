# Data Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a drawcast carry structured data of its own — rows a template, a widget and its questions read at play time — self-contained when published, and kept out of model calls when it is too big to send.

**Architecture:** `spec.assets` already is a map of named payloads referenced as `"@name"`, serialized last, resolved by `normalizeSpec`, and hoisted out of model calls. This widens its value type from `string` to `unknown`, makes `"@name"` resolve inside `params` as well as inside an element's `strokes`, and replaces a too-large data asset with a one-line descriptor for the duration of a model call. Nothing new is invented; four existing mechanisms grow one step each.

**Tech Stack:** TypeScript, Vite, vitest, js-yaml, Ajv.

**Spec:** `docs/superpowers/specs/2026-09-20-data-assets-design.md` — read it first. Every task below cites the section it implements.

## Global Constraints

- **Netlify runs `npm test && npm run build`.** `npm run build` type-checks with `tsc`; vitest does not. Both must be green before any push.
- **Never break the byte path.** Every existing behaviour of a `string` asset (a traced portrait, an embedded photo) must be byte-identical afterwards. `tests/spec-assets.test.ts` is the guard; do not weaken it.
- **`assets` stays out of the wire schema.** `specSchema` must not gain an `assets` key; only `documentSchema` (via `ASSET_FIELDS`) changes.
- **Sizes are constants, never literals at a use site:** `ASSET_MAX_BYTES = 1024 * 1024` (§4.5), `ASSET_SEND_MAX = 32 * 1024` (§5.1).
- **Messages are copied verbatim from the spec.** §4.4's table and §5.1's refusal wording are user-visible text; do not paraphrase them.
- Run the full suite (`npm test`) at the end of every task, not just the new file — the asset path is touched by the layout, the lint, the planner and three render resolvers.

## File Structure

| File | Responsibility after this plan |
|---|---|
| `src/spec/assets.ts` | The whole asset vocabulary: what a reference is, what a data asset is, its size, its descriptor, and the two resolvers (strokes, params). Pure — no DOM, no registry. Grows from 88 to ~190 lines, which is still one clear job. |
| `src/spec/types.ts` | `assets?: Record<string, unknown>` |
| `src/spec/schema.ts` | Document schema widening; `normalizeSpec` resolving params; the four `semanticErrors` |
| `src/llm/hoist.ts` | Descriptor-or-send decision, and a key-aware restore that cannot lose an edit |
| `src/llm/revise.ts` | Restore before validate |
| `src/llm/compile.ts` | Authoring-time param validation through resolved params |
| `src/ui/insert.ts` | `openInsertData` — file → parsed rows → asset |
| `src/main.ts` | The Insert menu entry, and the over-threshold note after a revise |
| `tests/spec-assets.test.ts` | Tasks 1–5, 8, 9 |
| `tests/revise.test.ts` | Task 6 |
| `tests/data-insert.test.ts` | Task 7 (new; `portrait-insert.test.ts` is the pattern to copy) |

---

### Task 1: An asset may be data

Spec §4.1. Widen the value type and keep every byte path exactly as it was.

**Files:**
- Modify: `src/spec/types.ts` (the `assets?` field)
- Modify: `src/spec/assets.ts` (`inlineStrokes`, `hoistStrokes`)
- Modify: `src/spec/schema.ts` (`ASSET_FIELDS`, ~1088–1097)
- Modify: `src/llm/hoist.ts:84` (the `as Record<string, string>` cast)
- Test: `tests/spec-assets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Spec["assets"]` is `Record<string, unknown> | undefined`. Every later task depends on this.

- [ ] **Step 1: Write the failing test**

Append to `tests/spec-assets.test.ts`:

```ts
describe("an asset may be data, not only bytes", () => {
  const OPENINGS = [
    { name: "Italian Game", eco: "C50", moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"] },
    { name: "Ruy Lopez", eco: "C60", moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"] },
  ];

  test("a data asset validates, and survives a YAML round trip with its types intact", () => {
    const spec = { template: "chess_board", params: { set: "@openings" }, assets: { openings: OPENINGS }, commands: [] } as unknown as Spec;
    expect(validateSpec(spec).errors).toEqual([]);
    const back = parsePlaylistText(formatPlaylist(singlePlaylist(spec), "script"));
    expect(itemsOf(back)[0].spec.assets!.openings).toEqual(OPENINGS);
  });

  test("strokes pointing at a data asset reads as absent rather than as an object", () => {
    const spec = { assets: { openings: OPENINGS } } as unknown as Spec;
    expect(inlineStrokes(spec, { strokes: "@openings" })).toBeUndefined();
  });

  test("a byte asset is untouched: hoistStrokes still moves long strokes and names them by element id", () => {
    const spec = { elements: [{ id: "foto", type: "image", strokes: PHOTO }] } as unknown as Spec;
    expect(hoistStrokes(spec)).toBe(1);
    expect(spec.elements![0].strokes).toBe("@foto");
    expect(spec.assets!.foto).toBe(PHOTO);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/spec-assets.test.ts -t "an asset may be data"`
Expected: FAIL. The first test fails on the document schema (`assets` requires string values); the second returns the array rather than `undefined`.

- [ ] **Step 3: Widen the type**

`src/spec/types.ts` — find the `assets?: Record<string, string>;` field on `Spec` and replace it, keeping the surrounding doc comment and adding the second paragraph:

```ts
  /**
   * Long machine-written payloads by name — an element's `strokes: "@foto"`
   * points here (spec/assets.ts). Optional: inline strokes remain valid.
   * Serialized last so the readable part of the spec stays on top.
   *
   * A STRING value is encoded bytes, as it has always been. Any other JSON
   * value is DATA — rows a template's params reference as `"@name"`
   * (design 2026-09-20 §4.1), which a layout and a widget read like any
   * other params.
   */
  assets?: Record<string, unknown>;
```

- [ ] **Step 4: Guard the byte readers**

`src/spec/assets.ts` — `inlineStrokes` already returns `undefined` for a non-string value; confirm and leave it. Then make `hoistStrokes`'s duplicate-name loop type-safe by comparing against the widened map:

```ts
    const assets = (spec.assets ??= {});
    let name = el.id;
    for (let n = 2; assets[name] !== undefined && assets[name] !== s; n++) name = `${el.id}_${n}`;
    assets[name] = s;
```

(unchanged source — it already type-checks against `Record<string, unknown>`; the step is to run `tsc` and confirm.)

`src/llm/hoist.ts:84` — retype the restore cast:

```ts
    if (assets) item.spec.assets = JSON.parse(assets) as Record<string, unknown>;
```

- [ ] **Step 5: Widen the document schema**

`src/spec/schema.ts`, `ASSET_FIELDS` (~1088):

```ts
/** Long machine-written payloads by name (spec/assets.ts) — the Embed dialog
 *  and the file insert write them; the model never sees a spec that has them
 *  (llm/hoist.ts), so they are a document field, not an authoring one. A
 *  string value is bytes; any other JSON value is data a param references
 *  (design 2026-09-20 §4.1). */
const ASSET_FIELDS = {
  assets: {
    type: "object",
    additionalProperties: true,
    description: 'Payloads referenced as "@name" — encoded bytes from an element\'s strokes, or data from params.',
  },
} as const;
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/spec-assets.test.ts` then `npx tsc --noEmit -p tsconfig.json`
Expected: all PASS, tsc clean. If `tsc` reports other `Record<string, string>` assumptions about `assets`, fix each by widening to `unknown` — do not cast back to `string`.

- [ ] **Step 7: Full suite**

Run: `npm test`
Expected: all green. This is the step that catches a byte-path regression.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "An asset may be data, not only bytes"
```

---

### Task 2: `"@name"` resolves inside params

Spec §4.2, §4.3. A reference anywhere in `params` becomes the asset's value, at the same moment a strokes reference already does.

**Files:**
- Modify: `src/spec/assets.ts`
- Modify: `src/spec/schema.ts` (`normalizeSpec`, ~1111–1117)
- Test: `tests/spec-assets.test.ts`

**Interfaces:**
- Consumes: Task 1's widened `assets`.
- Produces:
  - `paramAssetRefs(params: unknown): { path: string; name: string }[]`
  - `resolveParamAssetRefs(spec: { assets?: unknown; params?: unknown }): string[]` — returns dangling names, mutates in place
  - `paramsWithAssets(spec: Pick<Spec, "assets" | "params">): Record<string, unknown>` — a resolved COPY

- [ ] **Step 1: Write the failing test**

```ts
describe("@name inside params", () => {
  const SET = [{ name: "Italian Game", moves: ["e4"] }];

  test("resolves at the top level, and at any depth", () => {
    const params = { set: "@openings", nested: { pair: ["@openings", 3] } };
    const dangling = resolveParamAssetRefs({ assets: { openings: SET }, params });
    expect(dangling).toEqual([]);
    expect(params.set).toEqual(SET);
    expect((params.nested.pair as unknown[])[0]).toEqual(SET);
    expect((params.nested.pair as unknown[])[1]).toBe(3);
  });

  test("a partial match is left alone — the reference is the WHOLE string or nothing", () => {
    const params = { title: "see @openings", set: "@openings" };
    resolveParamAssetRefs({ assets: { openings: SET }, params });
    expect(params.title).toBe("see @openings");
  });

  test("a name that resolves to nothing is reported, not thrown, and left as written", () => {
    const params = { set: "@missing" };
    expect(resolveParamAssetRefs({ assets: {}, params })).toEqual(["missing"]);
    expect(params.set).toBe("@missing");
  });

  test("a reference to BYTES is left standing too — bytes are not data", () => {
    const params = { set: "@foto" };
    expect(resolveParamAssetRefs({ assets: { foto: "iVBORw0KGgo" }, params })).toEqual([]);
    expect(params.set).toBe("@foto"); // semanticErrors says why, in Task 3
  });

  test("paramAssetRefs reports where each reference sits", () => {
    expect(paramAssetRefs({ set: "@openings", deep: { rows: ["@endgames"] } })).toEqual([
      { path: "set", name: "openings" },
      { path: "deep.rows.0", name: "endgames" },
    ]);
  });

  test("normalizeSpec resolves params, so a layout never sees a reference", () => {
    const spec = { template: "chess_board", params: { set: "@openings" }, assets: { openings: SET } };
    const out = normalizeSpec(spec) as { params: { set: unknown }; assets: unknown };
    expect(out.params.set).toEqual(SET);
    // The input document is untouched: normalizeSpec clones.
    expect(spec.params.set).toBe("@openings");
  });

  test("paramsWithAssets returns a resolved copy and leaves the spec alone", () => {
    const spec = { params: { set: "@openings" }, assets: { openings: SET } } as unknown as Spec;
    expect(paramsWithAssets(spec).set).toEqual(SET);
    expect((spec.params as { set: string }).set).toBe("@openings");
  });
});
```

Add `paramAssetRefs, paramsWithAssets, resolveParamAssetRefs` to the existing import from `../src/spec/assets`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/spec-assets.test.ts -t "@name inside params"`
Expected: FAIL with "resolveParamAssetRefs is not a function" (or an import error naming it).

- [ ] **Step 3: Implement the walk**

Append to `src/spec/assets.ts`:

```ts
/**
 * Every `@name` inside `params`, with the dotted path it sits at ("set",
 * "deep.rows.0"). One walk serves both the resolver below and the semantic
 * errors, so the two can never disagree about what counts as a reference.
 *
 * A reference is the WHOLE string or nothing: ASSET_REF is anchored, so
 * "see @openings" is prose and stays prose.
 */
export function paramAssetRefs(params: unknown): { path: string; name: string }[] {
  const out: { path: string; name: string }[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      const name = assetRef(value);
      if (name !== null) out.push({ path, name });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, path === "" ? String(i) : `${path}.${i}`));
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, path === "" ? k : `${path}.${k}`);
      }
    }
  };
  walk(params, "");
  return out;
}

/** Write `value` at a dotted path inside `params`. The path came from paramAssetRefs, so every host exists. */
function setAtPath(params: unknown, path: string, value: unknown): void {
  const keys = path.split(".");
  let host = params as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) host = host[key] as Record<string, unknown>;
  host[keys[keys.length - 1]] = value;
}

/**
 * Rewrite every `@name` inside `params` into its asset value, IN PLACE.
 * Names that do not resolve are left as written (semanticErrors reports
 * them) and returned. The strokes counterpart is resolveAssetRefs above;
 * normalizeSpec calls both.
 */
export function resolveParamAssetRefs(spec: { assets?: unknown; params?: unknown }): string[] {
  const dangling: string[] = [];
  const assets = typeof spec.assets === "object" && spec.assets !== null ? (spec.assets as Record<string, unknown>) : {};
  for (const { path, name } of paramAssetRefs(spec.params)) {
    const value = assets[name];
    // Two references are left STANDING for semanticErrors to report: a name
    // that is not there, and a name whose asset is encoded bytes. Bytes are
    // not data, and silently pasting a base64 string into a param would fail
    // much further downstream, as a template complaining about a type.
    if (value === undefined) {
      dangling.push(name);
      continue;
    }
    if (typeof value === "string") continue;
    setAtPath(spec.params, path, value);
  }
  return dangling;
}

/**
 * Params with every `@name` resolved — the form every VALIDATOR must see.
 * normalizeSpec does this for the render path; this is for the authoring
 * path, which does not go through it (design §4.3). A copy: the document
 * keeps its references.
 */
export function paramsWithAssets(spec: Pick<Spec, "assets" | "params">): Record<string, unknown> {
  const params = (spec.params ?? {}) as Record<string, unknown>;
  if (spec.assets === undefined) return params;
  const clone = JSON.parse(JSON.stringify(params)) as Record<string, unknown>;
  resolveParamAssetRefs({ assets: spec.assets, params: clone });
  return clone;
}
```

- [ ] **Step 4: Wire it into normalizeSpec**

`src/spec/schema.ts` — extend the clone's type and call the new resolver beside the existing one:

```ts
  const clone = JSON.parse(JSON.stringify(spec)) as {
    commands?: Command[];
    elements?: SpecElement[];
    assets?: unknown;
    params?: unknown;
  };
  // `strokes: "@name"` becomes its bytes here, so the layout, the lint and
  // every decoder only ever see inline strokes (spec/assets.ts). A name that
  // resolves to nothing stays as written for semanticErrors to report.
  resolveAssetRefs(clone);
  // …and `params: {set: "@name"}` becomes its rows, for the same reason: a
  // template, a widget and the lint all read params, and none of them should
  // have to know what a reference is (design 2026-09-20 §4.3).
  resolveParamAssetRefs(clone);
```

Add `resolveParamAssetRefs` to the existing import from `./assets`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/spec-assets.test.ts -t "@name inside params"`
Expected: PASS, all seven.

- [ ] **Step 6: Full suite and tsc**

Run: `npm test && npx tsc --noEmit -p tsconfig.json`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "A param may point at an asset"
```

---

### Task 3: The four errors and the size cap

Spec §4.4, §4.5. Each failure names the asset and the site. The existing dangling-strokes message stays verbatim so its test does not move.

**Files:**
- Modify: `src/spec/assets.ts` (`ASSET_MAX_BYTES`, `assetBytes`, `formatAssetSize`)
- Modify: `src/spec/schema.ts` (`semanticErrors`, the strokes loop at ~1243–1251)
- Test: `tests/spec-assets.test.ts`

**Interfaces:**
- Consumes: Task 2's `paramAssetRefs`.
- Produces:
  - `ASSET_MAX_BYTES = 1024 * 1024`
  - `assetBytes(value: unknown): number`
  - `formatAssetSize(bytes: number): string` — e.g. `"1.4 MB"`, `"6 KB"`

- [ ] **Step 1: Write the failing test**

```ts
describe("asset errors", () => {
  const errorsFor = (spec: unknown): string[] => validateSpec(normalizeSpec(spec)).errors;

  test("a params reference to an absent asset names the path and the name", () => {
    expect(errorsFor({ template: "chess_board", params: { set: "@missing" }, commands: [] })).toContain(
      'params.set refers to asset "@missing", which is not in assets',
    );
  });

  test("strokes pointing at data, and params pointing at bytes, each say which is which", () => {
    const strokesAtData = errorsFor({
      elements: [{ id: "p1", type: "portrait", of: "Ada", strokes: "@openings" }],
      assets: { openings: [{ name: "Italian Game" }] },
      commands: [],
    });
    expect(strokesAtData).toContain(
      'element "p1" (portrait): strokes refers to asset "@openings", which is data, not encoded bytes',
    );
    const paramsAtBytes = errorsFor({
      template: "chess_board",
      params: { set: "@foto" },
      assets: { foto: "iVBORw0KGgo" },
      commands: [],
    });
    expect(paramsAtBytes).toContain('params.set refers to asset "@foto", which is encoded bytes, not data');
  });

  test("the absent-strokes message is unchanged", () => {
    expect(errorsFor({ elements: [{ id: "p1", type: "portrait", of: "Ada", strokes: "@gone" }], commands: [] })).toContain(
      'element "p1" (portrait): strokes refers to asset "@gone", which is not in assets',
    );
  });

  test("an asset over the cap is refused, and the message names both sizes", () => {
    const big = Array.from({ length: 40_000 }, (_, i) => ({ name: `row ${i}`, moves: ["e4", "e5"] }));
    expect(assetBytes(big)).toBeGreaterThan(ASSET_MAX_BYTES);
    const errs = errorsFor({ template: "chess_board", params: { set: "@big" }, assets: { big }, commands: [] });
    expect(errs.some((e) => /^asset "@big" is [\d.]+ MB; the limit is 1 MB$/.test(e))).toBe(true);
  });

  test("formatAssetSize reads the way a person would say it", () => {
    expect(formatAssetSize(6 * 1024)).toBe("6 KB");
    expect(formatAssetSize(1_468_006)).toBe("1.4 MB");
  });
});
```

Add `ASSET_MAX_BYTES, assetBytes, formatAssetSize` to the imports.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/spec-assets.test.ts -t "asset errors"`
Expected: FAIL — `assetBytes` undefined, and none of the new messages present.

- [ ] **Step 3: Add the size vocabulary**

Append to `src/spec/assets.ts`:

```ts
/**
 * The largest a single asset may be (design §4.5). An error, not a warning:
 * assets land in IndexedDB with the rest of the library, and the course round
 * of 2026-09-18 lost a user's work to a storage limit that failed silently. A
 * named limit with a clear message is that round's lesson.
 */
export const ASSET_MAX_BYTES = 1024 * 1024;

/** An asset's size as serialized — what it costs in the document and in a model call. */
export function assetBytes(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  // Byte length, not character count: a spec is UTF-8 on disk and on the wire.
  return new TextEncoder().encode(text).length;
}

/** A size the way a person says it: "6 KB", "1.4 MB". */
export function formatAssetSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}
```

- [ ] **Step 4: Split the strokes error and add the three new ones**

`src/spec/schema.ts`, replacing the loop at ~1243–1251:

```ts
  // A strokes reference that survived normalizeSpec's inlining names an asset
  // the document does not carry — that element would draw its placeholder
  // (or refetch) while looking embedded — or one of the wrong kind.
  for (const el of spec.elements ?? []) {
    const name = assetRef(el.strokes);
    if (name === null) continue;
    const value = spec.assets?.[name];
    if (value === undefined) {
      errors.push(`element "${el.id}" (${el.type}): strokes refers to asset "@${name}", which is not in assets`);
    } else if (typeof value !== "string") {
      errors.push(`element "${el.id}" (${el.type}): strokes refers to asset "@${name}", which is data, not encoded bytes`);
    }
  }

  // The same two questions for a params reference, plus the size cap. A
  // reference that survived normalizeSpec is one that could not resolve
  // (design §4.4).
  for (const { path, name } of paramAssetRefs(spec.params)) {
    const value = spec.assets?.[name];
    if (value === undefined) {
      errors.push(`params.${path} refers to asset "@${name}", which is not in assets`);
    } else if (typeof value === "string") {
      errors.push(`params.${path} refers to asset "@${name}", which is encoded bytes, not data`);
    }
  }
  for (const [name, value] of Object.entries(spec.assets ?? {})) {
    const bytes = assetBytes(value);
    if (bytes > ASSET_MAX_BYTES) {
      errors.push(`asset "@${name}" is ${formatAssetSize(bytes)}; the limit is ${formatAssetSize(ASSET_MAX_BYTES)}`);
    }
  }
```

Add `ASSET_MAX_BYTES, assetBytes, formatAssetSize, paramAssetRefs` to schema.ts's import from `./assets`.

This works because Task 2's resolver leaves BOTH kinds of bad reference standing — an absent name and a bytes-valued one — so a reference that survives `normalizeSpec` is exactly a reference `semanticErrors` has something to say about.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/spec-assets.test.ts -t "asset errors"`
Expected: PASS, all five.

- [ ] **Step 6: Full suite and tsc**

Run: `npm test && npx tsc --noEmit -p tsconfig.json`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Say which asset, and which kind it is"
```

---

### Task 4: The authoring-time trap

Spec §4.3. `templateParamIssues` runs on params that have NOT been through `normalizeSpec`. Left alone, `{set: "@openings"}` reads as "expected array, got string", the model is told to repair it, and it repairs it by inventing data.

**Files:**
- Modify: `src/llm/compile.ts:590`
- Test: `tests/spec-assets.test.ts`

**Interfaces:**
- Consumes: Task 2's `paramsWithAssets`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```ts
describe("the authoring-time trap (design §4.3)", () => {
  test("a param that points at an asset is not a schema violation", async () => {
    const { registerPack } = await import("../src/scenes/packs");
    const { ensureEngines } = await import("../src/scenes/engines");
    const { templateParamIssues } = await import("../src/scenes/params-check");
    const gamesYaml = (await import("../src/scenes/packs/games.yaml?raw")).default;
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);

    const spec = {
      template: "chess_board",
      params: { moves: "@line" },
      assets: { line: ["e4", "e5", "Nf3"] },
    } as unknown as Spec;

    // Unresolved, the schema sees a string where an array belongs.
    expect(templateParamIssues("chess_board", spec.params, true).errors.length).toBeGreaterThan(0);
    // Resolved — the form every validator must see — it is clean.
    expect(templateParamIssues("chess_board", paramsWithAssets(spec), true).errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/spec-assets.test.ts -t "authoring-time trap"`
Expected: PASS for the first assertion, FAIL for the second only if `paramsWithAssets` is wrong — if both pass, the test is doing its job as a REGRESSION pin for step 3's change. Record which happened; the step-3 change is what the compile path needs regardless.

- [ ] **Step 3: Resolve on the authoring path**

`src/llm/compile.ts`, at the `templateParamIssues` call (~590):

```ts
          const issues = templateParamIssues(
            best.template,
            // Through paramsWithAssets, never raw: authoring-time validation
            // does not go through normalizeSpec, so an unresolved "@openings"
            // would read as "expected array, got string" and the repair round
            // would answer it by INVENTING data (design 2026-09-20 §4.3).
            paramsWithAssets({ assets: best.assets, params: check.resolvedParams ?? best.params }),
            paramsStrictness({ tokens, substituted, dataPack }),
          );
```

Add `paramsWithAssets` to compile.ts's imports from `../spec/assets`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/spec-assets.test.ts -t "authoring-time trap"` then `npm test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Never ask the model to repair a reference into data"
```

---

### Task 5: Descriptors and the send threshold

> **Imports:** these tests use `itemsOf(playlist)` — `Playlist` carries `entries`, not `items`, and `itemsOf` (from `../src/playlist/playlist`) is the helper that flattens chapters out of them. `tests/` is inside tsconfig's include, so `tsc` type-checks it: add every import the test needs.

Spec §5, §5.1. A data asset under 32 KB rides into the model call and may be rewritten; a larger one is replaced by a one-line descriptor and cannot be.

**Files:**
- Modify: `src/spec/assets.ts` (`ASSET_SEND_MAX`, `describeAsset`, `DATA_DESCRIPTOR`)
- Modify: `src/llm/hoist.ts` (`hoistPortraitStrokes`, `restorePortraitStrokes`)
- Test: `tests/spec-assets.test.ts`

**Interfaces:**
- Consumes: Task 3's `assetBytes`.
- Produces:
  - `ASSET_SEND_MAX = 32 * 1024`
  - `DATA_DESCRIPTOR = "@data "`
  - `describeAsset(value: unknown): string`
  - `hoistPortraitStrokes` result gains `described: { name: string; bytes: number }[]`

- [ ] **Step 1: Write the failing test**

```ts
describe("descriptors and the send threshold", () => {
  const small = [{ name: "Italian Game", eco: "C50", moves: ["e4", "e5"], idea: "f7" }];
  const big = Array.from({ length: 2_000 }, (_, i) => ({ name: `Line ${i}`, eco: "C50", moves: ["e4", "e5"], idea: "x" }));

  test("describeAsset names the shape, never the contents", () => {
    expect(describeAsset(small)).toBe("@data 1 rows — name, eco, moves[], idea");
    expect(describeAsset([])).toBe("@data 0 rows");
    expect(describeAsset([1, 2, 3])).toBe("@data 3 numbers");
    expect(describeAsset(["a", "b"])).toBe("@data 2 strings");
    expect(describeAsset({ openings: 1, endgames: 2 })).toBe("@data object — openings, endgames");
    expect(describeAsset(42)).toBe("@data value");
  });

  test("a small data asset is SENT, so the model can edit it", () => {
    const doc = formatPlaylist(singlePlaylist({ template: "chess_board", params: { set: "@openings" }, assets: { openings: small } } as unknown as Spec), "script");
    const hoisted = hoistPortraitStrokes(doc);
    const sent = itemsOf(parsePlaylistText(hoisted.text))[0].spec;
    expect(sent.assets!.openings).toEqual(small);
    expect(hoisted.described).toEqual([]);
  });

  test("a large one is described, and the original comes back untouched", () => {
    expect(assetBytes(big)).toBeGreaterThan(ASSET_SEND_MAX);
    const doc = formatPlaylist(singlePlaylist({ template: "chess_board", params: { set: "@openings" }, assets: { openings: big } } as unknown as Spec), "script");
    const hoisted = hoistPortraitStrokes(doc);
    const seen = itemsOf(parsePlaylistText(hoisted.text))[0].spec;
    expect(seen.assets!.openings).toBe(`@data ${big.length} rows — name, eco, moves[], idea`);
    expect(hoisted.described.map((d) => d.name)).toEqual(["openings"]);

    // What the model returns, descriptor and all, restores to the original.
    const reply = parsePlaylistText(hoisted.text);
    restorePortraitStrokes(reply, hoisted.blobs);
    expect(itemsOf(reply)[0].spec.assets!.openings).toEqual(big);
  });

  test("an edit to a SENT asset survives restoration", () => {
    const doc = formatPlaylist(singlePlaylist({ template: "chess_board", params: { set: "@openings" }, assets: { openings: small } } as unknown as Spec), "script");
    const hoisted = hoistPortraitStrokes(doc);
    const reply = parsePlaylistText(hoisted.text);
    const edited = [...small, { name: "Sicilian Defence", eco: "B20", moves: ["e4", "c5"], idea: "asymmetry" }];
    itemsOf(reply)[0].spec.assets = { openings: edited };
    restorePortraitStrokes(reply, hoisted.blobs);
    expect(itemsOf(reply)[0].spec.assets!.openings).toEqual(edited);
  });

  test("a reply that drops the assets block loses nothing", () => {
    const doc = formatPlaylist(singlePlaylist({ template: "chess_board", params: { set: "@openings" }, assets: { openings: small } } as unknown as Spec), "script");
    const hoisted = hoistPortraitStrokes(doc);
    const reply = parsePlaylistText(hoisted.text);
    delete itemsOf(reply)[0].spec.assets;
    restorePortraitStrokes(reply, hoisted.blobs);
    expect(itemsOf(reply)[0].spec.assets!.openings).toEqual(small);
  });

  test("the threshold decides AT its boundary, not near it", () => {
    // A row is ~46 bytes serialized; build one set just under 32 KB and one just over.
    const row = (i: number) => ({ name: `Line ${i}`, eco: "C50", moves: ["e4"] });
    const fit: ReturnType<typeof row>[] = [];
    while (assetBytes([...fit, row(fit.length)]) <= ASSET_SEND_MAX) fit.push(row(fit.length));
    const over = [...fit, row(fit.length)];
    expect(assetBytes(fit)).toBeLessThanOrEqual(ASSET_SEND_MAX);
    expect(assetBytes(over)).toBeGreaterThan(ASSET_SEND_MAX);

    const seen = (rows: unknown) => {
      const doc = formatPlaylist(singlePlaylist({ template: "chess_board", params: { set: "@s" }, assets: { s: rows } } as unknown as Spec), "script");
      return itemsOf(parsePlaylistText(hoistPortraitStrokes(doc).text))[0].spec.assets!.s;
    };
    expect(seen(fit)).toEqual(fit); // exactly at the limit: still sent
    expect(typeof seen(over)).toBe("string"); // one row more: described
  });

  test("a ragged table describes as its FIRST row — a hint, not a schema", () => {
    expect(describeAsset([{ name: "a", eco: "C50" }, { name: "b", extra: 1 }])).toBe("@data 2 rows — name, eco");
  });

  test("bytes and data coexist in one spec, each reachable only from its own kind of site", () => {
    const spec = {
      template: "chess_board",
      params: { set: "@openings" },
      elements: [{ id: "foto", type: "image", strokes: "@foto" }],
      assets: { foto: PHOTO, openings: small },
      commands: [],
    } as unknown as Spec;
    const out = normalizeSpec(spec) as Spec;
    expect((out.params as { set: unknown }).set).toEqual(small);
    expect(out.elements![0].strokes).toBe(PHOTO);
    // Scoped to what this test is about: an unrelated schema complaint about
    // the image element must not decide whether asset handling is correct.
    expect(validateSpec(out).errors.filter((e) => e.includes("asset"))).toEqual([]);
  });

  test("bytes are unchanged: still stashed whole, still invisible to the model", () => {
    const doc = formatPlaylist(singlePlaylist({ elements: [{ id: "foto", type: "image", strokes: "@foto" }], assets: { foto: PHOTO } } as unknown as Spec), "script");
    const hoisted = hoistPortraitStrokes(doc);
    expect(hoisted.text).not.toContain(PHOTO.slice(0, 40));
    const reply = parsePlaylistText(hoisted.text);
    restorePortraitStrokes(reply, hoisted.blobs);
    expect(itemsOf(reply)[0].spec.assets!.foto).toBe(PHOTO);
  });
});
```

Add `ASSET_SEND_MAX, describeAsset` to the imports.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/spec-assets.test.ts -t "descriptors and the send threshold"`
Expected: FAIL — `describeAsset` is not a function.

- [ ] **Step 3: Implement the descriptor**

Append to `src/spec/assets.ts`:

```ts
/**
 * Serialized size beyond which a data asset is DESCRIBED to the model rather
 * than sent (design §5.1). Under it the asset rides into the call and the
 * model may rewrite it, which is what makes "add the Sicilian" work; over it
 * the model gets a line about its shape and cannot touch the rows.
 *
 * 32 KB because a 50-row openings set is 5-6 KB — about 1500 tokens against a
 * system prompt already near 50 000, affordable exactly when the data is
 * there — while a real dataset is not.
 */
export const ASSET_SEND_MAX = 32 * 1024;

/** The marker that opens every descriptor. Never a valid ASSET_REF (it has a space). */
export const DATA_DESCRIPTOR = "@data ";

/**
 * One line naming a data asset's SHAPE, for a model that must not see its
 * contents: "@data 50 rows — name, eco, moves[], idea". Twelve tokens where
 * the rows would have been three thousand, and the model cannot corrupt a row
 * it was never shown.
 *
 * Derived from the value, never authored. The keys come from the FIRST row —
 * a hint, not a schema; a ragged table describes as its first row and that is
 * accepted.
 */
export function describeAsset(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${DATA_DESCRIPTOR}0 rows`;
    const first = value[0];
    if (first !== null && typeof first === "object" && !Array.isArray(first)) {
      const row = first as Record<string, unknown>;
      const keys = Object.keys(row).map((k) => (Array.isArray(row[k]) ? `${k}[]` : k));
      return `${DATA_DESCRIPTOR}${value.length} rows — ${keys.join(", ")}`;
    }
    const kind = typeof first === "number" ? "numbers" : typeof first === "string" ? "strings" : "values";
    return `${DATA_DESCRIPTOR}${value.length} ${kind}`;
  }
  if (value !== null && typeof value === "object") {
    return `${DATA_DESCRIPTOR}object — ${Object.keys(value as Record<string, unknown>).join(", ")}`;
  }
  return `${DATA_DESCRIPTOR}value`;
}

/** True for an asset value that is data (rows, numbers, an object) rather than encoded bytes. */
export function isDataAsset(value: unknown): boolean {
  return typeof value !== "string";
}
```

- [ ] **Step 4: Decide per asset in the hoist**

`src/llm/hoist.ts` — replace the `if (item.spec.assets)` block inside `hoistPortraitStrokes`:

```ts
    // The `assets` map is the same bytes under another key (spec/assets.ts):
    // BYTES leave with the blobs and come back with them, exactly as before.
    // DATA is decided per asset (design §5.1): small enough to send rides
    // along and may be edited; larger is replaced by a descriptor naming its
    // shape. The whole map is stashed either way, so nothing can be lost.
    if (item.spec.assets) {
      blobs.set(assetsKey(i), JSON.stringify(item.spec.assets));
      const forModel: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(item.spec.assets)) {
        if (!isDataAsset(value)) continue; // bytes: not shown at all
        const bytes = assetBytes(value);
        if (bytes > ASSET_SEND_MAX) {
          forModel[name] = describeAsset(value);
          described.push({ name, bytes });
        } else {
          forModel[name] = value;
        }
      }
      if (Object.keys(forModel).length > 0) item.spec.assets = forModel;
      else delete item.spec.assets;
      any = true;
    }
```

Declare `const described: { name: string; bytes: number }[] = [];` beside `blobs`, and return it from both exits:

```ts
  return any ? { text: formatPlaylist(playlist, "script"), blobs, described } : { text: docText, blobs, described };
```

…and from the early `catch` return: `return { text: docText, blobs, described };`

Widen the function's return type to include `described: { name: string; bytes: number }[]`.

- [ ] **Step 5: Make restoration key-aware**

`src/llm/hoist.ts` — replace the assets line in `restorePortraitStrokes`:

```ts
    const stashed = blobs.get(assetsKey(i));
    if (stashed) {
      // The stash is the authority for everything the model could not edit —
      // bytes, and any data too large to send. An asset that WAS sent may have
      // been legitimately rewritten, so the reply's version wins for those.
      // A reply that drops the block entirely therefore loses nothing.
      const original = JSON.parse(stashed) as Record<string, unknown>;
      const returned = (item.spec.assets ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...original };
      for (const [name, value] of Object.entries(returned)) {
        const was = original[name];
        if (was !== undefined && isDataAsset(was) && assetBytes(was) <= ASSET_SEND_MAX) merged[name] = value;
      }
      item.spec.assets = merged;
    }
```

Add `ASSET_SEND_MAX, assetBytes, describeAsset, isDataAsset` to hoist.ts's import from `../spec/assets`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/spec-assets.test.ts -t "descriptors and the send threshold"`
Expected: PASS, all seven.

- [ ] **Step 7: Full suite and tsc**

Run: `npm test && npx tsc --noEmit -p tsconfig.json`
Expected: green. Any caller of `hoistPortraitStrokes` destructuring its result must still compile — `described` is additive.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Describe what is too big to send, send what is not"
```

---

### Task 6: Restore before validate

> **Imports:** these tests use `itemsOf(playlist)` — `Playlist` carries `entries`, not `items`, and `itemsOf` (from `../src/playlist/playlist`) is the helper that flattens chapters out of them. `tests/` is inside tsconfig's include, so `tsc` type-checks it: add every import the test needs.

Spec §5.2. Today validation runs at `revise.ts:66` and restoration at `:241`. A reply that drops the `assets:` block while params still reference an asset would fail validation every round.

**Files:**
- Modify: `src/llm/revise.ts` (the candidate loop, ~190–215; the tail, ~240–243)
- Test: `tests/revise.test.ts`

**Interfaces:**
- Consumes: Task 5's restoration.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `tests/revise.test.ts`, adding whatever imports it needs (`hoistPortraitStrokes`, `restorePortraitStrokes`, `formatPlaylist`, `itemsOf`, `parsePlaylistText`, `singlePlaylist`, `normalizeSpec`, `validateSpec`, `type Spec`). It asserts on those directly and does not need `checkPlaylist`:

```ts
describe("a hoisted document is not a complete document (design §5.2)", () => {
  test("a reply that drops the assets block validates clean once restored", () => {
    const spec = {
      template: "chess_board",
      params: { moves: "@line" },
      assets: { line: ["e4", "e5", "Nf3"] },
      commands: [{ draw: ["board"], speak: "A line." }],
    } as unknown as Spec;
    const hoisted = hoistPortraitStrokes(formatPlaylist(singlePlaylist(spec), "script"));

    // The model's reply: the document, with no assets block of its own.
    const reply = parsePlaylistText(hoisted.text);
    delete itemsOf(reply)[0].spec.assets;

    // Before restoration the reference is dangling — this is the state the
    // old order judged, and it is not a real error.
    expect(validateSpec(normalizeSpec(itemsOf(reply)[0].spec)).errors.join("\n")).toContain('"@line"');

    // After restoration, which is what the loop must now do first, it is clean.
    restorePortraitStrokes(reply, hoisted.blobs);
    expect(validateSpec(normalizeSpec(itemsOf(reply)[0].spec)).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/revise.test.ts -t "not a complete document"`
Expected: PASS for the first assertion and the second — this test pins the FACT the reorder relies on. If the second assertion fails, Task 5's restore is wrong; fix that before continuing.

- [ ] **Step 3: Move the restoration into the loop**

`src/llm/revise.ts`, in the candidate loop, immediately after `const parsed = parseReviseReply(raw);`:

```ts
      // Blobs come back BEFORE anything judges this candidate: a hoisted
      // document is not a complete document, and a reply that dropped the
      // `assets:` block would otherwise fail validation on a reference that is
      // perfectly good (design 2026-09-20 §5.2). Restoring into losers as well
      // as the winner costs a map lookup per asset.
      if (parsed.playlist && hoisted.blobs.size > 0) restorePortraitStrokes(parsed.playlist, hoisted.blobs);
```

- [ ] **Step 4: Drop the late restoration, keep the reformat**

Replace the tail block (~240–243):

```ts
  const promptFilled = best ? preserveFoundingPrompt(best.playlist, parsedNow.playlist) : false;
  if (best && (hoisted.blobs.size > 0 || promptFilled)) {
    // The winner's `text` is the model's raw reply, which still shows
    // placeholders and descriptors; the playlist has been restored in the loop
    // above, so the document is re-printed from it.
    best = { playlist: best.playlist, text: formatPlaylist(best.playlist, "script") };
  }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/revise.test.ts && npx vitest run tests/revise-call.test.ts`
Expected: green.

- [ ] **Step 6: Full suite and tsc**

Run: `npm test && npx tsc --noEmit -p tsconfig.json`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Restore before validate: a hoisted document is not a complete one"
```

---

### Task 7: `＋ Insert → Data from disk…`

Spec §6. A file becomes an asset, named, parsed, size-checked, in the part you are looking at.

**Files:**
- Modify: `src/ui/insert.ts` (add `openInsertData` and its session)
- Modify: `src/main.ts:839` (the `createMenu("Insert", …)` list)
- Create: `tests/data-insert.test.ts`

**Interfaces:**
- Consumes: Task 3's `ASSET_MAX_BYTES`, `assetBytes`, `formatAssetSize`.
- Produces:
  - `parseDataFile(text: string, filename: string): { rows: unknown; error?: string }`
  - `assetNameFor(filename: string, taken: readonly string[]): string`
  - `openInsertData(deps: InsertPortraitDeps): void`

- [ ] **Step 1: Write the failing test**

Create `tests/data-insert.test.ts`:

```ts
// The ＋ Insert menu's "Data from disk…" — a file becomes an asset. The pure
// halves only: parsing and naming. The dialog itself is DOM and lives in
// insert.ts's lazy build(), exactly as portrait-insert.test.ts has it.
import { describe, expect, test } from "vitest";
import { assetNameFor, parseDataFile } from "../src/ui/insert";

describe("parseDataFile", () => {
  test("JSON comes through as written", () => {
    expect(parseDataFile('[{"name":"Italian Game","eco":"C50"}]', "openings.json").rows).toEqual([
      { name: "Italian Game", eco: "C50" },
    ]);
  });

  test("CSV's header row becomes the keys", () => {
    const csv = "name,eco,moves\nItalian Game,C50,e4 e5\nRuy Lopez,C60,e4 e5";
    expect(parseDataFile(csv, "openings.csv").rows).toEqual([
      { name: "Italian Game", eco: "C50", moves: "e4 e5" },
      { name: "Ruy Lopez", eco: "C60", moves: "e4 e5" },
    ]);
  });

  test("a column is numeric only when EVERY cell in it is", () => {
    const csv = "eco,rating,note\nC50,2400,solid\nC60,n/a,sharp";
    const rows = parseDataFile(csv, "x.csv").rows as Record<string, unknown>[];
    expect(rows[0].rating).toBe("2400"); // one bad cell keeps the whole column as text
    const clean = parseDataFile("eco,rating\nC50,2400\nC60,2500", "y.csv").rows as Record<string, unknown>[];
    expect(clean[0].rating).toBe(2400);
  });

  test("malformed input is reported, never thrown", () => {
    expect(parseDataFile("{not json", "x.json").error).toMatch(/could not be read as JSON/);
    expect(parseDataFile("", "x.csv").error).toMatch(/empty/);
  });
});

describe("assetNameFor", () => {
  test("slugifies the filename to the reference character set", () => {
    expect(assetNameFor("My Openings (2026).json", [])).toBe("my_openings_2026");
  });

  test("never collides with a name already in the document", () => {
    expect(assetNameFor("openings.csv", ["openings"])).toBe("openings_2");
    expect(assetNameFor("openings.csv", ["openings", "openings_2"])).toBe("openings_3");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/data-insert.test.ts`
Expected: FAIL on the import — neither export exists.

- [ ] **Step 3: Implement the pure halves**

Append to `src/ui/insert.ts` (module scope is fine — these touch no DOM, which is what lets the test import them; see the file's own header comment about `build()`):

```ts
/**
 * A data file's rows. JSON as written; CSV's header row as keys.
 *
 * A column becomes numbers only when EVERY cell in it parses as one — the
 * overpromising trap from the steepness round (2026-09-20): a rule that
 * mostly works is worse than one that is stated. One "n/a" and the column
 * stays text, which the author can see in the editor.
 */
export function parseDataFile(text: string, filename: string): { rows: unknown; error?: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { rows: null, error: `${filename} is empty` };
  if (/\.json$/i.test(filename)) {
    try {
      return { rows: JSON.parse(trimmed) as unknown };
    } catch (err) {
      return { rows: null, error: `${filename} could not be read as JSON: ${(err as Error).message}` };
    }
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { rows: null, error: `${filename} has a header but no rows` };
  const cell = (line: string): string[] => line.split(",").map((c) => c.trim());
  const headers = cell(lines[0]);
  const body = lines.slice(1).map(cell);
  const numeric = headers.map((_, c) => body.every((r) => r[c] !== undefined && r[c] !== "" && Number.isFinite(Number(r[c]))));
  const rows = body.map((r) => {
    const row: Record<string, unknown> = {};
    headers.forEach((h, c) => {
      const raw = r[c] ?? "";
      row[h] = numeric[c] ? Number(raw) : raw;
    });
    return row;
  });
  return { rows };
}

/** A filename as an asset name: the reference character set, and never one already taken. */
export function assetNameFor(filename: string, taken: readonly string[]): string {
  const base = filename.replace(/\.[^.]+$/, "");
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "data";
  if (!taken.includes(slug)) return slug;
  for (let n = 2; ; n++) if (!taken.includes(`${slug}_${n}`)) return `${slug}_${n}`;
}
```

- [ ] **Step 4: Run the pure tests**

Run: `npx vitest run tests/data-insert.test.ts`
Expected: PASS, all seven.

- [ ] **Step 5: Build the dialog**

In `src/ui/insert.ts`, mirroring `openInsertPortrait`/`build()` — a module-level `dataSession` built lazily, everything DOM-touching inside `buildData()`, because vitest runs this suite with no DOM and a top-level `h(...)` would crash the import of the pure exports above:

```ts
let dataSession: InsertSession | null = null;

export function openInsertData(deps: InsertPortraitDeps): void {
  if (!dataSession) dataSession = buildData();
  dataSession.open(deps);
}

function buildData(): InsertSession {
  let current: InsertPortraitDeps;
  let items: PlaylistItem[] = [];
  /** The picked file's parsed rows and size — null until a file reads cleanly. */
  let picked: { rows: unknown; bytes: number } | null = null;

  const explanation = h(
    "p",
    { class: "settings-note" },
    "A JSON or CSV file, carried inside the drawcast as an asset. A template's params point at it by name, so a published cast needs none of your files. CSV's header row becomes the keys.",
  );

  const fileInput = h("input", { type: "file", accept: ".json,.csv" }) as HTMLInputElement;
  const partSel = h("select", {}) as HTMLSelectElement;
  const nameInput = h("input", { type: "text", spellcheck: "false" }) as HTMLInputElement;
  const sizeNote = h("p", { class: "settings-note" }, "");

  const modal = createModal("Insert data from disk", { size: "s" });
  // Detached <dialog>.showModal() throws, and the click then looks like it did
  // nothing at all — the bug that made two dialogs dead from the day they
  // shipped. Attach here, like every other modal in the app.
  document.body.append(modal.dialog);
  modal.body.append(
    explanation,
    h("div", { class: "settings-field" }, fileInput),
    h("div", { class: "settings-field" }, h("label", {}, "Part"), partSel),
    h("div", { class: "settings-field" }, h("label", {}, "Name"), nameInput),
    sizeNote,
  );

  const insertBtn = h("button", { class: "primary" }, "Insert") as HTMLButtonElement;
  insertBtn.disabled = true;
  modal.footer.append(insertBtn);

  /** Asset names already in the chosen part — what a new name must not collide with. */
  const takenIn = (i: number): string[] => Object.keys(items[i]?.spec.assets ?? {});

  fileInput.addEventListener("change", () => {
    picked = null;
    insertBtn.disabled = true;
    sizeNote.textContent = "";
    const file = fileInput.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      const { rows, error } = parseDataFile(text, file.name);
      if (error) {
        current.setStatus(error, "error");
        return;
      }
      const bytes = assetBytes(rows);
      // Refused BEFORE anything is embedded, so an oversized file never
      // reaches the document at all.
      if (bytes > ASSET_MAX_BYTES) {
        current.setStatus(`${file.name} is ${formatAssetSize(bytes)} — the limit is ${formatAssetSize(ASSET_MAX_BYTES)}`, "error");
        return;
      }
      picked = { rows, bytes };
      nameInput.value = assetNameFor(file.name, takenIn(Number(partSel.value)));
      sizeNote.textContent = `${formatAssetSize(bytes)}${Array.isArray(rows) ? `, ${rows.length} rows` : ""}`;
      insertBtn.disabled = false;
    });
  });

  insertBtn.addEventListener("click", () => {
    const playlist = current.readPlaylist();
    if (!playlist || !picked) return;
    const part = Number(partSel.value);
    const item = itemsOf(playlist)[part];
    if (!item) return;
    const name = assetNameFor(nameInput.value || "data", takenIn(part).filter((n) => n !== nameInput.value));
    ((item.spec.assets ??= {}) as Record<string, unknown>)[name] = picked.rows;
    current.applyPlaylist(playlist);
    current.setStatus(`Added "@${name}" — ${formatAssetSize(picked.bytes)}. Point a param at it, e.g. set: "@${name}"`, "ok");
    modal.close();
  });

  return {
    open(deps: InsertPortraitDeps) {
      current = deps;
      const playlist = deps.readPlaylist();
      if (!playlist) return; // readPlaylist already reported why
      items = itemsOf(playlist);
      partSel.replaceChildren(
        ...items.map((it, i) => h("option", { value: String(i) }, itemTitle(it) || `Part ${i + 1}`)),
      );
      // The part being VIEWED, never 0 — the bug this file's header comment
      // calls out for portraits, one dialog over.
      partSel.value = String(Math.min(deps.viewedPart(), items.length - 1));
      picked = null;
      fileInput.value = "";
      nameInput.value = "";
      sizeNote.textContent = "";
      insertBtn.disabled = true;
      modal.dialog.showModal();
    },
  };
}
```

Add `ASSET_MAX_BYTES, assetBytes, formatAssetSize` to insert.ts's imports from `../spec/assets`. If `modal.footer` or `modal.close()` is not the shape `createModal` returns, read `src/ui/modal.ts` and use whatever `openInsertPortrait` uses at its own confirm button — do not invent a second convention.

- [ ] **Step 6: Add the menu entry**

`src/main.ts`, in the `createMenu("Insert", [...])` array after "Image from disk…":

```ts
  {
    label: "Data from disk…",
    onSelect: () =>
      openInsertData({
        readPlaylist: () => readPlaylistText(specArea.value),
        viewedPart: () => previewedPart,
        applyPlaylist,
        setStatus,
      }),
  },
```

Add `openInsertData` to the import on `src/main.ts:53`, and update the menu's title text to `{ title: "Add an image or a data file, or embed every image into the file" }`.

- [ ] **Step 7: Full suite and tsc**

Run: `npm test && npx tsc --noEmit -p tsconfig.json`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "A data file becomes an asset"
```

---

### Task 8: Say when a set is too large to revise

Spec §5.1. Silence is the failure mode: a revise that quietly leaves the data alone while reporting success is how an author comes to believe their repertoire changed when it did not.

**Files:**
- Modify: `src/llm/revise.ts` (`ReviseOutcome`, and the two return paths)
- Modify: `src/main.ts` (the revise result handler)
- Test: `tests/spec-assets.test.ts`

**Interfaces:**
- Consumes: Task 5's `described`, Task 3's `formatAssetSize`.
- Produces: `ReviseOutcome.notes?: string[]`

- [ ] **Step 1: Write the failing test**

```ts
describe("the over-threshold note (design §5.1)", () => {
  test("names the asset, its size, and the two paths that do work", () => {
    const big = Array.from({ length: 2_000 }, (_, i) => ({ name: `Line ${i}`, moves: ["e4"] }));
    const hoisted = hoistPortraitStrokes(
      formatPlaylist(singlePlaylist({ template: "chess_board", params: { set: "@openings" }, assets: { openings: big } } as unknown as Spec), "script"),
    );
    expect(noteForDescribed(hoisted.described)).toEqual([
      `openings is ${formatAssetSize(assetBytes(big))} — too large to revise here. Edit it in the Spec source, or re-import the file.`,
    ]);
  });

  test("nothing to say when every asset was sent", () => {
    expect(noteForDescribed([])).toEqual([]);
  });
});
```

Add `noteForDescribed` to the imports from `../src/llm/hoist`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/spec-assets.test.ts -t "over-threshold note"`
Expected: FAIL — `noteForDescribed` is not exported.

- [ ] **Step 3: Implement the note**

Append to `src/llm/hoist.ts`:

```ts
/**
 * What to tell the author about assets the model could not be given
 * (design §5.1). Silence is the failure mode this exists to prevent: a revise
 * that quietly leaves the data alone while reporting success is how someone
 * comes to believe their repertoire changed when it did not.
 */
export function noteForDescribed(described: readonly { name: string; bytes: number }[]): string[] {
  return described.map(
    (d) => `${d.name} is ${formatAssetSize(d.bytes)} — too large to revise here. Edit it in the Spec source, or re-import the file.`,
  );
}
```

Add `formatAssetSize` to hoist.ts's import from `../spec/assets`.

- [ ] **Step 4: Carry it out of reviseDocument**

`src/llm/revise.ts` — add to the `ReviseOutcome` interface:

```ts
  /** Things the author should know about this revision that are not errors —
   *  today, data assets too large to have been given to the model (§5.1). */
  notes?: string[];
```

…and add `notes: noteForDescribed(hoisted.described)` to BOTH return paths in `reviseDocument` (the `catch` return and the final return). Import `noteForDescribed` alongside the existing hoist imports.

- [ ] **Step 5: Show it**

`src/main.ts` — locate the handler with `grep -n "reviseDocument" src/main.ts`. It ends by calling `setStatus(...)` with the revision's own result. A second `setStatus` would immediately overwrite that, so the notes JOIN it rather than follow it. Capture the message the handler already builds into a local and extend it:

```ts
    // Data too large to have been given to the model rides out on the same
    // line as the result — a second setStatus would simply overwrite it, and
    // the whole point of the note is that the author sees it (design §5.1).
    const notes = outcome.notes ?? [];
    setStatus(notes.length > 0 ? [message, ...notes].join("  ") : message, kind);
```

where `message` and `kind` are whatever that handler was already passing. Make no other change to it.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/spec-assets.test.ts -t "over-threshold note"`
Expected: PASS, both.

- [ ] **Step 7: Full suite, tsc, build**

Run: `npm test && npm run build`
Expected: green. `npm run build` is the gate Netlify runs; it type-checks.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Say when a set is too large to revise here"
```

---

### Task 9: A published cast with data needs nothing of the author's

> **Imports:** these tests use `itemsOf(playlist)` — `Playlist` carries `entries`, not `items`, and `itemsOf` (from `../src/playlist/playlist`) is the helper that flattens chapters out of them. `tests/` is inside tsconfig's include, so `tsc` type-checks it: add every import the test needs.

Spec §8.6. The promise the whole design rests on: the data travels with the cast. This is the test that would catch a future round quietly making an asset depend on app state.

**Files:**
- Test: `tests/spec-assets.test.ts`

**Interfaces:**
- Consumes: every task above. Adds no source.

- [ ] **Step 1: Write the test**

```ts
describe("self-containment", () => {
  test("a cast with data lays out from its serialized text alone, with no app state", async () => {
    const { registerPack } = await import("../src/scenes/packs");
    const { ensureEngines } = await import("../src/scenes/engines");
    const gamesYaml = (await import("../src/scenes/packs/games.yaml?raw")).default;
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);

    const authored = {
      template: "chess_board",
      params: { moves: "@line", plies_shown: 2 },
      assets: { line: ["e4", "e5", "Nf3"] },
      commands: [{ draw: ["board"], speak: "A line." }],
    } as unknown as Spec;

    // Everything a viewer gets: the document as TEXT, and nothing else.
    const published = formatPlaylist(singlePlaylist(authored), "script");
    const viewerSpec = itemsOf(parsePlaylistText(published))[0].spec;

    const res = layoutSpec(viewerSpec as never);
    expect(res.warnings).toEqual([]);
    expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
    // The line really was played: e2 is vacated after 1.e4, and the arrow exists.
    expect(res.order).toContain("move_arrow");
    expect(res.anchors.piece_e4).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/spec-assets.test.ts -t "self-containment"`
Expected: PASS. If it fails on `params.moves` being a string, the resolution point (Task 2) is wrong — `layoutSpec` calls `normalizeSpec`, so this is the end-to-end proof that it does.

- [ ] **Step 3: Full suite, tsc, build**

Run: `npm test && npm run build`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Prove a published cast carries its own data"
```

---

## After the last task

- [ ] Run `npm test && npm run build` one final time on the merged result.
- [ ] Update `docs/superpowers/specs/2026-09-20-data-assets-design.md`'s Status line to `IMPLEMENTED 2026-09-20, plan docs/superpowers/plans/2026-09-20-data-assets.md`, with the test count.
- [ ] The spec's §10 file table lists `src/llm/compile.ts` as needing "restore before validate on the internal rounds". Task 4 covers its params half. The restore half turned out NOT to be needed: `compile.ts` does not import `hoist.ts` at all, so the compile path never hoists — a freshly compiled spec has no assets, since the model cannot write them. Record that correction in the spec rather than leaving the row implying missing work.
- [ ] The openings trainer is deliberately NOT in this plan (spec §3.6, §9). Do not start it here.
