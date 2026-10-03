import { describe, expect, test } from "vitest";
import { endWords, makeEndPage, makeNextCard, posterItemOf, type Playlist } from "../src/playlist/playlist";
import { lecturePlaylist } from "../src/course/run";
import { parseCourse } from "../src/course/document";
import { lecturePosters } from "../src/course/publish";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const part = (title: string): Spec => ({ title, elements: [], commands: [] });
const pl = (...specs: Spec[]): Playlist => ({ meta: {} as Playlist["meta"], entries: specs.map((spec) => ({ kind: "item" as const, spec })), warnings: [] });

describe("the poster's part", () => {
  test("the last content part, never the end page", () => {
    expect(posterItemOf(pl(part("a"), part("b"), makeEndPage({ position: 1, total: 3, next: "Two" })))?.spec.title).toBe("b");
  });
  test("never the legacy Next card either", () => {
    expect(posterItemOf(pl(part("a"), makeNextCard({ next: "Two", position: 2, total: 3 })))?.spec.title).toBe("a");
  });
  test("a playlist of nothing but an end page has none", () => {
    expect(posterItemOf(pl(makeEndPage({ position: 2, total: 2, prev: "One" })))).toBeNull();
  });
});

describe("the end page", () => {
  test("validates, and ends drawn (no clear)", () => {
    const end = makeEndPage({ position: 2, total: 3, prev: "One", next: "Three" });
    expect(validateSpec(end).ok).toBe(true);
    expect(end.commands?.some((c) => c.clear !== undefined)).toBe(false);
    expect(end.elements?.filter((e) => e.type === "link").map((e) => e.href)).toEqual(["lecture:1", "lecture:3", "lecture:2"]);
  });
  test("speaks the lecture's language: its own words, its spoken Next, its lang", () => {
    const end = makeEndPage({ position: 2, total: 3, prev: "En", next: "Tre", lang: "nb" });
    const texts = (end.elements ?? []).map((e) => (e.type === "link" ? e.title : e.text));
    expect(texts).toEqual(["Forrige", "En", "Neste", "Tre", "Se igjen", "2 av 3"]);
    expect(end.commands?.[0].speak).toBe("Neste: Tre");
    expect(end.lang).toBe("nb");
    expect(validateSpec(end).ok).toBe(true);
    expect(endWords("nb-NO").prev).toBe("Forrige");
    expect(endWords("no").next).toBe("Neste");
    for (const l of ["nn", "sv", "da", "de", "fr", "es"]) expect(endWords(l).next).not.toBe("Next");
    // English (and unknown) stays as it was, with no lang stamped.
    const en = makeEndPage({ position: 1, total: 2, next: "Two", lang: "xx" });
    expect(en.commands?.[0].speak).toBe("Next: Two");
    expect(en.lang).toBeUndefined();
  });
  test("a course lecture's end page follows its parts' language", () => {
    const course = parseCourse("# K\n\n## En\n\n## To\n");
    const nb = lecturePlaylist(course, 0, { specs: [{ title: "a", lang: "nb", elements: [], commands: [] }], chapterOf: [], failed: [] } as never);
    expect(nb.entries.at(-1)).toMatchObject({ kind: "item", spec: { end_page: true, lang: "nb", title: "Hvor nå" } });
  });
});

describe("lecture posters at publish", () => {
  const plan = {
    files: [
      { path: "courses/qaly/01-a.yaml", content: "A" },
      { path: "courses/qaly/02-b.yaml", content: "B" },
      { path: "courses/qaly/index.html", content: "<html>" },
    ],
    fileOf: new Map([
      [0, "01-a.yaml"],
      [1, "02-b.yaml"],
    ]),
  };
  test("one png beside each lecture that could be drawn", async () => {
    const out = await lecturePosters(plan, async (yaml) => (yaml === "A" ? new Uint8Array([1]) : null));
    expect(out.map((f) => f.path)).toEqual(["courses/qaly/01-a.png"]);
  });
  test("a poster that throws is no poster, not a failed publish", async () => {
    await expect(lecturePosters(plan, async () => Promise.reject(new Error("no DOM")))).resolves.toEqual([]);
  });
});
