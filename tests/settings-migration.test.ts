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
import type { Settings } from "../src/store";
import { DEFAULT_ON_DEMAND_MAX } from "../src/llm/on-demand-run";
import { APPROACHES, DEFAULT_APPROACH, DEFAULT_STORYBOARD_VERSION, STORYBOARD_VERSIONS } from "../src/llm/storyboard";
import { singleCastTreatment } from "../src/llm/treatment";

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
  it("accepts the drawcast server — the third publish destination (round 0 spec §4)", () => {
    expect(migrateShareTo("server")).toBe("server");
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

  it("remembers the drawcast server across a reload", () => {
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, shareTo: "server" }));
    expect(loadSettings().shareTo).toBe("server");
  });
});

describe("the template-on-demand cap", () => {
  it("defaults to the run module's default — store.ts spells it as a literal, so pin the two equal", () => {
    expect(DEFAULT_SETTINGS.templatesOnDemandMax).toBe(DEFAULT_ON_DEMAND_MAX);
    expect(DEFAULT_SETTINGS.templatesOnDemandMax).toBe(3);
  });
  it("a settings blob stored before the cap existed gets the default on load", () => {
    const { templatesOnDemandMax: _dropped, ...older } = DEFAULT_SETTINGS;
    mem.set(SETTINGS_KEY, JSON.stringify({ ...older, templatesOnDemand: true }));
    const s = loadSettings();
    expect(s.templatesOnDemand).toBe(true);
    expect(s.templatesOnDemandMax).toBe(3);
  });
  it("a stored cap survives a reload", () => {
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, templatesOnDemandMax: 0 }));
    expect(loadSettings().templatesOnDemandMax).toBe(0);
  });
});

describe("the approach setting (docs/2026-09-19-storyboard-approach.md)", () => {
  it("defaults to the storyboard module's default — store.ts spells it as a literal union, so pin the two equal", () => {
    expect(DEFAULT_SETTINGS.approach).toBe(DEFAULT_APPROACH);
  });
  it("every APPROACHES id is assignable to Settings.approach's literal union", () => {
    for (const { id } of APPROACHES) {
      const pinned: Settings["approach"] = id;
      expect(["storyboard", "independent"]).toContain(pinned);
    }
  });
  // 2026-09-28: the same setting now decides a SINGLE drawcast too — the
  // storyline first (treatment v3) or one call. The ids did not change, so a
  // stored blob needs no migration: a default user gets the storyline, one
  // who chose "independent" keeps the one-shot call.
  it("governs single drawcasts: storyboard (the default) → the storyline, independent → one call", () => {
    expect(singleCastTreatment(DEFAULT_SETTINGS)).toBe("v3");
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, approach: "independent" }));
    expect(singleCastTreatment(loadSettings())).toBeUndefined();
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, approach: "storyboard" }));
    expect(singleCastTreatment(loadSettings())).toBe("v3");
  });
  it("the lab's Pipeline 'plan' still forces the v2 sheet — in developer mode only", () => {
    expect(singleCastTreatment({ ...DEFAULT_SETTINGS, developerMode: true, pipeline: "plan" })).toBe("v2");
    expect(singleCastTreatment({ ...DEFAULT_SETTINGS, developerMode: true, pipeline: "plan", approach: "independent" })).toBe("v2");
    expect(singleCastTreatment({ ...DEFAULT_SETTINGS, developerMode: false, pipeline: "plan" })).toBe("v3");
  });
  it("the storyboard prompt (2026-09-28) defaults to v1, the storyboard module's default", () => {
    expect(DEFAULT_SETTINGS.storyboardVersion).toBe("v1");
    expect(DEFAULT_SETTINGS.storyboardVersion).toBe(DEFAULT_STORYBOARD_VERSION);
    for (const { id } of STORYBOARD_VERSIONS) {
      const pinned: Settings["storyboardVersion"] = id;
      expect(["v1", "v2"]).toContain(pinned);
    }
  });
  it("a blob stored before the storyboard prompt existed loads as v1; v2 survives; junk falls back to v1", () => {
    const { storyboardVersion: _drop, ...old } = DEFAULT_SETTINGS;
    mem.set(SETTINGS_KEY, JSON.stringify(old));
    expect(loadSettings().storyboardVersion).toBe("v1");
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, storyboardVersion: "v2" }));
    expect(loadSettings().storyboardVersion).toBe("v2");
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, storyboardVersion: "v9" }));
    expect(loadSettings().storyboardVersion).toBe("v1");
  });
  it("the picker says what it does for a single drawcast and for parts", () => {
    const story = APPROACHES.find((a) => a.id === "storyboard")!;
    expect(story.label).toBe("Write the story first (storyline)");
    expect(story.hint).toMatch(/single drawcast/);
    expect(story.hint).toMatch(/multi-part/);
  });
});

describe("the visual repair toggle (freehand-figures Task 14)", () => {
  it("defaults to false — off until measured", () => {
    expect(DEFAULT_SETTINGS.visualRepair).toBe(false);
  });
  it("a settings blob stored before the toggle existed gets the default (false) on load", () => {
    const { visualRepair: _dropped, ...older } = DEFAULT_SETTINGS;
    mem.set(SETTINGS_KEY, JSON.stringify(older));
    expect(loadSettings().visualRepair).toBe(false);
  });
  it("a stored true survives a reload", () => {
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, visualRepair: true }));
    expect(loadSettings().visualRepair).toBe(true);
  });
});
