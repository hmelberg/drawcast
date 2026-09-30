// The Commodore 64 part of the code block — BASIC, the game catalogue, the
// c64 frame — rides along only for a request that NAMES the machine
// (wantsC64). Before 2026-09-30 every code request carried it: a Python
// simulation was handed fourteen cartridge names and the BASIC V2 keyword
// list, in the prose and again in the schema.
import { describe, expect, test } from "vitest";
import { apiSchema, codePromptFor, C64_PROMPT_SOURCE, CODE_PROMPT_SOURCE } from "../src/llm/compile";
import { wantsC64, wantsCode } from "../src/llm/prompt";
import { C64_FRAME_CLAUSE, C64_LANGUAGE_CLAUSE } from "../src/spec/schema";
import bundledExamples from "../src/examples.json";

const props = (s: object) => (s as any).properties.elements.items.properties;
const explore = (s: object) => (s as any).properties.commands.items.properties.explore.properties;

describe("the C64 gate", () => {
  test("wantsC64 reads the request, and BASIC only in capitals", () => {
    expect(wantsC64("Show the C64 booting")).toBe(true);
    expect(wantsC64("Why did the Commodore 64 outsell every other computer?")).toBe(true);
    expect(wantsC64("Write a first program in BASIC")).toBe(true);
    expect(wantsC64("Hvordan var hjemmedatamaskinene på 80-tallet?")).toBe(true);
    // An adjective, and the difficulty tag's word — neither is the machine.
    expect(wantsC64("Explain basic statistics")).toBe(false);
    expect(wantsC64("Simulate 500 coin flips in Python")).toBe(false);
  });

  test("naming the machine still opens the code block, and 'basic' alone no longer does", () => {
    expect(wantsCode("Show the C64 booting")).toBe(true);
    expect(wantsCode("Write a first program in BASIC")).toBe(true);
    expect(wantsCode("Explain basic statistics")).toBe(false);
  });

  test("every bundled figure ABOUT the machine is reachable from its own request", () => {
    // The two showcases that borrow the machine as one costume among several
    // ("five frames", "five ways to use code") name it nowhere in their
    // request, and after this gate the model would not reach for it there —
    // which is the point. Every figure whose subject IS the C64 must pass.
    const about = (bundledExamples as { request: string }[]).filter((e) => /commodore|c64/i.test(e.request));
    expect(about.length).toBeGreaterThanOrEqual(3);
    expect(about.filter((e) => !wantsC64(e.request)).map((e) => e.request)).toEqual([]);
  });

  test("the prose: the code block has no C64 in it; the C64 part is appended only on request", () => {
    expect(CODE_PROMPT_SOURCE).not.toMatch(/c64|commodore|"basic"/i);
    expect(codePromptFor(true, false)).toBe(CODE_PROMPT_SOURCE);
    expect(codePromptFor(true, true)).toContain(C64_PROMPT_SOURCE.trim());
    expect(codePromptFor(true, true)).toContain('"language": "basic"');
    expect(codePromptFor(false, true)).toBe("");
  });

  test("the schema: game, basic and c64 go unless the machine is named", () => {
    const off = apiSchema({ code: true, c64: false });
    expect(props(off).game).toBeUndefined();
    expect(explore(off).game).toBeUndefined();
    expect(props(off).language.enum).not.toContain("basic");
    expect(props(off).frame.enum).not.toContain("c64");
    expect(props(off).language.description).not.toContain("Commodore");
    expect(props(off).frame.description).not.toContain("c64");
    // …and the rest of the code element is untouched.
    expect(props(off).language.enum).toContain("python");
    expect(props(off).frame.enum).toContain("crt");

    const on = apiSchema({ code: true, c64: true });
    expect(props(on).game).toBeDefined();
    expect(props(on).language.description).toContain(C64_LANGUAGE_CLAUSE);
    expect(props(on).frame.description).toContain(C64_FRAME_CLAUSE);
    expect(JSON.stringify(on)).toEqual(JSON.stringify(apiSchema()));
  });

  test("the gate is worth what it claims", () => {
    const prose = codePromptFor(true, true).length - codePromptFor(true, false).length;
    const schema = JSON.stringify(apiSchema({ code: true, c64: true })).length - JSON.stringify(apiSchema({ code: true, c64: false })).length;
    expect(prose).toBeGreaterThan(2_000);
    expect(schema).toBeGreaterThan(2_500);
  });
});
