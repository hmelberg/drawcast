// Burning the caption into the picture is right for one destination and wrong
// for the other. A downloaded file has no subtitle layer and a loose .vtt gets
// lost; YouTube has one, and burns its own automatic captions on top of ours —
// so a burnt-in upload shows every sentence twice. Two independent settings,
// each defaulting to what its own destination needs.

import { beforeEach, describe, expect, test, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

import { DEFAULT_SETTINGS, loadSettings } from "../src/store";

const SETTINGS_KEY = "drawcast.settings.v1";

beforeEach(() => mem.clear());

describe("caption burn-in defaults", () => {
  test("a download burns the caption in; an upload does not", () => {
    expect(DEFAULT_SETTINGS.burnCaptions).toBe(true);
    expect(DEFAULT_SETTINGS.burnCaptionsOnUpload).toBe(false);
  });

  test("settings stored before the split do not start burning captions into uploads", () => {
    const stored = { ...DEFAULT_SETTINGS, burnCaptions: true } as Record<string, unknown>;
    delete stored.burnCaptionsOnUpload;
    mem.set(SETTINGS_KEY, JSON.stringify(stored));

    const s = loadSettings();

    expect(s.burnCaptionsOnUpload).toBe(false);
    expect(s.burnCaptions).toBe(true); // the download preference is untouched
  });

  test("turning the upload burn-in on is remembered, not overwritten by the default", () => {
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, burnCaptionsOnUpload: true }));
    expect(loadSettings().burnCaptionsOnUpload).toBe(true);
  });
});
