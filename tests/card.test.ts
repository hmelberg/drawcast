import { describe, expect, test } from "vitest";
import { cardElements, expandCards, titleFont } from "../src/spec/card";
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

  test("a card becomes title + underline elements and draw, push-in, erase, reset beats — the paired speak stays on the draw", () => {
    const out = expandCards(cast([{ card: { title: "Markov models" }, speak: "Markov models." }, { draw: ["a"] }], [{ id: "a", type: "text", text: "A", x: 1, y: 2 }]));
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

  test("a subtitle is its own element and its own beat, after the title", () => {
    const out = expandCards(cast([{ card: { title: "T", subtitle: "S" } }]));
    expect((out.elements ?? []).map((e) => e.id)).toEqual(["card_1_title", "card_1_line", "card_1_subtitle"]);
    const cmds = out.commands ?? [];
    expect(cmds[0]).toEqual({ draw: ["card_1_title", "card_1_line"] });
    expect(cmds[1]).toEqual({ draw: ["card_1_subtitle"] });
    expect(cmds[3].erase).toEqual(["card_1_title", "card_1_line", "card_1_subtitle"]);
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
