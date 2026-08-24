// The bundled packs became part of the baseline library (DEFAULT_SETTINGS).
// A browser that stored its settings before that carries the old opt-in list,
// so the new default would never reach the only people already using the app.
// loadSettings unions the built-in pack ids in ONCE — and a deliberate
// un-toggle afterwards must stick.

import { beforeEach, describe, expect, test, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../src/store";

const SETTINGS_KEY = "drawcast.settings.v1";

beforeEach(() => mem.clear());

describe("loadSettings pack upgrade", () => {
  test("a fresh browser just gets the defaults", () => {
    expect(loadSettings().enabledPacks).toEqual(DEFAULT_SETTINGS.enabledPacks);
  });

  test("settings stored before the change gain the built-in packs", () => {
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, model: "claude-sonnet-5", enabledPacks: [] }));

    const s = loadSettings();

    expect([...s.enabledPacks].sort()).toEqual([...DEFAULT_SETTINGS.enabledPacks].sort());
    expect(s.model).toBe("claude-sonnet-5"); // everything else is untouched
  });

  test("a pack the user switched off afterwards stays off", () => {
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, enabledPacks: [] }));
    const upgraded = loadSettings();

    saveSettings({ ...upgraded, enabledPacks: upgraded.enabledPacks.filter((id) => id !== "biology") });

    expect(loadSettings().enabledPacks).not.toContain("biology");
  });

  test("packs the user had already enabled survive the upgrade", () => {
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, enabledPacks: ["chemistry", "some_remote_pack"] }));

    expect(loadSettings().enabledPacks).toContain("some_remote_pack");
    expect(loadSettings().enabledPacks).toContain("physics");
  });
});
