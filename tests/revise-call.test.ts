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
  - { id: c1, type: curve, expr: "50" }
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

describe("system blocks", () => {
  // Live 400 from Hans's smoke test, 2026-08-24:
  // "system: text content blocks must contain non-whitespace text".
  // buildSystemBlocks splits the prompt at {{EXEMPLARS}}, which sits at the end
  // of compiler-v1.md, so with no exemplars the suffix is exactly "\n" —
  // whitespace, but truthy, so the old `suffixText ? …` guard shipped it.
  test("never sends a whitespace-only block, which the API rejects", async () => {
    replies = [GOOD];
    await reviseDocument(GOOD, "make the curve steeper", cfg());
    const blocks = calls[0].system as { text: string }[];
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(b.text.trim()).not.toBe("");
  });

  test("the cached prefix is still sent, and still carries cache_control", async () => {
    replies = [GOOD];
    await reviseDocument(GOOD, "steeper", cfg());
    const blocks = calls[0].system as { text: string; cache_control?: unknown }[];
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[0].text).toContain("{");
  });
});
