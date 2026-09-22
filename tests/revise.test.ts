import { describe, expect, test } from "vitest";
import { buildReviseUser, checkPlaylist, parseReviseReply, preserveFoundingPrompt, REVISE_PROMPT_SOURCE } from "../src/llm/revise";
import { formatPlaylist, itemsOf, parsePlaylistText, singlePlaylist } from "../src/playlist/playlist";
import { hoistPortraitStrokes, restorePortraitStrokes } from "../src/llm/hoist";
import { normalizeSpec, validateSpec } from "../src/spec/schema";
import { SETTING_KEYS } from "../src/spec/script/lines";
import type { Spec } from "../src/spec/types";

const SPEC_YAML = `title: A line
domain: { x: [0, 100], y: [0, 100] }
elements:
  - { id: ax, type: axes, x_label: x, y_label: y }
  - { id: c1, type: curve, expr: "50" }
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

describe("preserveFoundingPrompt — fill-if-absent only", () => {
  const p = (prompt?: string) => parsePlaylistText(prompt === undefined ? "title: T\ncommands: []\n" : `playlist: { prompt: ${prompt} }\n---\ntitle: T\ncommands: []\n`);

  test("fills a dropped prompt and says so", () => {
    const revised = p();
    expect(preserveFoundingPrompt(revised, p("keep me"))).toBe(true);
    expect(revised.meta.prompt).toBe("keep me");
  });

  test("never overwrites a prompt the reply kept", () => {
    const revised = p("model kept this");
    expect(preserveFoundingPrompt(revised, p("older"))).toBe(false);
    expect(revised.meta.prompt).toBe("model kept this");
  });

  test("invents nothing when the document never had one", () => {
    const revised = p();
    expect(preserveFoundingPrompt(revised, p())).toBe(false);
    expect(revised.meta.prompt).toBeUndefined();
  });
});

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

// The card teaches the notation by showing one figure in both — so the two
// halves have to BE the same figure. A Rosetta stone with a typo in it teaches
// the typo to every revision the app ever makes.
describe("the revise notation card (llm/prompts/revise-v1.md)", () => {
  const blocks = [...REVISE_PROMPT_SOURCE.matchAll(/```(json)?\n([\s\S]*?)\n```/g)];

  test("its two example blocks say the same thing", () => {
    const json = blocks.find((b) => b[1] === "json");
    const script = blocks.find((b) => b[1] === undefined);
    expect(json, "a ```json block").toBeDefined();
    expect(script, "a plain ``` block").toBeDefined();
    const fromScript = parsePlaylistText(script![2]);
    expect(itemsOf(fromScript)).toHaveLength(1);
    expect(normalizeSpec(itemsOf(fromScript)[0].spec)).toEqual(normalizeSpec(JSON.parse(json![2])));
  });

  test("the figure it teaches is a valid spec", () => {
    const json = blocks.find((b) => b[1] === "json")!;
    const v = validateSpec(JSON.parse(json[2]));
    expect(v.ok ? [] : v.errors).toEqual([]);
  });

  test("it replaces the compiler prompt's JSON-only contract, and is sent with every revision", () => {
    expect(REVISE_PROMPT_SOURCE).toContain('replaces "Output"');
    // Document settings are the half of the notation a page must never carry
    // (the 2026-09-21 "(root) must NOT have additional properties: prompt").
    expect(REVISE_PROMPT_SOURCE).toContain("prompt:");
    // …and pages are the half a lecture needs.
    expect(REVISE_PROMPT_SOURCE).toContain("## Name");
  });

  // The revise card is the ONLY prompt that teaches the script notation, and a
  // revision is told to return every other beat byte-for-byte. A construct the
  // scanner accepts but the card never mentions is a construct the model is
  // asked to preserve without having been told it exists. Design §4.3.
  test("the revise card covers every construct the scanner accepts", () => {
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
});
