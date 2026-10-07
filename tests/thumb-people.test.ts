// Backgrounds and photo people on the listing picture (2026-10-07).
import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { backgroundSvg, colourOf, defaultBackground, parseThumbLine, planThumb, printThumbLine, readThumb, thumbSvg, BG_PRESET_NAMES } from "../netlify/lib/thumb.mts";
import { PEOPLE, pickPerson, readPersonWords } from "../netlify/lib/people.mts";
import { renderThumb } from "../netlify/lib/thumb-render.mts";
import { PNG } from "pngjs";

describe("backgrounds", () => {
  test("presets, solid, gradient, glow and paper read and print back", () => {
    expect(parseThumbLine("sky").parts.bg).toBe("sky");
    expect(parseThumbLine('band "Hey" solid teal').parts).toMatchObject({ headline: "Hey", bg: "solid teal" });
    expect(parseThumbLine("gradient blue pink stamp").parts).toMatchObject({ bg: "gradient blue pink", marks: [{ kind: "stamp" }] });
    expect(parseThumbLine("glow #FFAA00").parts.bg).toBe("glow #ffaa00");
    expect(parseThumbLine("solid").parts.bg).toBe("solid yellow");
    expect(readThumb('lilac band "x"')).toBe('band "x" lilac');
  });
  test("the default is a preset, the same for the same title", () => {
    expect(BG_PRESET_NAMES).toContain(defaultBackground("Why the Moon never lands"));
    expect(planThumb(undefined, { title: "A" }).bg).toBe(planThumb('band "x"', { title: "A" }).bg);
    expect(planThumb("mint", { title: "A" }).bg).toBe("mint");
  });
  test("a dark colour is lightened so ink still reads", () => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(colourOf("#102030")!.slice(i, i + 2), 16));
    expect((0.3 * r + 0.59 * g + 0.11 * b) / 255).toBeGreaterThanOrEqual(0.74);
    expect(colourOf("blurple")).toBeUndefined();
  });
  test("the picture is multiplied onto the background", () => {
    const svg = thumbSvg(planThumb("glow pink", { title: "T" }), "p.png");
    expect(svg).toContain("radialGradient");
    expect(svg).toMatch(/<image href="p.png"[^>]*mix-blend-mode:multiply/);
    expect(backgroundSvg("paper")).toContain("#fffdf7");
  });
});

describe("people", () => {
  test("every catalogue picture is a file", () => {
    for (const p of PEOPLE) expect(existsSync(`public/thumb-people/${p.id}.png`)).toBe(true);
  });
  test("words read in any order, with synonyms", () => {
    expect(readPersonWords(["male", "45", "bald", "shocked"])).toEqual({ sex: "man", age: 45, looks: ["bald"], expression: "surprised" });
    expect(readPersonWords(["girl"])).toEqual({ sex: "woman", age: 9, looks: [] });
    expect(readPersonWords(["40s"]).age).toBe(45);
  });
  test("the nearest picture: exact when there is one, else the wishes let go in order", () => {
    expect(pickPerson(readPersonWords(["man", "45", "bald", "surprised"])).id).toBe("m45-surprised");
    expect(pickPerson(readPersonWords(["woman", "19", "puzzled"])).id).toBe("f19-puzzled");
    // no 70-year-old puzzled woman: the expression holds, then sex
    expect(pickPerson(readPersonWords(["woman", "70", "puzzled"])).id).toBe("f19-puzzled");
    // nobody annoyed yet: sex and age decide
    expect(pickPerson(readPersonWords(["old", "woman", "annoyed"])).id).toBe("f72-surprised");
  });
  test("the line takes a person and keeps them; a cartoon figure gives way", () => {
    const { parts } = parseThumbLine('band "Wait" person man 60 surprised stamp');
    expect(parts.person).toEqual(["man", "60", "surprised"]);
    expect(parts.marks).toEqual([{ kind: "stamp" }]);
    expect(printThumbLine(parts)).toBe('band "Wait" person man 60 surprised stamp');
    const plan = planThumb('band "Wait" thinking person child', { title: "T", kids: true, format: "quiz" });
    expect(plan.person).toBe("m9-surprised");
    expect(plan.figure).toBe("none");
    expect(planThumb("person", { title: "T" }).person).toBe(planThumb("person", { title: "T" }).person);
  });
  test("the person stands on the emptier side, facing the middle; marks and words go to the other", () => {
    const plan = planThumb('band "A headline here" person man 45 bald stamp', { title: "T" });
    const leftEmpty = thumbSvg(plan, "p.png", { tl: 0, bl: 0, tr: 1, br: 1 });
    // m45 looks left: on the left side he is mirrored to look right
    expect(leftEmpty).toMatch(/scale\(-1 1\)"><image href="\/thumb-people\/m45-surprised.png"/);
    const rightEmpty = thumbSvg(plan, "p.png", { tl: 1, bl: 1, tr: 0, br: 0 });
    expect(rightEmpty).not.toContain("scale(-1 1)");
    // the stamp takes a left corner when the person is on the right
    expect(rightEmpty).toMatch(/translate\(24 20\)/);
  });
  test("resvg draws the person, outlined, from the bundled file", () => {
    const poster = new PNG({ width: 100, height: 75 });
    poster.data.fill(255);
    const png = PNG.sync.read(Buffer.from(renderThumb(planThumb("solid blue person woman 19 surprised", { title: "T" }), PNG.sync.write(poster))));
    expect(png.width).toBe(1000);
    // the right half near the bottom is the person, not the blue background
    const at = (x: number, y: number): number[] => Array.from(png.data.slice((y * 1000 + x) * 4, (y * 1000 + x) * 4 + 3));
    expect(at(820, 700)).not.toEqual(at(150, 100));
    expect(at(150, 100)).toEqual([0xb7, 0xd9, 0xff]);
  });
});
