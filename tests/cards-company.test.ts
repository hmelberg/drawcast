// Cards that grow with company (spec 2026-10-04-page-frame, W29): `size:
// "auto"` grows cards that share the page into the part of the content area
// nobody else uses — measured from the spec, over the whole run.

import { describe, expect, test } from "vitest";
import { authoredCards, cardsExtent, cardsGeometry, type CardsElementLike } from "../src/spec/cards";
import { cardsCompany, coVisibleWithCards, elementBox, followerRoom } from "../src/spec/cards-company";
import { CAPTION_TOP, CONTENT_TOP, MARGIN, PAGE_W } from "../src/layout/page";
import { expandSpec } from "../src/spec/expand";
import type { BBox } from "../src/layout/geometry";
import type { Spec, SpecElement } from "../src/spec/types";

const rank: CardsElementLike = { id: "r", type: "cards", items: ["Rome", "Paris", "Oslo", "Lima"], ends: ["oldest", "newest"], arrange: "row" };
const page = (els: unknown[], commands: unknown[]): Spec => ({ title: "Q", elements: els, commands: [{ card: { title: "Q" } }, ...commands] }) as unknown as Spec;
const sizeOf = (s: Spec, id = "r"): number | undefined => (s.elements!.find((e) => e.id === id) as { size?: number }).size;
const extentOf = (s: Spec): BBox => {
  const el = authoredCards(s)[0];
  const e = cardsExtent(cardsGeometry(el), el);
  return { x: e.left, y: e.bottom, w: e.right - e.left, h: e.top - e.bottom };
};
const gapBetween = (a: BBox, b: BBox): number => Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), b.x - (a.x + a.w), a.x - (b.x + b.w));

const note = { id: "note", type: "text", text: "oldest first", x: 500, y: 600, font_size: 34 };
const pic = { id: "pic", type: "icon", of: "hourglass", size: 90, x: 820, y: 600 };
const foot = { id: "foot", type: "text", text: "about 4,500 years ago", x: 500, y: 215, font_size: 30 };

describe("company: what is on screen with the cards", () => {
  test("drawn before and kept, drawn while the cards stand, never named: company; erased before, or drawn after the cards go: not", () => {
    const els = [rank, note, pic, foot, { id: "late", type: "text", text: "x", x: 1, y: 1 }, { id: "free", type: "text", text: "y", x: 2, y: 2 }] as SpecElement[];
    const seen = coVisibleWithCards("r", { elements: els, commands: [{ draw: ["note", "pic"] }, { erase: ["pic"] }, { draw: ["r"] }, { draw: ["foot"] }, { erase: ["r"] }, { draw: ["late"] }] as Spec["commands"] });
    expect([...seen].sort()).toEqual(["foot", "note"]);
    // Cards that stay to the end meet what no verb names there.
    expect(coVisibleWithCards("r", { elements: els, commands: [{ draw: ["r"] }] as Spec["commands"] }).has("free")).toBe(true);
  });
  test("a group brings its members; clear takes everything but what it keeps", () => {
    const els = [rank, note, pic, { id: "g", type: "group", members: ["note", "pic"] }] as SpecElement[];
    expect(coVisibleWithCards("r", { elements: els, commands: [{ draw: ["g"] }, { draw: ["r"] }] as Spec["commands"] }).has("pic")).toBe(true);
    expect(coVisibleWithCards("r", { elements: els, commands: [{ draw: ["g"] }, { clear: { keep: ["note"] } }, { draw: ["r"] }] as Spec["commands"] }).has("pic")).toBe(false);
  });
  test("boxes from the spec: text, icon, rect, label beside its host, at.ref and at.place; null when the spec cannot say", () => {
    const host = (id: string): BBox | null => (id === "pic" ? { x: 775, y: 555, w: 90, h: 90 } : null);
    expect(elementBox(note as SpecElement, host)).toMatchObject({ y: expect.closeTo(600 - 21.25, 1), h: expect.closeTo(42.5, 1) });
    expect(elementBox(pic as SpecElement, host)).toEqual({ x: 775, y: 555, w: 90, h: 90 });
    expect(elementBox({ id: "b", type: "shape", x: 200, y: 300, width: 100, height: 40 } as SpecElement, host)).toEqual({ x: 150, y: 280, w: 100, h: 40 });
    const lbl = elementBox({ id: "l", type: "label", text: "sand", attach_to: "pic", side: "below" } as SpecElement, host) as BBox;
    expect(lbl.y).toBeLessThan(555);
    const beside = elementBox({ id: "t", type: "text", text: "vs", font_size: 30, at: { ref: "pic", side: "left", gap: 10 } } as SpecElement, host) as BBox;
    expect(beside.x + beside.w).toBeCloseTo(765);
    const pinned = elementBox({ id: "p", type: "text", text: "corner", at: { place: "top_right" } } as SpecElement, host) as BBox;
    expect(pinned.x + pinned.w).toBeCloseTo(960);
    expect(elementBox({ id: "q", type: "text", text: "nowhere" } as SpecElement, host)).toBeNull();
    expect(elementBox({ id: "q", type: "point", at: [1, 1] } as SpecElement, host)).toBeNull();
    expect(elementBox({ id: "q", type: "arrow", from: "pic", to: { x: 100, y: 100 } } as SpecElement, host)).toEqual({ x: 100, y: 100, w: 720, h: 500 });
  });
  test("followers — a label on a card, words placed against one — are not company; they ask for room on their side", () => {
    const els = [rank, { id: "vs", type: "text", text: "vs", font_size: 30, at: { ref: "r_1", side: "right", gap: 14 } }, { id: "l", type: "label", text: "first", attach_to: "r_2", side: "above" }] as SpecElement[];
    const f = followerRoom("r", els);
    expect([...f.followers].sort()).toEqual(["l", "vs"]);
    expect(f.pad.right).toBeGreaterThan(14);
    expect(f.pad.top).toBeGreaterThan(28);
    expect(cardsCompany("r", { elements: els, commands: [{ draw: ["r", "vs", "l"] }] as Spec["commands"] })!.boxes).toEqual([]);
  });
});

describe("growing into the free part of the content area", () => {
  test("words above and below: the cards grow between them, 16 clear of each", () => {
    const s = expandSpec(page([note, pic, rank, foot], [{ draw: ["note", "pic"] }, { draw: ["r"] }, { draw: ["foot"] }]));
    const k = sizeOf(s)!;
    expect(k).toBeGreaterThan(1.2);
    expect(k).toBeLessThanOrEqual(1.6);
    const e = extentOf(s);
    for (const other of [note, pic, foot]) {
      const b = elementBox(other as SpecElement, () => null) as BBox;
      expect(gapBetween(e, b), other.id).toBeGreaterThanOrEqual(16 - 0.5);
    }
    expect(e.x).toBeGreaterThanOrEqual(MARGIN - 0.5);
    expect(e.x + e.w).toBeLessThanOrEqual(PAGE_W - MARGIN + 0.5);
  });
  test("tighter company, smaller growth: a picture just under the row stops it sooner", () => {
    const low = { id: "low", type: "icon", of: "x", size: 60, x: 500, y: 200 };
    const near = { ...low, y: 290 };
    const roomy = sizeOf(expandSpec(page([note, rank, low], [{ draw: ["note", "r", "low"] }])))!;
    const tight = sizeOf(expandSpec(page([note, rank, near], [{ draw: ["note", "r", "low"] }])));
    expect(tight ?? 1).toBeLessThan(roomy);
  });
  test("company erased before the cards come is no company: the set grows as on an empty page", () => {
    const s = expandSpec(page([note, pic, rank], [{ draw: ["note", "pic"] }, { erase: ["note", "pic"] }, { draw: ["r"] }]));
    expect(sizeOf(s)).toBe(1.6);
  });
  test("company beside the row: the cards keep their span and stay clear of it", () => {
    const side = { id: "side", type: "shape", x: 820, y: 380, width: 100, height: 300 };
    const s = expandSpec(page([{ ...rank, x: 100, width: 600 }, side, note], [{ draw: ["side", "note", "r"] }]));
    expect(sizeOf(s)).toBeGreaterThan(1);
    const e = extentOf(s);
    expect(e.x + e.w).toBeLessThanOrEqual(700 + 0.5);
    expect(gapBetween(e, elementBox(side as SpecElement, () => null) as BBox)).toBeGreaterThanOrEqual(15.5);
  });
  test("off: an authored size, a template's chart over the page, company the spec cannot place, a set already off the frame", () => {
    expect(sizeOf(expandSpec(page([{ ...rank, size: 1 }, pic], [{ draw: ["pic", "r"] }])))).toBe(1);
    expect(sizeOf(expandSpec({ ...page([rank, note], [{ draw: ["note", "r"] }]), template: "bar_chart", params: { labels: ["a"], values: [1] } } as Spec))).toBeUndefined();
    expect(sizeOf(expandSpec(page([rank, pic, { id: "lost", type: "icon", of: "x" }], [{ draw: ["pic", "r", "lost"] }])))).toBeUndefined();
    expect(sizeOf(expandSpec(page([{ ...rank, x: 20, width: 960 }, pic], [{ draw: ["pic", "r"] }])))).toBeUndefined();
  });
  test("a deck keeps its own sizing", () => {
    const deck: CardsElementLike = { id: "r", type: "cards", deck: true, bins: ["Yes", "No"], items: Array.from({ length: 6 }, (_, i) => ({ text: `Item ${i}`, bin: i % 2 ? "No" : "Yes" })) };
    expect(sizeOf(expandSpec(page([deck, note], [{ draw: ["note", "r"] }])))).toBeUndefined();
  });
  test("a compare title stays under the strip the ask's headline uses; followers' words stay on the page", () => {
    const cmp: CardsElementLike = { id: "r", type: "cards", compare: "Which is older?", items: ["Fax", "Phone", "Oxford", "Aztecs"].map((t, i) => ({ text: t, value: i })) };
    const els = [cmp, { id: "w", type: "text", text: "pendulums", font_size: 26, at: { ref: "r_1", side: "left", gap: 16 } }, { ...pic, y: 220 }];
    const s = { title: "Q", heading: false, elements: els, commands: [{ draw: ["r", "pic"] }, { draw: ["w"] }] } as unknown as Spec;
    const x = expandSpec(s);
    const k = sizeOf(x) ?? 1;
    expect(k).toBeGreaterThan(1);
    const title = x.elements!.find((e) => e.id === "r_title")!;
    expect(title.y! + 24 * k * 0.65).toBeLessThanOrEqual(CONTENT_TOP + 1);
    const e = extentOf(x);
    expect(e.x - followerRoom("r", els as SpecElement[]).pad.left).toBeGreaterThanOrEqual(MARGIN - 0.5);
    expect(e.y).toBeGreaterThanOrEqual(CAPTION_TOP - 0.5);
  });
});
