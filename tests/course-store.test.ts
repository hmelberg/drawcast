// The course library, and the quota guard that stands between a forty-call
// batch run and a silent QuotaExceededError.

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

import { StorageFullError, deleteCourse, loadCourses, saveCourse, saveDrawing } from "../src/store";

beforeEach(() => {
  mem.clear();
  full = false;
});

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

  it("guards the drawing library too", () => {
    full = true;
    expect(() => saveDrawing({ id: "d1", title: "A", spec: {} as never, ts: "1" })).toThrow(StorageFullError);
  });

  it("says what could not be saved", () => {
    full = true;
    expect(() => saveCourse({ id: "c1", title: "A", text: "x", ts: "1" })).toThrow(/a course/);
  });
});
