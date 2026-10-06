// The retired password keys (credit plan delivery 2): a browser that holds a
// key the vending endpoint handed out loses it on its next visit; a key the
// author typed themselves is never touched.
import { beforeEach, describe, expect, test, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

import { purgeVendedKeys } from "../src/store";

beforeEach(() => mem.clear());

describe("purgeVendedKeys", () => {
  test("removes both vended keys, the flags and the usage tally", () => {
    mem.set("drawcast.apikey", "sk-ant-shared");
    mem.set("drawcast.ttskey", "AIza-shared");
    mem.set("drawcast.vendedKeys.v1", JSON.stringify({ anthropic: true, tts: true }));
    mem.set("drawcast.usage.v2", "{}");
    expect(purgeVendedKeys()).toEqual({ anthropic: true, tts: true });
    expect([...mem.keys()]).toEqual([]);
  });

  test("keeps a key the author typed (its flag was false)", () => {
    mem.set("drawcast.apikey", "sk-ant-own");
    mem.set("drawcast.ttskey", "AIza-shared");
    mem.set("drawcast.vendedKeys.v1", JSON.stringify({ anthropic: false, tts: true }));
    expect(purgeVendedKeys()).toEqual({ anthropic: false, tts: true });
    expect(mem.get("drawcast.apikey")).toBe("sk-ant-own");
    expect(mem.has("drawcast.ttskey")).toBe(false);
  });

  test("a browser that never had vended keys keeps everything", () => {
    mem.set("drawcast.apikey", "sk-ant-own");
    expect(purgeVendedKeys()).toEqual({ anthropic: false, tts: false });
    expect(mem.get("drawcast.apikey")).toBe("sk-ant-own");
  });
});
