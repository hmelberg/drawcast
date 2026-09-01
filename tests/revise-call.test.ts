import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
import { registerTemplateDoc, scenes } from "../src/scenes/registry";

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

describe("reviseDocument repair feedback surfaces warn-severity lint (F1)", () => {
  // Same idea as generate-loop.test.ts's F1 case, driven through the revise
  // loop instead: a template whose layout ALWAYS places one text element
  // off-canvas (deterministic lint ERROR), independent of params.
  const REPAIR_ID = "revise_repair_feedback";
  function registerBadTemplate(): void {
    registerTemplateDoc({
      template: REPAIR_ID,
      version: 1,
      kit: 1,
      status: "ready",
      description: "Test template for the F1 revise repair-feedback warn test: always places a label off-canvas.",
      params: {},
      element_ids: { bad_label: "off-canvas label" },
      examples: [{ request: "Draw the F1 revise repair test figure.", params: {} }],
      layout: `return { drawables: [kit.text("bad_label", [-999, 400], "Off canvas", { fontSize: 28 })], labels: [], anchors: {}, order: ["bad_label"] };`,
    });
  }
  afterEach(() => {
    delete scenes[REPAIR_ID];
  });

  const BAD_DOC = () => `template: ${REPAIR_ID}
params: {}
commands:
  - { speak: "One." }
  - { speak: "Two." }
  - { draw: [bad_label] }
`;

  test("a repair round triggered by a lint ERROR also carries a co-occurring WARN's message in the feedback sent to the model", async () => {
    registerBadTemplate();
    replies = [BAD_DOC(), BAD_DOC()];

    const out = await reviseDocument(BAD_DOC(), "tweak it", { ...cfg(), maxRepairs: 1 });

    expect(out.rounds.map((r) => r.label)).toEqual(["initial", "repair"]);
    const round1Issues = out.rounds[0].lintIssues;
    expect(round1Issues.some((i) => i.rule === "out-of-canvas" && i.severity === "error")).toBe(true);
    const warnIssue = round1Issues.find((i) => i.rule === "slow-start" && i.severity === "warn");
    expect(warnIssue).toBeDefined();

    expect(calls).toHaveLength(2);
    const feedback = String(calls[1].messages[2].content);
    expect(feedback).toContain(warnIssue!.message);
  });

  test("a document with ONLY warn-severity lint issues never triggers a repair round", async () => {
    const WARN_ONLY = `title: A line
domain: { x: [0, 100], y: [0, 100] }
elements:
  - { id: ax, type: axes, x_label: x, y_label: y }
  - { id: c1, type: curve, expr: "50" }
commands:
  - { speak: "One." }
  - { speak: "Two." }
  - { draw: [ax, c1] }
`;
    replies = [WARN_ONLY];

    const out = await reviseDocument(GOOD, "steeper", cfg());

    expect(out.rounds).toHaveLength(1);
    expect(out.rounds[0].lintIssues.some((i) => i.severity === "warn")).toBe(true);
    expect(out.rounds[0].lintIssues.some((i) => i.severity === "error")).toBe(false);
    expect(calls).toHaveLength(1);
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

// §F.3.3 follow-up ruling (2026-09-01): the founding request is provenance,
// not content. A revision whose reply omits the `playlist:` header must not
// lose `prompt:` — the next save would write a file with no provenance. The
// preservation is fill-if-absent ONLY: a header the model kept wins, and the
// revise instruction never lands in the field.
describe("reviseDocument preserves the founding prompt", () => {
  const HEADERED = `playlist: { prompt: explain trade }\n---\n${GOOD}`;

  test("a reply that drops the header gets the prompt filled back in, playlist and text both", async () => {
    replies = [GOOD]; // model returns a bare spec, no header
    const out = await reviseDocument(HEADERED, "steeper", cfg());
    expect(out.error).toBeUndefined();
    expect(out.playlist!.meta.prompt).toBe("explain trade");
    expect(out.text).toContain("prompt: explain trade");
  });

  test("a reply that kept the header is left byte-alone — no reformat", async () => {
    const echoed = `playlist: { prompt: explain trade }\n---\n${GOOD}`;
    replies = [echoed];
    const out = await reviseDocument(HEADERED, "steeper", cfg());
    expect(out.playlist!.meta.prompt).toBe("explain trade");
    expect(out.text).toBe(echoed.trimEnd()); // stripFence trims; a REFORMAT would rewrite the flow-style header
  });

  test("a document that never had a prompt gains none", async () => {
    replies = [GOOD];
    const out = await reviseDocument(GOOD, "steeper", cfg());
    expect(out.playlist!.meta.prompt).toBeUndefined();
  });
});
