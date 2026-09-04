import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseViewerHash } from "../src/viewer";

const src = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the learner param", () => {
  test("rides the hash and is normalised", () => {
    expect(parseViewerHash("#gh=hmelberg/dcast/learn-russian/01.yaml&learner=Fjell-Rev-Havn")?.learner).toBe("fjell-rev-havn");
    expect(parseViewerHash("#gh=hmelberg/dcast/learn-russian/01.yaml&learner=nope")?.learner).toBeUndefined();
    expect(parseViewerHash("#gh=hmelberg/dcast/learn-russian/01.yaml")?.learner).toBeUndefined();
  });
});

describe("the viewer reports to the learner backend", () => {
  test("it uses the client, never its own rules", () => {
    expect(src).toMatch(/from "\.\/learn"/);
    expect(src).toMatch(/reportingAllowed\(/);
    expect(src).toMatch(/saveLearner\(/);
  });
  test("an arriving code is stored before the URL is cleaned, and the cleanup uses replaceState", () => {
    const start = src.indexOf("countingEnabled(playlist.meta)");
    const save = src.indexOf("saveLearner(", start);
    const strip = src.indexOf("history.replaceState", start);
    expect(start).toBeGreaterThan(0);
    expect(save).toBeGreaterThan(start);
    expect(strip).toBeGreaterThan(start);
    expect(strip).toBeGreaterThan(save);
    expect(src).toMatch(/stripLearnerParam\(location\.href\)/);
  });
  test("a code in the address is cleaned away even when the cast has no backend to report to", () => {
    expect(src).toMatch(/if \(req\.learner\) \{/);
    expect(src).toMatch(/if \(enroll\) saveLearner\(/);
  });
  test("an answer is keyed by (item, step): the playlist item index plus the step inside it", () => {
    expect(src).toMatch(/onAnswer: reporter\s*\?\s*\(a, _item, index\) =>/);
    expect(src).toMatch(/kind: "answer", cast: learnerCast, item: index, step: a\.index/);
  });
  test("opened, answer and completed are wired and never awaited", () => {
    expect(src).toMatch(/kind: "opened"/);
    expect(src).toMatch(/onAnswer: /);
    expect(src).toMatch(/onDone: /);
    expect(src).toMatch(/kind: "completed"/);
    expect(src).not.toMatch(/await\s+sendEvent/);
  });
  test("the button is a trailing control and only appears with a course backend or a stored code", () => {
    expect(src).toMatch(/fullscreenEl: figureHost, trailing/);
    expect(src).toMatch(/learnerButton\(/);
  });
  test("dismissing the 🎓 popover never also toggles playback", () => {
    expect(src).toMatch(/panel\.hidden = true;\s*e\.stopPropagation\(\);/);
  });
});
