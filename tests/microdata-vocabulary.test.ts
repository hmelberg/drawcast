// microdata's word list is DERIVED, never copied: this re-reads the vendored
// emulator (public/mdlib/<version>/) and fails when the shipped lists drift
// from it. A snapshot that adds a command must break a test, not quietly leave
// the editor suggesting yesterday's language — the rule languages.ts states
// for runtimes, applied to the vocabulary.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { MD_COMMANDS, MD_FUNCTIONS, completionsFor } from "../src/ui/code-complete";
import { knownMicrodataVariables, publishMicrodataVariables } from "../src/code/vocabulary";
import { MDLIB_VERSION } from "../src/code/languages";

const dir = new URL(`../public/mdlib/${MDLIB_VERSION}/`, import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, dir), "utf8");

/** Every command name the emulator dispatches on, or filters with. */
function emulatorCommands(): string[] {
  const src = read("m2py.py");
  const out = new Set([...src.matchAll(/cmd == '([a-z][a-z0-9-]*)'/g)].map((m) => m[1]));
  for (const name of ["_COND_FILTER_COMMANDS", "_CONTROL_COMMANDS"]) {
    const block = new RegExp(`${name}\\s*=\\s*frozenset\\(\\s*[[{]([\\s\\S]*?)[\\]}]\\s*\\)`).exec(src);
    if (block) for (const m of block[1].matchAll(/'([a-z][a-z0-9-]*)'/g)) out.add(m[1]);
  }
  return [...out].sort();
}

/** The expression functions the emulator injects into eval — its own registry. */
function emulatorFunctions(): string[] {
  const src = read("functions.py");
  const body = src.slice(src.indexOf("def get_microdata_functions"));
  const from = body.indexOf("return {");
  const registry = body.slice(from, body.indexOf("\n    }", from));
  return [...new Set([...registry.matchAll(/'([A-Za-z_][A-Za-z0-9_]*)':/g)].map((m) => m[1]))].sort();
}

const offered = (text: string, caret = text.length): string[] =>
  completionsFor({ text, caret, language: "microdata", limit: 500 })?.items.map((i) => i.word) ?? [];

describe("the shipped vocabulary is the emulator's", () => {
  test("the snapshot the code pins is the one on disk", () => {
    expect(readdirSync(new URL("../public/mdlib/", import.meta.url))).toContain(MDLIB_VERSION);
  });

  test("the commands are exactly what m2py dispatches", () => {
    expect([...MD_COMMANDS].sort()).toEqual(emulatorCommands());
    expect(MD_COMMANDS.length).toBeGreaterThan(50); // the scan itself must not shrink to nothing
  });

  test("the expression functions are exactly the emulator's registry", () => {
    expect([...MD_FUNCTIONS].sort()).toEqual(emulatorFunctions());
    expect(MD_FUNCTIONS.length).toBeGreaterThan(50);
  });
});

describe("what microdata offers where", () => {
  test("commands at the start of a line, hyphens and all", () => {
    expect(offered("create-data")).toContain("create-dataset");
    expect(offered("  regress-pan")).toEqual(expect.arrayContaining(["regress-panel", "regress-panel-diff"]));
    // …and never mid-line, where a hyphen is a minus sign.
    expect(offered("generate y = x - crea")).not.toContain("create-dataset");
  });

  test("expression functions inside a line, never at its start", () => {
    expect(offered("generate z = rowm")).toEqual(expect.arrayContaining(["rowmax", "rowmean"]));
    expect(offered("generate z = sqr")).toContain("sqrt");
    expect(offered("sqr")).not.toContain("sqrt"); // a line starts with a command
  });

  test("the catalogue's variables, once the emulator has published them", () => {
    expect(knownMicrodataVariables()).toEqual([]); // nothing before a boot
    publishMicrodataVariables(["BEFOLKNING_KJOENN", "INNTEKT_WLONN"]);
    const found = completionsFor({
      text: "import fd/INNT",
      caret: 14,
      language: "microdata",
      variables: knownMicrodataVariables(),
    });
    expect(found?.items[0]).toEqual({ word: "INNTEKT_WLONN", kind: "variable" });
    expect(found?.start).toBe("import fd/".length); // the slash is not part of the word
    publishMicrodataVariables([]);
  });

  test("a microdata comment is '//', not '#'", () => {
    expect(completionsFor({ text: "// summ", caret: 7, language: "microdata" })).toBeNull();
    expect(offered("summ")).toContain("summarize");
    // A word that is not the first thing on its line is not a command, whatever
    // stands before it — so nothing is offered for it from the command list.
    expect(completionsFor({ text: "# summ", caret: 6, language: "microdata" })).toBeNull();
  });
});
