// Share dropped its "spec" destination — downloading your own source moved
// to Save → To disk (spec §1). A settings blob written before that change
// can still hold shareTo: "spec" in localStorage; migrateShareTo is what
// keeps loadSettings() from handing Share a destination that no longer
// exists. See loadSettings() in ../src/store for where this is actually
// applied to the stored value, not merely exported.

import { beforeEach, describe, expect, it, vi } from "vitest";

// A stub localStorage, exactly like settings-packs-upgrade.test.ts's — needed
// for the loadSettings() integration tests below, which are what actually
// prove the migration runs on a real machine rather than merely existing as
// an exported, unused function. A fresh test environment has no stored
// settings at all, which is exactly how this would slip through untested.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

import { DEFAULT_SETTINGS, loadSettings, migrateShareTo } from "../src/store";

const SETTINGS_KEY = "drawcast.settings.v1";

beforeEach(() => mem.clear());

describe("migrateShareTo", () => {
  it("moves a stored 'spec' to 'link' — that destination no longer exists", () => {
    expect(migrateShareTo("spec")).toBe("link");
  });
  it("leaves the surviving destinations alone", () => {
    for (const v of ["link", "youtube", "video"]) expect(migrateShareTo(v)).toBe(v);
  });
  it("accepts the Drive destination — a remembered \"drive\" must survive the round trip", () => {
    // Share writes settings.shareTo on every destination click, so publishing
    // to Drive once and reloading would otherwise silently snap the modal back
    // to GitHub: an unrecognised value falls through to "link".
    expect(migrateShareTo("drive")).toBe("drive");
  });
  it("falls back to link for anything unrecognised", () => {
    expect(migrateShareTo("nonsense")).toBe("link");
  });
});

describe("loadSettings", () => {
  it("migrates a stored shareTo: \"spec\" to \"link\" — not merely exported, actually applied on load", () => {
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, shareTo: "spec" }));
    expect(loadSettings().shareTo).toBe("link");
  });

  it("leaves a surviving destination untouched", () => {
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, shareTo: "youtube" }));
    expect(loadSettings().shareTo).toBe("youtube");
  });

  it("a fresh browser with no stored settings just gets the default", () => {
    expect(loadSettings().shareTo).toBe("link");
  });

  it("remembers Drive across a reload", () => {
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, shareTo: "drive" }));
    expect(loadSettings().shareTo).toBe("drive");
  });
});
