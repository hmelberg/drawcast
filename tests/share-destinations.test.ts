import { describe, expect, it } from "vitest";
import { shareDestinations } from "../src/ui/share";

const all = { github: true, google: true, tts: true };

describe("shareDestinations", () => {
  it("offers four destinations for a drawcast when everything is configured", () => {
    expect(shareDestinations(all, "drawcast").map((d) => d.id))
      .toEqual(["link", "youtube", "video", "spec"]);
  });

  it("names each action with the verb its button performs", () => {
    const byId = Object.fromEntries(shareDestinations(all, "drawcast").map((d) => [d.id, d.action]));
    expect(byId).toEqual({ link: "Publish", youtube: "Upload", video: "Export", spec: "Download" });
  });

  it("hides the link when there is no GitHub — a capability without its\n     credential does not advertise itself", () => {
    expect(shareDestinations({ ...all, github: false }, "drawcast").map((d) => d.id))
      .toEqual(["youtube", "video", "spec"]);
  });

  it("hides YouTube without Google, and video without a TTS key", () => {
    expect(shareDestinations({ github: true, google: false, tts: false }, "drawcast").map((d) => d.id))
      .toEqual(["link", "spec"]);
  });

  it("offers a course the link alone — batch video is not written", () => {
    expect(shareDestinations(all, "course").map((d) => d.id)).toEqual(["link"]);
  });

  it("can offer nothing at all", () => {
    expect(shareDestinations({ github: false, google: false, tts: false }, "course")).toEqual([]);
  });
});
