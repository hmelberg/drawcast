import { describe, expect, test } from "vitest";
import {
  exportSequence,
  formatPlaylist,
  isSingle,
  itemsOf,
  makeChapterCard,
  makeTitlePage,
  parsePlaylistText,
  playlistWithSpecs,
  singlePlaylist,
  sourceLanguage,
} from "../src/playlist/playlist";
import { playlistSpeakLines } from "../src/playlist/session";
import { validateSpec } from "../src/spec/schema";
import type { Spec, SpecElement } from "../src/spec/types";

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

describe("playlist subtitle", () => {
  test("the header's subtitle is parsed and round-trips through format", () => {
    const p = parsePlaylistText(`playlist: {title: T, subtitle: In six drawings}\n---\n${SPEC_A}\n---\n${SPEC_B}`);
    expect(p.meta.subtitle).toBe("In six drawings");
    expect(parsePlaylistText(formatPlaylist(p, "yaml"))).toEqual(p);
  });
});

const elById = (spec: Spec, id: string): SpecElement | undefined => (spec.elements ?? []).find((e) => e.id === id);

describe("makeTitlePage", () => {
  test("produces a valid spec carrying the series title and subtitle", () => {
    const page = makeTitlePage({ title: "Health economics", subtitle: "Six drawings" });
    expect(validateSpec(page).ok).toBe(true);
    expect(elById(page, "tp_title")?.text).toBe("Health economics");
    expect(elById(page, "tp_subtitle")?.text).toBe("Six drawings");
  });

  test("the title fades in instead of popping", () => {
    const title = elById(makeTitlePage({ title: "X" }), "tp_title");
    expect(title?.draw?.mode).toBe("sketch");
    expect(title?.draw?.duration ?? 0).toBeGreaterThan(0);
  });

  test("ends by fading the canvas back out", () => {
    expect((makeTitlePage({ title: "X" }).commands ?? []).at(-1)).toEqual({ clear: {} });
  });

  test("speaks the title so recordings announce the presentation", () => {
    const page = makeTitlePage({ title: "Health economics", subtitle: "Six drawings" });
    const spoken = (page.commands ?? [])
      .map((c) => c.speak)
      .filter(Boolean)
      .join(" ");
    expect(spoken).toContain("Health economics");
  });

  test("a long title shrinks its font to stay on the canvas", () => {
    const size = (t: string): number => elById(makeTitlePage({ title: t }), "tp_title")?.font_size ?? 0;
    expect(size("A quite long presentation title about Markov models")).toBeLessThan(size("Short"));
  });

  test("without a subtitle the page is valid and has no subtitle element", () => {
    const page = makeTitlePage({ title: "X" });
    expect(validateSpec(page).ok).toBe(true);
    expect(elById(page, "tp_subtitle")).toBeUndefined();
  });
});

describe("makeChapterCard", () => {
  test("announces the chapter big, with the next item as a smaller byline", () => {
    const card = makeChapterCard({ chapter: "Foundations", next: "Markov models", gate: "click" });
    expect(validateSpec(card).ok).toBe(true);
    expect(elById(card, "ch_title")?.text).toBe("Foundations");
    expect(elById(card, "ch_next")?.text).toContain("Markov models");
    expect(elById(card, "ch_next")?.font_size ?? 99).toBeLessThan(elById(card, "ch_title")?.font_size ?? 0);
  });

  test("chapter text fades in", () => {
    expect(elById(makeChapterCard({ chapter: "C", gate: "auto" }), "ch_title")?.draw?.mode).toBe("sketch");
  });

  test("click gate: waits for the click, then fades out", () => {
    const cmds = makeChapterCard({ chapter: "C", gate: "click" }).commands ?? [];
    expect(cmds.at(-2)).toEqual({ wait: "click" });
    expect(cmds.at(-1)).toEqual({ clear: {} });
  });

  test("auto gate: holds for the gap instead of waiting", () => {
    const cmds = makeChapterCard({ chapter: "C", gate: "auto", gap: 2 }).commands ?? [];
    expect(cmds.at(-2)).toEqual({ pause: 2 });
    expect(cmds.at(-1)).toEqual({ clear: {} });
  });
});

describe("exportSequence — what a video export plays, in order", () => {
  const SPEC_C = 'title: Part three\nelements:\n  - {id: t, type: text, text: ho, x: 500, y: 375}\ncommands: []';
  const STREAM = [
    "playlist: {title: Health econ, subtitle: In drawings}",
    "---",
    "chapter: Basics",
    "---",
    SPEC_A,
    "---",
    SPEC_B,
    "---",
    "chapter: Models",
    "---",
    SPEC_C,
  ].join("\n");

  test("opens with the title page when the playlist has a title", () => {
    const seq = exportSequence(parsePlaylistText(STREAM));
    expect(elById(seq[0], "tp_title")?.text).toBe("Health econ");
  });

  test("no title page without a playlist title", () => {
    const seq = exportSequence(parsePlaylistText(`${SPEC_A}\n---\n${SPEC_B}`));
    expect(seq.some((s) => elById(s, "tp_title"))).toBe(false);
  });

  test("chapter cards appear only where a new chapter begins", () => {
    const seq = exportSequence(parsePlaylistText(STREAM));
    const cards = seq.filter((s) => elById(s, "ch_title"));
    expect(cards).toHaveLength(1);
    expect(elById(cards[0], "ch_title")?.text).toBe("Models");
  });

  test("every item except the last fades out before the next", () => {
    const seq = exportSequence(parsePlaylistText(STREAM));
    const items = seq.filter((s) => !elById(s, "tp_title") && !elById(s, "ch_title"));
    expect(items).toHaveLength(3);
    for (const it of items.slice(0, -1)) expect((it.commands ?? []).at(-1)).toEqual({ clear: {} });
    expect((items.at(-1)?.commands ?? []).at(-1)).not.toEqual({ clear: {} });
  });

  test("transitions none: items only, apart from the title page", () => {
    const p = parsePlaylistText(`playlist: {title: T, transitions: none}\n---\n${SPEC_A}\n---\n${SPEC_B}`);
    const seq = exportSequence(p);
    expect(seq).toHaveLength(3);
    expect(seq.slice(1).every((s) => (s.commands ?? []).at(-1)?.clear === undefined)).toBe(true);
  });

  test("playlistSpeakLines covers the title page and chapter cards, with no per-page Next lines", () => {
    const lines = playlistSpeakLines(parsePlaylistText(STREAM));
    const texts = lines.map((l) => l.text);
    expect(texts.join(" ")).toContain("Health econ");
    expect(texts.join(" ")).toContain("Models");
    expect(texts.some((t) => t.startsWith("Next:"))).toBe(false);
  });
});

// Both main.ts (the CC-subtitles feature) and ui/share.ts (the YouTube panel)
// need this same answer for a playlist — one shared, pure, tested copy so a
// future narrationLanguage change cannot fix one caller and not the other.
describe("sourceLanguage", () => {
  test("a declared lang on any item wins", () => {
    const p = parsePlaylistText(`lang: nb\n${SPEC_A}`);
    expect(sourceLanguage(p)).toBe("nb");
  });

  test("no declared lang and nothing spoken falls back to English", () => {
    const p = parsePlaylistText(SPEC_A);
    expect(sourceLanguage(p)).toBe("en");
  });
});

describe("playlistWithSpecs", () => {
  test("swaps each item's spec, in item order, leaving chapters untouched", () => {
    const p = parsePlaylistText(`chapter: C\n---\n${SPEC_A}\n---\n${SPEC_B}`);
    const replacement: Spec = { title: "Replaced", commands: [] };
    const out = playlistWithSpecs(p, [replacement, replacement]);
    expect(out.entries.map((e) => e.kind)).toEqual(["chapter", "item", "item"]);
    expect(itemsOf(out).map((i) => i.spec.title)).toEqual(["Replaced", "Replaced"]);
  });

  test("never mutates the playlist it was given — a fresh object comes back", () => {
    const p = parsePlaylistText(SPEC_A);
    const original = itemsOf(p)[0].spec;
    const out = playlistWithSpecs(p, [{ title: "New", commands: [] }]);
    expect(itemsOf(p)[0].spec).toBe(original); // unchanged
    expect(itemsOf(out)[0].spec.title).toBe("New");
    expect(out).not.toBe(p);
  });
});

// The library kept doc.prompt but the file dropped it, so any Drive/disk/GitHub
// round trip lost the request that founded the drawcast. §F.3.3: the founding
// Generate request travels IN the document — revise instructions do not.
describe("playlist.prompt — the founding request travels in the file (B9)", () => {
  test("a single spec with a prompt serializes with a header and round-trips", () => {
    const p = parsePlaylistText(SPEC_A);
    p.meta.prompt = "explain comparative advantage";
    const text = formatPlaylist(p, "yaml");
    expect(text).toContain("prompt: explain comparative advantage");
    const back = parsePlaylistText(text);
    expect(back.meta.prompt).toBe("explain comparative advantage");
    expect(back).toEqual(p);
  });

  test("no prompt → no header, exactly as before", () => {
    const p = parsePlaylistText(SPEC_A);
    expect(formatPlaylist(p, "yaml")).not.toContain("---");
  });

  test("isSingle is false once a prompt is set — the header must survive", () => {
    const p = parsePlaylistText(SPEC_A);
    p.meta.prompt = "x";
    expect(isSingle(p)).toBe(false);
  });

  test("a prompt survives alongside a real playlist header", () => {
    const p = parsePlaylistText(`playlist: {title: T, prompt: draw the Laffer curve}\n---\n${SPEC_A}\n---\n${SPEC_B}`);
    expect(p.meta.prompt).toBe("draw the Laffer curve");
    expect(parsePlaylistText(formatPlaylist(p, "yaml"))).toEqual(p);
  });

  // Real requests carry #playlist / #parts=3 tags and colons, and a bare `#`
  // after a space starts a YAML comment — an unquoted dump would truncate the
  // request at the first tag, silently, on the way to disk.
  test("a request full of #tags, colons and newlines survives the dump", () => {
    for (const request of ["explain X #playlist #parts=3", "draw: supply and demand", "line one\nline two", "yes"]) {
      const p = parsePlaylistText(SPEC_A);
      p.meta.prompt = request;
      expect(parsePlaylistText(formatPlaylist(p, "yaml")).meta.prompt).toBe(request);
    }
  });

  test("a non-string prompt in the header is ignored, not carried", () => {
    const p = parsePlaylistText(`playlist: {prompt: 42}\n---\n${SPEC_A}`);
    expect(p.meta.prompt).toBeUndefined();
  });
});
