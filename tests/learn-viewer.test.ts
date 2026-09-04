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
    const save = src.indexOf("saveLearner(");
    const strip = src.indexOf("history.replaceState");
    expect(save).toBeGreaterThan(0);
    expect(strip).toBeGreaterThan(save);
    expect(src).toMatch(/stripLearnerParam\(location\.href\)/);
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
});
