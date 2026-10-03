import { describe, expect, it } from "vitest";
import { BAR_ZONE_FRACTION, barMayHide, inBarZone } from "../src/ui/controls";

describe("barMayHide", () => {
  it("fades out while playing and nobody holds the bar", () => {
    expect(barMayHide({ playing: true, held: false })).toBe(true);
  });

  it("stays while held — hovered, focused by keyboard, a menu of it open", () => {
    expect(barMayHide({ playing: true, held: true })).toBe(false);
  });

  it("never fades when paused, before the start or at the end", () => {
    expect(barMayHide({ playing: false, held: false })).toBe(false);
    expect(barMayHide({ playing: false, held: true })).toBe(false);
  });
});

describe("inBarZone", () => {
  const stage = { left: 0, top: 0, right: 400, bottom: 300 };
  const below = { left: 0, top: 304, right: 400, bottom: 344 };

  it("is the bottom fifth of the stage", () => {
    expect(BAR_ZONE_FRACTION).toBe(0.2);
    expect(inBarZone(200, 290, stage, below)).toBe(true);
    expect(inBarZone(200, 241, stage, below)).toBe(true);
    expect(inBarZone(200, 239, stage, below)).toBe(false);
  });

  it("is not the rest of the figure — the drawing, where questions are answered", () => {
    expect(inBarZone(200, 150, stage, below)).toBe(false);
    expect(inBarZone(10, 10, stage, below)).toBe(false);
  });

  it("is the bar itself, and the margin between it and a stage it sits right under", () => {
    expect(inBarZone(200, 320, stage, below)).toBe(true);
    expect(inBarZone(200, 302, stage, below)).toBe(true);
  });

  it("is not beside the stage, nor a far-off strip between it and a bar elsewhere", () => {
    expect(inBarZone(420, 290, stage, below)).toBe(false);
    const footer = { left: 0, top: 500, right: 400, bottom: 540 };
    expect(inBarZone(200, 400, stage, footer)).toBe(false);
    expect(inBarZone(200, 520, stage, footer)).toBe(true);
  });

  it("ignores a bar with no height (not laid out) and works without one", () => {
    const flat = { left: 0, top: 300, right: 400, bottom: 300 };
    expect(inBarZone(200, 290, stage, flat)).toBe(true);
    expect(inBarZone(200, 290, stage, null)).toBe(true);
    expect(inBarZone(200, 150, stage, null)).toBe(false);
  });
});
