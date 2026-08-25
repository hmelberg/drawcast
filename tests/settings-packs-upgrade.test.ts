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

  // The real-world case: a browser that already ran the FIRST pack-defaults
  // upgrade (9e9b9e0, packsDefault.v1) has that flag set and its
  // enabledPacks already unioned to the old default set. This branch grew
  // DEFAULT_SETTINGS.enabledPacks again (economics/evidence/mathlogic), so
  // without a new flag key that browser's v1 flag would forever block the
  // second union and it would never see the new academic packs.
  test("a browser that already ran the v1 upgrade still gains the new academic packs", () => {
    mem.set("drawcast.packsDefault.v1", "1"); // the OLD one-shot flag, already spent
    mem.set(
      SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, enabledPacks: ["physics", "chemistry", "biology"] })
    );

    const s = loadSettings();

    expect([...s.enabledPacks].sort()).toEqual([...DEFAULT_SETTINGS.enabledPacks].sort());
    expect(s.enabledPacks).toEqual(expect.arrayContaining(["economics", "evidence", "mathlogic"]));
    // The default-off carve-out never rides along with the union.
    expect(s.enabledPacks).not.toContain("games");
    expect(s.enabledPacks).not.toContain("maps");
  });

  test("un-toggling a pack after the v2 union sticks on the next load", () => {
    mem.set("drawcast.packsDefault.v1", "1");
    mem.set(
      SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, enabledPacks: ["physics", "chemistry", "biology"] })
    );

    const upgraded = loadSettings(); // runs the v2 union, sets the v2 flag
    saveSettings({ ...upgraded, enabledPacks: upgraded.enabledPacks.filter((id) => id !== "economics") });

    const s = loadSettings(); // v2 flag now set — no second union
    expect(s.enabledPacks).not.toContain("economics");
    expect(s.enabledPacks).toContain("mathlogic");
    expect(s.enabledPacks).not.toContain("games");
    expect(s.enabledPacks).not.toContain("maps");
  });
});
