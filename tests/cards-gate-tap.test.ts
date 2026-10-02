// The cards gate's faster sorting (spec 2026-10-03-round6 §7) on a minimal
// fake DOM (the one tests/choose-gate.test.ts uses: an svg 1000×750 px on a
// 1000×750 viewBox, so client pixels are logical units, y flipped): a tap
// sends a card to a box; select taps cards in and out; a deck deals one
// large card at a time to the box tapped or keyed, with a ✓ or ✗ each.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AskGateStep } from "../src/ui/controls";
import type { CardsSession } from "../src/render/player";
import { cardsGeometry, type CardsElementLike, type CardsGeometry } from "../src/spec/cards";
import { cardsTruth, decodeArrangement, encodeArrangement, initialArrangement } from "../src/cards/model";
import type { GuessMarks } from "../src/guess/marks";


type Listener = (e: unknown) => void;

class FakeEl {
  className = "";
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  text = "";
  hidden = false;
  disabled = false;
  offsetHeight = 0;
  parent: FakeEl | null = null;
  listeners: Record<string, Listener[]> = {};
  style: Record<string, unknown> = { setProperty: () => {}, removeProperty: () => {} };
  classList = {
    set: new Set<string>(),
    add: (c: string) => void this.classList.set.add(c),
    remove: (c: string) => void this.classList.set.delete(c),
    toggle: (c: string, on?: boolean) => void ((on ?? !this.classList.set.has(c)) ? this.classList.set.add(c) : this.classList.set.delete(c)),
    contains: (c: string) => this.classList.set.has(c),
  };
  constructor(public tag: string) {}
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    this.text = v;
    this.children = [];
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  append(...xs: (FakeEl | string)[]): void {
    for (const x of xs) typeof x === "string" ? (this.text += x) : this.appendChild(x);
  }
  appendChild(x: FakeEl): FakeEl {
    x.parent = this;
    this.children.push(x);
    return x;
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  replaceWith(x: FakeEl): void {
    if (!this.parent) return;
    const p = this.parent;
    p.children = p.children.map((c) => (c === this ? x : c));
    x.parent = p;
    this.parent = null;
  }
  addEventListener(t: string, f: Listener): void {
    (this.listeners[t] ??= []).push(f);
  }
  removeEventListener(): void {}
  querySelector(): null {
    return null;
  }
  closest(): null {
    return null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 600 };
  }
  setPointerCapture(): void {}
  click(): void {
    for (const f of this.listeners["click"] ?? []) f({ stopPropagation: () => {}, preventDefault: () => {} });
  }
  find(cls: string): FakeEl | null {
    if (this.className.split(" ").includes(cls)) return this;
    for (const c of this.children) {
      const f = c.find(cls);
      if (f) return f;
    }
    return null;
  }
}

const docListeners: Record<string, Listener[]> = {};
const g = globalThis as Record<string, unknown>;
const saved = { document: g.document, window: g.window };

beforeAll(() => {
  g.document = {
    createElement: (tag: string) => new FakeEl(tag),
    addEventListener: (t: string, f: Listener) => void (docListeners[t] ??= []).push(f),
    removeEventListener: (t: string, f: Listener) => void (docListeners[t] = (docListeners[t] ?? []).filter((x) => x !== f)),
  };
  g.window = globalThis;
  g.requestAnimationFrame ??= (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
  g.cancelAnimationFrame ??= (id: number) => clearTimeout(id);
});
afterAll(() => {
  g.document = saved.document;
  g.window = saved.window;
});

const key = (k: string, shiftKey = false): void => {
  for (const f of [...(docListeners["keydown"] ?? [])]) f({ key: k, shiftKey, target: null, preventDefault: () => {}, stopPropagation: () => {} });
};

const svg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 750 }), viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 750 } } };
const makeStage = (): FakeEl => {
  const s = new FakeEl("div");
  (s as unknown as { querySelector: (q: string) => unknown }).querySelector = (q: string) => (q === "svg.cs-svg" ? svg : null);
  (s as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 750 });
  return s;
};
const target = { closest: () => null };
/** Logical (x, y-up) → the pointer event the gate reads. */
const at = (p: [number, number]) => ({ clientX: p[0], clientY: 750 - p[1], pointerId: 1, type: "", target, stopPropagation: () => {}, preventDefault: () => {} });
const fire = (el: FakeEl, type: string, e: Record<string, unknown>): void => {
  for (const f of el.listeners[type] ?? []) f({ ...e, type });
};
const tap = (gate: FakeEl, p: [number, number]): void => {
  fire(gate, "pointerdown", at(p));
  fire(gate, "pointerup", at(p));
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function open(g: CardsGeometry, extra: Partial<AskGateStep> = {}) {
  return import("../src/ui/cards-gate").then(({ cardsGateFor }) => {
    const stage = makeStage();
    const ac = new AbortController();
    const placed: { id: string; dx: number; dy: number; scale: number }[] = [];
    const marks: (GuessMarks | null)[] = [];
    const fades: { id: string; a: number }[] = [];
    const session: CardsSession = {
      geometry: g,
      start: initialArrangement(g),
      place: (id, dx, dy, scale = 1) => void placed.push({ id, dx, dy, scale }),
      show: () => {},
      mark: (m) => void marks.push(m),
      fade: (id, a) => void fades.push({ id, a }),
    };
    let result: string | null | undefined;
    const step = { question: "Sort them", retry: false, required: false, cardsSession: session, ...extra } as unknown as AskGateStep;
    const done = cardsGateFor(stage as unknown as HTMLElement, null as never)(ac.signal, step).then((r) => (result = r));
    const gate = stage.find("cs-cardsgate")!;
    return { stage, gate, done, ac, placed, marks, fades, result: () => result, answer: () => stage.find("cs-guess-answer")! };
  });
}

const two: CardsElementLike = { id: "c", type: "cards", bins: ["Fixed", "Variable"], items: [{ text: "Rent", bin: "Fixed" }, { text: "Flour", bin: "Variable" }, { text: "Tax", bin: "Fixed" }] };
/** check: end — today's sort: tap-to-cycle, Answer. */
const twoEnd: CardsElementLike = { ...two, check: "end" };
type Opened = Awaited<ReturnType<typeof open>>;
const last = (o: Opened) => o.marks[o.marks.length - 1];
/** The counter's numbers in a mark set. */
const counter = (m: GuessMarks | null | undefined) => {
  const t = m?.texts ?? [];
  const n = (re: RegExp) => Number(t.find((x) => re.test(x.text))?.text.replace(/\D/g, "") ?? NaN);
  return { right: n(/^✓ \d+$/), wrong: n(/^✗ \d+$/) };
};
/** The tray, top row first, left to right — the order the gate picks cards in. */
const trayOrder = (g: CardsGeometry) => g.cards.map((_, i) => i).sort((a, b) => g.home[b][1] - g.home[a][1] || g.home[a][0] - g.home[b][0]);
/** Where card i was last placed (logical). */
const lastAt = (o: Opened, g: CardsGeometry, i: number): [number, number] => {
  const p = o.placed.filter((q) => q.id === g.cards[i]).pop()!;
  return [g.home[i][0] + p.dx, g.home[i][1] + p.dy];
};
const inBox = (g: CardsGeometry, p: [number, number], b: number) => {
  const bx = g.binBoxes[b];
  return Math.abs(p[0] - bx.c[0]) <= bx.w / 2 && Math.abs(p[1] - bx.c[1]) <= bx.h / 2;
};

describe("tap to move", () => {
  test("sort: taps send a card row → box 1 → box 2 → row; Answer gives the arrangement", async () => {
    const g = cardsGeometry(twoEnd);
    const o = await open(g);
    tap(o.gate, g.home[0]);
    tap(o.gate, g.home[1]);
    await wait(200);
    // card 1 is in box 1 now: a tap on it there sends it to box 2…
    tap(o.gate, g.binSlot(0, 1));
    await wait(200);
    // …and a fourth tap, on card 0 in box 1 twice over, takes it round to box 2 and out.
    tap(o.gate, g.binSlot(0, 0));
    await wait(200);
    tap(o.gate, g.binSlot(1, 1));
    o.answer().click();
    await o.done;
    expect(decodeArrangement(g, o.result()!)).toEqual({ order: [], boxes: [[], [1]] });
  });

  test("a drag still works (a move past the slop is not a tap)", async () => {
    const g = cardsGeometry(twoEnd);
    const o = await open(g);
    fire(o.gate, "pointerdown", at(g.home[2]));
    fire(o.gate, "pointermove", at(g.binBoxes[1].c));
    fire(o.gate, "pointerup", at(g.binBoxes[1].c));
    o.answer().click();
    await o.done;
    expect(decodeArrangement(g, o.result()!)!.boxes).toEqual([[], [2]]);
  });

  test("select: tap the cards that belong in; a second tap takes one out", async () => {
    const g = cardsGeometry({ id: "z", type: "cards", select: "Mammals", check: "end", items: [{ text: "Whale", in: true }, "Shark", { text: "Bat", in: true }] });
    const o = await open(g);
    expect(o.stage.find("cs-figgate-hint")!.textContent).toMatch(/Tap the cards/);
    tap(o.gate, g.home[0]);
    tap(o.gate, g.home[1]);
    tap(o.gate, g.home[2]);
    await wait(200);
    tap(o.gate, g.binSlot(0, 1)); // Shark, out again
    o.answer().click();
    await o.done;
    expect(o.result()).toBe(encodeArrangement(g, cardsTruth(g)));
  });

  test("fill: a tapped tile goes to the first empty box; with one box it answers", async () => {
    const g = cardsGeometry({ id: "t", type: "cards", fill: "m", items: [{ text: "x" }, { text: "2", blank: 1 }] });
    const o = await open(g);
    tap(o.gate, g.home[1]);
    await o.done;
    expect(o.result()).toBe("1");
  });
});

const deck: CardsElementLike = {
  id: "d",
  type: "cards",
  deck: true,
  bins: ["Virus", "Bacteria"],
  items: Array.from({ length: 12 }, (_, i) => ({ text: `G${i}`, bin: i % 3 === 0 ? "Bacteria" : "Virus" })),
};

const deckEnd: CardsElementLike = { ...deck, check: "end" };

describe("the deck", () => {
  test("the top card grows; taps on the boxes and keys 1/2 deal; a ✓ or ✗ each; the last answers", async () => {
    const g = cardsGeometry(deckEnd);
    const o = await open(g);
    expect(o.answer().hidden).toBe(true);
    await wait(300);
    const top = g.cards[g.deal![0]];
    expect(Math.max(...o.placed.filter((p) => p.id === top).map((p) => p.scale))).toBeCloseTo(g.deckScale!, 1);
    // Deal every card: the first right by a tap on its box, the second wrong by key, the rest right by key.
    g.deal!.forEach((card, s) => {
      const right = g.truthBin[card];
      if (s === 0) tap(o.gate, g.binBoxes[right].c);
      else if (s === 1) key(String(2 - right));
      else key(String(right + 1));
    });
    await o.done;
    const a = decodeArrangement(g, o.result()!)!;
    const wrong = g.deal![1];
    expect(a.boxes[1 - g.truthBin[wrong]]).toContain(wrong);
    expect(a.boxes.flat()).toHaveLength(12);
    // A tap on the paper between, or a key past the boxes, deals nothing.
    const flashes = o.marks.filter((m): m is GuessMarks => m !== null && m.texts.length > 0);
    expect(flashes.length).toBeGreaterThan(0);
    expect(flashes.every((m) => m.texts[0].text === "✓" || m.texts[0].text === "✗")).toBe(true);
  });

  test("a tap off the boxes or a key past them deals nothing", async () => {
    const g = cardsGeometry({ ...deck, items: (deck.items as object[]).slice(0, 2) } as CardsElementLike);
    const o = await open(g);
    tap(o.gate, [500, 5]);
    key("3");
    key("Enter");
    await wait(900);
    expect(o.result()).toBeUndefined();
    key("1");
    key("2");
    await o.done;
    expect(decodeArrangement(g, o.result()!)!.boxes.flat()).toHaveLength(2);
  });

  test("a card tapped while it still grows flies from the size it reached (no jump)", async () => {
    const g = cardsGeometry(deck);
    const o = await open(g);
    const top = g.cards[g.deal![0]];
    await wait(20);
    const reached = o.placed.filter((p) => p.id === top).pop()!.scale;
    expect(reached).toBeLessThan(g.deckScale!);
    key("1");
    const after = o.placed.filter((p) => p.id === top);
    // The flight's first frame starts at (about) the size reached, never at full size.
    expect(after[after.length - 1].scale).toBeLessThanOrEqual(reached + 0.05);
    o.ac.abort();
    await o.done;
  });

  test("an abort puts every card back, unscaled", async () => {
    const g = cardsGeometry(deck);
    const o = await open(g);
    key("1");
    o.ac.abort();
    await o.done;
    expect(o.result()).toBe(null);
    for (const id of g.cards) {
      const last = o.placed.filter((p) => p.id === id).pop();
      if (last) expect([last.dx, last.dy, last.scale]).toEqual([0, 0, 1]);
    }
  });
  test("check: each — a wrong card flies on to its right box, faded; the counter keeps score; the last answers", async () => {
    const g = cardsGeometry({ ...deck, items: (deck.items as object[]).slice(0, 4) } as CardsElementLike);
    const o = await open(g);
    expect(counter(last(o))).toEqual({ right: 0, wrong: 0 });
    // Dealt quickly: the second wrong, the rest right (Review Focus 1 for a deck).
    g.deal!.forEach((card, s) => key(String(s === 1 ? 2 - g.truthBin[card] : g.truthBin[card] + 1)));
    await o.done;
    const a = decodeArrangement(g, o.result()!)!;
    const wrong = g.deal![1];
    expect(a.boxes[g.truthBin[wrong]]).toContain(wrong);
    expect(a.first![wrong]).toBe(1 - g.truthBin[wrong]);
    expect(o.fades).toContainEqual({ id: g.cards[wrong], a: 0.45 });
    expect(counter(last(o))).toEqual({ right: 3, wrong: 1 });
    expect(inBox(g, lastAt(o, g, wrong), g.truthBin[wrong])).toBe(true);
    // Every card ends inside its right box.
    g.cards.forEach((_, i) => expect(inBox(g, lastAt(o, g, i), g.truthBin[i])).toBe(true));
    // The ✗ went with the card: nothing red is left but the counter.
    expect(last(o)!.texts.some((t) => t.text === "✗")).toBe(false);
  });
});

describe("rapid taps (final fix wave E)", () => {
  test("a second tap on the same spot while the card is still gliding away moves it on again", async () => {
    const g = cardsGeometry(twoEnd);
    const o = await open(g);
    tap(o.gate, g.home[0]);
    await wait(60);
    tap(o.gate, g.home[0]);
    await wait(400);
    o.answer().click();
    await o.done;
    expect(decodeArrangement(g, o.result()!)!.boxes).toEqual([[], [0]]);
  });
});

describe("check: each (round 7 §3)", () => {
  test("no Answer; the counter from 0; a tap on a box sends the picked card, judged; a wrong one glides to its right box, faded", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    expect(o.answer().hidden).toBe(true);
    expect(counter(last(o))).toEqual({ right: 0, wrong: 0 });
    const [a, b, c] = trayOrder(g);
    tap(o.gate, g.binBoxes[g.truthBin[a]].c);
    expect(counter(last(o))).toEqual({ right: 1, wrong: 0 });
    expect(last(o)!.texts.some((t) => t.text === "✓")).toBe(true);
    tap(o.gate, g.binBoxes[1 - g.truthBin[b]].c);
    expect(counter(last(o))).toEqual({ right: 1, wrong: 1 });
    const cross = () => last(o)!.texts.find((t) => t.text === "✗");
    const x0 = cross()!.at[0];
    // Mid-glide (hold 500 + about half of 600): the ✗ rides beside the card, on its way.
    await wait(800);
    const x1 = cross()?.at[0];
    expect(x1).toBeDefined();
    expect(Math.abs(x1! - x0)).toBeGreaterThan(5);
    expect(Math.abs(x1! - (lastAt(o, g, b)[0] + g.w / 2 + 2))).toBeLessThan(1);
    await wait(500);
    expect(inBox(g, lastAt(o, g, b), g.truthBin[b])).toBe(true);
    expect(o.fades).toContainEqual({ id: g.cards[b], a: 0.45 });
    // Nothing red left on the figure but the counter.
    expect(last(o)!.texts.some((t) => t.text === "✗")).toBe(false);
    tap(o.gate, g.binBoxes[g.truthBin[c]].c);
    await o.done;
    const ans = decodeArrangement(g, o.result()!)!;
    expect(ans.first).toEqual(g.cards.map((_, i) => (i === b ? 1 - g.truthBin[b] : g.truthBin[i])));
    expect(ans.boxes.flat().sort()).toEqual([0, 1, 2]);
    // The counter stands after the answer.
    expect(counter(last(o))).toEqual({ right: 2, wrong: 1 });
    // Every card already where the truth puts it: nothing reshuffles after (placeRight).
    g.cards.forEach((_, i) => {
      expect(lastAt(o, g, i)[0]).toBeCloseTo(g.truth[i][0], 0);
      expect(lastAt(o, g, i)[1]).toBeCloseTo(g.truth[i][1], 0);
    });
  });

  test("a tap on another tray card picks it; the next tap on a box sends that one (§3.1.5)", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    const [a, , c] = trayOrder(g);
    tap(o.gate, g.home[c]);
    tap(o.gate, g.binBoxes[g.truthBin[c]].c);
    await wait(250);
    expect(inBox(g, lastAt(o, g, c), g.truthBin[c])).toBe(true);
    // The first tray card was never sent: still at home.
    const pa = o.placed.filter((q) => q.id === g.cards[a]).pop();
    expect(pa ? [pa.dx, pa.dy] : [0, 0]).toEqual([0, 0]);
    // And the pick moves on to it.
    tap(o.gate, g.binBoxes[g.truthBin[a]].c);
    expect(counter(last(o))).toEqual({ right: 2, wrong: 0 });
    o.ac.abort();
    await o.done;
  });

  test("Tab skips the placed cards (§3.1.4)", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    const [a, b, c] = trayOrder(g);
    tap(o.gate, g.binBoxes[g.truthBin[a]].c); // a placed; b picked
    key("Tab"); // → c
    key("Tab"); // → b again: a is skipped
    key(String(g.truthBin[b] + 1));
    await wait(250);
    expect(inBox(g, lastAt(o, g, b), g.truthBin[b])).toBe(true);
    const pc = o.placed.filter((q) => q.id === g.cards[c]).pop();
    expect(pc ? [pc.dx, pc.dy] : [0, 0]).toEqual([0, 0]);
    o.ac.abort();
    await o.done;
  });

  test("a placed card stays put: pressing it is a tap on its box, never a drag", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    const [a] = trayOrder(g);
    tap(o.gate, g.binBoxes[g.truthBin[a]].c);
    await wait(250);
    const where = lastAt(o, g, a);
    fire(o.gate, "pointerdown", at(where));
    fire(o.gate, "pointermove", at([where[0] + 200, where[1] - 200]));
    fire(o.gate, "pointerup", at([where[0] + 200, where[1] - 200]));
    key("0");
    await wait(250);
    // Still in its box (the picked card sent there may take the slot before it).
    expect(inBox(g, lastAt(o, g, a), g.truthBin[a])).toBe(true);
    expect(Math.abs(lastAt(o, g, a)[0] - where[0])).toBeLessThan(100);
    o.ac.abort();
    await o.done;
  });

  test("two wrong drops inside the hold both end in their right boxes (Review Focus 1)", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    const [a, b] = trayOrder(g);
    tap(o.gate, g.binBoxes[1 - g.truthBin[a]].c);
    await wait(100);
    tap(o.gate, g.binBoxes[1 - g.truthBin[b]].c);
    await wait(1400);
    expect(inBox(g, lastAt(o, g, a), g.truthBin[a])).toBe(true);
    expect(inBox(g, lastAt(o, g, b), g.truthBin[b])).toBe(true);
    expect(counter(last(o))).toEqual({ right: 0, wrong: 2 });
    o.ac.abort();
    await o.done;
  });

  test("a drag is judged on release in a box; let go off the boxes it goes back unjudged", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    const c = trayOrder(g)[2];
    fire(o.gate, "pointerdown", at(g.home[c]));
    fire(o.gate, "pointermove", at([g.home[c][0], 5]));
    fire(o.gate, "pointerup", at([g.home[c][0], 5]));
    await wait(250);
    expect(counter(last(o))).toEqual({ right: 0, wrong: 0 });
    fire(o.gate, "pointerdown", at(g.home[c]));
    fire(o.gate, "pointermove", at(g.binBoxes[g.truthBin[c]].c));
    fire(o.gate, "pointerup", at(g.binBoxes[g.truthBin[c]].c));
    expect(counter(last(o))).toEqual({ right: 1, wrong: 0 });
    o.ac.abort();
    await o.done;
  });

  test("keys 1/2 send the picked card", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    const [a] = trayOrder(g);
    key(String(g.truthBin[a] + 1));
    expect(counter(last(o))).toEqual({ right: 1, wrong: 0 });
    o.ac.abort();
    await o.done;
  });

  test("an abort mid-glide puts every card back, unfaded (Review Focus 2)", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    const [a] = trayOrder(g);
    tap(o.gate, g.binBoxes[1 - g.truthBin[a]].c);
    await wait(700);
    o.ac.abort();
    await o.done;
    expect(o.result()).toBe(null);
    for (const id of g.cards) {
      const p = o.placed.filter((q) => q.id === id).pop();
      if (p) expect([p.dx, p.dy]).toEqual([0, 0]);
      const f = o.fades.filter((q) => q.id === id).pop();
      if (f) expect(f.a).toBe(1);
    }
  });
  test("select: a tap judges; a wrong one goes back to the tray, faded; Done sweeps the missed in as ✗", async () => {
    const z = cardsGeometry({ id: "z", type: "cards", select: "Mammals", items: [{ text: "Whale", in: true }, "Shark", { text: "Bat", in: true }, "Trout"] });
    const o = await open(z);
    expect(o.stage.find("cs-figgate-hint")!.textContent).toMatch(/then Done/);
    expect(o.answer().hidden).toBe(false);
    expect(o.answer().textContent).toBe("Done ▸");
    tap(o.gate, z.home[0]); // Whale: ✓
    tap(o.gate, z.home[1]); // Shark: ✗, back to the tray, faded
    await wait(1300);
    expect(lastAt(o, z, 1)[0]).toBeCloseTo(z.home[1][0], 0);
    expect(lastAt(o, z, 1)[1]).toBeCloseTo(z.home[1][1], 0);
    expect(o.fades).toContainEqual({ id: z.cards[1], a: 0.45 });
    tap(o.gate, z.home[1]); // final: nothing
    expect(counter(last(o))).toEqual({ right: 1, wrong: 1 });
    o.answer().click(); // Bat missed (✗, goes in, faded); Trout stays out (✓)
    await o.done;
    const a = decodeArrangement(z, o.result()!)!;
    expect(a.first).toEqual([0, 0, -1, -1]);
    expect(a.boxes).toEqual([[0, 2]]);
    expect(o.fades).toContainEqual({ id: z.cards[2], a: 0.45 });
    expect(counter(last(o))).toEqual({ right: 2, wrong: 2 });
  });

  test("select: Done pressed while a wrong card still glides back — it lands, then the sweep", async () => {
    const z = cardsGeometry({ id: "z", type: "cards", select: "Mammals", items: [{ text: "Whale", in: true }, "Shark", { text: "Bat", in: true }] });
    const o = await open(z);
    tap(o.gate, z.home[1]); // Shark: ✗, glides back after the hold
    await wait(600); // mid-glide
    o.answer().click();
    await o.done;
    expect(lastAt(o, z, 1)[0]).toBeCloseTo(z.home[1][0], 0);
    expect(lastAt(o, z, 1)[1]).toBeCloseTo(z.home[1][1], 0);
    // Both missed mammals went in; all three judged.
    expect(decodeArrangement(z, o.result()!)!.first).toEqual([-1, 0, -1]);
    z.cards.forEach((_, i) => {
      expect(lastAt(o, z, i)[0]).toBeCloseTo(z.truth[i][0], 0);
      expect(lastAt(o, z, i)[1]).toBeCloseTo(z.truth[i][1], 0);
    });
  });
});

test("the step's question stands as the headline; the hint is its how line (round 7 §8.1)", async () => {
  const q = "Which box does each card belong in? Sort every card.";
  const o = await open(cardsGeometry(two), { question: q });
  expect(o.stage.find("cs-gatehead-q")!.textContent).toBe(q);
  expect(o.stage.find("cs-gatehead")!.textContent).toContain("Tap a box, or drag a card");
  o.ac.abort();
  await o.done;
});

describe("check: each — review fixes (round 7)", () => {
  test("a correction glide leaves the card being dragged under the finger; its drop is judged", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    const [a, b] = trayOrder(g);
    tap(o.gate, g.binBoxes[1 - g.truthBin[a]].c); // a: wrong — it glides after the hold
    fire(o.gate, "pointerdown", at(g.home[b]));
    fire(o.gate, "pointermove", at(g.binBoxes[g.truthBin[b]].c));
    await wait(800); // mid-correction
    fire(o.gate, "pointermove", at(g.binBoxes[g.truthBin[b]].c));
    fire(o.gate, "pointerup", at(g.binBoxes[g.truthBin[b]].c));
    expect(counter(last(o))).toEqual({ right: 1, wrong: 1 });
    o.ac.abort();
    await o.done;
  });

  test("select: a tap during Done's sweep earns nothing; a judged card is not judged again", async () => {
    const z = cardsGeometry({ id: "z", type: "cards", select: "Mammals", items: [{ text: "Whale", in: true }, "Shark", { text: "Bat", in: true }, "Trout"] });
    const o = await open(z);
    tap(o.gate, z.home[1]); // Shark: wrong, back to the tray
    await wait(1300);
    tap(o.gate, z.home[1]); // already judged: nothing — no second ✗, no second fade
    await wait(1300);
    expect(o.fades.filter((f) => f.id === z.cards[1] && f.a < 1)).toHaveLength(1);
    const crosses = o.marks.filter((m, i) => m?.texts.some((t) => t.text === "✗") && !o.marks[i - 1]?.texts.some((t) => t.text === "✗")).length;
    expect(crosses).toBe(1);
    o.answer().click();
    tap(o.gate, z.home[0]); // Whale, missed: the sweep's, not the viewer's
    tap(o.gate, z.home[2]);
    await o.done;
    expect(decodeArrangement(z, o.result()!)!.first).toEqual([-1, 0, -1, -1]);
  });
});
