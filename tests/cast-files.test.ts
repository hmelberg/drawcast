// .cast files (2026-10-03): a published cast written as script, with its baked
// narration after `---` as the same `audio:` document a YAML stream carries.
// What publishing writes must come back as the same playlist and the same audio.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import bundled from "../src/examples.json";
import { formatPublished, parsePlaylistText, singlePlaylist, splitAudioTail, type AudioTrack, type Playlist } from "../src/playlist/playlist";
import { normalizeSpec } from "../src/spec/schema";
import { looksLikeScript } from "../src/spec/script/detect";
import type { Spec } from "../src/spec/types";

const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : v;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const norm = (p: Playlist) => ({ meta: p.meta, entries: p.entries.map((e) => (e.kind === "item" ? { kind: "item", spec: normalizeSpec(e.spec) } : e)) });

const AUDIO: AudioTrack = { lang: "en", lines: { abc123: { mp3: "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4", ms: 1200, voice: "en-GB-a" } } };

const QALY = "docs/courses/qaly";
const lectures = readdirSync(QALY).filter((f) => f.endsWith(".cast")).map((f) => [f, readFileSync(`${QALY}/${f}`, "utf8")] as const);

describe("a published .cast", () => {
  test("is a script, and carries the audio after it", () => {
    const p = singlePlaylist(bundled.find((e) => e.spec)!.spec as unknown as Spec);
    const text = formatPublished(p, AUDIO, "script");
    const tail = splitAudioTail(text);
    expect(tail).not.toBeNull();
    expect(looksLikeScript(tail!.body)).toBe(true);
    expect(tail!.audio.startsWith("audio:")).toBe(true);
    const back = parsePlaylistText(text);
    expect(back.audio).toEqual(AUDIO);
    expect(same(norm(back), norm(p))).toBe(true);
  });

  test("with no audio it is the plain script", () => {
    const p = singlePlaylist(bundled.find((e) => e.spec)!.spec as unknown as Spec);
    const text = formatPublished(p, null, "script");
    expect(splitAudioTail(text)).toBeNull();
    expect(parsePlaylistText(text).audio).toBeUndefined();
  });

  test("a broken audio document is a warning, never the lecture", () => {
    const p = singlePlaylist(bundled.find((e) => e.spec)!.spec as unknown as Spec);
    const text = `${formatPublished(p, null, "script")}---\naudio: [unclosed\n`;
    const back = parsePlaylistText(text);
    expect(back.audio).toBeUndefined();
    expect(back.warnings.some((w) => w.includes("audio"))).toBe(true);
    expect(back.entries.length).toBe(p.entries.length);
  });

  test.each(lectures)("the QALY lecture %s (converted from YAML 2026-10-03) reads cleanly and reprints byte for byte", (_name, text) => {
    const p = parsePlaylistText(text);
    expect(p.warnings).toEqual([]);
    expect(p.entries.filter((e) => e.kind === "item").length).toBeGreaterThan(1);
    expect(formatPublished(p, p.audio ?? null, "script")).toBe(text);
  });

  test("every bundled example survives as a published .cast", () => {
    const broken: string[] = [];
    for (const e of bundled as { spec?: Spec }[]) {
      if (!e.spec) continue;
      const p = singlePlaylist(e.spec);
      const back = parsePlaylistText(formatPublished(p, AUDIO, "script"));
      if (!same(norm(back), norm(p)) || !same(back.audio, AUDIO)) broken.push(e.spec.title ?? "?");
    }
    expect(broken).toEqual([]);
  });
});

describe("script can say every page field", () => {
  test("each top-level spec field has a script form (a setting, a payload fence, the heading, or the beats)", async () => {
    const { specSchema } = await import("../src/spec/schema");
    const { SETTING_ORDER, PAYLOAD_KEYS } = await import("../src/spec/script/print");
    const { SETTING_KEYS } = await import("../src/spec/script/lines");
    const said = new Set<string>(["title", "elements", "commands", ...SETTING_ORDER.map(([k]) => k as string), ...PAYLOAD_KEYS]);
    const fields = Object.keys((specSchema as unknown as { properties: Record<string, unknown> }).properties);
    expect(fields.filter((f) => !said.has(f))).toEqual([]);
    // …and every setting the printer writes, the scanner reads.
    expect(SETTING_ORDER.map(([, name]) => name).filter((n) => !(SETTING_KEYS as readonly string[]).includes(n))).toEqual([]);
  });
});

describe("the cases real files found (dev-casts and the published repos)", () => {
  const back = (p: Playlist) => parsePlaylistText(formatPublished(p, null, "script"));
  const item = (spec: Record<string, unknown>) => ({ kind: "item" as const, spec: spec as unknown as Spec });
  const list = (meta: Record<string, unknown>, specs: Record<string, unknown>[]): Playlist => ({ meta: { ...singlePlaylist({} as Spec).meta, ...meta }, entries: specs.map(item), warnings: [] });

  test("an untitled page (a course's end page) stays a page of its own", () => {
    const p = list({ title: "Course" }, [{ title: "One", commands: [{ speak: "First." }] }, { commands: [{ speak: "Next: two." }] }]);
    expect(same(norm(back(p)), norm(p))).toBe(true);
  });

  test("a playlist with one titled page keeps both titles", () => {
    for (const title of ["Course", "Same"]) {
      const p = list({ title }, [{ title: "Same", commands: [{ speak: "Hei." }] }]);
      expect(same(norm(back(p)), norm(p))).toBe(true);
    }
  });

  test("an element's own gap is never read as its placement's", () => {
    const spec = { commands: [{ speak: "Hei." }], elements: [{ id: "a", type: "text", text: "A", x: 1, y: 1 }, { id: "r", type: "group", layout: "row", gap: 70, members: ["a"], at: { side: "above", ref: "a" } }] };
    const p = singlePlaylist(spec as unknown as Spec);
    expect(same(norm(back(p)), norm(p))).toBe(true);
  });

  test("a layout group keeps its member order when its members are declared elsewhere", () => {
    const spec = {
      elements: [
        { id: "d", type: "text", text: "D", x: 0, y: 0 },
        { id: "t", type: "text", text: "T", x: 0, y: 0 },
        { id: "col", type: "group", layout: "column", members: ["t", "d"] },
      ],
      commands: [{ speak: "Hei." }, { draw: ["col"] }],
    };
    const p = singlePlaylist(spec as unknown as Spec);
    expect(same(norm(back(p)), norm(p))).toBe(true);
  });

  test("a code element whose id is also a field name (walk)", () => {
    const spec = { elements: [{ id: "walk", type: "code", language: "r", show: "output", code: "x <- 1" }], commands: [{ speak: "Hei.", draw: ["walk"] }] };
    const p = singlePlaylist(spec as unknown as Spec);
    expect(same(norm(back(p)), norm(p))).toBe(true);
  });
});

describe("every reader takes a .cast file", async () => {
  const { DOC_EXT_RE, stripDocExt } = await import("../src/cast-file");
  const { isValidCastKey } = await import("../netlify/lib/view-key.mts");
  const { CAST_KEY_RE } = await import("../src/learn");
  const { parseViewerHash } = await import("../src/viewer");
  const { registryItemKey } = await import("../src/registry");
  const { posterPathFor, privateCastTarget } = await import("../src/publish/cast");
  const { parseTarget } = await import("../src/links/resolve");
  const share = await import("../netlify/lib/share-card.mts");

  test("the extension rule: .cast and .yaml, stripped alike", () => {
    expect(DOC_EXT_RE.test("a/b.cast") && DOC_EXT_RE.test("a/b.yaml") && DOC_EXT_RE.test("a/b.yml")).toBe(true);
    expect(stripDocExt("casts/intro.cast")).toBe("casts/intro");
    expect(stripDocExt("casts/intro.yaml")).toBe("casts/intro");
  });

  test("cast keys (views, learner events) accept .cast on both sides", () => {
    expect(isValidCastKey("hmelberg/dcast/casts/intro.cast")).toBe(true);
    expect(CAST_KEY_RE.test("hmelberg/dcast/casts/intro.cast")).toBe(true);
  });

  test("the viewer opens #gh= and #anvil= links to a .cast", () => {
    expect(parseViewerHash("#gh=hmelberg/dcast/casts/intro.cast")).not.toBeNull();
    expect(parseViewerHash("#anvil=spanish/01-intro.cast")).not.toBeNull();
  });

  test("registry keys, posters and private targets drop .cast as they drop .yaml", () => {
    expect(registryItemKey("cast", "o/r/casts/intro.cast")).toBe("o/r/casts/intro");
    expect(posterPathFor("casts/intro.cast")).toBe("casts/intro.png");
    expect(privateCastTarget({ owner: "o", repo: "r" } as never, "casts", "intro", undefined, "Intro").item).toBe("o/r/casts/intro");
  });

  test("a link element may point at a .cast", () => {
    expect(parseTarget("./next.cast")).not.toBeNull();
    expect(parseTarget("o/r/casts/next.cast")).not.toBeNull();
  });

  test("share cards: a .cast keeps its extension in the card path, and its title is read from the script", () => {
    const t = share.parseSharePath("/c/gh/o/r/casts/intro.cast", "/c/");
    expect(t).toEqual({ kind: "gh", owner: "o", repo: "r", path: "casts/intro.cast" });
    const card = share.cardPathFor(t!);
    expect(card).toBe("/card/gh/o/r/casts/intro.cast.png");
    expect(share.parseSharePath(card, "/card/")).toEqual(t);
    // …while a .yaml cast's card path is unchanged.
    expect(share.parseSharePath("/card/gh/o/r/casts/intro.png", "/card/")).toEqual({ kind: "gh", owner: "o", repo: "r", path: "casts/intro.yaml" });
    expect(share.castCardText('# What is a QALY?\nsubtitle: "Length, quality, one number"\nprompt: Why?\n\n## Page one\nSpoken.\n')).toEqual({ title: "What is a QALY?", subtitle: "Length, quality, one number" });
    expect(share.castCardText("# A single page\nuse: supply_demand\nwith:\n    subtitle: not this\n")).toEqual({ title: "A single page" });
    // A YAML file that opens with a comment is still YAML.
    expect(share.castCardText("# made by hand\nplaylist:\n  title: Real title\n")).toEqual({ title: "Real title" });
  });
});

describe("publishing under the switch (src/cast-file.ts publishesCast)", async () => {
  const { setPublishesCast, publishName, publishExt } = await import("../src/cast-file");
  const { buildCastPlan, emptyCastIndex, castRegistration, privateCastTarget } = await import("../src/publish/cast");
  const { buildPublishPlan } = await import("../src/course/publish");
  const { parseCourse } = await import("../src/course/document");
  const { emptyManifest, upsertCourse } = await import("../src/publish/github");
  const repo = { owner: "hmelberg", repo: "kurs" };
  const castArgs = { title: "Difference-in-differences", text: "# DiD\n\nHei.\n", repo, castsDir: "casts", viewerBase: "https://drawcast.app", index: emptyCastIndex() };
  const withSwitch = <T>(on: boolean, f: () => T): T => {
    setPublishesCast(on);
    try {
      return f();
    } finally {
      setPublishesCast(true);
    }
  };

  test("on by default (the server takes .cast keys since 2026-10-03)", () => {
    expect(publishExt()).toBe(".cast");
  });

  test("off: .yaml, as before", () => withSwitch(false, () => {
    expect(publishExt()).toBe(".yaml");
    const plan = buildCastPlan(castArgs);
    expect(plan.files.some((f) => f.path === "casts/difference-in-differences.yaml")).toBe(true);
    expect(plan.castUrl.endsWith(".yaml")).toBe(true);
    expect(publishName("01-a.yaml")).toBe("01-a.yaml");
  }));

  test("on: a cast is published as .cast — file, link, index entry, registration and private target agree", () => {
    withSwitch(true, () => {
      const plan = buildCastPlan(castArgs);
      expect(plan.files.some((f) => f.path === "casts/difference-in-differences.cast")).toBe(true);
      expect(plan.castUrl).toBe("https://drawcast.app/#gh=hmelberg/kurs/casts/difference-in-differences.cast");
      const index = JSON.parse(plan.files.find((f) => f.path === "casts/casts.json")!.content);
      expect(index.casts[0].file).toBe("difference-in-differences.cast");
      expect(castRegistration("difference-in-differences", repo, "casts", "p").target).toBe("hmelberg/kurs/casts/difference-in-differences.cast");
      // The registry item is the same either way: the switch never moves a cast's row.
      expect(privateCastTarget(repo, "casts", undefined, "difference-in-differences", "x").item).toBe("hmelberg/kurs/casts/difference-in-differences");
    });
  });

  test("on: a course's recorded .yaml lectures become .cast, and the old files are deleted in the same commit", () => {
    withSwitch(true, () => {
      const text = "# T\nslug: t\n\n## A\nq\nstatus: done · file: 01-a.yaml\n\n## B\nq\n";
      const course = parseCourse(text);
      // The repo's manifest still lists the .yaml from the last publish.
      const manifest = upsertCourse(emptyManifest(), { slug: "t", title: "T", files: ["t/01-a.yaml", "t/course.md"], updated: "2026-10-01" });
      const plan = buildPublishPlan({ course, text, repo, coursesDir: "", viewerBase: "https://drawcast.app/", manifest, lectureYaml: () => "title: One\nelements: []\ncommands: []\n" });
      expect(plan.fileOf.get(0)).toBe("01-a.cast");
      expect(plan.fileOf.get(1)!.endsWith(".cast")).toBe(true);
      expect(plan.files.some((f) => f.path === "t/01-a.cast")).toBe(true);
      expect(plan.deletions).toContain("t/01-a.yaml");
      // …and the lecture is written as script.
      const lecture = plan.files.find((f) => f.path === "t/01-a.cast")!.content;
      expect(looksLikeScript(lecture.split(/\n---\naudio:/)[0])).toBe(true);
    });
  });
});

describe("ids with a decimal in them (a template's ticks: tick_0.5)", () => {
  test("a draw of tick ids reads back as those ids", () => {
    const spec = { commands: [{ speak: "Put it on a line.", draw: ["line", "tick_-0.5", "tick_0", "tick_0.25"] }] };
    const p = singlePlaylist(spec as unknown as Spec);
    const back = parsePlaylistText(formatPublished(p, null, "script"));
    expect(same(norm(back), norm(p))).toBe(true);
  });
});
