import { describe, expect, test } from "vitest";
import { linkAt, openModeFor } from "../src/ui/link-host";

describe("openModeFor", () => {
  test("auto: this page once finished, a new tab before", () => {
    expect(openModeFor(undefined, "done", false)).toBe("here");
    expect(openModeFor("auto", "playing", false)).toBe("tab");
    expect(openModeFor("auto", "paused", false)).toBe("tab");
    expect(openModeFor("auto", "idle", false)).toBe("tab");
  });
  test("an explicit open wins; a modified click is always a tab", () => {
    expect(openModeFor("here", "playing", false)).toBe("here");
    expect(openModeFor("window", "done", false)).toBe("window");
    expect(openModeFor("here", "done", true)).toBe("tab");
  });
});

describe("linkAt", () => {
  const links = [
    { id: "big", box: { x: 0, y: 0, w: 500, h: 500 } },
    { id: "small", box: { x: 100, y: 100, w: 50, h: 50 } },
  ];
  test("the smallest visible box under the point", () => {
    expect(linkAt(links, new Set(["big", "small"]), [120, 120])).toBe("small");
    expect(linkAt(links, new Set(["big"]), [120, 120])).toBe("big");
    expect(linkAt(links, new Set(["big", "small"]), [600, 600])).toBeNull();
    expect(linkAt(links, new Set(), [120, 120])).toBeNull();
  });
});
