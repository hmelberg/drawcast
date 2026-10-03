// Save to disk defaults to Script (a .cast) since 2026-10-03. Every stored
// settings blob already carries specFormat ("yaml", the old default, written
// by persist whether or not anyone chose it), so loadSettings moves a stored
// "yaml" to "script" ONCE — and a YAML picked after that stays.

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

describe("Save to disk's format", () => {
  test("a fresh browser saves as Script", () => {
    expect(DEFAULT_SETTINGS.specFormat).toBe("script");
    expect(loadSettings().specFormat).toBe("script");
  });

  test("a stored yaml (the old default) becomes script once, everything else untouched", () => {
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, specFormat: "yaml", model: "claude-sonnet-5" }));
    const s = loadSettings();
    expect(s.specFormat).toBe("script");
    expect(s.model).toBe("claude-sonnet-5");
  });

  test("YAML picked after the switch stays YAML", () => {
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, specFormat: "yaml" }));
    saveSettings({ ...loadSettings(), specFormat: "yaml" });
    expect(loadSettings().specFormat).toBe("yaml");
  });

  test("a stored json is a choice, and stays", () => {
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, specFormat: "json" }));
    expect(loadSettings().specFormat).toBe("json");
  });
});
