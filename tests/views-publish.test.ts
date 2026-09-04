// The publish-time "Count views" choice. The DOM half is guarded by source
// text (no jsdom in this suite); the rule that matters is a pure helper both
// publishers call.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { applyViewsFlag } from "../src/views";
import { formatPlaylist, parsePlaylistText } from "../src/playlist/playlist";

describe("applyViewsFlag", () => {
  test("counting on writes nothing at all — the file keeps its usual shape", () => {
    const p = parsePlaylistText("title: T\nelements: []\ncommands: []");
    const out = applyViewsFlag(p, true);
    expect(out.meta.views).toBeUndefined();
    expect(formatPlaylist(out, "yaml")).not.toContain("views");
  });

  test("counting off writes the flag into the published copy", () => {
    const p = parsePlaylistText("title: T\nelements: []\ncommands: []");
    const out = applyViewsFlag(p, false);
    expect(out.meta.views).toBe(false);
    expect(parsePlaylistText(formatPlaylist(out, "yaml")).meta.views).toBe(false);
  });

  test("the author's own document is never touched — only the copy", () => {
    const p = parsePlaylistText("title: T\nelements: []\ncommands: []");
    applyViewsFlag(p, false);
    expect(p.meta.views).toBeUndefined();
  });
});

describe("both publishers use the one rule", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const course = readFileSync(new URL("../src/ui/course.ts", import.meta.url), "utf8");
  const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");

  test("a single drawcast applies it", () => {
    expect(main).toMatch(/applyViewsFlag\(/);
  });

  test("a course applies it too — the comments checkbox was dropped here once", () => {
    expect(course).toMatch(/applyViewsFlag\(/);
  });

  test("the choice reaches both through the same choices object", () => {
    expect(share).toMatch(/countViews/);
    expect(main).toMatch(/countViews/);
    expect(course).toMatch(/countViews/);
  });

  test("the box is offered in the Link panel and defaults on", () => {
    expect(share).toMatch(/id: "share-count-views"/);
    expect(share).toMatch(/countViewsCb\.checked = /);
  });

  test("the last publish seeds it, so a republish cannot silently re-enable counting", () => {
    expect(share).toMatch(/publishedViews/);
    expect(main).toMatch(/doc\.publishedViews = /);
    const store = readFileSync(new URL("../src/store.ts", import.meta.url), "utf8");
    expect(store).toMatch(/publishedViews\?:\s*boolean/);
  });

  test("an AI revision carries the opt-out forward too, not just Save/publish bookkeeping — this is the third time this class of omission has appeared", () => {
    // Revise rebuilds the Doc from scratch (it is not a mutation like the
    // publish-bookkeeping assignments above), so every persisted field has to
    // be listed by hand here or autosave() on the next line drops it forever.
    const revise = main.slice(main.indexOf("async function revise("), main.indexOf("reviewBtn.addEventListener("));
    expect(revise).toMatch(/publishedComments:\s*doc\.publishedComments/);
    expect(revise).toMatch(/publishedViews:\s*doc\.publishedViews/);
  });

  test("a course seeds it too, from its own persisted row — a course has no single Doc to hang this on", () => {
    const store = readFileSync(new URL("../src/store.ts", import.meta.url), "utf8");
    const savedCourse = store.slice(store.indexOf("interface SavedCourse"), store.indexOf("export function loadCourses"));
    expect(savedCourse).toMatch(/publishedViews\?:\s*boolean/);
    // Recorded only once the commit has LANDED, beside the course's other
    // publish bookkeeping (firstTime/published.add) — never before the call.
    expect(course).toMatch(/publishedViews = countViews !== false;/);
    // Read back into the ShareDoc course.ts hands to Share, scoped to that
    // build so the checkbox is seeded from the SAME field the publish just
    // wrote, not some unrelated `publishedViews` reference elsewhere.
    const shareDocBuild = course.slice(course.indexOf('subject: "course",'), course.indexOf("settings: deps.settings"));
    expect(shareDocBuild).toMatch(/publishedViews,/);
  });
});
