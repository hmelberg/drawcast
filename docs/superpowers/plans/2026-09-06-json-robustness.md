# JSON Robustness in Course Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop course runs from dying on "invalid JSON" — keep structured output where the API accepts it, repair the one bad reply instead of failing the part, and make every remaining failure visible.

**Architecture:** All JSON-producing calls go through `callForJson` (src/llm/client.ts). Today one 400 for one schema disables structured output for every schema in the session, and a parse failure throws straight out of the call with no second chance. The fix lives almost entirely in that function: decide structured-output support per schema (a local check plus 400s learned per schema), reject a `max_tokens` cut-off with a clear message, and run ONE mechanical repair round on the repair model when the reply does not parse. The course-plan schema is closed so it stops triggering the 400. The course runner then reports a lecture with a missing part as failed instead of storing it silently.

**Tech Stack:** TypeScript, vitest, @anthropic-ai/sdk 0.110 (structured outputs via `output_config.format`).

**Spec:** The diagnosis in this session (2026-09-06), summarised at the top of this file's git commit and in the project memory. Measured facts: OUTLINE_SCHEMA is accepted by structured outputs; COURSE_SCHEMA is rejected (`context` is an open map); the spec schema is rejected (`params`/`animate` have `additionalProperties: true`). Opus 5 thinks by default and the thinking counts against `max_tokens` (measured 2688 output tokens for ~1150 tokens of text).

## Global Constraints

- No backwards-compatibility shims (no users yet): replace, do not migrate.
- `git add` only the files named in each task — another session has an uncommitted edit in `docs/superpowers/specs/2026-09-05-anatomy-design.md`; never `git add -A`.
- Tests run with `npx vitest run <file>`; the full suite with `npm test`.
- Structured outputs accept only `additionalProperties: false` on objects (API error text: "For 'object' type, 'additionalProperties: true' is not supported").

---

### Task 1: Structured-output support decided per schema

**Files:**
- Modify: `src/llm/client.ts:109-155`
- Test: `tests/json-robustness.test.ts` (create)

**Interfaces:**
- Produces: `export function structuredOutputSupported(schema: unknown): boolean` — true when every object node in the schema carries `additionalProperties: false`.
- Produces: module-private `brokenSchemas: Set<string>` keyed by `JSON.stringify(schema)`; `featureBroken.structuredOutput` is deleted.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/json-robustness.test.ts
import { describe, expect, test, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

import Anthropic from "@anthropic-ai/sdk";
import { callForJson, structuredOutputSupported } from "../src/llm/client";
import { OUTLINE_SCHEMA } from "../src/llm/outline";
import { apiSchema } from "../src/llm/compile";

interface Reply {
  text?: string;
  stop_reason?: string;
  /** Throw this instead of answering. */
  error?: Error;
}
interface Recorded {
  body: Record<string, unknown>;
}

/** A queue of replies: each stream() call consumes the next one. */
function queuedClient(replies: Reply[]): { client: Anthropic; recorded: Recorded[] } {
  const recorded: Recorded[] = [];
  const make = (body: Record<string, unknown>) => {
    recorded.push({ body });
    const reply = replies.shift() ?? { text: "{}" };
    const stream = {
      on: () => stream,
      async finalMessage() {
        if (reply.error) throw reply.error;
        return {
          model: body.model,
          stop_reason: reply.stop_reason ?? "end_turn",
          content: [{ type: "text", text: reply.text ?? "" }],
          usage: { input_tokens: 10, output_tokens: 20 },
        } as unknown as Anthropic.Message;
      },
    };
    return stream;
  };
  return { client: { messages: { stream: make }, beta: { messages: { stream: make } } } as unknown as Anthropic, recorded };
}

function schemaError(): Error {
  return new Anthropic.BadRequestError(
    400,
    { type: "error", error: { type: "invalid_request_error", message: "output_config.format.schema: For 'object' type, 'additionalProperties: true' is not supported." } },
    "output_config.format.schema: For 'object' type, 'additionalProperties: true' is not supported.",
    new Headers(),
  );
}

const CLOSED = { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false };
const OPEN = { type: "object", properties: { p: { type: "object", additionalProperties: true } }, additionalProperties: false };

describe("structuredOutputSupported", () => {
  test("accepts the outline schema", () => {
    expect(structuredOutputSupported(OUTLINE_SCHEMA)).toBe(true);
  });
  test("rejects the spec schema (open params)", () => {
    expect(structuredOutputSupported(apiSchema())).toBe(false);
  });
  test("rejects a map-typed additionalProperties", () => {
    expect(structuredOutputSupported({ type: "object", properties: { c: { type: "object", additionalProperties: { type: "string" } } }, additionalProperties: false })).toBe(false);
  });
});

describe("structured output is decided per schema", () => {
  test("a locally unsupported schema never sends output_config.format", async () => {
    const { client, recorded } = queuedClient([{ text: '{"p":{}}' }]);
    await callForJson(client, "claude-sonnet-5", "s", [{ role: "user", content: "u" }], OPEN);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].body.output_config).toBeUndefined();
  });

  test("a 400 for one schema does not degrade another", async () => {
    // Schema A: the API rejects it (unexpected shape); schema B keeps structured output.
    const A = { type: "object", properties: { x: { type: "string", format: "unknown-format" } }, additionalProperties: false };
    const { client, recorded } = queuedClient([{ error: schemaError() }, { text: '{"x":"1"}' }, { text: '{"a":"1"}' }]);
    await callForJson(client, "claude-sonnet-5", "s", [{ role: "user", content: "u" }], A);
    await callForJson(client, "claude-sonnet-5", "s", [{ role: "user", content: "u" }], CLOSED);
    expect(recorded).toHaveLength(3);
    expect(recorded[1].body.output_config).toBeUndefined(); // A retried plain
    expect((recorded[2].body.output_config as { format?: unknown }).format).toBeDefined(); // B still structured
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/json-robustness.test.ts`
Expected: FAIL — `structuredOutputSupported` is not exported; the per-schema test fails because the global flag disables B.

- [ ] **Step 3: Implement**

In `src/llm/client.ts`, replace the `featureBroken` block and the attempt loop's schema decision:

```typescript
/**
 * The API's structured-output grammar accepts only `additionalProperties:
 * false` on objects. Anything else (true, a map schema, or omitted) is a 400
 * — so check locally and never spend a round trip on a schema that cannot
 * work. The spec schema fails this (open `params`); the outline and course
 * schemas pass.
 */
export function structuredOutputSupported(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null) return true;
  if (Array.isArray(schema)) return schema.every(structuredOutputSupported);
  const node = schema as Record<string, unknown>;
  const isObject = node.type === "object" || "properties" in node;
  if (isObject && node.additionalProperties !== false) return false;
  return Object.values(node).every(structuredOutputSupported);
}

// Learned per session, PER SCHEMA: a 400 for one schema must not degrade the
// calls that use another. The fallbacks beta is a per-key property, so that
// one stays global.
const brokenSchemas = new Set<string>();
let fallbacksBroken = false;
```

and in `callForJson`:

```typescript
  const schemaKey = JSON.stringify(outputSchema);
  const schemaUsable = structuredOutputSupported(outputSchema) && !brokenSchemas.has(schemaKey);
  ...
  for (let attempt = 0; attempt < 3 && !response; attempt++) {
    const useSchema = schemaUsable && !brokenSchemas.has(schemaKey) ? outputSchema : null;
    const useFallbacks = !fallbacksBroken;
    try { ... } catch (err) {
      ...
      if (useSchema && /output_config|format\.schema|json_schema/i.test(msg)) brokenSchemas.add(schemaKey);
      else if (useFallbacks && /fallback|beta/i.test(msg)) fallbacksBroken = true;
      else if (useSchema) brokenSchemas.add(schemaKey);
      else if (useFallbacks) fallbacksBroken = true;
      else throw err;
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/json-robustness.test.ts tests/streaming.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm/client.ts tests/json-robustness.test.ts
git commit -m "client: decide structured output per schema, not per session"
```

---

### Task 2: A reply cut off at max_tokens is an error, not a JSON error

**Files:**
- Modify: `src/llm/client.ts` (after the refusal check in `callForJson`)
- Test: `tests/json-robustness.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe("max_tokens", () => {
  test("a cut-off reply is reported as such, not as bad JSON", async () => {
    const { client } = queuedClient([{ text: '{"a":"1', stop_reason: "max_tokens" }]);
    await expect(callForJson(client, "claude-sonnet-5", "s", [{ role: "user", content: "u" }], CLOSED)).rejects.toThrow(/cut off/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/json-robustness.test.ts`; expected FAIL with a JSON parse message instead of /cut off/.

- [ ] **Step 3: Implement** — in `callForJson`, after the refusal check:

```typescript
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `The reply was cut off at the output limit (${response.usage?.output_tokens ?? "?"} tokens, thinking included) — try again, or ask for something smaller.`,
    );
  }
```

- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `git add src/llm/client.ts tests/json-robustness.test.ts && git commit -m "client: name a max_tokens cut-off instead of reporting bad JSON"`

---

### Task 3: One repair round for a reply that is not JSON

**Files:**
- Modify: `src/llm/client.ts` (parse step of `callForJson`; add `repairModelFor`, moved from compile.ts)
- Modify: `src/llm/compile.ts:139-141` (re-export `repairModelFor` from client)
- Test: `tests/json-robustness.test.ts`

**Interfaces:**
- Produces: `export function repairModelFor(model: string): string` in client.ts (compile.ts re-exports it, so `import { repairModelFor } from "./compile"` keeps working in author.ts/revise.ts and the tests).
- Produces: `JsonCallMeta.jsonRepaired?: boolean`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("invalid JSON gets one mechanical repair round", () => {
  test("the repaired reply is used", async () => {
    const { client, recorded } = queuedClient([{ text: 'Sure! {"a": "1",}' }, { text: '{"a":"1"}' }]);
    const { json, meta } = await callForJson(client, "claude-opus-5", "s", [{ role: "user", content: "u" }], OPEN);
    expect(json).toEqual({ a: "1" });
    expect(meta.jsonRepaired).toBe(true);
    expect(recorded).toHaveLength(2);
    const repair = recorded[1].body;
    expect(repair.model).toBe("claude-sonnet-5"); // mechanical → repair model
    expect((repair.output_config as { effort?: string }).effort).toBe("low");
    const msgs = repair.messages as { role: string; content: string }[];
    expect(msgs[msgs.length - 2]).toEqual({ role: "assistant", content: 'Sure! {"a": "1",}' });
    expect(msgs[msgs.length - 1].content).toMatch(/not valid JSON/);
  });

  test("a second bad reply fails with the parse error and the reply's head", async () => {
    const { client } = queuedClient([{ text: "no json here" }, { text: "still none" }]);
    await expect(callForJson(client, "claude-opus-5", "s", [{ role: "user", content: "u" }], OPEN)).rejects.toThrow(/not valid JSON.*still none/);
  });

  test("an empty reply is not sent back for repair", async () => {
    const { client, recorded } = queuedClient([{ text: "" }]);
    await expect(callForJson(client, "claude-opus-5", "s", [{ role: "user", content: "u" }], OPEN)).rejects.toThrow(/empty/);
    expect(recorded).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — expected: the first rejects with the parse error (no repair), `jsonRepaired` undefined.

- [ ] **Step 3: Implement** — in client.ts:

```typescript
/** Mechanical rounds (schema/lint/JSON repairs) run on the faster sibling of the creative model. */
export function repairModelFor(model: string): string {
  return opusTier(model) ? "claude-sonnet-5" : model;
}

function parseReply(raw: string, structured: boolean): unknown {
  return structured ? JSON.parse(raw) : extractJson(raw);
}
```

and replace `const json = structured ? JSON.parse(raw) : extractJson(raw);` with:

```typescript
  let json: unknown;
  let jsonRepaired = false;
  try {
    if (raw.trim() === "") throw new Error("the reply was empty");
    json = parseReply(raw, structured);
  } catch (firstErr) {
    if (raw.trim() === "") throw new Error("The model's reply was empty.");
    // One mechanical repair round: hand the bad reply back and ask for the
    // JSON alone. Same system prompt (cache hit), the repair model, low
    // effort, plain JSON — the grammar path is exactly what failed us.
    const fix = `That reply was not valid JSON (${(firstErr as Error).message}). Return ONLY the corrected JSON object — no prose, no code fences, newlines inside strings escaped as \\n.`;
    const retry = await createMessage(
      client,
      repairModelFor(model),
      system,
      [...messages, { role: "assistant", content: raw }, { role: "user", content: fix }],
      null,
      !fallbacksBroken,
      { ...opts, effort: "low" },
    );
    addAnthropicTokens((retry.usage?.input_tokens ?? 0) + (retry.usage?.output_tokens ?? 0));
    const raw2 = retry.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    try {
      json = extractJson(raw2);
    } catch (secondErr) {
      throw new Error(`The model's reply was not valid JSON even after a repair round (${(secondErr as Error).message}). The reply began: "${raw2.slice(0, 80)}"`);
    }
    jsonRepaired = true;
  }
```

Add `jsonRepaired?: boolean` to `JsonCallMeta` and `jsonRepaired` to the returned meta. In compile.ts delete the local `repairModelFor` and add `export { repairModelFor } from "./client";`.

- [ ] **Step 4: Run** `npx vitest run tests/json-robustness.test.ts tests/generate-loop.test.ts tests/revise-call.test.ts tests/latency.test.ts` — expected PASS.
- [ ] **Step 5: Commit** — `git add src/llm/client.ts src/llm/compile.ts tests/json-robustness.test.ts && git commit -m "client: one repair round when the reply is not JSON"`

---

### Task 4: Close the course-plan schema

**Files:**
- Modify: `src/course/plan.ts:15-20`
- Test: `tests/course-plan.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { structuredOutputSupported } from "../src/llm/client";
import { COURSE_SCHEMA } from "../src/course/plan";

describe("COURSE_SCHEMA", () => {
  it("is accepted by structured outputs (every object closed)", () => {
    expect(structuredOutputSupported(COURSE_SCHEMA)).toBe(true);
  });
  it("names the four shared-context keys the prompt asks for", () => {
    const ctx = (COURSE_SCHEMA.properties.context as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(ctx).sort()).toEqual(["example", "language", "level", "notation"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/course-plan.test.ts`
- [ ] **Step 3: Implement** — replace the `context` property:

```typescript
    context: {
      type: "object",
      description: "What every lecture shares. Omit a key you have nothing to say for.",
      properties: {
        level: { type: "string", description: "Who the course is for, e.g. \"master students in economics\"." },
        language: { type: "string", description: "The language the lectures are narrated in." },
        notation: { type: "string", description: "The symbols the whole course uses for its quantities." },
        example: { type: "string", description: "One running example every lecture returns to." },
      },
      additionalProperties: false,
    },
```

- [ ] **Step 4: Run** `npx vitest run tests/course-plan.test.ts` — PASS.
- [ ] **Step 5: Commit** — `git add src/course/plan.ts tests/course-plan.test.ts && git commit -m "course plan: close the context schema so structured output is accepted"`

---

### Task 5: A lecture with a missing part is a failed lecture

**Files:**
- Modify: `src/llm/multi.ts:21-29,89-108` (`PartsResult.errors`)
- Modify: `src/course/run.ts:244-274`
- Test: `tests/course-partial.test.ts` (create)

**Interfaces:**
- Produces: `PartsResult.errors?: string[]` — parallel to `failed`, the error of each failed part.
- Produces: `oneLine(text: string): string` (module-private in run.ts) — collapses whitespace, replaces "·", caps at 300 chars, so an error survives the status line.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/course-partial.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm/multi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/multi")>();
  return { ...actual, outlineParts: vi.fn(), generateFromOutline: vi.fn() };
});

import { generateFromOutline, outlineParts } from "../src/llm/multi";
import { parseCourse } from "../src/course/document";
import { runCourse, type RunHooks } from "../src/course/run";
import type { GenerateConfig, PromptVariant } from "../src/llm/compile";
import type { Spec } from "../src/spec/types";

const VARIANT: PromptVariant = { name: "t", source: "" };
const cfg: GenerateConfig = { apiKey: "k", model: "claude-opus-5", variant: VARIANT, exemplars: [] };
const hooks: RunHooks = { onLecture: () => {}, onProgress: () => {}, onDocument: () => {} };
const spec = (t: string): Spec => ({ title: t, elements: [], commands: [] }) as Spec;
const DOC = `# C\n\n## L1\nq\n#parts=3\n`;

beforeEach(() => {
  vi.mocked(outlineParts).mockReset();
  vi.mocked(generateFromOutline).mockReset();
  vi.mocked(outlineParts).mockResolvedValue({ outline: { title: "L1", parts: [{ title: "a", brief: "" }, { title: "b", brief: "" }, { title: "c", brief: "" }] } });
});

describe("runCourse with a part missing", () => {
  it("marks the lecture failed, names the part, and stores nothing", async () => {
    vi.mocked(generateFromOutline).mockResolvedValue({
      outline: null, specs: [spec("a"), spec("c")], chapterOf: [undefined, undefined],
      failed: [2], errors: ["Bad control character in string literal in JSON at position 54\n(line 1)"],
    });
    const store = vi.fn(() => "id");
    const result = await runCourse(DOC, cfg, hooks, store);
    expect(store).not.toHaveBeenCalled();
    expect(result.failed).toEqual([0]);
    const status = parseCourse(result.text).lectures[0].status;
    expect(status?.state).toBe("failed");
    expect(status?.error).toMatch(/part 2 of 3 failed/);
    expect(status?.error).toContain("Bad control character");
    expect(status?.error).not.toContain("\n");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/course-partial.test.ts`; expected: `store` was called, state "done".

- [ ] **Step 3: Implement**

multi.ts — collect errors beside the failed part numbers:

```typescript
  const errors: string[] = [];
  outcomes.forEach((outcome, i) => {
    if (!outcome.spec) {
      failed.push(i + 1);
      errors.push(outcome.error ?? "no spec");
      return;
    }
    ...
  });
  return { outline: plan, specs, chapterOf, failed, errors, error: specs.length === 0 ? (outcomes[0]?.error ?? "no spec") : undefined };
```

run.ts — one failure path for both "no specs" and "some specs":

```typescript
/** An error must fit on one status line: no newlines, no "·" (the line's separator), not endless. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").replace(/·/g, "-").trim().slice(0, 300);
}

/** Why a lecture failed, from its parts result — undefined when every part landed. */
export function partsFailure(result: PartsResult, parts: number): string | undefined {
  if (result.failed.length === 0 && result.specs.length > 0) return undefined;
  const first = result.errors?.[0] ?? result.error ?? "no spec";
  if (result.specs.length === 0) return oneLine(first);
  const which = result.failed.length === 1 ? `part ${result.failed[0]}` : `parts ${result.failed.join(", ")}`;
  return oneLine(`${which} of ${parts} failed — ${first}`);
}
```

and in Phase 2 replace `if (result.specs.length === 0) {` with:

```typescript
      const failure = partsFailure(result, plan.outline.parts.length);
      if (failure !== undefined) {
        failed.push(i);
        current = setLectureStatus(current, i, { state: "failed", error: failure, ts });
        hooks.onLecture(i, "failed");
      } else {
```

Also wrap the outline failure and the store failure errors in `oneLine(...)`.

- [ ] **Step 4: Run** `npx vitest run tests/course-partial.test.ts tests/course-run.test.ts tests/course-parallel.test.ts` — PASS.
- [ ] **Step 5: Commit** — `git add src/llm/multi.ts src/course/run.ts tests/course-partial.test.ts && git commit -m "course run: a lecture with a missing part is a failed lecture, and says which part"`

---

### Task 6: Full suite, build, push

- [ ] `npm test` — all green.
- [ ] `npm run build` — tsc clean.
- [ ] `git push origin main` (Netlify builds `npm test && npm run build` before deploying to drawcast.app).
