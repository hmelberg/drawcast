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
const lectures = readdirSync(QALY).filter((f) => f.endsWith(".yaml")).map((f) => [f, readFileSync(`${QALY}/${f}`, "utf8")] as const);

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

  test.each(lectures)("the QALY lecture %s survives YAML → .cast → playlist, with audio", (_name, yaml) => {
    const p = parsePlaylistText(yaml);
    const text = formatPublished(p, AUDIO, "script");
    const back = parsePlaylistText(text);
    expect(back.warnings).toEqual(p.warnings);
    expect(same(norm(back), norm(p))).toBe(true);
    expect(back.audio).toEqual(AUDIO);
    // …and far fewer lines than the YAML it replaces (812 → 297 for lecture 1;
    // the characters shrink less, since a skill-built lecture places by x/y).
    expect(formatPublished(p, null, "script").split("\n").length).toBeLessThan(yaml.split("\n").length * 0.5);
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
