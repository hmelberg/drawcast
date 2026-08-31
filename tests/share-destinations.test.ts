import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { panelVisibility, shareDestinations, type ShareDest, type ShareTo } from "../src/ui/share";

// Round-2 fix: DESTS is down to three (link/youtube/video — see below), but
// panelVisibility's own doc comment still said "four panels" from before one
// was retired.
it("panelVisibility's doc comment says three panels, matching DESTS", async () => {
  const src = await readFile(new URL("../src/ui/share.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/four panels/);
  expect(src).toMatch(/three panels/);
});

const all = { github: true, google: true, tts: true };
const ALL_IDS: ShareTo[] = ["link", "youtube", "video"];
const dest = (id: ShareTo): ShareDest => ({ id, label: id, action: id });

describe("shareDestinations", () => {
  it("offers three destinations for a drawcast when everything is configured", () => {
    expect(shareDestinations(all, "drawcast").map((d) => d.id))
      .toEqual(["link", "youtube", "video"]);
  });

  it("names each action with the verb its button performs", () => {
    const byId = Object.fromEntries(shareDestinations(all, "drawcast").map((d) => [d.id, d.action]));
    expect(byId).toEqual({ link: "Publish", youtube: "Upload", video: "Export" });
  });

  it("hides the link when there is no GitHub — a capability without its\n     credential does not advertise itself", () => {
    expect(shareDestinations({ ...all, github: false }, "drawcast").map((d) => d.id))
      .toEqual(["youtube", "video"]);
  });

  it("hides YouTube without Google, and video without a TTS key", () => {
    expect(shareDestinations({ github: true, google: false, tts: false }, "drawcast").map((d) => d.id))
      .toEqual(["link"]);
  });

  it("offers a course the link alone — batch video is not written", () => {
    expect(shareDestinations(all, "course").map((d) => d.id)).toEqual(["link"]);
  });

  it("can offer nothing at all", () => {
    expect(shareDestinations({ github: false, google: false, tts: false }, "course")).toEqual([]);
  });
});

describe("panelVisibility", () => {
  it("shows only the selected panel, and hides an unavailable one even though it is not selected", () => {
    // The bug this pins: a GitHub+TTS user (no Google) sees Link and Video
    // file in the rail, but before this function existed YouTube's panel —
    // never touched by the filtered `destinations` loop — stayed at its
    // un-set `.hidden` default and rendered anyway.
    const available = [dest("link"), dest("video")];
    const visible = panelVisibility(ALL_IDS, available, "link");
    expect(visible).toEqual({ link: true, youtube: false, video: false });
  });

  it("shows whichever available destination is selected", () => {
    const available = [dest("link"), dest("video")];
    expect(panelVisibility(ALL_IDS, available, "video")).toEqual({ link: false, youtube: false, video: true });
  });

  it("shows nothing when the selection names a destination that is not available", () => {
    // Defensive: a stale/invalid selection must never leak a hidden panel's
    // content rather than showing the wrong (but at least real) one.
    const available = [dest("link")];
    expect(panelVisibility(ALL_IDS, available, "youtube")).toEqual({ link: false, youtube: false, video: false });
  });

  it("shows all three when everything is available and one is picked", () => {
    const available = ALL_IDS.map(dest);
    expect(panelVisibility(ALL_IDS, available, "youtube")).toEqual({ link: false, youtube: true, video: false });
  });
});
