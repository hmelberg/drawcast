// A Commodore 64 game on a drawn machine: the boot screen and play mark the
// layout draws (ink — a movie shows exactly this), the emulator URL the
// player opens, the beat that hands over the joystick, and the two ways an
// author can point at a program the emulator could never fetch.

import { describe, expect, test } from "vitest";
import { c64EmulatorUrl, C64_PALETTE, C64_BACKGROUND, C64_BORDER, C64_TEXT } from "../src/code/c64";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type AreaDrawable, type TextDrawable } from "../src/layout/model";
import { lintCommands } from "../src/lint/lint";
import { planCommands } from "../src/render/plan";
import { resolveCode } from "../src/render/code";
import type { Spec } from "../src/spec/types";

const GAME = "https://vc64web.github.io/doc/media/wolfling14.prg";
const spec = (el: object = {}, commands: object[] = [{ draw: ["c64"] }]): Spec =>
  ({ elements: [{ id: "c64", type: "code", frame: "c64", game: GAME, ...el }], commands }) as unknown as Spec;
const lay = (el: object = {}) => layoutSpec(spec(el), heuristicMeasure);
const leaf = (el: object, id: string) => flattenDrawables(lay(el).drawables).find((d) => d.id === id);

describe("the emulator URL", () => {
  test("is vc64web's own page with the Open ROMs and the program in its hash", () => {
    const u = c64EmulatorUrl(GAME);
    expect(u.startsWith("https://vc64web.github.io/#")).toBe(true);
    expect(u).toContain("#openROMS=true");
    expect(u).toContain("#navbar=hidden");
    expect(u.endsWith(`#${GAME}`)).toBe(true);
  });
});

describe("what the layout draws for a switched-on machine", () => {
  test("the boot screen in the machine's own colours, inside the panel's group", () => {
    const border = leaf({}, "c64__border") as AreaDrawable;
    const screen = leaf({}, "c64__screen") as AreaDrawable;
    expect(border.style.fill).toBe(C64_PALETTE[C64_BORDER]);
    expect(screen.style.fill).toBe(C64_PALETTE[C64_BACKGROUND]);
    // The screen sits inside the border on every side.
    const bx = border.pts.map((p) => p[0]), sx = screen.pts.map((p) => p[0]);
    expect(Math.min(...sx)).toBeGreaterThan(Math.min(...bx));
    expect(Math.max(...sx)).toBeLessThan(Math.max(...bx));
    const ready = leaf({}, "c64__boot2") as TextDrawable;
    expect(ready.text).toBe("READY.");
    expect(ready.font).toBe("mono");
    expect(ready.style.color).toBe(C64_PALETTE[C64_TEXT]);
    expect((leaf({}, "c64__boot0") as TextDrawable).text).toContain("COMMODORE 64 BASIC V2");
  });

  test("a play mark on the screen's centre, white so it reads on blue", () => {
    const ring = leaf({}, "c64__play")!;
    const tri = leaf({}, "c64__playtri") as AreaDrawable;
    expect(ring.style.color).toBe(C64_PALETTE[1]);
    expect(tri.style.fill).toBe(C64_PALETTE[1]);
    const screen = leaf({}, "c64__screen") as AreaDrawable;
    const cx = (Math.min(...screen.pts.map((p) => p[0])) + Math.max(...screen.pts.map((p) => p[0]))) / 2;
    const tcx = tri.pts.reduce((a, p) => a + p[0], 0) / tri.pts.length;
    expect(Math.abs(tcx - cx)).toBeLessThan(15);
  });

  test("it is all one beat: draw: [id] switches the machine on, and no ruled placeholders remain", () => {
    const l = lay();
    const panel = l.drawables.find((d) => d.id === "c64")!;
    const ids = flattenDrawables([panel]).map((d) => d.id);
    for (const part of ["c64__border", "c64__screen", "c64__boot2", "c64__play"]) expect(ids).toContain(part);
    expect(flattenDrawables(l.drawables).some((d) => d.id.startsWith("c64__rule"))).toBe(false);
  });

  test("the screen keeps the machine's shape — 40 × 25 characters, 320 × 200", () => {
    const border = leaf({}, "c64__border") as AreaDrawable;
    const xs = border.pts.map((p) => p[0]), ys = border.pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const hh = Math.max(...ys) - Math.min(...ys);
    expect(w / hh).toBeGreaterThan(1.3);
    expect(w / hh).toBeLessThan(1.9);
  });

  test("a script on the same machine keeps the ordinary panel — the boot screen is for a machine with nothing to run", () => {
    const l = lay({ language: "python", code: "print(1)" });
    expect(flattenDrawables(l.drawables).some((d) => d.id === "c64__screen")).toBe(false);
  });
});

describe("a machine with nothing to run is not an error", () => {
  test("resolveCode skips it instead of stamping 'needs language and code'", async () => {
    const s = spec();
    const res = await resolveCode(s, { runner: async () => { throw new Error("must not run"); } });
    expect(res).toEqual([{ id: "c64", ok: true, skipped: true }]);
    expect(s.elements![0].code_result).toBeUndefined();
  });
});

describe("the beat that hands over the joystick", () => {
  test("explore: { game } is carried, and an unknown id is reported", () => {
    const plan = planCommands([{ draw: ["c64"] }, { explore: { game: "c64" } }] as never, ["c64"], {});
    expect(plan.steps[1]).toMatchObject({ kind: "explore", game: "c64" });
    const bad = planCommands([{ explore: { game: "nope" } }] as never, ["c64"], {});
    expect(bad.warnings.some((w) => w.includes('"nope" is not an element'))).toBe(true);
  });
});

describe("what the emulator could never fetch is caught at authoring time", () => {
  test("http, and a '#' in the URL", () => {
    expect(lintCommands(spec({ game: "http://example.org/x.prg" })).some((i) => i.message.includes("nor an https URL"))).toBe(true);
    expect(lintCommands(spec({ game: "https://example.org/x.prg#v2" })).some((i) => i.message.includes("may not contain '#'"))).toBe(true);
    expect(lintCommands(spec()).some((i) => i.message.includes("game"))).toBe(false);
  });
});

// ---- the catalogue, and what a `game` value may be ----------------------
import { C64_PROGRAMS, NO_CORS_HOSTS, resolveGame } from "../src/code/c64-catalogue";

describe("the catalogue", () => {
  test("every entry is a key, an https URL without '#', and a note for the tray", () => {
    expect(C64_PROGRAMS.length).toBeGreaterThan(0);
    for (const p of C64_PROGRAMS) {
      expect(p.key).toMatch(/^[a-z0-9-]+$/);
      expect(p.url.startsWith("https://")).toBe(true);
      expect(p.url).not.toContain("#");
      expect(p.note.length).toBeGreaterThan(10);
      expect(NO_CORS_HOSTS).not.toContain(new URL(p.url).hostname);
    }
    expect(new Set(C64_PROGRAMS.map((p) => p.key)).size).toBe(C64_PROGRAMS.length);
  });

  test("a key resolves to its program, a URL to itself, and the rest is refused with the reason", () => {
    expect(resolveGame("wolfling")).toEqual({ url: GAME, title: "Wolfling" });
    expect(resolveGame("c64maze")).toEqual({ url: "https://raw.githubusercontent.com/DarwinNE/C64maze/master/c64maze.prg", title: "C64maze" });
    expect(resolveGame(GAME)).toEqual({ url: GAME, title: "wolfling14.prg" });
    expect(resolveGame("boulder-dash").reason).toMatch(/neither a catalogue key \(c64maze, crowboy, space-shooter, tenlander, wolfling\) nor an https URL/);
    expect(resolveGame("http://example.org/x.prg").reason).toMatch(/https/);
    expect(resolveGame("https://example.org/x.prg#v2").reason).toMatch(/'#'/);
    expect(resolveGame("https://csdb.dk/getinternalfile.php/1/x.prg").reason).toMatch(/csdb\.dk sends no CORS header/);
  });

  test("the lint and the schema both speak the catalogue", () => {
    expect(lintCommands(spec({ game: "wolfling" })).some((i) => i.message.includes("game"))).toBe(false);
    expect(lintCommands(spec({ game: "https://csdb.dk/x.prg" })).some((i) => i.message.includes("no CORS header"))).toBe(true);
  });
});

// ---- the Internet Archive as a source the viewer picks from ----------------
import { archiveEmbedUrl, archivePageUrl, archiveSearchUrl, parseArchiveSearch } from "../src/code/c64-archive";

describe("the Archive", () => {
  test("the search is scoped to the C64 library and asks for what the tray shows", () => {
    const u = new URL(archiveSearchUrl("boulder dash"));
    expect(u.hostname).toBe("archive.org");
    expect(u.searchParams.get("q")).toBe("collection:softwarelibrary_c64 AND (boulder dash)");
    expect(u.searchParams.get("output")).toBe("json");
    expect(u.searchParams.getAll("fl[]")).toEqual(["identifier", "title", "year"]);
    // quotes and parentheses would break the query language; an empty query is everything
    expect(new URL(archiveSearchUrl('x ("y")')).searchParams.get("q")).toBe("collection:softwarelibrary_c64 AND (x   y)");
    expect(new URL(archiveSearchUrl("  ")).searchParams.get("q")).toBe("collection:softwarelibrary_c64 AND (*)");
  });

  test("hits come out in the Archive's order, and an identifier that could not be a path is dropped", () => {
    const hits = parseArchiveSearch({
      response: { docs: [{ identifier: "Baffle_1994_Feniks", title: "Baffle (1994)(Feniks)", year: "1994" }, { identifier: "../x", title: "no" }, { identifier: "Bare_Id" }] },
    });
    expect(hits).toEqual([{ id: "Baffle_1994_Feniks", title: "Baffle (1994)(Feniks)", year: "1994" }, { id: "Bare_Id", title: "Bare_Id" }]);
    expect(parseArchiveSearch(null)).toEqual([]);
    expect(parseArchiveSearch({ response: {} })).toEqual([]);
  });

  test("a pick runs in the Archive's own player, and its page is one click away", () => {
    expect(archiveEmbedUrl("Baffle_1994_Feniks")).toBe("https://archive.org/embed/Baffle_1994_Feniks");
    expect(archiveEmbedUrl("a/b")).toBeNull();
    expect(archivePageUrl("Baffle_1994_Feniks")).toBe("https://archive.org/details/Baffle_1994_Feniks");
  });

  test("every catalogue program names the licence that lets us point at it", () => {
    for (const p of C64_PROGRAMS) expect(p.licence.length).toBeGreaterThan(3);
    expect(C64_PROGRAMS.map((p) => p.key)).toEqual(["c64maze", "crowboy", "space-shooter", "tenlander", "wolfling"]);
  });
});
