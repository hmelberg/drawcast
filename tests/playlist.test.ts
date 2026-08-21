import { describe, expect, test } from "vitest";
import { formatPlaylist, itemsOf, makeTitleCard, parsePlaylistText, singlePlaylist } from "../src/playlist/playlist";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const SPEC_A = 'title: Part one\nelements:\n  - {id: t, type: text, text: hi, x: 500, y: 375}\ncommands: []';
const SPEC_B = 'title: Part two\nlevel: advanced\nelements:\n  - {id: t, type: text, text: yo, x: 500, y: 375}\ncommands: []';

describe("parsePlaylistText — single documents stay exactly as today", () => {
  test("a single YAML spec becomes a one-item playlist with defaults", () => {
    const p = parsePlaylistText(SPEC_A);
    expect(p.entries).toHaveLength(1);
    expect(p.entries[0]).toMatchObject({ kind: "item" });
    expect(p.meta.advance).toBe("click");
    expect(p.meta.transitions).toBe("auto");
  });

  test("a single JSON spec parses too", () => {
    const p = parsePlaylistText('{"title": "One", "commands": []}');
    expect(p.entries).toHaveLength(1);
  });
});

describe("parsePlaylistText — multi-document streams", () => {
  const STREAM = [
    "playlist:",
    "  title: Health economics in three drawings",
    "  advance: auto",
    "  gap: 2",
    "---",
    "chapter: Foundations",
    "---",
    SPEC_A,
    "---",
    SPEC_B,
  ].join("\n");

  test("header, chapter and items are classified", () => {
    const p = parsePlaylistText(STREAM);
    expect(p.meta.title).toBe("Health economics in three drawings");
    expect(p.meta.advance).toBe("auto");
    expect(p.meta.gap).toBe(2);
    expect(p.entries.map((e) => e.kind)).toEqual(["chapter", "item", "item"]);
  });

  test("itemsOf pairs items with their governing chapter", () => {
    const items = itemsOf(parsePlaylistText(STREAM));
    expect(items).toHaveLength(2);
    expect(items[0].chapter).toBe("Foundations");
    expect(items[1].chapter).toBe("Foundations");
    expect((items[1].spec as Spec).title).toBe("Part two");
  });

  test("a stream without a header gets default meta", () => {
    const p = parsePlaylistText(`${SPEC_A}\n---\n${SPEC_B}`);
    expect(p.meta.advance).toBe("click");
    expect(p.entries).toHaveLength(2);
  });

  test("chapter accepts both a bare string and a mapping", () => {
    const p = parsePlaylistText(`chapter: {title: Models}\n---\n${SPEC_A}`);
    expect(p.entries[0]).toMatchObject({ kind: "chapter", title: "Models" });
  });

  test("empty documents in the stream are skipped", () => {
    const p = parsePlaylistText(`${SPEC_A}\n---\n\n---\n${SPEC_B}`);
    expect(p.entries).toHaveLength(2);
  });

  test("an unknown advance value falls back to click with a warning", () => {
    const p = parsePlaylistText(`playlist: {advance: sideways}\n---\n${SPEC_A}`);
    expect(p.meta.advance).toBe("click");
    expect(p.warnings.length).toBeGreaterThan(0);
  });
});

describe("formatPlaylist — round trip", () => {
  test("a one-item playlist formats like a plain spec (no separators)", () => {
    const p = parsePlaylistText(SPEC_A);
    const text = formatPlaylist(p, "yaml");
    expect(text).not.toContain("---");
    expect(parsePlaylistText(text)).toEqual(p);
  });

  test("a full stream round-trips through format and parse", () => {
    const p = parsePlaylistText(
      ["playlist: {title: T, advance: auto, gap: 2}", "---", "chapter: C", "---", SPEC_A, "---", SPEC_B].join("\n"),
    );
    const roundTripped = parsePlaylistText(formatPlaylist(p, "yaml"));
    expect(roundTripped).toEqual(p);
  });
});

describe("singlePlaylist", () => {
  test("wraps a spec as a one-item playlist", () => {
    const spec: Spec = { title: "X", commands: [] };
    const p = singlePlaylist(spec);
    expect(itemsOf(p)).toHaveLength(1);
    expect(itemsOf(p)[0].spec).toBe(spec);
  });
});

describe("makeTitleCard", () => {
  test("produces a valid spec announcing the next item", () => {
    const card = makeTitleCard({ next: "Markov models", gate: "click" });
    expect(validateSpec(card).ok).toBe(true);
    const speaks = (card.commands ?? []).filter((c) => c.speak !== undefined);
    expect(speaks[0].speak).toContain("Markov models");
  });

  test("click gate ends the card with a wait command", () => {
    const card = makeTitleCard({ next: "X", gate: "click" });
    expect((card.commands ?? []).some((c) => c.wait === "click")).toBe(true);
  });

  test("auto advance ends the card with a pause of the given gap", () => {
    const card = makeTitleCard({ next: "X", gate: "auto", gap: 2 });
    const last = (card.commands ?? []).at(-1);
    expect(last).toEqual({ pause: 2 });
  });

  test("a chapter crossing shows the chapter as the kicker", () => {
    const card = makeTitleCard({ next: "X", chapter: "Foundations", gate: "click" });
    const texts = (card.elements ?? []).filter((e) => e.type === "text").map((e) => e.text);
    expect(texts).toContain("Foundations");
  });

  test("a level badge appears when the item declares one", () => {
    const card = makeTitleCard({ next: "X", level: "advanced", gate: "click" });
    const texts = (card.elements ?? []).map((e) => e.text ?? "");
    expect(texts.join(" ")).toContain("advanced");
  });
});
