import { describe, expect, test } from "vitest";
import { inControlRegion, registerContinue, registerControlRegion, tryContinue } from "../src/ui/control-press";

// A stand-in for the stage: the registry keys on object identity only.
const stage = {} as HTMLElement;
const ev = {} as MouseEvent;

describe("control-press registry", () => {
  test("no region registered: nothing is a control press", () => {
    expect(inControlRegion(stage, ev)).toBe(false);
  });
  test("a registered predicate decides, and unregistering removes it", () => {
    const off = registerControlRegion(stage, () => true);
    expect(inControlRegion(stage, ev)).toBe(true);
    off();
    expect(inControlRegion(stage, ev)).toBe(false);
  });
  test("any one of several predicates suffices", () => {
    const a = registerControlRegion(stage, () => false);
    const b = registerControlRegion(stage, () => true);
    expect(inControlRegion(stage, ev)).toBe(true);
    a();
    b();
  });
  test("continue: consumed only while a hook says so", () => {
    expect(tryContinue(stage)).toBe(false);
    let gated = true;
    const off = registerContinue(stage, () => gated);
    expect(tryContinue(stage)).toBe(true);
    gated = false;
    expect(tryContinue(stage)).toBe(false);
    off();
    gated = true;
    expect(tryContinue(stage)).toBe(false);
  });
});
