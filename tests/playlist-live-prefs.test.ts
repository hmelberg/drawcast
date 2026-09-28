// A ☰ jump or a part change rebuilds the control bar from the session's
// prefs. They must be the viewer's latest choices, not the session's first
// ones: muting and then changing part left the narration muted in the app
// but put the published viewer (which passes no `muted`) back to sound, and
// narrated went back to silent. mountPlaylist needs a DOM (none here), so the
// pure helper is tested and the session is pinned to use it.
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { livePrefs } from "../src/playlist/live-prefs";

describe("livePrefs", () => {
  test("follows mute, mode and speed as the bar reports them, and forwards each to the host", () => {
    const onMute = vi.fn();
    const onMode = vi.fn();
    const onSpeed = vi.fn();
    const p = livePrefs({ mode: "silent", speed: 1, onMute, onMode, onSpeed });
    expect(p.muted).toBeUndefined();
    p.onMute!(true);
    p.onMode!("narrated");
    p.onSpeed!(1.5);
    // what the next mount's attachPlayerControls reads
    expect(p.muted).toBe(true);
    expect(p.mode).toBe("narrated");
    expect(p.speed).toBe(1.5);
    expect(onMute).toHaveBeenCalledWith(true);
    expect(onMode).toHaveBeenCalledWith("narrated");
    expect(onSpeed).toHaveBeenCalledWith(1.5);
  });

  test("a host without callbacks (the published viewer) still keeps the choice", () => {
    const p = livePrefs({ mode: "narrated", speed: 1 });
    p.onMute!(true);
    expect(p.muted).toBe(true);
    p.onMute!(false);
    expect(p.muted).toBe(false);
  });

  test("never mutates the host's object", () => {
    const start = { mode: "silent" as const, speed: 1 };
    livePrefs(start).onMode!("narrated");
    expect(start.mode).toBe("silent");
  });
});

describe("the session mounts every item from the live values", () => {
  const session = readFileSync(new URL("../src/playlist/session.ts", import.meta.url), "utf8");
  test("prefs come from livePrefs, not a one-time copy", () => {
    expect(session).toMatch(/const prefs: PlaybackPrefs = livePrefs\(\{/);
  });
  test("the figure renders in the live mode and speed", () => {
    expect(session).toMatch(/get mode\(\) \{\s*return modeRef;/);
    expect(session).toMatch(/get speed\(\) \{\s*return speedRef;/);
    expect(session).not.toMatch(/mode: opts\.mode, speed: opts\.speed/);
  });
});
