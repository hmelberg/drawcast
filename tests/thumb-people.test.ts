// Backgrounds and photo people on the listing picture (2026-10-07).
import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { keyPaper } from "../netlify/lib/paper-key.mts";
import { parseThumbLine, planThumb, printThumbLine, readThumb, seeThroughFor, thumbSvg } from "../netlify/lib/thumb.mts";
import { PEOPLE, pickPerson, readPersonWords, type Person } from "../netlify/lib/people.mts";
import { renderThumb } from "../netlify/lib/thumb-render.mts";
import { PNG } from "pngjs";

describe("backgrounds", () => {
  test("card (with a surface), notebook, graph, chalkboard and paper read and print back", () => {
    expect(parseThumbLine("notebook").parts.bg).toBe("notebook");
    expect(parseThumbLine('band "Hey" card cork stamp').parts).toMatchObject({ headline: "Hey", bg: "card cork", marks: [{ kind: "stamp" }] });
    expect(parseThumbLine("card").parts.bg).toBe("card");
    expect(readThumb('chalkboard band "x"')).toBe('band "x" chalkboard');
    expect(parseThumbLine("gradient").unknown).toEqual(["gradient"]);
  });
  test("paper is the default; card alone gets a surface the title picks, the same each time", () => {
    expect(planThumb('band "x"', { title: "A" }).bg).toBeUndefined();
    expect(planThumb("paper").bg).toBeUndefined();
    const a = planThumb("card", { title: "Why the Moon never lands" }).bg!;
    expect(a).toMatch(/^card \w+$/);
    expect(planThumb("card", { title: "Why the Moon never lands" }).bg).toBe(a);
    expect(planThumb("card navy").bg).toBe("card navy");
  });
  test("the background stands behind the picture; a card keeps the poster's paper, a page or board needs it see-through", () => {
    const card = thumbSvg(planThumb("card teal"), "p.png");
    expect(card.indexOf("#5fb3a9")).toBeLessThan(card.indexOf('href="p.png"'));
    expect(card).toMatch(/<g transform="rotate\(-2.5[^"]*"><image filter="url\(#thumb-shadow\)" href="p.png"/);
    expect(seeThroughFor("card teal")).toBe(false);
    expect(seeThroughFor("graph")).toBe(true);
    expect(thumbSvg(planThumb("chalkboard"), "p.png")).toMatch(/<g filter="url\(#thumb-chalk\)"><image href="p.png"/);
    expect(thumbSvg(planThumb(""), "p.png")).not.toContain("thumb-");
  });
  test("a drawing on a card gets a sheet of paper under it", () => {
    const svg = thumbSvg(planThumb("card wood"), "", undefined, "<path d='M0 0'/>");
    expect(svg).toMatch(/<rect width="1000" height="750" fill="#fffdf7" filter="url\(#thumb-shadow\)"\/><g><path/);
  });
  test("a poster's paper goes see-through; ink and colours stay as drawn; edges lose their white", () => {
    // a row: paper, an edge pixel (ink half-blended with white), ink, a pale fill, paper
    const px = [[255, 254, 251], [149, 146, 145], [43, 38, 34], [200, 220, 240], [255, 255, 255]];
    const rgba = new Uint8Array(px.flatMap((c) => [...c, 255]));
    keyPaper(rgba, px.length, 1);
    expect(rgba[3]).toBe(0);
    expect(rgba[19]).toBe(0);
    expect(Array.from(rgba.slice(8, 12))).toEqual([43, 38, 34, 255]);
    // the edge pixel: darker and partly see-through, the same over white as before
    expect(rgba[7]).toBeLessThan(255);
    expect(Math.round(rgba[4] * (rgba[7] / 255) + 255 * (1 - rgba[7] / 255))).toBeCloseTo(149, -1);
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
  test("everyday people are asked for by a word; polished is the default", () => {
    expect(readPersonWords(["ordinary", "talking"])).toEqual({ style: "everyday", looks: [], expression: "talking" });
    expect(readPersonWords(["eccentric"])).toEqual({ style: "everyday", looks: ["quirky"] });
    expect(pickPerson(readPersonWords(["man"])).style).toBe("polished");
    const everyday: Person = { id: "e", sex: "man", age: 50, looks: [], expression: "talking", style: "everyday", faces: "front", w: 500, h: 640 };
    expect(pickPerson(readPersonWords(["everyday"]), "", [...PEOPLE, everyday]).id).toBe("e");
    expect(pickPerson(readPersonWords(["surprised"]), "", [...PEOPLE, everyday]).style).toBe("polished");
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
    const png = PNG.sync.read(Buffer.from(renderThumb(planThumb("card navy person woman 19 surprised", { title: "T" }), PNG.sync.write(poster))));
    expect(png.width).toBe(1000);
    // the right half near the bottom is the person, not the navy desk
    const at = (x: number, y: number): number[] => Array.from(png.data.slice((y * 1000 + x) * 4, (y * 1000 + x) * 4 + 3));
    expect(at(820, 700)).not.toEqual(at(20, 20));
    expect(at(20, 20)).toEqual([0x1d, 0x2a, 0x44]);
  });
});
