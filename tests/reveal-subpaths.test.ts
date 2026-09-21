import { describe, expect, it } from "vitest";
import { chunkSubpaths, revealLocals, splitSubpaths } from "../src/render/svg-backend";

describe("splitSubpaths", () => {
  it("returns the one subpath of a simple line", () => {
    expect(splitSubpaths("M0 0 L10 0")).toEqual(["M0 0 L10 0"]);
  });

  it("splits at every absolute moveto", () => {
    expect(splitSubpaths("M0 0 L10 0 M20 0 L30 0")).toEqual(["M0 0 L10 0", "M20 0 L30 0"]);
  });

  it("keeps a closepath with the subpath it closes", () => {
    expect(splitSubpaths("M0 0 L10 0 Z M20 0 L30 0 Z")).toEqual(["M0 0 L10 0 Z", "M20 0 L30 0 Z"]);
  });

  it("splits rough.js curve passes", () => {
    const d = "M1 1 C2 2, 3 3, 4 4 M4 4 C5 5, 6 6, 7 7";
    expect(splitSubpaths(d)).toHaveLength(2);
  });

  it("refuses data with a relative moveto — it reads from the previous subpath's end", () => {
    expect(splitSubpaths("M0 0 L10 0 m5 0 l10 0")).toBeNull();
  });

  it("refuses empty data", () => {
    expect(splitSubpaths("")).toBeNull();
    expect(splitSubpaths("   ")).toBeNull();
  });

  it("leaves relative commands inside a subpath alone", () => {
    expect(splitSubpaths("M0 10 h20 v10 h-20 Z")).toEqual(["M0 10 h20 v10 h-20 Z"]);
  });
});

describe("chunkSubpaths", () => {
  it("gives every subpath its own node when they fit", () => {
    expect(chunkSubpaths(["a", "b", "c"], 4)).toEqual(["a", "b", "c"]);
  });

  it("groups consecutive subpaths when there are more than the cap", () => {
    const out = chunkSubpaths(["a", "b", "c", "d", "e"], 2);
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out.join(" ")).toBe("a b c d e");
  });

  it("keeps the drawing order", () => {
    const subs = Array.from({ length: 1000 }, (_, i) => `s${i}`);
    const out = chunkSubpaths(subs, 240);
    expect(out.length).toBeLessThanOrEqual(240);
    expect(out.join(" ")).toBe(subs.join(" "));
  });
});

describe("revealLocals", () => {
  it("draws nothing at t = 0", () => {
    expect(revealLocals([10, 20, 30], 0)).toEqual([0, 0, 0]);
  });

  it("draws everything at t = 1", () => {
    expect(revealLocals([10, 20, 30], 1)).toEqual([10, 20, 30]);
  });

  it("finishes one stroke before it starts the next", () => {
    // 60 units in all; at a sixth of the way the first stroke is done and
    // nothing else has begun — the pen is never in two places at once.
    expect(revealLocals([10, 20, 30], 10 / 60)).toEqual([10, 0, 0]);
    expect(revealLocals([10, 20, 30], 20 / 60)).toEqual([10, 10, 0]);
  });

  it("survives a zero-length stroke", () => {
    expect(revealLocals([0, 10], 0.5)).toEqual([0, 5]);
  });

  it("survives an element with no length at all", () => {
    expect(revealLocals([0, 0], 0.5)).toEqual([0, 0]);
  });
});
