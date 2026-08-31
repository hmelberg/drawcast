import { describe, expect, it } from "vitest";
import { SETTINGS_TABS } from "../src/store";

const tabOf = (field: string) => SETTINGS_TABS.find((t) => t.fields.includes(field))?.id;

describe("SETTINGS_TABS", () => {
  it("has four tabs, keys first", () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toEqual(["keys", "playback", "publishing", "advanced"]);
  });

  it("files skip-questions and burn-captions under playback, not under the\n     text-to-speech KEY they were nested beneath", () => {
    expect(tabOf("skipQuestions")).toBe("playback");
    expect(tabOf("burnCaptions")).toBe("playback");
    expect(tabOf("cloudPlayback")).toBe("playback");
  });

  it("keeps the two keys together", () => {
    expect(tabOf("apiKey")).toBe("keys");
    expect(tabOf("ttsKey")).toBe("keys");
  });

  it("puts the GitHub trio under publishing", () => {
    for (const f of ["githubRepo", "githubToken", "coursesDir"]) expect(tabOf(f)).toBe("publishing");
  });

  it("puts backup with developer mode under advanced", () => {
    expect(tabOf("backup")).toBe("advanced");
    expect(tabOf("developerMode")).toBe("advanced");
  });

  it("files every field exactly once", () => {
    const all = SETTINGS_TABS.flatMap((t) => t.fields);
    expect(new Set(all).size).toBe(all.length);
  });
});
