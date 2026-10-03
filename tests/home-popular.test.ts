// The front page's Popular row: visit ranks by drawcast, ordered with likes.
import { describe, expect, test } from "vitest";
import type { CatalogueItem } from "../src/catalogue";
import { LIKE_WEIGHT, popularItems, rankByBase } from "../src/home/model";
import { fetchRanks } from "../src/home/rank";

const item = (name: string, likes = 0, extra: Partial<CatalogueItem> = {}): CatalogueItem => ({
  kind: "cast", title: name, name, owner: "o", lectures: 1, updated: "", private: false, tags: [], likes, ...extra,
});

describe("popular", () => {
  test("lectures count for their course; most visited first", () => {
    expect(rankByBase([{ name: "spanish/1", visits: 3 }, { name: "spanish/2", visits: 4 }, { name: "moon", visits: 5 }, { name: "spanish", visits: 1 }]))
      .toEqual([{ name: "spanish", visits: 8 }, { name: "moon", visits: 5 }]);
  });
  test("likes weigh in; unranked or private items never show", () => {
    const ranks = [{ name: "a", visits: 10 }, { name: "b", visits: 8 }, { name: "p", visits: 99 }];
    const out = popularItems(ranks, [item("a"), item("b", 1), item("newest"), item("p", 0, { private: true })]);
    expect(LIKE_WEIGHT).toBeGreaterThan(2);
    expect(out.map((i) => i.name)).toEqual(["b", "a"]);
  });
  test("fetchRanks: [] on failure or a malformed body, never a throw", async () => {
    const ok = async () => new Response(JSON.stringify({ ranks: [{ name: "a", visits: 2 }, { name: 3 }] }));
    expect(await fetchRanks(ok as typeof fetch)).toEqual([{ name: "a", visits: 2 }]);
    expect(await fetchRanks((async () => new Response("x", { status: 500 })) as typeof fetch)).toEqual([]);
    expect(await fetchRanks((async () => { throw new Error("net"); }) as typeof fetch)).toEqual([]);
  });
});

import { courseNext } from "../src/home/model";
describe("course up next", () => {
  const course = { name: "spanish", title: "Spanish", lectures: 4, owner: "o" };
  test("lecture 2 of 4: lectures 3 and 4, in order", () => {
    expect(courseNext("spanish/2", course).map((c) => [c.name, c.meta])).toEqual([["spanish/3", "Lecture 3 of 4"], ["spanish/4", "Lecture 4 of 4"]]);
  });
  test("the last lecture, a plain cast, or another course: nothing", () => {
    expect(courseNext("spanish/4", course)).toEqual([]);
    expect(courseNext("moon", course)).toEqual([]);
    expect(courseNext("french/1", course)).toEqual([]);
    expect(courseNext("spanish/1", null)).toEqual([]);
  });
});

describe("course up next titles", () => {
  test("each lecture by its own title from course.md, else the course's", () => {
    const course = { name: "spanish", title: "Spanish", lectures: 3, owner: "o" };
    expect(courseNext("spanish/1", course, ["Hola", "Numbers"]).map((c) => c.title)).toEqual(["Numbers", "Spanish — lecture 3"]);
  });
});
