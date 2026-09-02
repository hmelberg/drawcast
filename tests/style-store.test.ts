import { beforeEach, describe, expect, it, vi } from "vitest";

// B5: style profiles are localStorage-only by ruling (S §4.1 option 1).
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

import { deleteStyle, loadStyles, saveStyle } from "../src/store";

describe("style profiles", () => {
  beforeEach(() => mem.clear());

  it("saves, updates by id (newest first), and deletes", () => {
    saveStyle({ id: "a", name: "Lectures", text: "Open with a question.", ts: "1" });
    saveStyle({ id: "b", name: "Kids", text: "Short words.", ts: "2" });
    expect(loadStyles().map((s) => s.id)).toEqual(["b", "a"]);
    saveStyle({ id: "a", name: "Lectures", text: "One idea per screen.", ts: "3" });
    expect(loadStyles()[0]).toMatchObject({ id: "a", text: "One idea per screen." });
    expect(loadStyles()).toHaveLength(2);
    deleteStyle("a");
    expect(loadStyles().map((s) => s.id)).toEqual(["b"]);
  });

  it("an empty store is an empty list, not a throw", () => {
    expect(loadStyles()).toEqual([]);
  });
});
