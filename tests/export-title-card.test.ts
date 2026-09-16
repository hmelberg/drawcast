import { describe, expect, test } from "vitest";
import { exportSequence, singlePlaylist, type Playlist } from "../src/playlist/playlist";
import type { Spec } from "../src/spec/types";

// Title-below-player design (2026-09-16): the exported file has no page
// under it to carry the title, so a single cast opens with the title card a
// playlist's title page draws — on request (the Share checkbox), never for a
// cast that opens with its own `card`, and never twice for a playlist.

const item = (title: string | undefined, commands: Spec["commands"] = [{ draw: "a" }]): Spec => ({
  ...(title ? { title } : {}),
  elements: [{ id: "a", type: "text", text: "A", x: 500, y: 375 }],
  commands,
});

describe("exportSequence titleCard", () => {
  test("off by default: a single cast plays as itself", () => {
    expect(exportSequence(singlePlaylist(item("Markov models")))).toHaveLength(1);
  });

  test("on: the cast is preceded by a card carrying its title, spoken", () => {
    const seq = exportSequence(singlePlaylist(item("Markov models")), { titleCard: true });
    expect(seq).toHaveLength(2);
    expect((seq[0].elements ?? []).find((e) => e.id === "tp_title")?.text).toBe("Markov models");
    expect(seq[0].commands?.[0].speak).toBe("Markov models");
  });

  test("a cast without a title, or one that opens with its own card, gets none", () => {
    expect(exportSequence(singlePlaylist(item(undefined)), { titleCard: true })).toHaveLength(1);
    expect(exportSequence(singlePlaylist(item("T", [{ card: { title: "T" } }, { draw: "a" }])), { titleCard: true })).toHaveLength(1);
  });

  test("a playlist with a title keeps its one title page; a multi-item playlist without one gets no card", () => {
    const titled: Playlist = { meta: { title: "Series", advance: "auto", gap: 1, transitions: "none" }, entries: [{ kind: "item", spec: item("One") }, { kind: "item", spec: item("Two") }], warnings: [] };
    expect(exportSequence(titled, { titleCard: true }).filter((s) => (s.elements ?? []).some((e) => e.id === "tp_title"))).toHaveLength(1);
    const untitled: Playlist = { ...titled, meta: { advance: "auto", gap: 1, transitions: "none" } };
    expect(exportSequence(untitled, { titleCard: true })).toHaveLength(2);
  });
});
