import { describe, expect, test } from "vitest";
import { clampBox, POPOUT_MIN, readBox, writeBox } from "../src/ui/tray-popout";

describe("tray pop-out geometry", () => {
  test("clamps inside the host and never below the minimum size", () => {
    expect(clampBox({ x: -20, y: -5, w: 300, h: 200 }, { w: 800, h: 600 })).toEqual({ x: 0, y: 0, w: 300, h: 200 });
    expect(clampBox({ x: 700, y: 550, w: 300, h: 200 }, { w: 800, h: 600 })).toEqual({ x: 500, y: 400, w: 300, h: 200 });
    expect(clampBox({ x: 0, y: 0, w: 10, h: 10 }, { w: 800, h: 600 })).toEqual({ x: 0, y: 0, w: POPOUT_MIN.w, h: POPOUT_MIN.h });
    expect(clampBox({ x: 0, y: 0, w: 2000, h: 2000 }, { w: 800, h: 600 })).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });
  test("storage round-trips and survives garbage or a throwing storage", () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    writeBox(s, "k", { x: 1, y: 2, w: 300, h: 150 });
    expect(readBox(s, "k")).toEqual({ x: 1, y: 2, w: 300, h: 150 });
    store.set("k", "{nope");
    expect(readBox(s, "k")).toBeNull();
    expect(readBox({ getItem: () => { throw new Error("private mode"); } }, "k")).toBeNull();
    expect(() => writeBox({ setItem: () => { throw new Error("quota"); } }, "k", { x: 0, y: 0, w: 300, h: 150 })).not.toThrow();
    expect(readBox(null, "k")).toBeNull();
  });
});
