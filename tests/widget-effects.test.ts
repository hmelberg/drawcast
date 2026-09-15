import { describe, expect, test } from "vitest";
import { validateEffects } from "../src/scenes/widget-effects";

const scene = { ids: ["key_dot", "key_dash"], paramNames: ["signal", "decoded"] };

describe("validateEffects", () => {
  test("a well-formed list passes untouched", () => {
    const { effects, issues } = validateEffects(
      [{ sound: { hz: 700, ms: 80 } }, { patch: { signal: "." } }, { glow: "key_dot", color: "#4a7c59" }, { pointer: "key_dash" }, { caption: "dot" }, { answer: "S" }],
      scene,
    );
    expect(issues).toEqual([]);
    expect(effects).toHaveLength(6);
    expect(effects[2].glow).toEqual(["key_dot"]);
  });
  test("a non-array is an issue and yields nothing", () => {
    expect(validateEffects({ patch: {} }, scene)).toEqual({ effects: [], issues: ["effects must be an array"] });
  });
  test("an unknown param in a patch is dropped with an issue, the rest kept", () => {
    const { effects, issues } = validateEffects([{ patch: { signal: ".", bogus: 1 } }], scene);
    expect(effects).toEqual([{ patch: { signal: "." } }]);
    expect(issues).toEqual(['patch: "bogus" is not a template param (signal, decoded)']);
  });
  test("an unknown effect key is an issue; an unknown part in glow/pointer is dropped", () => {
    const { effects, issues } = validateEffects([{ blink: 1 }, { glow: ["nope", "key_dot"] }, { pointer: "nope" }], scene);
    expect(effects).toEqual([{ glow: ["key_dot"] }]);
    expect(issues).toContain('unknown effect key "blink"');
    expect(issues).toContain('glow: "nope" is not a part');
    expect(issues).toContain('pointer: "nope" is not a part');
  });
  test("sound needs hz and ms, or notes", () => {
    const { effects, issues } = validateEffects([{ sound: { hz: 700 } }, { sound: { notes: "C4:q" } }, { sound: "beep" }], scene);
    expect(effects).toEqual([{ sound: { notes: "C4:q" } }]);
    expect(issues).toHaveLength(2);
  });
  test("answer and caption must be strings", () => {
    const { effects, issues } = validateEffects([{ answer: 3 }, { caption: ["x"] }], scene);
    expect(effects).toEqual([]);
    expect(issues).toHaveLength(2);
  });
});
