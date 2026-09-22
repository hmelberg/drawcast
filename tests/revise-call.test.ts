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
import { formatPlaylist, singlePlaylist } from "../src/playlist/playlist";
import { TEMPLATE_FULL_THRESHOLD } from "../src/scenes/catalog";
import type { Command, Spec, SpecElement } from "../src/spec/types";

const GOOD = `title: A line
domain: { x: [0, 100], y: [0, 100] }
elements:
  - { id: ax, type: axes, x_label: x, y_label: y }
  - { id: c1, type: curve, expr: "50" }
commands:
  - { draw: [ax, c1] }
`;
const BROKEN = "title: Broken\nelements: not-an-array\ncommands: []\n";

// IMPORTANT 1 fixtures (final-review round, 2026-09-22): GOOD above is the
// YAML escape-hatch form (a ```yaml fence merged into the page) — exactly
// what the old regexes matched. A real revision's docText is SCRIPT
// notation (main.ts's specArea.value = formatPlaylist(playlist, "script")),
// so these are built through the real printer rather than typed by hand,
// to be exactly what a revision actually receives.
const SCRIPT_ELEMENTS: SpecElement[] = [
  { id: "ax", type: "axes", x_label: "x", y_label: "y" },
  { id: "c1", type: "curve", expr: "50" },
];
const SCRIPT_COMMANDS: Command[] = [{ draw: ["ax", "c1"] }];
const SCRIPT_SPEC_BASE: Spec = { title: "A line", domain: { x: [0, 100], y: [0, 100] }, elements: SCRIPT_ELEMENTS, commands: SCRIPT_COMMANDS };
const SCRIPT_PLAIN = formatPlaylist(singlePlaylist(SCRIPT_SPEC_BASE), "script");
const SCRIPT_WITH_CODE = formatPlaylist(
  singlePlaylist({ ...SCRIPT_SPEC_BASE, elements: [...SCRIPT_ELEMENTS, { id: "sim", type: "code", language: "python", code: "print(1)" }] }),
  "script",
);
const SCRIPT_WITH_SOUND = formatPlaylist(
  singlePlaylist({ ...SCRIPT_SPEC_BASE, commands: [...SCRIPT_COMMANDS, { play: "C4:q" }] }),
  "script",
);

const cfg = () => ({ apiKey: "k", model: "claude-opus-5", variant: promptVariants()[0] });

/** The system blocks are TextBlockParam[]; flatten them for assertions. */
const systemText = (i: number) => (calls[i].system as { text: string }[]).map((b) => b.text).join("\n");

beforeEach(() => {
  calls.length = 0;
  replies = [];
});

describe("reviseDocument", () => {
  // Task 3 (design §3.3) fix round 1: a prose-only assertion here cannot
  // catch a revert of revise.ts's schema half alone — `schema: apiSchema()`
  // (dropping the { code, sound } flags) keeps this test, and every other
  // test in the suite, green, while silently constraining a code- or
  // sound-carrying revision to a schema missing the element/verb it needs
  // (the exact "silent corruption of someone's existing work" design §3.3
  // warns about). `code_result` and `instrument` are schema PROPERTY NAMES:
  // {{SCHEMA}} is filled via JSON.stringify (src/llm/prompt.ts), which
  // escapes any quote that was already INSIDE a description string (so the
  // play description's own embedded example, `"instrument": "piano"`, lands
  // in the prompt as `\"instrument\": \"piano\"` — a different substring),
  // so an unescaped '"code_result"' / '"instrument"' can only come from the
  // schema's own JSON key. Checked (grep) that neither appears, quoted, in
  // compiler-v1.md or revise-v1.md — the two prompt sources present on every
  // call regardless of these gates — so the assertion cannot pass by
  // accident from an always-on source.
  test("the conditional code block rides along only when the document or the instruction wants a script", async () => {
    // Task 10: the 15k code bullet is filled into {{CODE}} on demand. A
    // revision of a document that HAS a code element still needs the rules.
    replies = [GOOD, GOOD];
    await reviseDocument(GOOD, "make the curve steeper", cfg());
    expect(systemText(0)).not.toContain("**code** runs a real script");
    expect(systemText(0)).not.toContain('"code_result"');
    const withCode = GOOD.replace("  - { id: c1", "  - { id: sim, type: code, language: python, code: \"print(1)\" }\n  - { id: c1");
    await reviseDocument(withCode, "make it print two", cfg());
    expect(systemText(1)).toContain("**code** runs a real script");
    expect(systemText(1)).toContain('"code_result"');
  });

  test("the conditional sound block, and the schema's play verb, ride along only when the document or the instruction wants sound", async () => {
    replies = [GOOD, GOOD];
    await reviseDocument(GOOD, "make the curve steeper", cfg());
    expect(systemText(0)).not.toContain("**play** sounds synthesized notes");
    expect(systemText(0)).not.toContain('"instrument"');
    const withSound = GOOD.replace("  - { draw: [ax, c1] }", "  - { draw: [ax, c1] }\n  - { play: \"C4:q\" }");
    await reviseDocument(withSound, "make it louder", cfg());
    expect(systemText(1)).toContain("**play** sounds synthesized notes");
    expect(systemText(1)).toContain('"instrument"');
  });

  // IMPORTANT 1 (final-review round, 2026-09-22): the two tests above use the
  // YAML escape-hatch form, which is the ONLY form the old regexes
  // (`/\btype:\s*['"]?code\b/`, `/\bplay:/`) ever matched — dead on the
  // SCRIPT notation a real revision actually sends (main.ts:838/:2905 set
  // specArea.value = formatPlaylist(playlist, "script")). These two use the
  // real printer's output instead, so they fail against the old textual
  // regexes and pass only once wantCode/wantSound read the parsed spec.
  test("the conditional code block rides along for a SCRIPT-notation document too — the old regex never matched a real one", async () => {
    // Evidence: a real code fence never contains the literal substring the
    // old regex looked for. Against the pre-fix regex this line alone shows
    // the fixture can never trip it; the assertions below show the fix reads
    // the parsed spec instead and gets the right answer anyway.
    expect(SCRIPT_WITH_CODE).not.toMatch(/\btype:\s*['"]?code\b/);
    replies = [SCRIPT_PLAIN, SCRIPT_PLAIN];
    await reviseDocument(SCRIPT_PLAIN, "make the curve steeper", cfg());
    expect(systemText(0)).not.toContain("**code** runs a real script");
    expect(systemText(0)).not.toContain('"code_result"');
    await reviseDocument(SCRIPT_WITH_CODE, "make it print two", cfg());
    expect(systemText(1)).toContain("**code** runs a real script");
    expect(systemText(1)).toContain('"code_result"');
  });

  test("the conditional sound block rides along for a SCRIPT-notation document too — the old regex never matched a real one", async () => {
    // Evidence: a play command prints as a direction line, `play "C4:q"` —
    // no colon after `play`, so the old regex can never see it either.
    expect(SCRIPT_WITH_SOUND).not.toMatch(/\bplay:/);
    replies = [SCRIPT_PLAIN, SCRIPT_PLAIN];
    await reviseDocument(SCRIPT_PLAIN, "make the curve steeper", cfg());
    expect(systemText(0)).not.toContain("**play** sounds synthesized notes");
    expect(systemText(0)).not.toContain('"instrument"');
    await reviseDocument(SCRIPT_WITH_SOUND, "make it louder", cfg());
    expect(systemText(1)).toContain("**play** sounds synthesized notes");
    expect(systemText(1)).toContain('"instrument"');
  });

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
    // round 1 review, fix 2: every exit of reviseDocument answers the "is
    // there a note?" question — this early return (before the try block, so
    // there is no `best` yet to fold playlist.warnings from) must still carry
    // a `notes` array rather than leaving it undefined on just this one path.
    expect(out.notes).toEqual([]);
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

// design 2026-09-20 §5.2: a hoisted document is not a complete document.
// restorePortraitStrokes must run on a candidate BEFORE checkPlaylist judges
// it, not only on the eventual winner afterwards -- otherwise a reply whose
// params reference an asset, but which drops the assets: block (the
// realistic case: assets is not in the wire schema, so a model never echoes
// it back), fails "not in assets" on a reference that is perfectly good, and
// spends a repair round the model can only satisfy by inventing data.
describe("reviseDocument restores hoisted assets before judging a candidate (design §5.2)", () => {
  const DATA_TEMPLATE_ID = "revise_data_assets_restore_test";
  function registerDataTemplate(): void {
    registerTemplateDoc({
      template: DATA_TEMPLATE_ID,
      version: 1,
      kit: 1,
      status: "ready",
      description: "Test template for the restore-before-validate test: takes an array param.",
      params: { type: "object", properties: { moves: { type: "array", items: { type: "string" } } } },
      element_ids: { fig: "the one label this template draws" },
      examples: [{ request: "Draw the restore-before-validate test figure.", params: {} }],
      // On-canvas (CANVAS is 1000x750) and lint-clean either way — params.moves
      // is not even read; only its presence as a schema-legal array matters here.
      layout: `return { drawables: [kit.text("fig", [500, 375], "Data", { fontSize: 28 })], labels: [], anchors: {}, order: ["fig"] };`,
    });
  }
  afterEach(() => {
    delete scenes[DATA_TEMPLATE_ID];
  });

  // A `draw` beat matters here beyond realism: formatPlaylist's "script" format
  // needs at least one indented action line to separate narration from the
  // trailing ```assets fence on reparse — a commands list with only `speak`
  // reformats into something parsePlaylistText itself cannot read back, which
  // would make this test fail for a reason that has nothing to do with §5.2.
  const WITH_ASSETS = `template: ${DATA_TEMPLATE_ID}
params: { moves: "@line" }
assets: { line: ["e4", "e5", "Nf3"] }
commands:
  - { draw: [fig], speak: "A line." }
`;
  // The realistic reply: assets is not in the wire schema, so the model
  // returns the document with only the reference surviving.
  const WITHOUT_ASSETS = `template: ${DATA_TEMPLATE_ID}
params: { moves: "@line" }
commands:
  - { draw: [fig], speak: "A line." }
`;

  test("a reply that drops the assets block still completes in one round", async () => {
    registerDataTemplate();
    // Two identical canned replies: if the ordering under test regresses, the
    // repair round the model is sent gets the very same reply back (a model
    // cannot invent the author's data), so a second, distinct failure mode
    // (running out of canned replies) never masks the one this test is for.
    replies = [WITHOUT_ASSETS, WITHOUT_ASSETS];

    const out = await reviseDocument(WITH_ASSETS, "tweak it", { ...cfg(), maxRepairs: 1 });

    expect(out.rounds).toHaveLength(1);
    expect(out.error).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  test("an asset too large to send notes the author on the finished outcome (design §5.1, round 1 review)", async () => {
    registerDataTemplate();
    const big = Array.from({ length: 2_000 }, (_, i) => `move-number-${i}-with-extra-padding-to-grow-the-row`);
    const withBig = `template: ${DATA_TEMPLATE_ID}
params: { moves: "@line" }
assets: { line: ${JSON.stringify(big)} }
commands:
  - { draw: [fig], speak: "A line." }
`;
    replies = [WITHOUT_ASSETS];
    const out = await reviseDocument(withBig, "tweak it", cfg());
    expect(out.error).toBeUndefined();
    expect(out.notes).toEqual(["line is 104 KB — too large to revise here. Edit it in the Spec source, or re-import the file."]);
    // And the data itself made the round trip untouched — the note is in
    // addition to the restore, not instead of it.
    expect((out.playlist!.entries[0] as { spec: { assets?: { line?: unknown } } }).spec.assets?.line).toEqual(big);
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
    // The editor's text is script now, so a refilled prompt comes back as a
    // document setting with a quoted value.
    expect(out.text).toContain('prompt: "explain trade"');
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

// Revising a LECTURE, which is the case the prompt never described until the
// revise card: pages under `##`, chapters between them, the founding prompt
// above both. The reply shapes below are the ones a model actually reaches
// for — the document back as it came, the document with a page added, and the
// document as JSON because the compiler prompt spent 46k characters asking
// for JSON.
describe("reviseDocument on a multi-page document", () => {
  const LECTURE = `# Marginal cost
prompt: "explain marginal cost #parts=2"

chapter: "Setting up"

## The curve
Costs rise with output.
    axes ax x_label q y_label kr
    curve c1 expr "50"

chapter: "The turn"

## The margin
The slope is what matters.
    axes ax2 x_label q y_label kr
    curve c2 expr 2*x
`;

  const shape = (out: { playlist: { entries: { kind: string; title?: string; spec?: { title?: string } }[] } | null }) =>
    out.playlist!.entries.map((e) => (e.kind === "chapter" ? `chapter:${e.title}` : `item:${e.spec!.title}`));

  test("the document is handed over whole, fenced so its own code fences cannot close it", async () => {
    replies = [LECTURE];
    await reviseDocument(LECTURE, "make the second curve steeper", cfg());
    const user = calls[0].messages[0].content as string;
    expect(user).toContain(LECTURE);
    expect(user).toContain("````");
    // The notation card rides in the uncached tail, not the cached prefix.
    const blocks = calls[0].system as { text: string; cache_control?: unknown }[];
    expect(blocks[blocks.length - 1].text).toContain('replaces "Output"');
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
  });

  test("pages, chapters and the founding prompt all survive the round trip", async () => {
    replies = [LECTURE];
    const out = await reviseDocument(LECTURE, "make the second curve steeper", cfg());
    expect(out.error).toBeUndefined();
    expect(shape(out)).toEqual(["chapter:Setting up", "item:The curve", "chapter:The turn", "item:The margin"]);
    expect(out.playlist!.meta.prompt).toBe("explain marginal cost #parts=2");
  });

  test("a reply that adds a page and a chapter is taken as it stands", async () => {
    replies = [LECTURE.replace(/$/, '\nchapter: "The moral"\n\n## What it means\nSo price equals marginal cost.\n    axes ax3 x_label q y_label kr\n')];
    const out = await reviseDocument(LECTURE, "add a closing part", cfg());
    expect(out.error).toBeUndefined();
    expect(shape(out)).toEqual([
      "chapter:Setting up",
      "item:The curve",
      "chapter:The turn",
      "item:The margin",
      "chapter:The moral",
      "item:What it means",
    ]);
  });

  test("a reply that drops a page keeps the rest, rather than failing the revision", async () => {
    replies = [LECTURE.slice(0, LECTURE.indexOf('chapter: "The turn"'))];
    const out = await reviseDocument(LECTURE, "cut the second part", cfg());
    expect(out.error).toBeUndefined();
    expect(shape(out)).toEqual(["chapter:Setting up", "item:The curve"]);
    expect(out.playlist!.meta.prompt).toBe("explain marginal cost #parts=2");
  });

  test("a reply that switched to JSON, prompt and all, is read rather than refused", async () => {
    replies = [JSON.stringify({ prompt: "explain marginal cost #parts=2", title: "The curve", elements: [{ id: "ax", type: "axes" }], commands: [{ draw: ["ax"], speak: "Hei." }] })];
    const out = await reviseDocument(LECTURE, "just the first part, as JSON", cfg());
    expect(out.error).toBeUndefined();
    expect(shape(out)).toEqual(["item:The curve"]);
    expect(out.playlist!.meta.prompt).toBe("explain marginal cost #parts=2");
  });
});

// IMPORTANT 2 (final-review round, 2026-09-22): reviseDocument calls
// catalogParts with no router shortlist of its own — revise has no router.
// A template-less document (no priorityIds either, the default) then meets
// every condition for the catalog's last-resort fallback whenever the
// instruction is not in English (the keyword selector is English-only, so it
// scores zero and returns []): ~27k chars of supply_demand + qaly_profiles +
// decision_tree get appended to catalog.variable, which revise puts in the
// UNCACHED suffix (revise.ts) — paid in full on every such revision, instead
// of riding the ~0.1×-cost cached prefix the way a fixed hot set would. Only
// reachable once the bundled library is past TEMPLATE_FULL_THRESHOLD (below
// it, catalogParts never runs the two-level branch at all), so this
// registers throwaway templates to get there, same as tests/catalog-split.test.ts.
describe("reviseDocument never pulls in a full template a template-less document did not ask for (2026-09-22; the catalog fallback itself was deleted 2026-09-23)", () => {
  const added: string[] = [];
  function addFake(id: string): void {
    registerTemplateDoc({
      template: id,
      version: 1,
      kit: 1,
      status: "ready",
      description: `Fake ${id} figure for the revise lastResort test. Second sentence.`,
      params: {},
      element_ids: {},
      examples: [{ request: `Draw the ${id} thing.`, params: {} }],
      layout: `return { drawables: [], labels: [], anchors: {}, order: [] };`,
    });
    added.push(id);
  }
  function fillPastThreshold(): void {
    const ready = () => Object.values(scenes).filter((s) => s.manifest.status === "ready").length;
    for (let i = 0; ready() <= TEMPLATE_FULL_THRESHOLD; i++) addFake(`revise_lastresort_fake_${i}`);
  }
  afterEach(() => {
    for (const id of added.splice(0)) delete scenes[id];
  });

  test("a Norwegian instruction revising a template-less document leaves the catalog's variable half empty", async () => {
    fillPastThreshold();
    replies = [GOOD];
    await reviseDocument(GOOD, "Forklar tilbud og etterspørsel", cfg());
    // Evidence: the keyword selector really cannot place this request (it is
    // English-only), so before the fix every one of these appears in full.
    expect(systemText(0)).not.toContain("### Scene template: supply_demand (READY");
    expect(systemText(0)).not.toContain("### Scene template: qaly_profiles (READY");
    expect(systemText(0)).not.toContain("### Scene template: decision_tree (READY");
  });
});

// Scoped re-review finding (2026-09-22): parsedNow.playlist (the CURRENT
// document, straight off the textarea) is PARSED but never VALIDATED —
// validateSpec/checkPlaylist run on the model's REPLY, not on the incoming
// document — and main.ts notes a hand-edit the author never re-rendered
// still rides into a revision. The structural code/sound check above
// (`specs.some((s) => ... s.elements.some((e) => e.type === "code"))`) can
// therefore meet `elements`/`commands` in any shape JSON/YAML allows: not an
// array at all, or an array holding a null/blank entry. The OLD regex-based
// check could never throw (a regex test against a string always returns);
// the new structural one could, before Array.isArray + `?.` guards were
// added. This runs before reviseDocument's own try block, and main.ts's
// revise() has no catch around the call — so an unguarded throw here would
// have reached the author as a spinner that silently clears with no error
// shown at all.
describe("reviseDocument survives a malformed CURRENT document (scoped re-review, 2026-09-22)", () => {
  const ELEMENTS_NOT_ARRAY = "title: A\nelements: not-an-array\ncommands: []\n";
  const ELEMENTS_NULL_ITEM = "title: A\nelements:\n  - null\n  - { id: ax, type: axes, x_label: x, y_label: y }\ncommands: []\n";
  const COMMANDS_NOT_ARRAY = "title: A\nelements: []\ncommands: not-an-array\n";
  const COMMANDS_NULL_ITEM = "title: A\nelements: []\ncommands:\n  - null\n  - { pause: 0.4 }\n";

  test("elements that are not an array at all do not crash the code check", async () => {
    replies = [GOOD];
    const out = await reviseDocument(ELEMENTS_NOT_ARRAY, "steeper", cfg());
    expect(out.error).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  test("an elements list holding a null item does not crash the code check", async () => {
    replies = [GOOD];
    const out = await reviseDocument(ELEMENTS_NULL_ITEM, "steeper", cfg());
    expect(out.error).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  test("commands that are not an array at all do not crash the sound check", async () => {
    replies = [GOOD];
    const out = await reviseDocument(COMMANDS_NOT_ARRAY, "steeper", cfg());
    expect(out.error).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  test("a commands list holding a null item does not crash the sound check", async () => {
    replies = [GOOD];
    const out = await reviseDocument(COMMANDS_NULL_ITEM, "steeper", cfg());
    expect(out.error).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});
