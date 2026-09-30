// The Problems note under a #cast= cast (src/ui/problems-box.ts): the text
// "Copy for your AI" puts on the clipboard, built from the app's own checks
// (lint/check-playlist.ts). The DOM half is read from source, like the
// catalogue's: this suite runs in plain node.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { checkPlaylistItems } from "../src/lint/check-playlist";
import { parsePlaylistText } from "../src/playlist/playlist";
import { emptyProblems, lintLine, problemCount, problemsText } from "../src/ui/problems-box";

describe("problemsText", () => {
  test("a clean cast has nothing to say", () => {
    expect(problemsText(emptyProblems())).toBe("");
    expect(problemCount(emptyProblems())).toBe(0);
  });

  test("a cast that could not be read says why", () => {
    const text = problemsText({ ...emptyProblems(), fatal: "The link's cast data is damaged." });
    expect(text).toContain("It could not be played:\n- The link's cast data is damaged.");
    expect(text.startsWith("drawcast.app found problems")).toBe(true);
  });

  test("validation errors, document warnings and lint with element ids; lint errors before warnings", () => {
    const text = problemsText({
      errors: ["item 2: elements[0].type must be one of …"],
      warnings: ["playlist.next needs title and href — ignored"],
      lint: [
        { rule: "long-label", ids: ["lbl"], message: "too many words", severity: "warn", item: 0 },
        { rule: "curve-var-shadow", ids: ["c1"], message: "flat curve", severity: "error", item: 1 },
      ],
      items: 2,
    });
    expect(text).toContain("Validation errors (the cast does not play until these are fixed):\n- item 2: elements[0].type");
    expect(text).toContain("Document warnings:\n- playlist.next needs title and href");
    const err = text.indexOf("item 2: [error] curve-var-shadow (ids: c1): flat curve");
    const warn = text.indexOf("item 1: [warn] long-label (ids: lbl): too many words");
    expect(err).toBeGreaterThan(0);
    expect(warn).toBeGreaterThan(err);
  });

  test("item numbers only when there is more than one item", () => {
    expect(lintLine({ rule: "math", ids: [], message: "bad TeX", severity: "warn", item: 0 }, 1)).toBe("[warn] math: bad TeX");
  });
});

describe("checkPlaylistItems feeds it", () => {
  test("an invalid spec lists every validation error", () => {
    const playlist = parsePlaylistText(JSON.stringify({ elements: [{ id: "a", type: "no-such-kind" }], commands: [{ draw: "a" }, { nonsense: 1 }] }));
    const { errors, lintIssues } = checkPlaylistItems(playlist);
    expect(errors.length).toBeGreaterThan(0);
    expect(lintIssues).toEqual([]);
  });

  test("a valid spec with a lint issue carries its item and ids", () => {
    const spec = {
      title: "t",
      vars: { t: 0 },
      elements: [{ id: "c1", type: "curve", expr: "0.5*t*t" }],
      commands: [{ draw: ["c1"] }],
    };
    const { errors, lintIssues } = checkPlaylistItems(parsePlaylistText(JSON.stringify(spec)));
    expect(errors).toEqual([]);
    const shadow = lintIssues.find((i) => i.rule === "curve-var-shadow");
    expect(shadow).toMatchObject({ item: 0, ids: ["c1"], severity: "error" });
  });
});

describe("the viewer shows it for #cast= only", () => {
  const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8");
  test("the box exists only for an inline cast", () => {
    expect(viewer).toContain('const problems = req.inline !== undefined ? problemsBox() : null;');
  });
  test("an inline cast is never counted and never reports", () => {
    expect(viewer).toMatch(/countingEnabled\(playlist\.meta\) && req\.gh\b/);
    expect(viewer).toMatch(/const castKey = req\.anvil \? req\.anvil\.cast : req\.gh \? castKeyFor\(req\.gh\) : null;/);
  });
});
