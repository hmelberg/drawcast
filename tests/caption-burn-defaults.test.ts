// Burning the caption into the picture is a question worth asking about ONE
// destination. A downloaded file has no subtitle layer and a loose .vtt gets
// lost, so the download burns in by default. YouTube has a subtitle layer and
// paints its own automatic captions over the picture, so a burnt-in upload
// shows every sentence twice — it never burns in, and there is no setting for
// it any more (publish-polish spec §2 ruling 4). One setting, for the one
// destination where the answer can go either way.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";

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
  test("a download burns the caption in", () => {
    expect(DEFAULT_SETTINGS.burnCaptions).toBe(true);
  });

  test("turning the download burn-in off is remembered, not overwritten by the default", () => {
    mem.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, burnCaptions: false }));
    expect(loadSettings().burnCaptions).toBe(false);
  });

  test("a settings blob stored before the upload setting died loads without it", () => {
    // The dead key rides along in the stored JSON — nothing reads it, and the
    // download preference beside it is untouched.
    const stored = { ...DEFAULT_SETTINGS, burnCaptions: true, burnCaptionsOnUpload: true } as Record<string, unknown>;
    mem.set(SETTINGS_KEY, JSON.stringify(stored));

    const s = loadSettings();

    expect(s.burnCaptions).toBe(true);
    expect(Object.keys(DEFAULT_SETTINGS)).not.toContain("burnCaptionsOnUpload");
  });
});

describe("the upload never burns in (spec §2 ruling 4)", () => {
  test("the setting is gone from the store and the YouTube panel", async () => {
    const store = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");
    const share = await readFile(new URL("../src/ui/share.ts", import.meta.url), "utf8");
    expect(store.length).toBeGreaterThan(1000);
    expect(store).not.toContain("burnCaptionsOnUpload");
    expect(share).not.toContain("burnCaptionsOnUpload");
    // The upload renders with burn-in off, unconditionally.
    expect(share).toContain("deps.renderVideo(exportSequence(playlist), false, of)");
  });

  test("the download's own checkbox and setting survive", async () => {
    const share = await readFile(new URL("../src/ui/share.ts", import.meta.url), "utf8");
    expect(share).toContain("deps.settings.burnCaptions = videoBurnCb.checked;");
    expect(share).toContain("deps.renderVideo(exportSequence(doc.playlist), videoBurnCb.checked)");
  });
});
