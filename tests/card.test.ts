import { describe, expect, test } from "vitest";
import { cardElements, expandCards, headingFont, HEADING_Y, titleFont } from "../src/spec/card";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

// The `card` verb (title-below-player design, 2026-09-16): the disappearing
// heading — title over an underline, a slow push-in, then gone — as ONE beat
// the author writes, expanded before layout into the elements and commands
// the playlist title page has always used. Live playback and export see only
// the expansion, so the two cannot differ.

const cast = (commands: Spec["commands"], elements: Spec["elements"] = []): Spec => ({ title: "Doc", elements, commands });

describe("expandCards", () => {
  test("a cast without cards is returned as is — the same object", () => {
    const spec = cast([{ draw: ["a"], speak: "hi" }], [{ id: "a", type: "text", text: "A", x: 1, y: 2 }]);
    expect(expandCards(spec)).toBe(spec);
  });

  test("the centre style (the slower TV card): title + underline, draw, push-in, erase, reset — the paired speak stays on the draw", () => {
    const out = expandCards(cast([{ card: { title: "Markov models", style: "center" }, speak: "Markov models." }, { draw: ["a"] }], [{ id: "a", type: "text", text: "A", x: 1, y: 2 }]));
    const ids = (out.elements ?? []).map((e) => e.id);
    expect(ids).toEqual(["a", "card_1_title", "card_1_line"]);
    expect((out.elements ?? []).find((e) => e.id === "card_1_title")).toMatchObject({ type: "text", text: "Markov models", draw: { mode: "sketch" } });
    const cmds = out.commands ?? [];
    expect(cmds[0]).toEqual({ draw: ["card_1_title", "card_1_line"], speak: "Markov models." });
    expect(cmds[1].camera).toMatchObject({ center: { ref: "card_1_title" }, zoom: 1.08 });
    expect(cmds[2]).toMatchObject({ erase: ["card_1_title", "card_1_line"], parallel: true });
    expect(cmds[3].camera).toMatchObject({ reset: true });
    expect(cmds[4]).toEqual({ draw: ["a"] });
    expect(cmds.some((c) => c.card !== undefined)).toBe(false);
  });

  test("in the centre style, a subtitle is its own element and its own beat, after the title", () => {
    const out = expandCards(cast([{ card: { title: "T", subtitle: "S", style: "center" } }]));
    expect((out.elements ?? []).map((e) => e.id)).toEqual(["card_1_title", "card_1_line", "card_1_subtitle"]);
    const cmds = out.commands ?? [];
    expect(cmds[0]).toEqual({ draw: ["card_1_title", "card_1_line"] });
    expect(cmds[1]).toEqual({ draw: ["card_1_subtitle"] });
    expect(cmds[3].erase).toEqual(["card_1_title", "card_1_line", "card_1_subtitle"]);
  });

  // Hans 2026-09-24: the TV card "takes too much time for short drawcasts".
  // The default is a heading centred at the top, underlined, zooming quickly
  // from large to its size — and it stays.
  test("the default is a top heading: camera close on it, drawn, pulled back with the words — and it stays", () => {
    const out = expandCards(cast([{ card: { title: "Why bridges look different" }, speak: "Bridges." }, { draw: ["a"] }], [{ id: "a", type: "text", text: "A", x: 1, y: 2 }]));
    const title = (out.elements ?? []).find((e) => e.id === "card_1_title")!;
    expect(title).toMatchObject({ type: "text", text: "Why bridges look different", x: 500, y: HEADING_Y });
    expect((out.elements ?? []).find((e) => e.id === "card_1_line")).toBeDefined();
    const cmds = out.commands ?? [];
    expect(cmds[0].camera).toMatchObject({ center: { ref: "card_1_title" }, zoom: 1.8 });
    expect(cmds[1]).toEqual({ draw: ["card_1_title", "card_1_line"], parallel: true });
    expect(cmds[2]).toEqual({ speak: "Bridges.", camera: { reset: true, duration: 0.6 } });
    expect(cmds[3]).toEqual({ draw: ["a"] });
    // Stays: nothing erases it.
    expect(cmds.some((c) => c.erase !== undefined)).toBe(false);
  });

  test("the heading is quick: under a second of animation before the first drawing", () => {
    const out = expandCards(cast([{ card: { title: "T" } }]));
    const title = (out.elements ?? []).find((e) => e.id === "card_1_title")!;
    const secs = (title.draw as { duration: number }).duration + 0.6 + 0.01;
    expect(secs).toBeLessThan(1);
  });

  test("the heading sits above the band figures are fitted into, and a long title shrinks", () => {
    expect(HEADING_Y - 36).toBeGreaterThan(655);
    expect(HEADING_Y + 36 * 0.4).toBeLessThan(750);
    expect(headingFont("A very long heading that goes on and on across the page")).toBeLessThan(headingFont("Short"));
  });

  test("two cards get distinct ids, and the expansion validates against the schema", () => {
    const out = expandCards(cast([{ card: { title: "One" } }, { card: { title: "Two" } }]));
    const ids = (out.elements ?? []).map((e) => e.id);
    expect(ids).toContain("card_1_title");
    expect(ids).toContain("card_2_title");
    expect(validateSpec(out).ok).toBe(true);
  });

  test("the unexpanded card is itself a valid command, and needs a title", () => {
    const a: Spec["elements"] = [{ id: "a", type: "text", text: "A", x: 1, y: 2 }];
    expect(validateSpec(cast([{ card: { title: "T", subtitle: "S" }, speak: "T" }, { draw: "a" }], a)).ok).toBe(true);
    expect(validateSpec(cast([{ card: { subtitle: "S" } } as never, { draw: "a" }], a)).ok).toBe(false);
  });

  test("the input spec is not mutated", () => {
    const spec = cast([{ card: { title: "T" } }]);
    expandCards(spec);
    expect(spec.elements).toEqual([]);
    expect(spec.commands?.[0].card).toEqual({ title: "T" });
  });
});

describe("cardElements / titleFont", () => {
  test("a long title shrinks its font to stay on the canvas", () => {
    expect(titleFont("A quite long presentation title about Markov models")).toBeLessThan(titleFont("Short"));
  });
  test("elements carry the prefix the caller names", () => {
    expect(cardElements("T", "S", "tp").map((e) => e.id)).toEqual(["tp_title", "tp_line", "tp_subtitle"]);
  });
});

describe("headingZoom (2026-09-25)", () => {
  test("a short title starts at 1.8×; a long one starts wider so its ends stay in view", async () => {
    const { headingZoom, headingFont } = await import("../src/spec/card");
    expect(headingZoom("Why bridges look different")).toBe(1.8);
    const long = "Why the acceptability curve slopes";
    const z = headingZoom(long);
    expect(z).toBeLessThan(1.8);
    // The estimated width at that zoom fits the 1000-unit view.
    expect(0.54 * headingFont(long) * long.length * z).toBeLessThanOrEqual(920);
    expect(headingZoom("x".repeat(200))).toBe(1);
  });
});
