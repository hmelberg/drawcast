import { describe, expect, test } from "vitest";
import { buildReviseUser, checkPlaylist, parseReviseReply, preserveFoundingPrompt } from "../src/llm/revise";
import { parsePlaylistText } from "../src/playlist/playlist";

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
