// The course library, and the quota guard that stands between a forty-call
// batch run and a silent QuotaExceededError. The drawing library is a cache
// persisted to IndexedDB since 2026-09-18; here, with no IndexedDB, the fake
// localStorage stands in as its mirror, so its rows are still visible below.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();
/** Set to make every write fail the way a full quota does. */
let full = false;
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (full) {
      const err = new Error("quota");
      err.name = "QuotaExceededError";
      throw err;
    }
    mem.set(k, v);
  },
  removeItem: (k: string) => void mem.delete(k),
});

import { StorageFullError, deleteCourse, hydrateStore, loadCourses, loadLibrary, saveCourse, saveDrawing } from "../src/store";

beforeEach(async () => {
  mem.clear();
  full = false;
  await hydrateStore(); // the library cache re-reads the (now empty) fake
});

/** The background write has landed once the microtasks have run. */
const settled = () => new Promise<void>((r) => setTimeout(r, 0));

describe("course library", () => {
  it("saves and loads a course", () => {
    saveCourse({ id: "c1", title: "Causal Inference", text: "# Causal Inference\n", ts: "2026-08-30" });
    expect(loadCourses()).toHaveLength(1);
    expect(loadCourses()[0].title).toBe("Causal Inference");
  });

  it("replaces by id rather than duplicating", () => {
    saveCourse({ id: "c1", title: "A", text: "x", ts: "1" });
    saveCourse({ id: "c1", title: "B", text: "y", ts: "2" });
    expect(loadCourses()).toHaveLength(1);
    expect(loadCourses()[0].title).toBe("B");
  });

  it("deletes by id", () => {
    saveCourse({ id: "c1", title: "A", text: "x", ts: "1" });
    deleteCourse("c1");
    expect(loadCourses()).toEqual([]);
  });
});

describe("quota", () => {
  it("turns a quota failure into StorageFullError, not a raw throw", () => {
    full = true;
    expect(() => saveCourse({ id: "c1", title: "A", text: "x", ts: "1" })).toThrow(StorageFullError);
  });

  it("no longer reaches the drawing library — a save there never throws, and the row stays in the cache", async () => {
    full = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => saveDrawing({ id: "d1", title: "A", spec: {} as never, ts: "1" })).not.toThrow();
    expect(loadLibrary()).toHaveLength(1);
    await settled();
    expect(warn).toHaveBeenCalled(); // the mirror write is reported, not raised
    warn.mockRestore();
  });

  it("says what could not be saved", () => {
    full = true;
    expect(() => saveCourse({ id: "c1", title: "A", text: "x", ts: "1" })).toThrow(/a course/);
  });
});

describe("the library behind the cache (no IndexedDB here)", () => {
  it("hydrates from the legacy localStorage key and mirrors every write back to it", async () => {
    mem.set("drawcast.library.v1", JSON.stringify([{ id: "old", title: "Kept", spec: {}, ts: "0" }]));
    await hydrateStore();
    expect(loadLibrary().map((d) => d.id)).toEqual(["old"]);
    // Without IndexedDB the key IS the store — never removed.
    expect(mem.has("drawcast.library.v1")).toBe(true);
    saveDrawing({ id: "new", title: "New", spec: {} as never, ts: "1" });
    expect(loadLibrary().map((d) => d.id)).toEqual(["new", "old"]);
    await settled();
    expect(JSON.parse(mem.get("drawcast.library.v1")!).map((d: { id: string }) => d.id)).toEqual(["new", "old"]);
  });
});

describe("course ownership", () => {
  it("keeps the courseId a lecture was saved with", () => {
    saveDrawing({ id: "d1", title: "Lecture 1", spec: {} as never, courseId: "c1", ts: "1" });
    expect(loadLibrary()[0].courseId).toBe("c1");
  });

  it("leaves an ordinary drawcast unowned", () => {
    saveDrawing({ id: "d2", title: "One-off", spec: {} as never, ts: "1" });
    expect(loadLibrary()[0].courseId).toBeUndefined();
  });

  it("replaces a lecture in place when it is saved again under the same id", () => {
    saveDrawing({ id: "d1", title: "Lecture 1", spec: {} as never, courseId: "c1", ts: "1" });
    saveDrawing({ id: "d1", title: "Lecture 1", spec: {} as never, courseId: "c1", playlist: "revised", ts: "2" });
    expect(loadLibrary()).toHaveLength(1);
    expect(loadLibrary()[0].playlist).toBe("revised");
  });
});
