import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { destinationOffers, panelVisibility, shareDestinations, type ShareDest, type ShareTo } from "../src/ui/share";

// panelVisibility's doc comment counts the panels, and the count has been
// wrong before (it said "four" after one of four was retired). Google Drive
// (spec §7) brings it back to four — so the comment has to move with DESTS
// again, and this pins that it did.
it("panelVisibility's doc comment says four panels, matching DESTS", async () => {
  const src = await readFile(new URL("../src/ui/share.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/three panels/);
  expect(src).toMatch(/four panels/);
});

const all = { github: true, google: true, tts: true };
const ALL_IDS: ShareTo[] = ["link", "drive", "youtube", "video"];
const dest = (id: ShareTo): ShareDest => ({ id, label: id, action: id });

describe("shareDestinations", () => {
  it("offers four destinations for a drawcast when everything is configured", () => {
    expect(shareDestinations(all, "drawcast").map((d) => d.id))
      .toEqual(["link", "drive", "youtube", "video"]);
  });

  it("names each action with the verb its button performs", () => {
    const byId = Object.fromEntries(shareDestinations(all, "drawcast").map((d) => [d.id, d.action]));
    expect(byId).toEqual({ link: "Publish", drive: "Publish", youtube: "Upload", video: "Export" });
  });

  it("hides the link when there is no GitHub — a capability without its\n     credential does not advertise itself", () => {
    expect(shareDestinations({ ...all, github: false }, "drawcast").map((d) => d.id))
      .toEqual(["drive", "youtube", "video"]);
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

describe("destinationOffers — the §0.1 third state", () => {
  it("offers GitHub publishing disabled with a route when the repo is missing", () => {
    const offers = destinationOffers({ github: false, google: true, tts: true }, "drawcast");
    const link = offers.find((o) => o.id === "link")!;
    expect(link.enabled).toBe(false);
    expect(link.reason).toMatch(/Settings/);
  });
  it("hides YouTube entirely when Google is not configured — an env credential does not advertise itself", () => {
    const offers = destinationOffers({ github: true, google: false, tts: true }, "drawcast");
    expect(offers.map((o) => o.id)).not.toContain("youtube");
  });
  it("offers YouTube disabled when only the TTS key is missing", () => {
    const offers = destinationOffers({ github: true, google: true, tts: false }, "drawcast");
    const yt = offers.find((o) => o.id === "youtube")!;
    expect(yt.enabled).toBe(false);
    expect(yt.reason).toMatch(/TTS key/);
  });
  it("with no credentials at all a drawcast still sees two disabled rows, never an empty modal", () => {
    const offers = destinationOffers({ github: false, google: false, tts: false }, "drawcast");
    expect(offers.map((o) => o.id)).toEqual(["link", "video"]);
    expect(offers.every((o) => !o.enabled)).toBe(true);
  });
  it("a course is offered the GitHub destination alone, same third-state rules", () => {
    expect(destinationOffers({ github: false, google: true, tts: true }, "course").map((o) => o.id)).toEqual(["link"]);
  });
});

// Google Drive (spec §7-8). Its only credential is the build's Google client
// config — an ENV credential the author cannot supply from Settings — so it
// follows YouTube's rule for being SHOWN, and nothing else gates it: sign-in
// happens at publish time, exactly as Save → Drive already does. There is no
// third (disabled-with-a-reason) state for it, because there is no reason a
// Settings visit could fix.
describe("destinationOffers — Google Drive", () => {
  it("hides Drive entirely when Google is not configured", () => {
    const offers = destinationOffers({ github: true, google: false, tts: true }, "drawcast");
    expect(offers.map((o) => o.id)).not.toContain("drive");
  });

  it("offers Drive ENABLED once Google is configured, even with no repo and no TTS key", () => {
    const offers = destinationOffers({ github: false, google: true, tts: false }, "drawcast");
    const drive = offers.find((o) => o.id === "drive")!;
    expect(drive.enabled).toBe(true);
    expect(drive.reason).toBeUndefined();
    expect(drive.action).toBe("Publish");
    expect(drive.label).toBe("Google Drive");
  });

  it("sits directly after the GitHub link — the two publish destinations together", () => {
    const ids = destinationOffers(all, "drawcast").map((o) => o.id);
    expect(ids.indexOf("drive")).toBe(ids.indexOf("link") + 1);
  });

  it("is never offered to a course — courses stay GitHub-only (spec §9)", () => {
    expect(destinationOffers(all, "course").map((o) => o.id)).toEqual(["link"]);
    expect(shareDestinations(all, "course").map((d) => d.id)).not.toContain("drive");
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
    expect(visible).toEqual({ link: true, drive: false, youtube: false, video: false });
  });

  it("shows whichever available destination is selected", () => {
    const available = [dest("link"), dest("video")];
    expect(panelVisibility(ALL_IDS, available, "video")).toEqual({ link: false, drive: false, youtube: false, video: true });
  });

  it("shows nothing when the selection names a destination that is not available", () => {
    // Defensive: a stale/invalid selection must never leak a hidden panel's
    // content rather than showing the wrong (but at least real) one.
    const available = [dest("link")];
    expect(panelVisibility(ALL_IDS, available, "youtube")).toEqual({ link: false, drive: false, youtube: false, video: false });
  });

  it("shows all four when everything is available and one is picked", () => {
    const available = ALL_IDS.map(dest);
    expect(panelVisibility(ALL_IDS, available, "youtube")).toEqual({ link: false, drive: false, youtube: true, video: false });
  });

  it("hides Drive's panel for a Google-less build even when it is the remembered selection", () => {
    // The same leak panelVisibility exists for, now with a fourth panel to
    // leak: settings.shareTo can hold "drive" from a session where Google WAS
    // configured, and the drive panel's `.hidden` is otherwise never touched.
    const available = [dest("link"), dest("video")];
    expect(panelVisibility(ALL_IDS, available, "drive")).toEqual({ link: false, drive: false, youtube: false, video: false });
  });
});
