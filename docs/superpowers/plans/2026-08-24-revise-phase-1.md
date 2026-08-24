# Revise with AI — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Revise button beside Generate that sends the whole current document to the model with a change instruction and takes a whole document back, with session-only arrows to step through versions.

**Architecture:** Revise is a stateless call — the editor text goes in, a complete replacement document comes back — so single specs and multi-part playlists share one code path and hand-edits ride along. Two new pure modules (`src/history.ts`, `src/llm/revise.ts`) carry all the logic and all the tests; `main.ts` only wires them. Saving becomes automatic by giving `Doc` a stable id and reusing `saveDrawing`, which already replaces by id.

**Tech Stack:** TypeScript, Vite, vitest (`npx vitest run`), `@anthropic-ai/sdk` (BYOK, browser-direct), js-yaml.

**Spec:** `docs/superpowers/specs/2026-08-24-revise-and-history-design.md` — read §0 (phasing) first; §1, §3 storage shapes, and §5 are **phase 2 and must not be built**.

## Global Constraints

- Branch: `revise-and-history`. Do not merge to `main`.
- **No changes to `src/store.ts`.** Phase 1 needs none: `saveDrawing` already replaces by id (`store.ts:188`).
- Versions live in memory only. Nothing about versions goes into localStorage.
- Tests are `tests/*.test.ts`, vitest, run from the repo root. Pure modules must not import DOM APIs; use `heuristicMeasure` from `src/layout/measure.ts` as the default measure so tests run under node.
- Prompt variant files are globbed as `./prompts/compiler-*.md` (`compile.ts:24`). **Do not add a file matching that pattern** — it would appear in the user's prompt-variant picker.
- The full suite must pass before each commit: `npx vitest run`.
- Type check with `npx tsc --noEmit`.

---

### Task 1: The version stack (`src/history.ts`)

Pure, in-memory, append-only. Nothing here touches the DOM, localStorage, or the network.

**Files:**
- Create: `src/history.ts`
- Test: `tests/history.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Version`, `VersionKind`, `Stack`, `MAX_VERSIONS`, `emptyStack()`, `seedStack(text, label)`, `pushVersion(stack, entry)`, `pushManualEdit(stack, text, ts)`, `restoreViewed(stack, ts)`, `viewAt(stack, index)`, `currentVersion(stack)`, `atNewest(stack)`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/history.test.ts
import { describe, expect, test } from "vitest";
import {
  MAX_VERSIONS, atNewest, currentVersion, emptyStack, pushManualEdit,
  pushVersion, restoreViewed, seedStack, viewAt,
} from "../src/history";

const TS = "2026-08-24T10:00:00.000Z";

describe("pushVersion", () => {
  test("appends and leaves the cursor on the newest version", () => {
    let s = seedStack("a", "first");
    s = pushVersion(s, { text: "b", label: "second", kind: "revise", ts: TS });
    expect(s.versions.map((v) => v.text)).toEqual(["a", "b"]);
    expect(s.cursor).toBe(1);
    expect(atNewest(s)).toBe(true);
  });

  test("records `from` only when pushing from a version that is not the newest", () => {
    let s = seedStack("a", "first");
    s = pushVersion(s, { text: "b", label: "second", kind: "revise", ts: TS });
    expect(currentVersion(s)!.from).toBeUndefined();

    s = viewAt(s, 0);
    s = pushVersion(s, { text: "c", label: "third", kind: "revise", ts: TS });
    expect(currentVersion(s)!.from).toBe("first");
    expect(s.versions).toHaveLength(3); // nothing was truncated
  });

  test("drops the oldest version past the cap, keeping the cursor newest", () => {
    let s = seedStack("v0", "v0");
    for (let i = 1; i <= MAX_VERSIONS + 3; i++) {
      s = pushVersion(s, { text: `v${i}`, label: `v${i}`, kind: "revise", ts: TS });
    }
    expect(s.versions).toHaveLength(MAX_VERSIONS);
    expect(s.versions[0].text).toBe(`v${MAX_VERSIONS + 3 - MAX_VERSIONS + 1}`);
    expect(currentVersion(s)!.text).toBe(`v${MAX_VERSIONS + 3}`);
    expect(s.cursor).toBe(MAX_VERSIONS - 1);
  });
});

describe("pushManualEdit", () => {
  test("coalesces consecutive manual edits into one version", () => {
    let s = seedStack("a", "first");
    s = pushManualEdit(s, "b", TS);
    s = pushManualEdit(s, "c", "2026-08-24T10:05:00.000Z");
    expect(s.versions).toHaveLength(2);
    expect(currentVersion(s)!.text).toBe("c");
    expect(currentVersion(s)!.ts).toBe("2026-08-24T10:05:00.000Z");
  });

  test("does not coalesce when an AI version intervened", () => {
    let s = seedStack("a", "first");
    s = pushManualEdit(s, "b", TS);
    s = pushVersion(s, { text: "c", label: "steeper", kind: "revise", ts: TS });
    s = pushManualEdit(s, "d", TS);
    expect(s.versions).toHaveLength(4);
  });

  test("does not coalesce when the cursor is not on the newest version", () => {
    let s = seedStack("a", "first");
    s = pushManualEdit(s, "b", TS);
    s = viewAt(s, 0);
    s = pushManualEdit(s, "c", TS);
    expect(s.versions).toHaveLength(3);
    expect(currentVersion(s)!.from).toBe("first");
  });
});

describe("restoreViewed", () => {
  test("appends a copy of the viewed version and keeps every earlier one", () => {
    let s = seedStack("a", "first");
    s = pushVersion(s, { text: "b", label: "second", kind: "revise", ts: TS });
    s = viewAt(s, 0);
    s = restoreViewed(s, TS);
    expect(s.versions.map((v) => v.text)).toEqual(["a", "b", "a"]);
    expect(currentVersion(s)!.label).toBe('restored "first"');
    expect(currentVersion(s)!.from).toBeUndefined(); // the label already names the parent
    expect(atNewest(s)).toBe(true);
  });
});

describe("viewAt", () => {
  test("clamps out-of-range indices", () => {
    let s = seedStack("a", "first");
    s = pushVersion(s, { text: "b", label: "second", kind: "revise", ts: TS });
    expect(viewAt(s, -5).cursor).toBe(0);
    expect(viewAt(s, 99).cursor).toBe(1);
  });

  test("an empty stack has no current version and reports newest", () => {
    const s = emptyStack();
    expect(currentVersion(s)).toBeNull();
    expect(atNewest(s)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/history.test.ts`
Expected: FAIL — `Failed to resolve import "../src/history"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/history.ts
// The version stack behind the editor's ◀ ▶ arrows. Append-only by design:
// restoring an older version pushes a COPY rather than rewinding into it, so no
// user action ever removes a version and there is nothing to confirm. The only
// thing that drops a version is the age-based cap below.
//
// Phase 1 keeps this in memory only — versions are gone on reload. See
// docs/superpowers/specs/2026-08-24-revise-and-history-design.md §0.

export type VersionKind = "loaded" | "generate" | "revise" | "manual" | "restore";

export interface Version {
  /** The serialized document — exactly what the editor textarea holds. */
  text: string;
  label: string;
  kind: VersionKind;
  /** The parent's LABEL, set only when this version derived from a non-newest one. */
  from?: string;
  ts: string;
}

export interface Stack {
  versions: Version[];
  /** View cursor into `versions`; -1 only when the stack is empty. */
  cursor: number;
}

export const MAX_VERSIONS = 20;

export function emptyStack(): Stack {
  return { versions: [], cursor: -1 };
}

/** Reset to a single baseline version — a fresh generation, or a document just loaded. */
export function seedStack(text: string, label: string, kind: VersionKind = "loaded"): Stack {
  return { versions: [{ text, label, kind, ts: new Date().toISOString() }], cursor: 0 };
}

export function currentVersion(stack: Stack): Version | null {
  return stack.versions[stack.cursor] ?? null;
}

/** True when the cursor sits on the newest version — i.e. normal editing, not viewing. */
export function atNewest(stack: Stack): boolean {
  return stack.cursor === stack.versions.length - 1;
}

export function viewAt(stack: Stack, index: number): Stack {
  if (stack.versions.length === 0) return stack;
  const cursor = Math.min(Math.max(index, 0), stack.versions.length - 1);
  return { ...stack, cursor };
}

/**
 * Append a version. When the cursor is parked on an older version, the new one
 * records where it came from — a "restore" never does, because its own label
 * already names the parent and saying it twice reads as noise.
 */
export function pushVersion(stack: Stack, entry: Omit<Version, "from">): Stack {
  const parent = atNewest(stack) || entry.kind === "restore" ? undefined : currentVersion(stack)?.label;
  const versions = [...stack.versions, { ...entry, ...(parent ? { from: parent } : {}) }];
  // Age-based eviction, and the ONLY thing that removes a version.
  const trimmed = versions.length > MAX_VERSIONS ? versions.slice(versions.length - MAX_VERSIONS) : versions;
  return { versions: trimmed, cursor: trimmed.length - 1 };
}

/**
 * Hand-edits arrive as a stream with no natural boundary, so a run of them
 * collapses into ONE version whose timestamp refreshes; the next AI action seals
 * it. Without this the arrows fill with identical "manual edit" steps and push
 * the real revisions off the end.
 */
export function pushManualEdit(stack: Stack, text: string, ts: string): Stack {
  const newest = stack.versions[stack.versions.length - 1];
  if (newest && newest.kind === "manual" && atNewest(stack)) {
    const versions = [...stack.versions];
    versions[versions.length - 1] = { ...newest, text, ts };
    return { versions, cursor: versions.length - 1 };
  }
  return pushVersion(stack, { text, label: "manual edit", kind: "manual", ts });
}

/** Append a copy of the version being viewed. Never rewinds, never deletes. */
export function restoreViewed(stack: Stack, ts: string): Stack {
  const viewed = currentVersion(stack);
  if (!viewed) return stack;
  return pushVersion(stack, { text: viewed.text, label: `restored "${viewed.label}"`, kind: "restore", ts });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/history.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Type check and commit**

```bash
npx tsc --noEmit
git add src/history.ts tests/history.test.ts
git commit -m "Add the append-only version stack behind the editor arrows"
```

---

### Task 2: Revise message building and reply reading (`src/llm/revise.ts`, pure half)

**Files:**
- Create: `src/llm/revise.ts`
- Test: `tests/revise.test.ts`

**Interfaces:**
- Consumes: `parsePlaylistText`, `itemsOf`, `type Playlist` from `../playlist/playlist`; `stripFence` from `./prompt`; `validateSpec` from `../spec/schema`; `layoutSpec` from `../layout/layout`; `heuristicMeasure`, `type MeasureFn` from `../layout/measure`; `type LintIssue` from `../lint/lint`.
- Produces: `buildReviseUser(docText, instruction): string`, `parseReviseReply(text): { playlist: Playlist | null; error?: string }`, `checkPlaylist(playlist, measure?): { errors: string[]; lintIssues: LintIssue[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/revise.test.ts
import { describe, expect, test } from "vitest";
import { buildReviseUser, checkPlaylist, parseReviseReply } from "../src/llm/revise";

const SPEC_YAML = `title: A line
domain: { x: [0, 100], y: [0, 100] }
elements:
  - { id: ax, type: axes, x_label: x, y_label: y }
  - { id: c1, type: curve, expr: 50 }
commands:
  - { draw: [ax, c1] }
`;

describe("buildReviseUser", () => {
  test("carries the document and the instruction, and demands a complete document", () => {
    const user = buildReviseUser(SPEC_YAML, "make the curve steeper");
    expect(user).toContain(SPEC_YAML);
    expect(user).toContain("make the curve steeper");
    expect(user).toContain("COMPLETE document");
  });
});

describe("parseReviseReply", () => {
  test("strips a fenced reply", () => {
    const { playlist, error } = parseReviseReply("```yaml\n" + SPEC_YAML + "```");
    expect(error).toBeUndefined();
    expect(playlist!.entries).toHaveLength(1);
  });

  test("reads a multi-document stream, keeping the header and chapters", () => {
    const stream = `playlist:\n  title: Two parts\n---\nchapter: Part one\n---\n${SPEC_YAML}---\n${SPEC_YAML}`;
    const { playlist } = parseReviseReply(stream);
    expect(playlist!.meta.title).toBe("Two parts");
    expect(playlist!.entries.filter((e) => e.kind === "chapter")).toHaveLength(1);
    expect(playlist!.entries.filter((e) => e.kind === "item")).toHaveLength(2);
  });

  test("reports a reply that is not a document at all", () => {
    const { playlist, error } = parseReviseReply("Sure! I'd be happy to help with that.");
    expect(playlist).toBeNull();
    expect(error).toMatch(/not a readable document/);
  });
});

describe("checkPlaylist", () => {
  test("a valid single spec produces no errors", () => {
    const { playlist } = parseReviseReply(SPEC_YAML);
    expect(checkPlaylist(playlist!).errors).toEqual([]);
  });

  test("names the failing item by number when there is more than one", () => {
    // `elements` must be an array — a scalar fails the schema outright, so this
    // test does not depend on whether empty arrays happen to be legal.
    const bad = "title: Broken\nelements: not-an-array\ncommands: []\n";
    const { playlist } = parseReviseReply(`${SPEC_YAML}---\n${bad}`);
    const { errors } = checkPlaylist(playlist!);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/^item 2: /);
  });

  test("a single-item playlist reports errors without an item prefix", () => {
    const { playlist } = parseReviseReply("title: Broken\nelements: not-an-array\ncommands: []\n");
    const { errors } = checkPlaylist(playlist!);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).not.toMatch(/^item /);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/revise.test.ts`
Expected: FAIL — `Failed to resolve import "../src/llm/revise"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/llm/revise.ts
// Revising an existing drawcast: the whole editor document goes out, a whole
// replacement document comes back. Text in, text out — so a single spec and a
// multi-document playlist are ONE path, hand-edits in the textarea ride along,
// and the model can add, drop, reorder and retitle parts rather than only edit
// the ones already there.
//
// Deliberately not a continued conversation: a stateless call also works on a
// document loaded from the library, a bundled example, or a #gdoc= share, and
// its cost does not grow every round.

import { itemsOf, parsePlaylistText, type Playlist } from "../playlist/playlist";
import { stripFence } from "./prompt";
import { validateSpec } from "../spec/schema";
import { layoutSpec } from "../layout/layout";
import { heuristicMeasure, type MeasureFn } from "../layout/measure";
import type { LintIssue } from "../lint/lint";

export function buildReviseUser(docText: string, instruction: string): string {
  return [
    "Here is the current drawcast document:",
    "```yaml",
    docText,
    "```",
    "",
    `Apply this change: ${instruction}`,
    "",
    "Return the COMPLETE document in the same shape it came in — one document, or a `---` separated multi-document stream if it already is one.",
    "Change only what the instruction asks for and leave everything else as it is.",
    "Return the document only, with no commentary before or after it.",
  ].join("\n");
}

export function parseReviseReply(text: string): { playlist: Playlist | null; error?: string } {
  try {
    return { playlist: parsePlaylistText(stripFence(text)) };
  } catch (err) {
    return { playlist: null, error: `the reply is not a readable document: ${(err as Error).message}` };
  }
}

/**
 * Validate and lint EVERY item. Errors are prefixed with the item number only
 * when there is more than one — a single-spec document should not be told about
 * "item 1".
 */
export function checkPlaylist(playlist: Playlist, measure: MeasureFn = heuristicMeasure): { errors: string[]; lintIssues: LintIssue[] } {
  const items = itemsOf(playlist);
  if (items.length === 0) return { errors: ["the document has no drawable items"], lintIssues: [] };
  const errors: string[] = [];
  const lintIssues: LintIssue[] = [];
  for (const item of items) {
    const where = items.length > 1 ? `item ${item.index + 1}: ` : "";
    const v = validateSpec(item.spec);
    if (!v.ok) {
      errors.push(...v.errors.map((e) => `${where}${e}`));
      continue;
    }
    try {
      lintIssues.push(...layoutSpec(item.spec, measure).issues);
    } catch (err) {
      errors.push(`${where}layout failed: ${(err as Error).message}`);
    }
  }
  return { errors, lintIssues };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/revise.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Type check and commit**

```bash
npx tsc --noEmit
git add src/llm/revise.ts tests/revise.test.ts
git commit -m "Build and read the revise exchange: whole document out, whole document back"
```

---

### Task 3: The revise call and its repair loop

Mirrors `generateSpec`'s shape (`src/llm/compile.ts:168-315`): call, validate, feed the failures back, capped.

**Files:**
- Modify: `src/llm/compile.ts` — export `apiSchema` (currently a private function at line 42)
- Modify: `src/llm/revise.ts`
- Test: `tests/revise-call.test.ts`

**Interfaces:**
- Consumes: Task 2's `buildReviseUser`, `parseReviseReply`, `checkPlaylist`; `callForText`, `describeApiError`, `makeClient` from `./client`; `apiSchema`, `fewshotsText`, `needsRepair`, `repairModelFor`, `type PromptVariant` from `./compile`; `buildSystemBlocks` from `./prompt`; `catalogParts` from `../scenes/catalog`; `ensureEnginesForTemplate` from `../scenes/engines`; `lintReportText` from `../lint/lint`.
- Produces: `ReviseConfig`, `ReviseRound`, `ReviseOutcome`, `reviseDocument(docText, instruction, cfg): Promise<ReviseOutcome>`.

- [ ] **Step 1: Export `apiSchema` from `compile.ts`**

In `src/llm/compile.ts` line 42, change:

```ts
/** Schema copy for the API's structured-output constraint. */
function apiSchema(): object {
```

to:

```ts
/** Schema copy for the API's structured-output constraint, and for the prompt's {{SCHEMA}}. */
export function apiSchema(): object {
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/revise-call.test.ts
import { beforeEach, describe, expect, test, vi } from "vitest";

const calls: { model: string; system: unknown; messages: { role: string; content: unknown }[] }[] = [];
let replies: string[] = [];

vi.mock("../src/llm/client", async () => {
  const actual = await vi.importActual<typeof import("../src/llm/client")>("../src/llm/client");
  return {
    ...actual,
    makeClient: () => ({}) as never,
    callForText: (_c: unknown, model: string, system: unknown, messages: never[]) => {
      calls.push({ model, system, messages });
      return Promise.resolve({ text: replies.shift() ?? "", ms: 1 });
    },
  };
});

import { reviseDocument } from "../src/llm/revise";
import { promptVariants } from "../src/llm/compile";

const GOOD = `title: A line
domain: { x: [0, 100], y: [0, 100] }
elements:
  - { id: ax, type: axes, x_label: x, y_label: y }
  - { id: c1, type: curve, expr: 50 }
commands:
  - { draw: [ax, c1] }
`;
const BROKEN = "title: Broken\nelements: not-an-array\ncommands: []\n";

const cfg = () => ({ apiKey: "k", model: "claude-opus-5", variant: promptVariants()[0] });

/** The system blocks are TextBlockParam[]; flatten them for assertions. */
const systemText = (i: number) => (calls[i].system as { text: string }[]).map((b) => b.text).join("\n");

beforeEach(() => {
  calls.length = 0;
  replies = [];
});

describe("reviseDocument", () => {
  test("a clean reply returns the playlist in one round", async () => {
    replies = [GOOD];
    const out = await reviseDocument(GOOD, "make the curve steeper", cfg());
    expect(out.error).toBeUndefined();
    expect(out.playlist!.entries).toHaveLength(1);
    expect(out.rounds).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test("sends the document and the instruction in the user message", async () => {
    replies = [GOOD];
    await reviseDocument(GOOD, "make the curve steeper", cfg());
    expect(String(calls[0].messages[0].content)).toContain("make the curve steeper");
    expect(String(calls[0].messages[0].content)).toContain("id: c1");
  });

  test("repairs an invalid reply, naming the failure, on the faster model", async () => {
    replies = [BROKEN, GOOD];
    const out = await reviseDocument(GOOD, "steeper", cfg());
    expect(out.error).toBeUndefined();
    expect(out.rounds).toHaveLength(2);
    expect(calls[0].model).toBe("claude-opus-5");
    expect(calls[1].model).toBe("claude-sonnet-5"); // repairModelFor drops the Opus tier
    expect(String(calls[1].messages[2].content)).toMatch(/failed validation/);
  });

  test("gives up after maxRepairs and reports why", async () => {
    replies = [BROKEN, BROKEN, BROKEN];
    const out = await reviseDocument(GOOD, "steeper", { ...cfg(), maxRepairs: 1 });
    expect(out.playlist).toBeNull();
    expect(out.error).toBeTruthy();
    expect(out.rounds).toHaveLength(2);
  });

  test("gives templates already in the document a full catalog entry", async () => {
    replies = [GOOD];
    await reviseDocument("template: supply_demand\nparams: {}\ncommands: []\n", "shift demand", cfg());
    expect(systemText(0)).toContain("Scene template: supply_demand");
  });

  test("an unreadable document is refused before any API call", async () => {
    const out = await reviseDocument("::: not a document :::", "steeper", cfg());
    expect(out.error).toMatch(/current document/);
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/revise-call.test.ts`
Expected: FAIL — `reviseDocument is not a function`.

- [ ] **Step 4: Append the implementation to `src/llm/revise.ts`**

```ts
// --- appended to src/llm/revise.ts ---

import type Anthropic from "@anthropic-ai/sdk";
import { callForText, describeApiError, makeClient } from "./client";
import { apiSchema, fewshotsText, needsRepair, repairModelFor, type PromptVariant } from "./compile";
import { buildSystemBlocks } from "./prompt";
import { catalogParts } from "../scenes/catalog";
import { ensureEnginesForTemplate } from "../scenes/engines";
import { lintReportText } from "../lint/lint";

export interface ReviseConfig {
  apiKey: string;
  model: string;
  /** The active compiler prompt — the same one Generate uses, so the cached prefix is reused. */
  variant: PromptVariant;
  /** Priority packs from settings; templates in the document are added automatically. */
  priorityIds?: string[];
  maxRepairs?: number;
}

export interface ReviseRound {
  label: "initial" | "repair";
  text: string;
  errors: string[];
  lintIssues: LintIssue[];
  ms: number;
}

export interface ReviseOutcome {
  playlist: Playlist | null;
  /** The accepted document text, exactly as returned (fence stripped). */
  text: string | null;
  rounds: ReviseRound[];
  error?: string;
}

/** Template ids used anywhere in the document — they need FULL catalog entries, not index stubs. */
function templatesIn(playlist: Playlist): string[] {
  return [...new Set(itemsOf(playlist).map((i) => i.spec.template).filter((t): t is string => !!t))];
}

export async function reviseDocument(docText: string, instruction: string, cfg: ReviseConfig): Promise<ReviseOutcome> {
  const parsedNow = parseReviseReply(docText);
  if (!parsedNow.playlist) {
    return { playlist: null, text: null, rounds: [], error: `the current document is unreadable: ${parsedNow.error}` };
  }

  // Same system blocks as generation, including the cache_control prefix, so a
  // revise right after a generate reuses the warm ~10k-token cached prompt.
  // Exemplars are deliberately empty: pickExemplars teaches request -> spec
  // authoring, and a revision already has a spec in front of it.
  const priorityIds = [...new Set([...(cfg.priorityIds ?? []), ...templatesIn(parsedNow.playlist)])];
  const catalog = catalogParts({ request: instruction, priorityIds });
  const blocks = buildSystemBlocks(cfg.variant.source, {
    schema: apiSchema(),
    catalog: catalog.stable,
    fewshots: fewshotsText(),
    exemplars: "",
  });
  const suffixText = blocks.suffix + (catalog.variable ? "\n\n" + catalog.variable : "");
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: blocks.prefix, cache_control: { type: "ephemeral" } },
    ...(suffixText ? [{ type: "text" as const, text: suffixText }] : []),
  ];

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildReviseUser(docText, instruction) }];
  const rounds: ReviseRound[] = [];
  const maxRepairs = cfg.maxRepairs ?? 2;
  let repairsUsed = 0;
  let best: { playlist: Playlist; text: string } | null = null;
  const client = makeClient(cfg.apiKey);

  try {
    while (true) {
      const label: ReviseRound["label"] = rounds.length === 0 ? "initial" : "repair";
      const model = label === "initial" ? cfg.model : repairModelFor(cfg.model);
      const { text: raw, ms } = await callForText(client, model, system, messages);
      const cleaned = stripFence(raw);
      const parsed = parseReviseReply(raw);

      let errors: string[] = [];
      let lintIssues: LintIssue[] = [];
      if (!parsed.playlist) {
        errors = [parsed.error!];
      } else {
        // Engines must be loaded before layout — layoutSpec reads them synchronously.
        for (const id of templatesIn(parsed.playlist)) {
          await ensureEnginesForTemplate(id).catch((err) => {
            errors.push(`engine load failed for "${id}": ${(err as Error).message}`);
          });
        }
        const checked = checkPlaylist(parsed.playlist);
        errors = [...errors, ...checked.errors];
        lintIssues = checked.lintIssues;
        if (errors.length === 0) best = { playlist: parsed.playlist, text: cleaned };
      }
      rounds.push({ label, text: cleaned, errors, lintIssues, ms });

      if (!needsRepair(errors, lintIssues) || repairsUsed >= maxRepairs) break;
      repairsUsed++;

      const lintErrors = lintIssues.filter((i) => i.severity === "error");
      const feedback =
        errors.length > 0
          ? `The revised document failed validation:\n${errors.join("\n")}\n\nReturn the corrected COMPLETE document, in the same shape.`
          : `The revised figure has visual problems:\n${lintReportText(lintErrors)}\n\nReturn the corrected COMPLETE document, in the same shape. Typical fixes: different label sides, shorter texts, fewer overlapping elements.`;
      messages.push({ role: "assistant", content: raw }, { role: "user", content: feedback });
    }
  } catch (err) {
    return { playlist: best?.playlist ?? null, text: best?.text ?? null, rounds, error: describeApiError(err) };
  }

  return {
    playlist: best?.playlist ?? null,
    text: best?.text ?? null,
    rounds,
    error: best ? undefined : (rounds[rounds.length - 1]?.errors[0] ?? "The model never produced a usable document."),
  };
}
```

All the names this appended code needs from Task 2 — `LintIssue`, `Playlist`, `itemsOf`, `stripFence`, `buildReviseUser`, `parseReviseReply`, `checkPlaylist` — are already imported or defined at the top of `src/llm/revise.ts`. Merge the new `import` lines above into that existing import block rather than leaving a second block mid-file.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/revise-call.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the full suite, type check, commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/llm/revise.ts src/llm/compile.ts tests/revise-call.test.ts
git commit -m "Call the model to revise a document, repairing what comes back"
```

---

### Task 4: Stable `Doc.id` and automatic saving

Saving stops being a chore. `saveDrawing` already replaces by id (`store.ts:188`), so a stable id is the whole mechanism.

**Files:**
- Modify: `src/main.ts` — `Doc` (line 127), `initialDoc` (230), `docFromSaved` (219), `setDoc` (1389), `rerenderBtn` handler (1730), `saveBtn` (471, 700, 1771)
- Test: manual gate (this is DOM wiring; the logic it depends on is already covered)

**Interfaces:**
- Consumes: `saveDrawing`, `loadLibrary` from `./store` (already imported).
- Produces: `Doc.id: string | null`, `autosave(): void`.

- [ ] **Step 1: Give `Doc` an id**

In `src/main.ts` line 127:

```ts
interface Doc {
  /** The library entry this document belongs to; null until the first change (copy-on-write). */
  id: string | null;
  title: string;
  prompt?: string;
  playlist: Playlist;
}
```

Then fix the constructors:
- `docFromSaved(saved)` (line 219) — add `id: saved.id`.
- `initialDoc()` (line 230) — the `docFromSaved(saved)` branch already carries an id; the bundled-example branch gets `id: null` (an untouched example is not yours until you change it).
- Every other `setDoc({ … })` literal in the file gets an explicit `id`: generation results and the blank document get `id: null`, so the first save mints one.

- [ ] **Step 2: Add `autosave`, next to `setDoc`**

```ts
/**
 * Copy-on-write persistence: the first change to a document mints its library
 * id, and every later change replaces that same entry (saveDrawing filters by
 * id before unshifting). Loading an example or a share saves nothing until you
 * change it.
 */
function autosave(): void {
  doc.id ??= crypto.randomUUID();
  saveDrawing({
    id: doc.id,
    title: doc.title,
    prompt: doc.prompt,
    spec: firstSpec(doc),
    playlist: isSingle(doc.playlist) ? undefined : formatPlaylist(doc.playlist, "yaml"),
    ts: new Date().toISOString(),
  });
  refreshLibrary();
}
```

- [ ] **Step 3: Call it from every place the document changes**

- At the end of `generate()`'s success path, after `setDoc(...)` — `autosave()`.
- At the end of `generateMulti()`'s success path, after `setDoc(...)` — `autosave()`.
- In the `rerenderBtn` handler (line 1730), after `doc = { … }` — `autosave()`.

- [ ] **Step 4: Remove the now-redundant Save button**

- Delete the `saveBtn` declaration (line 471), its entry in the `pane-bar` (line 700), and its click listener (lines 1771-1783).
- Remove `saveDrawing` from the "save" path only — it is still imported for `autosave`.

- [ ] **Step 5: Verify by hand**

```bash
npm run dev
```

Expected, with the sidebar Library panel open:
1. Generate a drawcast → exactly **one** new entry appears.
2. Edit the spec text, press `↻ Re-render` twice → still exactly **one** entry, title unchanged.
3. Reload the page → the drawcast is still there and still one entry.
4. Open a bundled example without touching it → **no** new entry.
5. `💾 Save` is gone from the spec pane bar.

- [ ] **Step 6: Full suite, type check, commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/main.ts
git commit -m "Save every change automatically, replacing the entry instead of piling up copies"
```

---

### Task 5: The Revise button and action

**Files:**
- Modify: `src/main.ts` — gen-row (line 684), editor actions (~1530-1584), `setDoc` (1389), `rerenderBtn` handler (1730)
- Test: manual gate

**Interfaces:**
- Consumes: Task 1's stack functions; Task 3's `reviseDocument`; existing `requireKey`, `setStatus`, `readPlaylistText`, `docTitleOf`, `refreshChips`, `currentVariant`, `packTemplateIds`.
- Produces: `stack` module-level state, `reviseBtn`, `revise(): Promise<void>`, `applyHistoryUi(): void` (fleshed out in Task 6).

- [ ] **Step 1: Add the button and the stack state**

Next to `generateBtn` (line 289):

```ts
const reviseBtn = h("button", { class: "primary", title: "Change the current drawcast with AI" }, "Revise with AI");
```

Put it in the gen-row (line 684): `h("div", { class: "row gen-row" }, choicesBtn, histNav, generateBtn, reviseBtn)` — `histNav` arrives in Task 6; use `h("span")` as a placeholder until then.

Beside `let doc: Doc = initialDoc();` (line 133):

```ts
import { atNewest, currentVersion, emptyStack, pushManualEdit, pushVersion, restoreViewed, seedStack, viewAt, type Stack } from "./history";

let stack: Stack = emptyStack();
/** Set while an arrow step is being applied, so restoring a version does not record a manual edit. */
let restoring = false;
```

- [ ] **Step 2: Seed and push the stack wherever the document changes**

In `setDoc` (line 1389), after `specArea.value = …`, seed a fresh baseline — a new document starts a new history:

```ts
function setDoc(next: Doc, statusText?: string, version?: { label: string; kind: "generate" | "revise" }): void {
  doc = next;
  lastLogId = null;
  specArea.value = formatPlaylist(doc.playlist, settings.specFormat);
  if (version) stack = pushVersion(stack, { text: specArea.value, label: version.label, kind: version.kind, ts: new Date().toISOString() });
  else stack = seedStack(specArea.value, doc.prompt ?? doc.title);
  applyHistoryUi();
  // …the rest of the existing body, unchanged…
}
```

`generate()` and `generateMulti()` pass `{ label: rawRequest, kind: "generate" }`; `revise()` passes `{ label, kind: "revise" }`. Every other caller (library load, blank, gdoc) passes nothing and gets a fresh single-version baseline, which is correct — a document you just opened has no history yet.

In the `rerenderBtn` handler (line 1730), after `doc = { … }`:

```ts
if (!restoring) stack = pushManualEdit(stack, specArea.value, new Date().toISOString());
applyHistoryUi();
```

- [ ] **Step 3: Write `revise()`**

Place it directly after `generate()` (line 1584):

```ts
async function revise(): Promise<void> {
  const instruction = promptEl.value.trim();
  if (!instruction) {
    setStatus("Describe the change you want, then press Revise.", "error");
    return;
  }
  const apiKey = requireKey();
  if (!apiKey) return;
  // The TEXTAREA is the source, not `doc` — hand-edits you have not re-rendered
  // still ride along into the revision, so the label must not pretend otherwise.
  const docText = specArea.value;
  const dirty = docText !== currentVersion(stack)?.text;
  const label = dirty ? `${instruction} (+ manual edits)` : instruction;

  reviseBtn.disabled = true;
  try {
    setStatus(`Revising (${settings.model}, prompt ${currentVariant().name})…`);
    const outcome = await reviseDocument(docText, instruction, {
      apiKey,
      model: settings.model,
      variant: currentVariant(),
      priorityIds: settings.priorityPacks.flatMap((p) => packTemplateIds(p)),
    });
    logRevision(instruction, outcome);
    if (!outcome.playlist) {
      setStatus(outcome.error ?? "Revision failed.", "error");
      return;
    }
    setDoc(
      { id: doc.id, title: docTitleOf(outcome.playlist, doc.title), prompt: doc.prompt, playlist: outcome.playlist },
      `Revised: ${instruction}`,
      { label, kind: "revise" },
    );
    autosave();
    promptEl.value = ""; // consumed — and an empty box makes Generate inert
    refreshChips();
  } finally {
    reviseBtn.disabled = false;
  }
}

reviseBtn.addEventListener("click", () => void revise());
```

`doc.prompt` is deliberately **not** replaced: it stays the original request, so exemplars, the log and "👍 Learn from this" keep pairing *original request → current spec*.

- [ ] **Step 4: Log the revision**

`logOutcome` (line 1506) is typed to `GenerationOutcome`; give revisions their own, beside it:

Add `reviseDocument` and `type ReviseOutcome` to main.ts's imports from `./llm/revise`.

```ts
/** Log one revision; returns the log id. Mirrors generateMulti's convention of naming the sub-request in `prompt`. */
function logRevision(instruction: string, outcome: ReviseOutcome): string {
  const logId = crypto.randomUUID();
  appendLog({
    id: logId,
    ts: new Date().toISOString(),
    prompt: `${doc.prompt ?? doc.title} ⟶ revise: ${instruction}`,
    config: { model: settings.model, promptVariant: currentVariant().name, specVersion: SPEC_VERSION },
    rounds: outcome.rounds.map((r) => ({
      label: r.label,
      validationErrors: r.errors,
      lintCount: r.lintIssues.length,
      ms: Math.round(r.ms),
      structuredOutput: false,
    })),
    spec: outcome.playlist ? (itemsOf(outcome.playlist)[0]?.spec ?? null) : null, // LogEntry.spec is Spec | null, not optional
    lintIssues: [],
    warnings: [],
    error: outcome.error,
  });
  refreshCounts();
  return logId;
}
```

`setDoc` clears `lastLogId` (line 1391), so the rating stars only target the revision if it is assigned **after**. In `revise()`, capture the id at the call site and assign it once the document is applied — the same ordering `generate()` uses at line 1580:

```ts
    const logId = logRevision(instruction, outcome);
    if (!outcome.playlist) { … }
    setDoc(…);
    lastLogId = logId;   // after setDoc, so the stars target this revision
    autosave();
```

- [ ] **Step 5: Verify by hand**

```bash
npm run dev
```

1. Generate something, then type "make the labels bigger" and press Revise → the figure changes, the box empties, status reads `Revised: make the labels bigger`.
2. The Library sidebar still shows **one** entry for it, with the original title.
3. Press Revise with an empty box → an error status, no API call.
4. Hand-edit the spec without re-rendering, then Revise → status still reads `Revised: …` and the edit survives into the result.

- [ ] **Step 6: Full suite, type check, commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/main.ts
git commit -m "Add Revise with AI beside Generate"
```

---

### Task 6: The arrows, the viewing bar, and the read-only pane

**Files:**
- Modify: `src/main.ts` — gen-row, `applyHistoryUi`
- Modify: `src/styles.css`
- Test: manual gate

**Interfaces:**
- Consumes: Task 1's `viewAt`, `restoreViewed`, `atNewest`, `currentVersion`; Task 5's `stack`, `restoring`, `reviseBtn`.
- Produces: `applyHistoryUi()` complete; `showVersion(index)`.

- [ ] **Step 1: Build the controls**

Beside `reviseBtn`:

```ts
const histPrev = h("button", { class: "small", title: "Previous version" }, "◀");
const histCounter = h("button", { class: "small hist-counter" }, "1/1");
const histNext = h("button", { class: "small", title: "Next version" }, "▶");
const histNav = h("span", { class: "hist-nav", hidden: "" }, histPrev, histCounter, histNext);

const restoreBtn = h("button", { class: "small" }, "Restore");
const latestBtn = h("button", { class: "small" }, "Latest ▸");
const viewBar = h(
  "div",
  { class: "view-bar", hidden: "" },
  h("span", {}, "Viewing an older version"),
  h("span", { class: "pane-spacer" }),
  restoreBtn,
  latestBtn,
);
```

Replace the Task 5 placeholder in the gen-row with `histNav`, and insert `viewBar` immediately above the `gen-row` inside the `editor-toolbar` panel (line 681-686).

- [ ] **Step 2: Write `applyHistoryUi` and `showVersion`**

```ts
/** Render a version WITHOUT recording it — arrows navigate, they never mutate. */
function showVersion(index: number): void {
  stack = viewAt(stack, index);
  const v = currentVersion(stack);
  if (!v) return;
  const playlist = readPlaylistText(v.text);
  if (!playlist) return; // readPlaylistText already reported why
  restoring = true;
  try {
    specArea.value = v.text;
    doc = { id: doc.id, title: docTitleOf(playlist, doc.title), prompt: doc.prompt, playlist };
    void present();
  } finally {
    restoring = false;
  }
  applyHistoryUi();
}

function applyHistoryUi(): void {
  const n = stack.versions.length;
  const viewing = !atNewest(stack);
  histNav.hidden = n < 2;
  histCounter.textContent = `${stack.cursor + 1}/${n}`;
  const v = currentVersion(stack);
  histCounter.title = v ? `${v.label}${v.from ? ` · from "${v.from}"` : ""}` : "";
  histPrev.disabled = stack.cursor <= 0;
  histNext.disabled = atNewest(stack);
  viewBar.hidden = !viewing;
  // While viewing, editing has nowhere to land — lock the pane rather than let
  // hand-edits vanish on the next arrow press.
  specArea.readOnly = viewing;
  rerenderBtn.disabled = viewing;
  reviseBtn.textContent = viewing ? "Revise from here" : "Revise with AI";
}

histPrev.addEventListener("click", () => showVersion(stack.cursor - 1));
histNext.addEventListener("click", () => showVersion(stack.cursor + 1));
latestBtn.addEventListener("click", () => showVersion(stack.versions.length - 1));
restoreBtn.addEventListener("click", () => {
  stack = restoreViewed(stack, new Date().toISOString());
  showVersion(stack.versions.length - 1);
  autosave();
  setStatus(`Restored: ${currentVersion(stack)?.from ?? "an earlier version"}`, "ok");
});
```

Call `applyHistoryUi()` once at startup, after `refreshLibrary()` (line 1769).

- [ ] **Step 3: Style the new controls**

Append to `src/styles.css`. The amber reuses `.lint-chip.warn`'s exact `#9c6b1f` + `color-mix` recipe (line 388) rather than inventing a token — this file has no warning variables, only `--paper --surface --ink --muted --line --rust --steel --mustard --loss --ok`.

```css
.hist-nav { display: inline-flex; align-items: center; gap: 2px; margin-right: auto; }
.hist-counter { min-width: 3.2em; font-variant-numeric: tabular-nums; cursor: default; }

.view-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 8px;
  border-radius: 6px;
  font-size: 0.9em;
  color: #9c6b1f;
  border: 1px solid color-mix(in srgb, #9c6b1f 45%, var(--surface));
  background: color-mix(in srgb, #9c6b1f 10%, var(--surface));
}
.spec-json[readonly] { opacity: 0.75; }
```

Both new elements are hidden via the `hidden` attribute while carrying an explicit `display`, which normally loses to the UA rule — this file already guards that globally with `[hidden] { display: none !important; }` (line 27), so no extra rule is needed.

- [ ] **Step 4: Verify by hand**

```bash
npm run dev
```

1. Generate, then revise twice → the arrows appear reading `3/3`.
2. Press ◀ twice → the figure changes back, the counter reads `1/3`, the viewing bar appears, the spec pane greys out and refuses typing, `↻ Re-render` is disabled, the button reads `Revise from here`.
3. Press `Latest ▸` → back to `3/3`, the bar disappears, the pane is editable again.
4. Step back to `1/3` and press `Restore` → the counter reads `4/4`, the figure is the old one, **and versions 1-3 are still reachable with ◀**.
5. Step back and press `Revise from here` with an instruction → a new newest version, nothing deleted, and the counter's tooltip names what it came from.
6. Hover the counter → the tooltip shows that version's label.

- [ ] **Step 5: Full suite, type check, commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/main.ts src/styles.css
git commit -m "Step through versions with the arrows; restore by appending, never rewinding"
```

---

## Known phase-1 consequences

- **Revise is always visible.** `initialDoc()` always returns a document (your most recent library entry, or a bundled example), so there is never a moment with nothing to revise. Hiding it until you generate or load in *this* session was considered and rejected as arbitrary. The three-origin rule that fixes this properly — boot offers Generate because you did not choose the document — is phase 2 (spec §1).
- **Versions do not survive a reload.** The stack is in memory. The library entry holds the current version only.
- **A revise carrying hand-edits is one version**, labelled `"… (+ manual edits)"`. Splitting it would mean diffing the textarea on every keystroke.
