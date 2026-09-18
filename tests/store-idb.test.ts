// The drawing library and the logs in IndexedDB (2026-09-18: a batch course
// generation filled localStorage's ~5 MB quota). A small fake of the four
// IndexedDB calls store.ts makes — open, createObjectStore, get, put — is
// enough to pin what matters: the one-time migration of Hans's saved
// drawcasts out of localStorage, the background write behind every save,
// the log cap, and that a store failure is reported, never thrown.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- fakes ---------------------------------------------------------------
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

/** The one object store, by key. */
const idb = new Map<string, string>();
/** Set to make every put fail, the way a full or broken database does. */
let putFails = false;
type Handler = (() => void) | null;
function later(fn: () => void): void {
  queueMicrotask(fn);
}
const fakeDb = {
  createObjectStore: () => undefined,
  transaction: () => {
    const tx: { oncomplete: Handler; onerror: Handler; onabort: Handler; objectStore: () => unknown } = {
      oncomplete: null,
      onerror: null,
      onabort: null,
      objectStore: () => ({
        get: (key: string) => {
          const req: { result: unknown; onsuccess: Handler; onerror: Handler } = { result: idb.get(key), onsuccess: null, onerror: null };
          later(() => req.onsuccess?.());
          return req;
        },
        put: (value: string, key: string) => {
          if (putFails) later(() => tx.onerror?.());
          else {
            idb.set(key, value);
            later(() => tx.oncomplete?.());
          }
        },
      }),
    };
    return tx;
  },
};
vi.stubGlobal("indexedDB", {
  open: () => {
    const req: { result: unknown; onupgradeneeded: Handler; onsuccess: Handler; onerror: Handler } = { result: fakeDb, onupgradeneeded: null, onsuccess: null, onerror: null };
    later(() => {
      req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
});

import { appendLog, clearLogs, deleteDrawing, hydrateStore, loadLibrary, loadLogs, saveDrawing, updateLog, type LogEntry, type SavedDrawing } from "../src/store";

const drawing = (id: string, title = id): SavedDrawing => ({ id, title, spec: {} as never, ts: "1" });
const log = (id: string): LogEntry => ({ id, ts: "1", prompt: id, config: { model: "m", promptVariant: "v", specVersion: "1" }, rounds: [], spec: null, lintIssues: [], warnings: [] });
const settled = () => new Promise<void>((r) => setTimeout(r, 0));
const stored = (key: string): { id: string }[] => JSON.parse(idb.get(key) ?? "[]");

beforeEach(async () => {
  mem.clear();
  idb.clear();
  putFails = false;
  await hydrateStore();
});

describe("migration out of localStorage", () => {
  it("imports the legacy library and logs on hydrate, then removes the old keys", async () => {
    mem.set("drawcast.library.v1", JSON.stringify([drawing("a"), drawing("b")]));
    mem.set("drawcast.logs.v1", JSON.stringify([log("l1")]));
    await hydrateStore();
    expect(loadLibrary().map((d) => d.id)).toEqual(["a", "b"]);
    expect(loadLogs().map((l) => l.id)).toEqual(["l1"]);
    expect(stored("library").map((d) => d.id)).toEqual(["a", "b"]);
    expect(stored("logs").map((l) => l.id)).toEqual(["l1"]);
    expect(mem.has("drawcast.library.v1")).toBe(false);
    expect(mem.has("drawcast.logs.v1")).toBe(false);
  });

  it("unions by id with what IndexedDB already holds — a copy left behind cannot double a row", async () => {
    idb.set("library", JSON.stringify([drawing("a", "newer")]));
    mem.set("drawcast.library.v1", JSON.stringify([drawing("a", "older"), drawing("z")]));
    await hydrateStore();
    expect(loadLibrary().map((d) => [d.id, d.title])).toEqual([
      ["a", "newer"],
      ["z", "z"],
    ]);
  });

  it("keeps the legacy key when the IndexedDB write does not commit", async () => {
    mem.set("drawcast.library.v1", JSON.stringify([drawing("a")]));
    putFails = true;
    await hydrateStore();
    expect(loadLibrary().map((d) => d.id)).toEqual(["a"]); // read into the cache regardless
    expect(mem.has("drawcast.library.v1")).toBe(true);
  });

  it("an empty browser hydrates to empty collections and touches nothing", async () => {
    expect(loadLibrary()).toEqual([]);
    expect(loadLogs()).toEqual([]);
    expect(idb.size).toBe(0);
  });
});

describe("the library", () => {
  it("reads synchronously from the cache and persists in the background", async () => {
    saveDrawing(drawing("d1"));
    expect(loadLibrary().map((d) => d.id)).toEqual(["d1"]); // before any await
    await settled();
    expect(stored("library").map((d) => d.id)).toEqual(["d1"]);
    saveDrawing(drawing("d2"));
    saveDrawing(drawing("d1", "again"));
    deleteDrawing("d2");
    expect(loadLibrary().map((d) => [d.id, d.title])).toEqual([["d1", "again"]]);
    await settled();
    expect(stored("library")).toEqual(loadLibrary());
    expect(mem.size).toBe(0); // nothing goes to localStorage any more
  });

  it("survives a reload: a fresh hydrate reads back what was persisted", async () => {
    saveDrawing(drawing("d1"));
    await settled();
    await hydrateStore();
    expect(loadLibrary().map((d) => d.id)).toEqual(["d1"]);
  });

  it("reports a failed write on the console and never throws", async () => {
    putFails = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => saveDrawing(drawing("d1"))).not.toThrow();
    expect(loadLibrary()).toHaveLength(1);
    await settled();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("the logs", () => {
  it("append, update and clear go through the cache and the store", async () => {
    appendLog(log("l1"));
    appendLog(log("l2"));
    updateLog("l1", { rating: 4 });
    updateLog("nope", { rating: 1 });
    expect(loadLogs().map((l) => [l.id, l.rating])).toEqual([
      ["l1", 4],
      ["l2", undefined],
    ]);
    await settled();
    expect(stored("logs").map((l) => l.id)).toEqual(["l1", "l2"]);
    clearLogs();
    expect(loadLogs()).toEqual([]);
    await settled();
    expect(stored("logs")).toEqual([]);
  });

  it("keeps the newest 300", async () => {
    for (let i = 0; i < 305; i++) appendLog(log(`l${i}`));
    expect(loadLogs()).toHaveLength(300);
    expect(loadLogs()[0].id).toBe("l5");
    expect(loadLogs()[299].id).toBe("l304");
    // …on hydrate too, should a copy come in from localStorage: those rows
    // predate everything in IndexedDB, so they go first and the cap drops them.
    mem.set("drawcast.logs.v1", JSON.stringify(Array.from({ length: 10 }, (_, i) => log(`old${i}`))));
    await settled();
    await hydrateStore();
    expect(loadLogs()).toHaveLength(300);
    expect(loadLogs()[0].id).toBe("l5");
    expect(loadLogs()[299].id).toBe("l304");
  });
});
