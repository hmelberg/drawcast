// Tap to type (2026-09-27): the host-side checks around a body's `editable`
// hook — the field it returns, the text the viewer types — the shared scrub
// arithmetic, and the wiring that keeps older bodies exactly as they were.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseFieldValue, validateEditField } from "../src/scenes/widget-effects";
import { niceStep, rescaleShares, scrubbed, writeLike, probabilityStep } from "../src/scenes/number-scrub";
import { fieldText } from "../src/ui/number-edit";
import { scenes } from "../src/scenes/registry";

describe("validateEditField: only a well-formed field reaches the DOM", () => {
  test("a good field passes, extra keys dropped", () => {
    expect(validateEditField({ value: 0.5, label: " p ", min: 0, max: 1, step: 0.01, box: { x: 1, y: 2, w: 3, h: 4 }, junk: 1 })).toEqual({
      field: { value: 0.5, label: "p", min: 0, max: 1, step: 0.01, box: { x: 1, y: 2, w: 3, h: 4 } },
      issues: [],
    });
  });
  test("null is 'not editable', silently", () => {
    expect(validateEditField(null)).toEqual({ field: null, issues: [] });
  });
  test("each defect is named", () => {
    const r = validateEditField({ value: NaN, label: "", min: 2, max: 1, step: 0, box: { x: 0, y: 0, w: 0, h: 1 } });
    expect(r.field).toBeNull();
    expect(r.issues.join(" | ")).toMatch(/value.*label.*step.*min is above max.*box/);
    expect(validateEditField("0.5").issues).toEqual(["editable must return an object or null"]);
  });
});

describe("parseFieldValue: what the viewer typed", () => {
  const p = { min: 0, max: 1 };
  test("numbers, a decimal comma, a percentage on a share", () => {
    expect(parseFieldValue(" 0.25 ", p)).toEqual({ value: 0.25 });
    expect(parseFieldValue("0,125", p)).toEqual({ value: 0.125 });
    expect(parseFieldValue("40%", p)).toEqual({ value: 0.4 });
    expect(parseFieldValue(".5", p)).toEqual({ value: 0.5 });
    expect(parseFieldValue("12,000", {})).toEqual({ value: 12000 });
    expect(parseFieldValue("−3", {})).toEqual({ value: -3 });
  });
  test("rejected, never clamped", () => {
    expect(parseFieldValue("", p)).toEqual({ error: "empty" });
    expect(parseFieldValue("abc", p)).toEqual({ error: "not a number" });
    expect(parseFieldValue("1e999", {})).toEqual({ error: "not a number" });
    expect(parseFieldValue("1.2", p)).toEqual({ error: "at most 1" });
    expect(parseFieldValue("-0.1", p)).toEqual({ error: "at least 0" });
  });
});

describe("the scrub's arithmetic", () => {
  test("a nice step near 1 %", () => {
    expect(niceStep(9.5, 0.1)).toBeCloseTo(0.1, 12);
    expect(niceStep(10000, 1)).toBe(100);
    expect(niceStep(150000, 1)).toBe(2000);
    expect(niceStep(0, 7)).toBe(7);
    expect(niceStep(-250, 1)).toBe(5);
  });
  test("whole steps from the press value, clamped", () => {
    expect(scrubbed(0.9, 3, 0.01, 0, 1)).toBe(0.9); // under one step
    expect(scrubbed(0.9, 4, 0.01, 0, 1)).toBe(0.91);
    expect(scrubbed(0.9, -7.9, 0.01, 0, 1)).toBe(0.89); // toward zero, symmetric
    expect(scrubbed(0.9, 400, 0.01, 0, 1)).toBe(1);
  });
  test("written like the author: decimals and the decimal comma", () => {
    expect(writeLike(0.2, "0.10")).toBe("0.20");
    expect(writeLike(0.125, "0.10")).toBe("0.125");
    expect(writeLike(0.3, "0,5")).toBe("0,30");
    expect(probabilityStep("0.005")).toBe(0.001);
    expect(probabilityStep("0.1")).toBe(0.01);
  });
  test("shares rescaled to a total, exact to the places", () => {
    expect(rescaleShares([0.3, 0.2], 0.4, 2)).toEqual([0.24, 0.16]);
    const r = rescaleShares([1, 1, 1], 1, 2);
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(rescaleShares([0, 0], 0.5, 2)).toEqual([0.25, 0.25]);
  });
  test("a field's starting text has no float dust", () => {
    expect(fieldText(0.1 + 0.2)).toBe("0.3");
    expect(fieldText(150000)).toBe("150000");
  });
});

describe("wiring", () => {
  test("decision_tree and markov_model carry live, editable bodies — free play, no manifest widget flag", () => {
    for (const name of ["decision_tree", "markov_model"]) {
      const m = scenes[name];
      expect(m.widget).toBeDefined();
      expect(m.manifest.widget).toBeUndefined();
      const b = m.widget!();
      expect(b.live).toBe(true);
      expect(typeof b.editable).toBe("function");
      expect(typeof b.parts).toBe("function");
    }
  });

  test("supply_demand's body has no editable hook: its taps still pass through", () => {
    expect(scenes["supply_demand"].widget!().editable).toBeUndefined();
  });

  test("one template lint hook: SceneModule.lint (markov moved off SceneLayout.issues)", () => {
    expect(scenes["markov_model"].lint).toBeDefined();
    expect(readFileSync("src/scenes/types.ts", "utf8")).not.toMatch(/^\s*issues\?:/m);
    expect(readFileSync("src/layout/layout.ts", "utf8")).not.toContain("sceneLayout.issues");
  });

  test("the stage: an edit tap swallows its click (card included) and opens the field; play and steps close it", () => {
    const src = readFileSync("src/ui/widget-host.ts", "utf8");
    expect(src).toContain('swallowAll = read === "drag" || read === "edit" || (read === "click" && host.live);');
    expect(src).toContain('if (read === "edit") openField();');
    expect((src.match(/closeField\(\);/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".cs-stage.cs-scrubbable, .cs-stage.cs-scrubbable.cs-grabbable, .cs-stage.cs-scrubbable.cs-grabbing { cursor: ew-resize; }");
    const edit = readFileSync("src/ui/number-edit.ts", "utf8");
    expect(edit).toContain('type: "number"');
    expect(edit).toContain('"aria-label": opts.label');
  });

  test("the pan: a live body's non-parts are the pan's (its host claims its own parts)", () => {
    expect(readFileSync("src/ui/view-pan.ts", "utf8")).toContain("(!!template.widget && !liveBody)");
  });
});
