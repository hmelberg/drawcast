# Prompt Weight and Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take ~56,000 characters (~14 k tokens, 27 %) off the cached prefix of every model call without removing one feature or one template, and close the three places where a shipped feature has no way into a prompt.

**Architecture:** Four weight changes, each independent: stop pinning three health-economics templates open for every request now that the router shortlists them; put the schema's repeated sub-shapes in `$defs`; extend the existing code/sound prose gate to the schema half it already implies; and cap the catalog's one-line index. Then three coverage changes: `author-v1.md` learns the `groups` / `attached` / `curveSamples` the last two rounds added, `revise-v1.md` learns the four script constructs it is asked to round-trip, and the `point` bullet learns `blocking: false`.

**Tech Stack:** TypeScript, Vite, vitest, Ajv (draft-07, `strict: false`), `@anthropic-ai/sdk`.

**Spec:** `docs/superpowers/specs/2026-09-22-prompt-weight-and-coverage-design.md` — read it first, all of it. Every task below cites the section it implements, and §5 says what is deliberately NOT in this plan and why.

## Global Constraints

- **Netlify runs `npm test && npm run build`.** `npm run build` type-checks with `tsc`; vitest does not. Both must be green before any push. Run the full `npm test` at the end of every task, not just the file you touched — the schema is read by the layout, the lint, the planner, the revise path and three render resolvers.
- **Measure every constant; never copy one from the design doc.** The design's numbers were measured at `fa1b4fd` and are there to tell you whether your result is in the right neighbourhood, not to be pasted into a test. Every `expect(...).toBe(N)` in this plan says how to obtain `N`.
- **The ratchet rule stands** (`tests/prompt-size.test.ts`): a round that changes the schema or the prompt re-pins `BASELINE_SCHEMA_CHARS` / `BASELINE_SYSTEM_CHARS` / `BASELINE_REVISE_CHARS` to its own newly measured size, on purpose, with a dated comment saying what bought the change. Tasks 1–4 re-pin **down**; tasks 5–7 re-pin **up**. Do them in order so each re-pin is a single honest number.
- **`tests/prompt-size.test.ts` is blind to Tasks 1 and 4.** Its `system()` helper builds from `catalogParts({}).stable` with **no pack loaded** — 13 templates, below `TEMPLATE_FULL_THRESHOLD`, so the two-level regime never runs there. The guards for the two-level catalog go in `tests/pack-defaults.test.ts`, which already loads the default packs in a `beforeAll`. Design §7.
- **Nothing the model reads may get worse.** Strategy B on the schema descriptions (design §3.2) and pruning the fewshots (§5) are explicitly out of scope; do not drift into either.
- **Do not delete a template, a pack, or a catalog entry.** Design §2.

## File Structure

| File | Responsibility after this plan |
|---|---|
| `src/scenes/catalog.ts` | Loses the unconditional `CORE_IDS` pin; gains a last-resort fallback for the case where neither router nor keyword selector produced anything; `indexLine()` caps the one-line index |
| `src/spec/schema.ts` | Gains `$defs` on `specSchema`; `pointRefSchema` / `ghostSchema` / the endpoint bag emit `$ref` wrappers; `apiSchema`'s gating lives here as two exported key lists |
| `src/llm/compile.ts` | `apiSchema(opts)` takes the same two booleans that already gate `{{CODE}}` / `{{SOUND}}`, and passes them identically to the prompt and to the structured-output constraint |
| `src/llm/revise.ts` | Passes its already-computed code/sound booleans into `apiSchema` |
| `src/llm/prompts/author-v1.md` | The layout return shape gains `groups`, `attached`, `curveSamples`; the `element_ids` rule gains group names |
| `src/llm/prompts/revise-v1.md` | Gains inline action spans, `A:`/`B:`, `@label`, and four page settings |
| `src/llm/prompts/compiler-v1.md` | The `point` bullet gains `blocking: false` |
| `tests/pack-defaults.test.ts` | Tasks 1, 4 — the two-level catalog's size and reachability guards |
| `tests/schema-defs.test.ts` | Task 2 (new) |
| `tests/schema-gate.test.ts` | Task 3 (new) |
| `tests/prompt-size.test.ts` | Re-pinned in Tasks 2, 3, 5, 6, 7 |
| `tests/author-rules.test.ts` | Task 5 |
| `tests/revise.test.ts` | Task 6 |

---

## Part A — weight

### Task 1: The three core templates stop riding every request

Design §3.1. `CORE_IDS` puts `supply_demand` (14,070 ch), `qaly_profiles` (10,009 ch) and `decision_tree` (2,811 ch) in full into the cached prefix of **every** request, whatever its topic. The router (97.9 % top-5) now shortlists them for the requests that want them.

There is one measured hole, and this task closes it rather than shipping past it: **the keyword selector is English-only.** `selectTemplates("Forklar tilbud og etterspørsel", 5)` returns `[]` — every template description is in English, so a Norwegian request has zero keyword overlap, and today the pin is what rescues it. That matters when the router is absent or failed. (Revise is already safe: `revise.ts:172` puts the document's own templates into `priorityIds`, which still get full entries.)

**Files:**
- Modify: `src/scenes/catalog.ts:31` (`CORE_IDS`), `:263` (`stableIds`), `:283` (`picks`)
- Modify: `tests/pack-defaults.test.ts:46`
- Test: `tests/pack-defaults.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `catalogParts()` keeps its exact `{ stable: string; variable: string }` signature. `CORE_IDS` stops being a module-level pin and becomes `LAST_RESORT_IDS`, used only when a request produced no shortlist at all.

- [ ] **Step 1: Write the failing tests**

In `tests/pack-defaults.test.ts`, inside the existing `describe("the default catalog", …)` (its `beforeAll` already loads `DEFAULT_SETTINGS.enabledPacks`), add:

```ts
  // Design §3.1. The two-level catalog's stable half is the cached prefix of
  // every request, whatever its topic. Before this round it carried three
  // health-economics templates in full — 26,890 chars a chess request paid
  // for. The router shortlists them now. Measured 2026-09-22 after the
  // unpin: <MEASURE IT>. The ceiling is the measurement plus ~10 % of room
  // for the index to grow with the library; a round that adds a pack may
  // re-pin it, on purpose, with a note like this one.
  test("the stable catalog is the index and nothing expanded", () => {
    const { stable } = catalogParts({ request: "explain a chess opening" });
    expect(stable).not.toContain("### Scene template: supply_demand (READY");
    expect(stable).not.toContain("### Scene template: qaly_profiles (READY");
    expect(stable).not.toContain("### Scene template: decision_tree (READY");
    expect(stable.length).toBeLessThan(28_000);
    // The index itself is intact: every ready template still has its line.
    for (const id of readyIds()) expect(stable).toContain(`- ${id}: `);
    expect(stable).toContain("need_template");
  });

  test("a request that wants a core template still gets it in full", () => {
    const { variable } = catalogParts({ request: "Explain supply and demand with a tax" });
    expect(variable).toContain("### Scene template: supply_demand (READY");
  });

  // The measured hole the unpin opens: template descriptions are English, so
  // a Norwegian request scores zero keyword overlap and selectTemplates
  // returns []. With a router that is fine — it reads meaning. With no
  // router and no keyword hit the model would face an index and nothing
  // else, which is exactly the request the pin used to rescue.
  test("a request no selector could shortlist still gets the fallback", () => {
    const { variable } = catalogParts({ request: "Forklar tilbud og etterspørsel" });
    expect(variable).toContain("### Scene template: supply_demand (READY");
  });

  test("a request the keyword selector CAN place gets no fallback padding", () => {
    const { variable } = catalogParts({ request: "draw the structure of aspirin" });
    expect(variable).toContain("### Scene template: molecule (READY");
    expect(variable).not.toContain("### Scene template: qaly_profiles (READY");
  });
```

Then fix the existing assertion at `tests/pack-defaults.test.ts:46`, which asserts the opposite of the new behaviour. Replace this line:

```ts
    for (const id of ["supply_demand", "decision_tree", "qaly_profiles"]) expect(stable).toContain(`### Scene template: ${id} (READY`);
```

with:

```ts
    // The core three are no longer pinned into the stable half (design §3.1);
    // their own test above covers how a request reaches them now.
    for (const id of ["supply_demand", "decision_tree", "qaly_profiles"]) expect(stable).toContain(`- ${id}: `);
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/pack-defaults.test.ts
```

Expected: the three new `stable` assertions FAIL (`supply_demand` is still expanded, `stable.length` is ~52,409), and the Norwegian fallback test FAILS (`variable` is empty).

- [ ] **Step 3: Unpin, and add the last-resort fallback**

In `src/scenes/catalog.ts`, replace the `CORE_IDS` declaration at line 31:

```ts
/**
 * The shortlist of last resort: used ONLY when a request produced no
 * shortlist at all — no router (or a failed one) AND no keyword overlap.
 *
 * Until 2026-09-22 these three were pinned into every request's stable
 * catalog in full, 26,890 chars a chess question paid for. That pin predates
 * the template router (src/llm/router.ts, 97.9 % top-5 joined with the
 * keyword selector), which shortlists them for the requests that want them.
 *
 * It is not simply deleted, because the keyword selector is ENGLISH: every
 * template description is written in English, so `selectTemplates("Forklar
 * tilbud og etterspørsel", 5)` returns [] — measured — and half this app's
 * requests are written in Norwegian. With a router that is harmless (it
 * reads meaning, not keywords); with no router it is the one case the pin
 * was really carrying. So the pin becomes a fallback for exactly that case
 * and costs nothing in every other.
 */
const LAST_RESORT_IDS = ["supply_demand", "decision_tree", "qaly_profiles"];
```

Then at line 263, drop `...CORE_IDS` from `stableIds`:

```ts
  // Preference-stable hot set: config only (forced/priority), NEVER the
  // free-text request — that's what keeps `stable` identical across requests
  // sharing the same forced template / priority packs (the cache_control pin).
  const stableIds = dedupe([...(opts.forced ? [opts.forced] : []), ...(opts.priorityIds ?? [])]).filter(
    (id) => scenes[id]?.manifest.status === "ready" && !excluded.has(id),
  );
```

Then, where `picks` is computed (line ~283), fall back when nothing was picked:

```ts
  const routed = opts.shortlist && opts.shortlist.length > 0 ? dedupe(opts.shortlist).slice(0, HOT_SHORTLIST) : [];
  const keyword = selectTemplates(opts.request ?? "", routed.length > 0 ? HOT_SHORTLIST : 3);
  const picks = routed.length > 0 ? dedupe([...routed, ...keyword]).slice(0, HOT_SHORTLIST) : keyword;
  // Neither selector placed this request (a router outage on a request whose
  // language the English keyword selector cannot read). An index and nothing
  // else is the one prompt this catalog promised never to send — see
  // LAST_RESORT_IDS.
  const placed = picks.length > 0 || stableIds.length > 0 ? picks : LAST_RESORT_IDS;
  const shortlist = placed.filter((id) => scenes[id]?.manifest.status === "ready" && !stableIds.includes(id) && !excluded.has(id));
```

- [ ] **Step 4: Run the tests to verify they pass, then measure and pin the real ceiling**

```bash
npx vitest run tests/pack-defaults.test.ts
```

All five should pass. Now replace the `28_000` guess with the measured number. Add this temporary test to the same describe block, read the number off it, then delete it:

```ts
  test("TEMP measure", () => { console.log("stable:", catalogParts({ request: "x" }).stable.length); });
```

```bash
npx vitest run tests/pack-defaults.test.ts 2>&1 | grep "stable:"
```

Set the ceiling to that number rounded up to the next 500, put the measured figure in the comment where `<MEASURE IT>` is, and delete the TEMP test.

- [ ] **Step 5: Run the selector bench — this is the gate for the whole task**

```bash
npm run selector:eval -- --router --gate 0.95
```

Expected: exit 0, recall@5 at or above 0.95. This needs `ANTHROPIC_API_KEY` in `.env` or the environment and spends one Haiku call per case. **If it fails, stop and report the recall figure rather than adjusting the gate** — the gate is the claim this task rests on.

- [ ] **Step 6: Run the full suite**

```bash
npm test && npm run build
```

`tests/generate-loop.test.ts:335` has a comment reading "of which is in CORE_IDS or cfg.priorityIds either" — update it to say `LAST_RESORT_IDS`. If any other test fails, read it before changing it: a test that asserted the old pin is telling you what the pin was for.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/catalog.ts tests/pack-defaults.test.ts tests/generate-loop.test.ts
git commit -m "The catalog stops holding three templates open for every request

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The schema's repeated shapes move into `$defs`

Design §3.2. `pointRefSchema(what)` and `ghostSchema(what)` are factories, so every call site carries a full copy of the structure — eight copies of the point shape, five of the ghost shape, four of the endpoint bag. Measured recoverable: **8,545 chars (10.4 % of the schema)** with every per-site description kept exactly as it is (Strategy A). Strategy B is out of scope.

Verified before planning, so do not re-litigate it: Anthropic structured outputs support `$ref`/`$defs`; Ajv draft-07 with `strict: false` resolves `#/$defs/...` by JSON pointer whatever the draft calls the keyword, honours `allOf` beside a sibling `description`, and keeps resolving after `documentSchema`'s `{ ...specSchema, properties: {…} }` spread.

**Files:**
- Modify: `src/spec/schema.ts:61-95` (the three factories), `:974` (`specSchema` gains `$defs`)
- Create: `tests/schema-defs.test.ts`
- Modify: `tests/prompt-size.test.ts:421` (`BASELINE_SCHEMA_CHARS`)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `specSchema.$defs` with the keys `point_ref`, `ghost`, `end_ref`. `pointRefSchema(what)` and `ghostSchema(what)` keep their exact `(what: string) => object` signatures — only what they return changes.

- [ ] **Step 1: Write the failing test**

Create `tests/schema-defs.test.ts`:

```ts
// The schema is embedded verbatim in every system prompt AND is the API's
// structured-output constraint, so a shape written out eight times is paid
// for eight times on every request. $defs is supported by both readers —
// Anthropic structured outputs list $ref/$def, and Ajv resolves #/$defs by
// JSON pointer regardless of draft-07's own keyword name. Design §3.2.
import { describe, expect, test } from "vitest";
import AjvModule from "ajv";
import { apiSchema } from "../src/llm/compile";
import { documentSchema, specSchema, validateSpec } from "../src/spec/schema";

const AjvCtor = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as typeof AjvModule;

describe("the schema's shared shapes", () => {
  test("the repeated shapes are defined once", () => {
    const s = apiSchema() as { $defs?: Record<string, unknown> };
    expect(Object.keys(s.$defs ?? {}).sort()).toEqual(["end_ref", "ghost", "point_ref"]);
    // The bodies are gone from the call sites: the point shape's structural
    // signature appears once, in $defs, not eight times.
    const text = JSON.stringify(s);
    const body = '{"type":"array","items":{"type":"number"},"minItems":2,"maxItems":2}';
    expect(text.split(body).length - 1).toBeLessThanOrEqual(2);
  });

  test("every call site keeps its own description", () => {
    const text = JSON.stringify(apiSchema());
    // move.to, move.pivot, arrange.at, flip.through and morph.pivot each say
    // something different about the same shape; that is the point of Strategy A.
    expect(text).toContain("Destination of the moving element's");
    expect(text).toContain("the point to turn or grow about");
    expect(text).toContain("Centre of the arrangement");
    expect(text).toContain("A point the mirror line passes through");
  });

  // documentSchema is `{ ...specSchema, properties: {…} }`, so $defs rides
  // the spread — but a pointer that resolved against specSchema's root must
  // still resolve against the document's. This is the trap; pin it.
  test("ajv resolves the pointers from both roots", () => {
    const ajv = new AjvCtor({ allErrors: true, strict: false });
    const viaSpec = ajv.compile(JSON.parse(JSON.stringify(specSchema)));
    const viaDoc = ajv.compile(JSON.parse(JSON.stringify(documentSchema)));
    const good = { commands: [{ move: { target: ["a"], to: { ref: "b", anchor: "tip" } } }] };
    const bad = { commands: [{ move: { target: ["a"], to: { nonsense: 1 } } }] };
    expect(viaSpec(good)).toBe(true);
    expect(viaDoc(good)).toBe(true);
    expect(viaSpec(bad)).toBe(false);
    expect(viaDoc(bad)).toBe(false);
  });

  test("a spec that validated before still validates", () => {
    const spec = {
      title: "t",
      elements: [{ id: "a", type: "point", x: 10, y: 10 }],
      commands: [
        { move: { target: ["a"], to: [500, 400], ghost: true } },
        { flip: { target: ["a"], through: { ref: "a", anchor: "left" } } },
      ],
    };
    expect(validateSpec(spec).errors).toEqual([]);
  });
});
```

`validateSpec` is exported at `src/spec/schema.ts:1752` and returns `{ ok: boolean; errors: string[] }`; `tests/revise.test.ts` already imports it the same way.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/schema-defs.test.ts
```

Expected: the first test FAILS — `$defs` is undefined.

- [ ] **Step 3: Add `$defs` and make the factories reference it**

In `src/spec/schema.ts`, after `ANCHOR_NAMES` (line 58), add the shared bodies and keep the three factories as the only way call sites reach them:

```ts
/**
 * Shapes written out at more than one call site. They live here once and the
 * call sites reference them, so the schema — which is embedded verbatim in
 * every system prompt and is also the structured-output constraint — pays for
 * each shape once instead of once per site (8,545 chars measured, design
 * §3.2). Each site keeps its OWN description through the `allOf` wrapper the
 * factories below emit: the anchor vocabulary is what a site needs at the
 * moment it is read, and sharing THAT would make the schema worse to read to
 * save characters.
 *
 * Ajv resolves `#/$defs/...` by JSON pointer even on draft-07, where the
 * keyword is spelled `definitions`, and `documentSchema`'s spread carries
 * $defs onto its own root so both compile. tests/schema-defs.test.ts pins it.
 */
const SHARED_DEFS = {
  point_ref: {
    oneOf: [
      { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
      {
        type: "object",
        properties: { ref: { type: "string" }, anchor: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
        additionalProperties: false,
      },
    ],
  },
  ghost: {
    oneOf: [
      { type: "boolean" },
      { type: "array", items: { type: "string" } },
      { type: "object", properties: { of: { type: "array", items: { type: "string" } }, opacity: { type: "number", minimum: 0, maximum: 1 } }, additionalProperties: false },
    ],
  },
  end_ref: {
    type: "object",
    properties: {
      ref: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
      anchor: { type: "string", description: `A named point ON ref instead of its centre — e.g. {"ref": "tri", "anchor": "vertex_1"}: ${ANCHOR_NAMES}.` },
    },
    additionalProperties: false,
  },
};
```

Replace `endRefSchema` (lines 61–71) with a reference that keeps its description:

```ts
const endRefSchema = {
  allOf: [{ $ref: "#/$defs/end_ref" }],
  description: "Arrow/edge endpoint: set ref to an element id, OR x+y coordinates (domain coordinates if a domain is declared, else logical).",
};
```

**`endRefSchema.properties` is read at two sites** (`schema.ts:160` and `:166`, inside `oneOf` lists). Those two must now read `SHARED_DEFS.end_ref.properties` instead — `endRefSchema` no longer has a `properties` key, and `tsc` will point at both.

Replace the two factories (lines 74–95) with wrapper emitters, keeping their signatures and every description string byte-identical:

```ts
/** A point a verb takes: [x, y], or a named point on an element so the model never computes it. */
const pointRefSchema = (what: string) => ({
  allOf: [{ $ref: "#/$defs/point_ref" }],
  description: `${what} — [x, y] (domain units when a domain is declared, else logical), or {"ref": id, "anchor": name} for a point ON an element so you never compute it: ${ANCHOR_NAMES}.`,
});

/** A verb's ghost option: true (every target), a list of ids, or {of, opacity}. */
const ghostSchema = (what: string) => ({
  allOf: [{ $ref: "#/$defs/ghost" }],
  description: `${what} — KEEP a faded copy of the original where it is while this plays: true keeps every target at 0.3, ["id", …] keeps those, {"of": […], "opacity": 0.2} sets the shade. The copy is an element <id>_ghost you can erase or fade later — a pieces id ghosts every piece: kake_1_ghost, kake_2_ghost, … Default: nothing is kept.`,
});
```

Finally add `$defs` to `specSchema` (line 974), immediately after `$schema` so it spreads into `documentSchema`:

```ts
export const specSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $defs: SHARED_DEFS,
  title: "ConceptSketchSpec",
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/schema-defs.test.ts && npm test
```

Expected: all green. `apiSchema()` deletes `$schema` but **not** `$defs` — confirm by eye that `src/llm/compile.ts:97-101` still only deletes `copy.$schema`.

- [ ] **Step 5: Re-pin the ratchet, down**

```bash
npx vitest run tests/prompt-size.test.ts 2>&1 | grep -A3 "schema stays within"
```

If it passes it is telling you nothing — the ceiling is above the new size. Measure the new size directly. Add this temporary test to `tests/schema-defs.test.ts`, read the numbers off it, then delete it:

```ts
test("TEMP measure", () => {
  console.log("schema:", JSON.stringify(apiSchema()).length);
  console.log("system:", buildSystemPrompt(promptVariants()[0].source, {
    schema: apiSchema(), catalog: catalogParts({}).stable, fewshots: fewshotsText(), exemplars: "", code: "", sound: "",
  }).length);
});
```

(importing `buildSystemPrompt` from `../src/llm/prompt`, and `fewshotsText` / `promptVariants` from `../src/llm/compile`, exactly as `tests/prompt-size.test.ts` does.)

```bash
npx vitest run tests/schema-defs.test.ts 2>&1 | grep -E "schema:|system:"
```

Set `BASELINE_SCHEMA_CHARS` in `tests/prompt-size.test.ts:421` to the measured value and append to its comment:

```
// Re-pinned DOWN 2026-09-22: the repeated sub-shapes (the point-ref bag ×8,
// the ghost option ×5, the arrow endpoint ×4) moved into specSchema.$defs
// and each call site became an allOf wrapper that keeps its own description
// unchanged (design 2026-09-22 §3.2). 81898 -> <MEASURED>. Nothing the model
// reads changed; only the number of times it reads the same braces.
```

`BASELINE_SYSTEM_CHARS` embeds the schema verbatim, so re-pin it by the same delta — measure, do not subtract by hand.

- [ ] **Step 6: Commit**

```bash
git add src/spec/schema.ts tests/schema-defs.test.ts tests/prompt-size.test.ts
git commit -m "The schema names its repeated shapes once

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The code/sound gate reaches the schema

Design §3.3. `{{CODE}}` (17,502 ch) and `{{SOUND}}` (1,424 ch) are already withheld from requests that do not want them. The schema is not: every request carries the `code` element and its 14 properties (**9,154 ch measured**) and the `play` command with `instrument`/`tempo` (**1,404 ch**). So a request the prompt has decided is not about code is still handed the full instructions for writing a code element — and is constrained to a schema that permits one.

This adds no cache variants: `{{CODE}}` and `{{SOUND}}` sit before `{{EXEMPLARS}}`, so the cached prefix already forks four ways on these two booleans.

**Files:**
- Modify: `src/spec/schema.ts` (export the two key lists)
- Modify: `src/llm/compile.ts:97-101` (`apiSchema`), `:414-429`, `:515-522`
- Modify: `src/llm/revise.ts:175`
- Create: `tests/schema-gate.test.ts`
- Modify: `tests/prompt-size.test.ts`

**Interfaces:**
- Consumes: Task 2's `$defs` (untouched by the gate — the shared shapes are not code- or sound-only).
- Produces: `apiSchema(opts?: { code?: boolean; sound?: boolean }): object`. Omitting `opts` returns the **full** schema, so every existing caller and test keeps working unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/schema-gate.test.ts`:

```ts
// The prose gate (wantsCode / wantsSound) has withheld the 17.5k code block
// and the 1.4k sound block since the code round. The schema did not follow,
// so a request the prompt had already decided was not about code still
// carried the whole code element — and was CONSTRAINED to a schema that
// allowed one. Design §3.3.
import { describe, expect, test } from "vitest";
import { apiSchema } from "../src/llm/compile";
import { CODE_ONLY_ELEMENT_PROPS, SOUND_ONLY_COMMAND_PROPS } from "../src/spec/schema";

const props = (s: object) => (s as any).properties.elements.items.properties;
const cmds = (s: object) => (s as any).properties.commands.items.properties;

describe("the schema's code and sound halves", () => {
  test("the key lists are derived from the descriptions, not hand-kept", () => {
    // Every element property whose description begins "code:" is code-only.
    // Measured 2026-09-22: 14 of them. `width` mentions code but describes
    // six element types, so the prefix — not the word — is the rule.
    const all = props(apiSchema());
    const derived = Object.keys(all).filter((k) => /^code(\/| |:)/.test(all[k].description ?? ""));
    expect([...CODE_ONLY_ELEMENT_PROPS].sort()).toEqual(derived.sort());
    expect(CODE_ONLY_ELEMENT_PROPS).toContain("controls");
    expect(CODE_ONLY_ELEMENT_PROPS).not.toContain("width");
  });

  test("no gate asked for means the whole schema, as before", () => {
    expect(JSON.stringify(apiSchema())).toEqual(JSON.stringify(apiSchema({ code: true, sound: true })));
  });

  test("a code-less request is not handed the code element", () => {
    const s = apiSchema({ code: false, sound: true });
    expect(props(s).type.enum).not.toContain("code");
    for (const k of CODE_ONLY_ELEMENT_PROPS) expect(props(s)[k]).toBeUndefined();
    // and the sound half is untouched by the code gate
    expect(cmds(s).play).toBeDefined();
  });

  test("a soundless request is not handed the play verb", () => {
    const s = apiSchema({ code: true, sound: false });
    for (const k of SOUND_ONLY_COMMAND_PROPS) expect(cmds(s)[k]).toBeUndefined();
    expect(props(s).type.enum).toContain("code");
  });

  test("the gate is worth what it claims", () => {
    const full = JSON.stringify(apiSchema()).length;
    const bare = JSON.stringify(apiSchema({ code: false, sound: false })).length;
    expect(full - bare).toBeGreaterThan(9_000);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/schema-gate.test.ts
```

Expected: FAIL — `CODE_ONLY_ELEMENT_PROPS` is not exported and `apiSchema` takes no argument.

- [ ] **Step 3: Export the key lists and teach `apiSchema` the gate**

In `src/spec/schema.ts`, beside `elementSchema`, add:

```ts
/**
 * Element properties that belong to the `code` element alone — the rule is
 * the description's own prefix, "code: ", which every one of them already
 * carries. Kept as an explicit list rather than derived at call time so the
 * gate is greppable and a new code property that forgets the prefix fails
 * tests/schema-gate.test.ts rather than silently riding every request.
 * `width` deliberately absent: it describes six element types, one of which
 * is code. Design §3.3.
 */
export const CODE_ONLY_ELEMENT_PROPS = [
  "language", "code", "show", "lines", "frame", "figures", "chart",
  "game", "marks", "code_result", "code_src", "controls", "autorun", "pane",
] as const;

/** Command properties that belong to the `play` verb alone. */
export const SOUND_ONLY_COMMAND_PROPS = ["play", "instrument", "tempo"] as const;
```

In `src/llm/compile.ts`, replace `apiSchema` (lines 96–101):

```ts
/**
 * Schema copy for the API's structured-output constraint, and for the
 * prompt's {{SCHEMA}}.
 *
 * `code` and `sound` are the SAME two booleans that already gate {{CODE}}
 * and {{SOUND}} (llm/prompt.ts's wantsCode / wantsSound). Omitted means the
 * full schema, so every caller that does not care is unaffected. Both blocks
 * sit before {{EXEMPLARS}}, so the cached prefix already forks four ways on
 * these two — gating the schema too adds no fifth cache entry.
 *
 * The two call sites in generateSpec must be given IDENTICAL flags: one
 * fills the prompt's {{SCHEMA}}, the other is the structured-output
 * constraint, and a model shown one contract while held to another is the
 * failure this note exists to prevent.
 */
export function apiSchema(opts: { code?: boolean; sound?: boolean } = {}): object {
  const copy = JSON.parse(JSON.stringify(specSchema)) as Record<string, unknown>;
  delete copy.$schema;
  const props = copy.properties as Record<string, any>;
  if (opts.code === false) {
    const el = props.elements.items.properties;
    for (const k of CODE_ONLY_ELEMENT_PROPS) delete el[k];
    el.type.enum = el.type.enum.filter((t: string) => t !== "code");
  }
  if (opts.sound === false) {
    const cmd = props.commands.items.properties;
    for (const k of SOUND_ONLY_COMMAND_PROPS) delete cmd[k];
  }
  return copy;
}
```

Add the import of both lists from `../spec/schema` at the top of `compile.ts`.

In `generateSpec` (around line 414), hoist the two booleans above their first use so the prompt and the constraint cannot drift:

```ts
  // One pair of booleans, read three times: the prose gate, the schema gate,
  // and the structured-output constraint. They must never disagree.
  const wantCode = wantsCode(request);
  const wantSound = wantsSound(request);
  const code = wantCode ? CODE_PROMPT_SOURCE : "";
  const sound = wantSound ? SOUND_PROMPT_SOURCE : "";
  const schema = apiSchema({ code: wantCode, sound: wantSound });
  let blocks = buildSystemBlocks(cfg.variant.source, {
    schema,
    catalog: catalog.stable,
    fewshots: fewshotsText(),
    exemplars: formatExemplars(pickExemplars(request, cfg.exemplars, cfg.bundledExemplars ?? [], 3)),
    code,
    sound,
  });
```

Delete the now-duplicate `const schema = apiSchema();` that followed. Then find the **second** assembly site (around line 515, the template-fetch escalation rebuild) and give it the same `schema` — `tsc` will not catch this, so grep for `apiSchema(` in `compile.ts` and confirm every remaining call passes the same two flags.

In `src/llm/revise.ts`, the booleans already exist inline; hoist and reuse them:

```ts
  // A revision needs the code half whenever the DOCUMENT has a code element,
  // not just when the instruction says so ("make it 1000 draws" rarely does).
  // Same for play. These gate the prose and the schema together.
  const wantCode = wantsCode(instruction) || /\btype:\s*['"]?code\b/.test(docText);
  const wantSound = wantsSound(instruction) || /\bplay:/.test(docText);
  const blocks = buildSystemBlocks(cfg.variant.source, {
    schema: apiSchema({ code: wantCode, sound: wantSound }),
    catalog: catalog.stable,
    fewshots: fewshotsText(),
    exemplars: "",
    code: wantCode ? CODE_PROMPT_SOURCE : "",
    sound: wantSound ? SOUND_PROMPT_SOURCE : "",
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/schema-gate.test.ts && npm test && npm run build
```

- [ ] **Step 5: Add the regression guard that the two call sites agree**

Append to `tests/schema-gate.test.ts`:

```ts
  // The failure this gate could introduce, in one assertion: the prompt's
  // {{SCHEMA}} and the structured-output constraint are built from the same
  // object, so a request that gets the code element in one gets it in both.
  test("the prompt's schema and the constraint are the same object", async () => {
    const src = await import("node:fs").then((fs) => fs.readFileSync("src/llm/compile.ts", "utf8"));
    const calls = src.match(/apiSchema\([^)]*\)/g) ?? [];
    expect(calls.length, "every apiSchema call in compile.ts").toBeGreaterThan(0);
    for (const c of calls) expect(c).toBe("apiSchema({ code: wantCode, sound: wantSound })");
  });
```

If a legitimate call site cannot use those exact variable names, rename the local variables to match rather than weakening the assertion.

- [ ] **Step 6: Re-pin the ratchet, down**

`tests/prompt-size.test.ts`'s `system()` helper calls `apiSchema()` with no argument, so it still measures the full schema — that is correct and should stay. Add one new test beside it:

```ts
  test("a request about neither code nor sound is not handed either schema half", () => {
    const full = JSON.stringify(apiSchema()).length;
    const bare = JSON.stringify(apiSchema({ code: false, sound: false })).length;
    // Measured 2026-09-22: <MEASURE IT> chars withheld from the ordinary
    // request — the code element and its 14 properties, and the play verb.
    expect(full - bare).toBeGreaterThan(9_000);
  });
```

- [ ] **Step 7: Commit**

```bash
git add src/spec/schema.ts src/llm/compile.ts src/llm/revise.ts tests/schema-gate.test.ts tests/prompt-size.test.ts
git commit -m "A request that is not about code is not handed the code element

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The catalog index line gets a ceiling

Design §3.4. 24,815 chars for 88 lines — median 276, p90 407, longest 497 (`note_sheet`). `firstSentence()` takes whatever the description's first sentence is, and several open with a parenthetical list of presets. Safe to cap because the **router reads a different index**: `routerIndexText()` (first sentence + the "Choose this for…" sentence + two example requests) is built for routing and is not touched here.

**Files:**
- Modify: `src/scenes/catalog.ts` (add `indexLine`, use it at the index build)
- Modify: `tests/pack-defaults.test.ts`, `tests/catalog.test.ts`
- Test: `tests/pack-defaults.test.ts`

**Interfaces:**
- Consumes: Task 1's `catalogParts`.
- Produces: `indexLine(manifest: SceneManifest): string` — not exported; internal to `catalog.ts`.

- [ ] **Step 1: Write the failing test**

In `tests/pack-defaults.test.ts`, inside the same describe block:

```ts
  // Design §3.4. The index is in the cached prefix of every request; the
  // router reads its own, richer index (routerIndexText), so capping this
  // one costs routing nothing. Its two jobs here are knowing what exists and
  // naming an id for the need_template escalation — 140 chars serves both.
  test("no index line runs long", () => {
    const index = catalogParts({ request: "x" }).stable.split("\n\n")[0].split("\n");
    expect(index).toHaveLength(readyIds().length);
    for (const line of index) expect(line.length, line).toBeLessThanOrEqual(160);
    // The cap is a cap, not a truncation of everything: short descriptions
    // are untouched and still end in their own full stop.
    expect(index.some((l) => l.endsWith("."))).toBe(true);
  });

  test("the router's index is NOT capped", () => {
    const longest = routerIndexText().split("\n").reduce((a, b) => (b.length > a.length ? b : a));
    expect(longest.length).toBeGreaterThan(200);
  });
```

Import `routerIndexText` at the top of the file.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/pack-defaults.test.ts
```

Expected: the cap test FAILS on `note_sheet` at 497 chars.

- [ ] **Step 3: Add the cap**

In `src/scenes/catalog.ts`, beside `firstSentence`:

```ts
/**
 * One template's line in the compiler's index — the list of every ready
 * template that rides the cached prefix of every request. Capped, because at
 * 88 templates the uncapped first sentence came to 24,815 chars (median 276,
 * longest 497: descriptions that open by listing their presets).
 *
 * Capping is safe here and nowhere else: the ROUTER reads its own index
 * (routerIndexText below), which keeps the full sentence plus the "Choose
 * this for…" sentence plus two example requests. This line's only jobs are
 * telling the model the template exists and giving it an id to name in a
 * need_template escalation. Cut on a word boundary so the tail is never a
 * half word, and only when there is something to cut. Design §3.4.
 */
const INDEX_LINE_MAX = 140;

function indexLine(manifest: SceneManifest): string {
  const text = firstSentence(manifest.description);
  if (text.length <= INDEX_LINE_MAX) return `- ${manifest.name}: ${text}`;
  const cut = text.slice(0, INDEX_LINE_MAX);
  const at = cut.lastIndexOf(" ");
  return `- ${manifest.name}: ${(at > INDEX_LINE_MAX / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
```

Then replace the index build (line ~258):

```ts
  const index = ready.map((s) => indexLine(s.manifest)).join("\n");
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/pack-defaults.test.ts tests/catalog.test.ts
```

`tests/catalog.test.ts` asserts index membership with `- ${id}: ` prefixes; those still hold because the cap only touches the tail. If any assertion matched a full sentence, shorten the assertion to the `- id: ` prefix rather than raising the cap.

- [ ] **Step 5: Measure what it bought, and run the bench**

Use the TEMP-test pattern from Task 1 Step 4 to print the new `stable.length`, and put the before/after in the Step 1 comment. Then confirm routing is genuinely untouched:

```bash
npm run selector:eval -- --router --gate 0.95
```

- [ ] **Step 6: Run the full suite and commit**

```bash
npm test && npm run build
git add src/scenes/catalog.ts tests/pack-defaults.test.ts tests/catalog.test.ts
git commit -m "An index line is a line, not a paragraph

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Part B — coverage

### Task 5: The template author learns `groups` and `attached`

Design §4.2. `author-v1.md` was last touched 2026-09-15; `attached` landed 09-19 and `groups` 09-20. It states the layout body *"must `return { drawables, labels, anchors, order }`"* — a closed four-key list, so the AI author is the only template writer in the repo that cannot use either. Hand-written templates already use `attached` **82 times across 8 packs**. Neither exemplar (`cell_diagram`, `violin_anatomy`) demonstrates them, so prose has to carry it.

**Files:**
- Modify: `src/llm/prompts/author-v1.md:24` and `:31-34`, `:12`
- Modify: `tests/author-rules.test.ts`
- Modify: `tests/prompt-size.test.ts` (re-pin up, if the author prompt is ratcheted there — check; if not, no re-pin)

**Interfaces:**
- Consumes: nothing.
- Produces: no code interface — prompt text only.

- [ ] **Step 1: Write the failing test**

In `tests/author-rules.test.ts`:

```ts
// The layout contract the author prompt states must be the contract
// SceneLayout actually has. It said four keys for two rounds after `groups`
// (4901ab0) and `attached` (46e5a0d) landed, so every AI-authored template
// was structurally unable to use either while eight hand-written packs did.
// Design §4.2.
test("the author prompt teaches the whole SceneLayout return shape", () => {
  // The ASSEMBLED prompt, the way the file's other tests read it — what the
  // model is actually handed, not the source with its placeholders unfilled.
  // Assert on the PROSE, not on bare identifiers: {{KIT_SOURCE}} fills this
  // prompt with kit.ts, which contains "group", "labels" and "anchors" of
  // its own, so `toContain("groups")` would pass without a word changing.
  const text = buildAuthorSystem()[0].text;
  expect(text).toContain("`return { drawables, labels, anchors, order }`");
  expect(text).toContain("**`groups`**");
  expect(text).toContain("**`attached`**");
  expect(text).toContain("**`curveSamples`**");
  // Each is explained, not merely listed.
  expect(text).toContain("A group is a NAME, not a drawable");
  expect(text).toContain("which of your ids FOLLOW another");
  // And it says group names must be documented, because element_ids is the
  // only channel the COMPILER has for learning them.
  expect(text).toMatch(/element_ids[\s\S]{0,400}`groups`/);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/author-rules.test.ts
```

Expected: FAIL on `groups`.

- [ ] **Step 3: Update the prompt**

In `src/llm/prompts/author-v1.md`, replace line 24:

```
It must `return { drawables, labels, anchors, order }`, and may also return
`groups`, `attached` and `curveSamples` (below).
```

Extend the bullet list at lines 31–34 with three bullets in the file's own voice and line width (~76 columns):

```
- **`groups`**: names for SETS of your own ids — `{position: ["board",
  "squares", "pieces"], pieces: ["piece_a1", …]}`. A drawcast naming one in a
  command means every member, so a whole board is `draw: ["position"]`
  instead of sixty-four ids, while each member keeps its own id for a beat
  that is ABOUT it. A group is a NAME, not a drawable: it belongs to no
  `order` and draws nothing of its own.
- **`attached`**: which of your ids FOLLOW another —
  `{wtp_line: ["wtp_label"]}`. A follower goes where its element goes
  (`move`, `arrange`), fades when it fades, and stays lit when a `focus`
  keeps it. Declare it whenever a label names one element and is not called
  `label_<that id>`, which is the only case the app can infer by itself.
- **`curveSamples`**: `{id: [[x, y], …]}` in logical coordinates for any
  curve you draw, so a drawcast can lay its own shaded region or
  intersection on top of your curve.
```

And extend line 12's `element_ids` description:

```
"element_ids": {"<id>": "<what it is>", ...},   ← every id a command may name,
   INCLUDING every name you put in `groups`: this text is the only place the
   drawcast compiler learns a group exists. Say what the group stands for
   ("the whole board at once — the board, all 64 squares, every man").
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/author-rules.test.ts && npm test
```

- [ ] **Step 5: Verify against the real authoring path, not just the string**

```bash
npx vitest run tests/author.test.ts tests/author-mode.test.ts
```

`buildAuthorSystem()` fills `{{KIT_SOURCE}}`, `{{ENGINES_SOURCE}}` and two exemplars into this file; confirm the assembled prompt still builds and that no placeholder was disturbed.

- [ ] **Step 6: Re-pin if the author prompt is ratcheted, then commit**

```bash
grep -n "author" tests/prompt-size.test.ts
```

If a constant covers it, re-pin it **up** to the newly measured size with a dated note naming what bought the increase. Then:

```bash
npm test && npm run build
git add src/llm/prompts/author-v1.md tests/author-rules.test.ts tests/prompt-size.test.ts
git commit -m "The author learns the two keys the last two rounds added

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The revise card covers the notation it round-trips

Design §4.3. `revise-v1.md` is the only prompt that teaches the script notation, and four constructs the scanner accepts are missing from it: `(@ … @)` inline action spans (inline-timing round, 09-19), `A:`/`B:` dialogue lines, `@label` gotos, and the page settings `voice:`, `record:`, `canvas:`, `zoom_from:`. A document using any of them is handed to a model under the instruction *"every id and every number comes back exactly as it went in."*

**Files:**
- Modify: `src/llm/prompts/revise-v1.md`
- Modify: `tests/revise.test.ts`, `tests/prompt-size.test.ts:431`

**Interfaces:**
- Consumes: nothing.
- Produces: no code interface — prompt text only.

- [ ] **Step 1: Write the failing test**

In `tests/revise.test.ts`:

```ts
// The revise card is the ONLY prompt that teaches the script notation, and a
// revision is told to return every other beat byte-for-byte. A construct the
// scanner accepts but the card never mentions is a construct the model is
// asked to preserve without having been told it exists. Design §4.3.
test("the revise card covers every construct the scanner accepts", () => {
  // REVISE_PROMPT_SOURCE is already imported at the top of this file.
  expect(REVISE_PROMPT_SOURCE).toContain("(@");      // inline action spans
  expect(REVISE_PROMPT_SOURCE).toContain("@)");
  expect(REVISE_PROMPT_SOURCE).toContain("`A:`");    // dialogue lines
  expect(REVISE_PROMPT_SOURCE).toContain("`@name`"); // goto lines
});

// The closed list in the scanner and the closed list in the card must not
// drift apart — the card is the only place a model learns either.
test("every SETTING_KEYS entry appears in the revise card", () => {
  // Backtick + key + colon, so `vars: {json}` and `use: <template>` count as
  // well as a bare `gap:` — the card writes some of them with their value
  // shape inside the same span.
  const missing = SETTING_KEYS.filter((k) => !REVISE_PROMPT_SOURCE.includes(`\`${k}:`));
  expect(missing).toEqual([]);
});
```

`REVISE_PROMPT_SOURCE` is already imported at the top of `tests/revise.test.ts`; add `SETTING_KEYS`:

```ts
import { SETTING_KEYS } from "../src/spec/script/lines";
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/revise.test.ts
```

Expected: FAIL on `(@` and on the missing settings.

- [ ] **Step 3: Update the card**

In `src/llm/prompts/revise-v1.md`, extend the "How to read it, in full" list. Add after the **direction** bullet:

```
- **An action may sit INSIDE a spoken line**, wrapped in `(@ … @)`: `"This
  line (@point at.ref eq gesture circle@) is the equilibrium."` The span is
  not spoken — it marks the MOMENT in the sentence at which its action
  fires. Keep a span exactly where it sits; moving it retimes the beat.
- **A dialogue beat names its speaker** with `A:` or `B:` at the left margin:
  `A: So the gap IS the loss?`. A is the lead voice, B the second.
- **`@name` on its own line is a label** — the target a quiz, an ask or an
  `if` jumps to.
```

Extend the **Page settings** bullet to the full closed list:

```
- **Page settings** are `key: value` lines above the page's first beat, and
  the list is CLOSED — a spoken line may perfectly well begin "Kort sagt:",
  and only this list keeps that from being read as a setting: `lang:`,
  `voice:` (male/female), `level:`, `record:`, `canvas:`, `domain:`,
  `vars: {json}`, `text: {json}`, `zoom_from:`, `use: <template>` (the
  spec's `template`), `with: {json}` (its `params`), `chapter:`.
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/revise.test.ts && npm test
```

- [ ] **Step 5: Re-pin `BASELINE_REVISE_CHARS`, up**

The card rides in the **uncached tail**, so every revision pays it in full — the ratchet on it is real. Measure the new length and set `tests/prompt-size.test.ts:431` to it, appending to the comment:

```
// Re-pinned UP 2026-09-22: four constructs the scanner accepts but the card
// never named — inline `(@ … @)` action spans, `A:`/`B:` dialogue lines,
// `@name` gotos, and the closed SETTING_KEYS list (design 2026-09-22 §4.3).
// 4520 -> <MEASURED>. A revision was being told to return every beat
// unchanged while being shown a notation missing four of its spellings.
```

- [ ] **Step 6: Commit**

```bash
npm run build
git add src/llm/prompts/revise-v1.md tests/revise.test.ts tests/prompt-size.test.ts
git commit -m "The revise card teaches the whole notation it asks for back

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `blocking` gets a way in

Design §4.1. Taught in no prompt and no tag; used in **0 of 291** bundled example specs. Yet the schema's own `point` description says *"Combine with speak blocking:false to talk while pointing"* — advertising a spelling the prompt never gives. One clause on the `point` bullet closes it. (Do **not** add `voice`/`delivery` prose: §4 measured both as fully taught in `src/llm/tags.ts`, tag-gated on purpose.)

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md:70`
- Modify: `tests/prompt-size.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/prompt-size.test.ts`, beside the other coverage tests:

```ts
  // A command key the schema advertises must be reachable from the prose.
  // `blocking` was in neither the prompt nor tags.ts nor any of 291 bundled
  // specs, while the schema's `point` description told the model to combine
  // it with speak. Design §4.1.
  test("the prompt names blocking where the schema says to use it", () => {
    expect(system(false)).toContain('"blocking": false');
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/prompt-size.test.ts -t "blocking"
```

Expected: FAIL.

- [ ] **Step 3: Extend the `point` bullet**

In `src/llm/prompts/compiler-v1.md:70`, append one clause to the existing `point` line, keeping it a single line as the file's style requires:

```
Add `"blocking": false` to a standalone `speak` to start the line and go straight on to the next command — that is how you talk WHILE pointing, highlighting or drawing rather than before it.
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/prompt-size.test.ts -t "blocking"
```

- [ ] **Step 5: Re-pin `BASELINE_SYSTEM_CHARS`, up**

Measure and set, appending to the comment:

```
// Re-pinned UP 2026-09-22 for one clause on the point bullet: `"blocking":
// false` was named by the SCHEMA's point description and by nothing the
// model reads as prose — 0 of 291 bundled specs used it (design 2026-09-22
// §4.1). <PREVIOUS> -> <MEASURED>.
```

- [ ] **Step 6: Commit**

```bash
npm test && npm run build
git add src/llm/prompts/compiler-v1.md tests/prompt-size.test.ts
git commit -m "Talking while pointing gets a spelling the prompt gives

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Closing out

- [ ] **Measure what the round actually bought.** Reproduce the design §1 table on the finished branch and put the after-column into `ROADMAP.md`, retiring the "next slimming target" note at `ROADMAP.md:217`. State the real figure, whatever it is — if it came to 40,000 chars instead of 56,000, say 40,000.
- [ ] **Run the bench once more end to end:** `npm run selector:eval -- --router --gate 0.95`.
- [ ] **Hans's smoke test, in the live app, before this is called done:** one Norwegian request with the router on, one with a deliberately wrong API key so the router fails (the fallback path from Task 1), one code request, one sound request, and one revise of a document containing a code element (the Task 3 path that would otherwise validate a code element against a schema with none).
- [ ] **Widen the prompt-sync rule.** It currently covers `compiler-v1.md` + the schema description + a size re-pin. `author-v1.md` and `revise-v1.md` sit outside it, and §4.2 and §4.3 are exactly where the drift was. Add both files, and `src/llm/tags.ts` — §4's first pass mis-flagged two features as untaught because it did not read `tags.ts` as a prompt.

## Not in this plan

Read design §5 for the reasoning; in short:

- **`zoom_from`** — a pipeline gap, not a prompt gap. `multi.ts:262` writes every part in parallel, so part *i+1* cannot name an element of part *i*. Teaching it here would ship dangling ids.
- **Pruning the fewshots** (22,658 ch) — needs a live eval over real generations, not a reading.
- **Strategy B on the schema descriptions** (a further ~6 k) — buys characters by making the schema worse to read at the point of use.
- **The exemplar selector's Norwegian blind spot** — 0 of 251 bundled exemplars for a Norwegian topic request. A quality issue for whoever next touches the exemplar pool.
