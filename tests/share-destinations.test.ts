import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { destinationOffers, panelVisibility, shareDestinations, type ShareDest, type ShareTo } from "../src/ui/share";

// panelVisibility's doc comment counts the panels, and the count has been
// wrong before (it said "four" after one of four was retired). Google Drive
// (spec §7) brought it back to four; the drawcast server (round 0 spec §4)
// makes it five — so the comment has to move with DESTS again, and this pins
// that it did.
it("panelVisibility's doc comment says five panels, matching DESTS", async () => {
  const src = await readFile(new URL("../src/ui/share.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/four panels/);
  expect(src).toMatch(/five panels/);
});

const all = { github: true, google: true, tts: true };
const ALL_IDS: ShareTo[] = ["link", "drive", "server", "youtube", "video"];
const dest = (id: ShareTo): ShareDest => ({ id, label: id, action: id });

describe("shareDestinations", () => {
  it("offers five destinations for a drawcast when everything is configured", () => {
    expect(shareDestinations(all, "drawcast").map((d) => d.id))
      .toEqual(["link", "drive", "server", "youtube", "video"]);
  });

  it("names each action with the verb its button performs", () => {
    const byId = Object.fromEntries(shareDestinations(all, "drawcast").map((d) => [d.id, d.action]));
    expect(byId).toEqual({ link: "Publish", drive: "Publish", server: "Publish", youtube: "Upload", video: "Export" });
  });

  it("hides the link when there is no GitHub — a capability without its\n     credential does not advertise itself", () => {
    expect(shareDestinations({ ...all, github: false }, "drawcast").map((d) => d.id))
      .toEqual(["drive", "server", "youtube", "video"]);
  });

  it("hides YouTube without Google, and video without a TTS key — the server needs neither", () => {
    expect(shareDestinations({ github: true, google: false, tts: false }, "drawcast").map((d) => d.id))
      .toEqual(["link", "server"]);
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
  it("with no credentials at all a drawcast still sees two disabled rows and the server, never an empty modal", () => {
    const offers = destinationOffers({ github: false, google: false, tts: false }, "drawcast");
    expect(offers.map((o) => o.id)).toEqual(["link", "server", "video"]);
    expect(offers.filter((o) => o.id !== "server").every((o) => !o.enabled)).toBe(true);
    // The server's credential is the sign-in, which its PANEL asks for — the
    // row itself has no Settings value to be missing (see the DESTS comment).
    expect(offers.find((o) => o.id === "server")!.enabled).toBe(true);
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

// The drawcast server (round 0 spec §4, §9): the third publish target. Its
// credential is the session token, which Settings → Publishing supplies —
// but the row is always offered and always ready, so a signed-out author
// still opens the panel and reads what the destination is for; the panel's
// Publish button is what says "Sign in to publish here".
describe("destinationOffers — the drawcast server", () => {
  it("is offered ENABLED with no credential at all", () => {
    const offers = destinationOffers({ github: false, google: false, tts: false }, "drawcast");
    const server = offers.find((o) => o.id === "server")!;
    expect(server.enabled).toBe(true);
    expect(server.reason).toBeUndefined();
    expect(server.action).toBe("Publish");
    expect(server.label).toBe("drawcast server");
  });

  it("sits directly after Drive — the three publish destinations together, before the two exports", () => {
    const ids = destinationOffers(all, "drawcast").map((o) => o.id);
    expect(ids.indexOf("server")).toBe(ids.indexOf("drive") + 1);
    expect(ids.indexOf("server")).toBeLessThan(ids.indexOf("youtube"));
  });

  it("is never offered to a course in this round", () => {
    expect(destinationOffers(all, "course").map((o) => o.id)).toEqual(["link"]);
    expect(shareDestinations(all, "course").map((d) => d.id)).not.toContain("server");
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
    expect(visible).toEqual({ link: true, drive: false, server: false, youtube: false, video: false });
  });

  it("shows whichever available destination is selected", () => {
    const available = [dest("link"), dest("video")];
    expect(panelVisibility(ALL_IDS, available, "video")).toEqual({ link: false, drive: false, server: false, youtube: false, video: true });
  });

  it("shows nothing when the selection names a destination that is not available", () => {
    // Defensive: a stale/invalid selection must never leak a hidden panel's
    // content rather than showing the wrong (but at least real) one.
    const available = [dest("link")];
    expect(panelVisibility(ALL_IDS, available, "youtube")).toEqual({ link: false, drive: false, server: false, youtube: false, video: false });
  });

  it("shows all five when everything is available and one is picked", () => {
    const available = ALL_IDS.map(dest);
    expect(panelVisibility(ALL_IDS, available, "youtube")).toEqual({ link: false, drive: false, server: false, youtube: true, video: false });
  });

  it("hides Drive's panel for a Google-less build even when it is the remembered selection", () => {
    // The same leak panelVisibility exists for, now with a fourth panel to
    // leak: settings.shareTo can hold "drive" from a session where Google WAS
    // configured, and the drive panel's `.hidden` is otherwise never touched.
    const available = [dest("link"), dest("video")];
    expect(panelVisibility(ALL_IDS, available, "drive")).toEqual({ link: false, drive: false, server: false, youtube: false, video: false });
  });

  it("shows the server's panel when it is selected, and hides it when another is", () => {
    const available = [dest("link"), dest("server"), dest("video")];
    expect(panelVisibility(ALL_IDS, available, "server")).toEqual({ link: false, drive: false, server: true, youtube: false, video: false });
    expect(panelVisibility(ALL_IDS, available, "link").server).toBe(false);
  });
});
