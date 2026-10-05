// A check's own visuals leave once its answer is explained (2026-10-05).
import { describe, expect, test } from "vitest";
import { expandCheckCleanup } from "../src/spec/check-cleanup";
import { expandEstimates } from "../src/spec/slider";
import { expandSpec } from "../src/spec/expand";
import { itemsOf, parsePlaylistText } from "../src/playlist/playlist";
import type { Spec } from "../src/spec/types";

const line = { id: "nl", type: "scale", min: 0, max: 40, value: 14, label: "OR" };
const cards = { id: "cs", type: "cards", bins: ["A", "B"], items: [{ text: "x", bin: "A" }, { text: "y", bin: "B" }] };
const bar = { id: "t", type: "text", text: "T", x: 500, y: 400 };
const erasesAfter = (s: Spec, i: number): unknown => (s.commands ?? [])[i + 1]?.erase;

describe("defaults", () => {
  test("a slider leaves after its answer when the page goes on", () => {
    const s = expandCheckCleanup(expandEstimates({ elements: [bar], commands: [{ ask: { question: "Odds at 90 %?", estimate: { min: 0, max: 30, value: 9 }, right: "Nine." } }, { draw: ["t"], speak: "On we go." }] } as never));
    expect(erasesAfter(s, 0)).toEqual(["estimate_1"]);
  });
  test("a number line is cleared when the page goes on explaining (an aside)…", () => {
    const s = expandCheckCleanup({ elements: [line, bar], commands: [{ draw: ["nl"] }, { ask: { question: "Where?", on: "nl" } }, { draw: ["t"], speak: "Now the explanation." }] } as never);
    expect(erasesAfter(s, 1)).toEqual(["nl"]);
  });
  test("…but stays when the next thing is another question (a quiz rhythm)", () => {
    const s = expandCheckCleanup({ elements: [line, cards], commands: [{ draw: ["nl"] }, { ask: { question: "Where?", on: "nl" } }, { draw: ["cs"] }, { ask: { question: "Sort", on: "cs" } }] } as never);
    expect(erasesAfter(s, 1)).not.toEqual(["nl"]);
  });
  test("stays when a later command uses it", () => {
    const s = expandCheckCleanup({ elements: [line], commands: [{ draw: ["nl"] }, { ask: { question: "Where?", on: "nl" } }, { highlight: { target: ["nl_answer"] }, speak: "Look at it again." }] } as never);
    expect((s.commands ?? []).some((c) => c.erase !== undefined)).toBe(false);
  });
  test("nothing added when the page ends with the check", () => {
    const s = expandCheckCleanup(expandEstimates({ elements: [], commands: [{ ask: { question: "Q", estimate: { min: 0, max: 30, value: 9 } } }] } as never));
    expect((s.commands ?? []).length).toBe(1);
  });
  test("a guess on the figure's own part is never furniture", () => {
    const s = expandCheckCleanup({ template: "bar_chart", params: { labels: ["a"], values: [1] }, commands: [{ ask: { question: "How tall?", on: "bar_1" } }, { pause: 1, speak: "And so on." }] } as never);
    expect((s.commands ?? []).some((c) => c.erase !== undefined)).toBe(false);
  });
});

describe("overrides", () => {
  test("after: keep keeps a slider; after: clear clears even what a later line uses", () => {
    const kept = expandCheckCleanup(expandEstimates({ elements: [bar], commands: [{ ask: { question: "Q", estimate: { min: 0, max: 30, value: 9 }, after: "keep" } }, { draw: ["t"], speak: "On." }] } as never));
    expect((kept.commands ?? []).some((c) => c.erase !== undefined)).toBe(false);
    const cleared = expandCheckCleanup({ elements: [line], commands: [{ draw: ["nl"] }, { ask: { question: "Q", on: "nl", after: "clear" } }, { highlight: { target: ["nl"] }, speak: "Again." }] } as never);
    expect(erasesAfter(cleared, 1)).toEqual(["nl"]);
  });
  test("page.checks: keep (a quiz) keeps; the ask's own after still wins", () => {
    const s = expandCheckCleanup(expandEstimates({ page: { checks: "keep" }, elements: [bar], commands: [{ ask: { question: "Q", estimate: { min: 0, max: 30, value: 9 } } }, { draw: ["t"], speak: "On." }, { ask: { question: "R", estimate: { min: 0, max: 9, value: 3 }, after: "clear" } }, { draw: ["t"], speak: "On." }] } as never));
    expect((s.commands ?? []).filter((c) => c.erase !== undefined)).toEqual([{ erase: ["estimate_2"] }]);
  });
  test("a quiz-format cast's pages keep their checks; others decide by the rule", () => {
    const text = (fmt: string) => `# T\nformat: ${fmt}\n\n## P\n    text t "Hi" x 500 y 400\n\nHi.\n    draw t\n`;
    expect(itemsOf(parsePlaylistText(text("quiz")))[0].spec.page?.checks).toBeUndefined(); // no ask on the page: untouched
    const withAsk = (fmt: string) => parsePlaylistText(`# T\nformat: ${fmt}\n\n## P\n    text t "Hi" x 500 y 400\n\nHi.\n    draw t\n    ask "Q?" answer "x"\n`);
    expect(itemsOf(withAsk("quiz"))[0].spec.page?.checks).toBe("keep");
    expect(itemsOf(withAsk("drawcast"))[0].spec.page?.checks).toBeUndefined();
  });
});

test("expandSpec runs it: the erase is planned like any erase", () => {
  const s = expandSpec({ title: "T", elements: [bar], commands: [{ ask: { question: "Odds at 90 %?", estimate: { min: 0, max: 30, value: 9 }, right: "Nine." } }, { draw: ["t"], speak: "On we go." }] } as never);
  expect((s.commands ?? []).some((c) => Array.isArray(c.erase) && (c.erase as string[]).includes("estimate_1"))).toBe(true);
});
