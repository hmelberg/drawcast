import { describe, expect, it } from "vitest";
import { buildPublishPlan } from "../src/course/publish";
import { formatPlaylist, isSingle, parsePlaylistText } from "../src/playlist/playlist";
import { parseCourse } from "../src/course/document";

// Hans 2026-09-02: "when a lecture ends on Next it should also have a link
// to the next lecture so we can just click it and go". The link lives in the
// PUBLISHED copy's header (meta.next) — written at publish time, the one
// moment the target URL exists, and recomputed on every republish so
// reordering can never stale it.

const COURSE = [
  "# C",
  "---",
  "## One",
  "q?",
  "status: done · id: a1 · 2026-09-01",
  "---",
  "## Two",
  "q?",
  "status: done · id: a2 · 2026-09-01",
  "---",
  "## Three (ungenerated)",
  "q?",
].join("\n");

const LECTURE = "title: L\nelements: []\ncommands: []";

function plan(lectureYaml: (i: number) => string | null) {
  return buildPublishPlan({
    course: parseCourse(COURSE),
    text: COURSE,
    repo: { owner: "o", repo: "r" },
    coursesDir: "courses",
    viewerBase: "https://drawcast.app/",
    manifest: { courses: [] },
    lectureYaml,
  });
}

describe("meta.next in the header", () => {
  it("round-trips, and a doc that carries it keeps its header", () => {
    const p = parsePlaylistText("title: T\nelements: []\ncommands: []");
    p.meta.next = { title: "Two", href: "https://x/#gh=o/r/c/two.yaml" };
    expect(isSingle(p)).toBe(false);
    expect(parsePlaylistText(formatPlaylist(p, "yaml")).meta.next).toEqual({ title: "Two", href: "https://x/#gh=o/r/c/two.yaml" });
  });

  it("malformed next is ignored with a warning", () => {
    const p = parsePlaylistText("playlist: {next: {title: 1}}\n---\ntitle: T\nelements: []\ncommands: []");
    expect(p.meta.next).toBeUndefined();
    expect(p.warnings.some((w) => w.includes("next"))).toBe(true);
  });
});

describe("publishCourse writes the link", () => {
  it("each lecture points at the NEXT published one; none points at an ungenerated page", () => {
    const out = plan((i) => (i < 2 ? LECTURE : null));
    const lecture0 = parsePlaylistText(out.files.find((f) => f.path.endsWith("/one.yaml"))!.content);
    expect(lecture0.meta.next).toEqual({ title: "Two", href: "https://drawcast.app/#gh=o/r/courses/c/two.yaml" });
    // Two's successor (Three) has no page — no link to a 404.
    const lecture1 = parsePlaylistText(out.files.find((f) => f.path.endsWith("/two.yaml"))!.content);
    expect(lecture1.meta.next).toBeUndefined();
  });

  it("a republish CLEARS a stale link the earlier order left on what is now last", () => {
    const withStale = formatPlaylist(
      (() => {
        const p = parsePlaylistText(LECTURE);
        p.meta.next = { title: "Gone", href: "https://drawcast.app/#gh=o/r/courses/c/gone.yaml" };
        return p;
      })(),
      "yaml",
    );
    const out = plan((i) => (i === 1 ? withStale : i === 0 ? LECTURE : null));
    const last = parsePlaylistText(out.files.find((f) => f.path.endsWith("/two.yaml"))!.content);
    expect(last.meta.next).toBeUndefined();
  });
});
