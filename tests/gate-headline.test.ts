// The question over the figure (round 7 §8.1): the ask's own sentence at the
// top, the gate's hint as the how line under it; the bar keeps only buttons,
// Skip then Answer; a title card's heading stands aside meanwhile.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

class El {
  className = "";
  children: El[] = [];
  text = "";
  parent: El | null = null;
  offsetHeight = 30;
  attrs: Record<string, string> = {};
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
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  append(...xs: (El | string)[]): void {
    for (const x of xs) typeof x === "string" ? (this.text += x) : this.appendChild(x);
  }
  appendChild(x: El): El {
    x.parent = this;
    this.children.push(x);
    return x;
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  querySelector(q: string): unknown {
    if (q === "svg.cs-svg") return { getBoundingClientRect: () => ({ top: 40, left: 0, width: 800, height: 600 }) };
    if (q === ".cs-gatehead") return this.children.find((c) => c.className.split(" ").includes("cs-gatehead")) ?? null;
    return null;
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 800, height: 700 };
  }
}

const gl = globalThis as Record<string, unknown>;
const saved = { document: gl.document };
beforeAll(() => {
  gl.document = { createElement: (tag: string) => new El(tag) };
});
afterAll(() => {
  gl.document = saved.document;
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const Q = "Which of these animals are mammals? Tap every mammal.";

async function mount(question: string, stage = new El("div")) {
  const { mountGateDock } = await import("../src/ui/gate-dock");
  const { h } = await import("../src/ui/dom");
  const gate = new El("div");
  stage.appendChild(gate);
  const how = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, "Tap a box, or drag a card") as unknown as El;
  const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip" }, "Skip ▸") as unknown as El;
  const answer = h("button", { class: "cs-cardgate-pill cs-guess-answer" }, "Answer ▸") as unknown as El;
  const dock = mountGateDock(stage as unknown as HTMLElement, gate as unknown as HTMLElement, [skip, answer] as unknown as HTMLElement[], () => {}, { question, how: how as unknown as HTMLElement });
  const bar = gate.children.find((c) => c.className === "cs-gatedock")!;
  const heads = () => stage.children.filter((c) => c.className === "cs-gatehead");
  return { stage, gate, how, skip, answer, dock, bar, heads };
}

describe("the headline", () => {
  test("the question over the figure, the how line under it; the bar keeps Skip then Answer", async () => {
    const m = await mount(Q);
    const [head] = m.heads();
    expect(head.textContent).toContain(Q);
    expect(head.children).toContain(m.how);
    expect(m.bar.children).toEqual([m.skip, m.answer]);
    expect(m.stage.classList.contains("cs-headline")).toBe(true);
    // Just under the drawing's top edge (the svg stands 40 px down).
    expect(head.style.top).toBe("46px");
    m.dock.dispose();
    expect(m.stage.classList.contains("cs-headline")).toBe(false);
    expect(head.classList.contains("cs-gatehead-out")).toBe(true);
    await wait(350);
    expect(m.heads()).toHaveLength(0);
  });

  test("no question (test me): no headline; the how line stays in the bar, first", async () => {
    const m = await mount("");
    expect(m.heads()).toHaveLength(0);
    expect(m.bar.children).toEqual([m.how, m.skip, m.answer]);
    expect(m.stage.classList.contains("cs-headline")).toBe(false);
  });

  test("a phone (caption below): the drawing gives up the headline's height and stands under it", async () => {
    const { dockShrink } = await import("../src/ui/gate-dock");
    expect(dockShrink({ mode: "below", stageH: 700, svgH: 500, captionH: 100, dockH: 50, headH: 60 })).toBe(10);
    expect(dockShrink({ mode: "overlay", stageH: 700, svgH: 500, captionH: 100, dockH: 50, headH: 60 })).toBe(0);
    const stage = new El("div");
    stage.classList.add("cs-caption-below");
    const props: Record<string, string> = {};
    stage.style.setProperty = (k: string, v: string) => void (props[k] = v);
    const m = await mount(Q, stage);
    const [head] = m.heads();
    expect(head.style.top).toBe("0px");
    expect(props["--cs-head-h"]).toBe(`${head.offsetHeight + 6}px`);
    m.dock.dispose();
  });

  test("a bar with no buttons (a required choose) is not shown", async () => {
    const { mountGateDock } = await import("../src/ui/gate-dock");
    const { h } = await import("../src/ui/dom");
    const stage = new El("div");
    const gate = new El("div");
    stage.appendChild(gate);
    const how = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, "Tap one") as unknown as El;
    mountGateDock(stage as unknown as HTMLElement, gate as unknown as HTMLElement, [], () => {}, { question: Q, how: how as unknown as HTMLElement });
    const bar = gate.children.find((c) => c.className === "cs-gatedock")! as unknown as { hidden?: boolean };
    expect(bar.hidden).toBe(true);
  });

  test("a new question takes down a headline still fading", async () => {
    const a = await mount(Q);
    a.dock.dispose();
    const b = await mount("Which of these foods are fruit? Tap every fruit.", a.stage);
    expect(b.heads()).toHaveLength(1);
    expect(b.heads()[0].textContent).toContain("Which of these foods");
  });
});

describe("every docked gate", () => {
  for (const f of ["guess-gate", "cards-gate", "choose-gate", "formula-gate", "tree-gate"]) {
    test(`${f}: the question goes to the headline; Skip comes first in the bar`, () => {
      // A light check of the wiring; the behaviour is tested in the gates' own
      // fake-DOM tests (cards-gate-tap: the headline shows the step's question)
      // and in the player (the question arrives with its {vars} filled).
      const src = readFileSync(new URL(`../src/ui/${f}.ts`, import.meta.url), "utf8");
      expect(src).toMatch(/mountGateDock\([^;]*question:/);
      expect(src).not.toMatch(/docked\.push\(skip\)/);
    });
  }

  test("CSS: a title card's heading stands aside under a headline; the old top-hint rules are gone", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.cs-stage\.cs-headline [^{]*card_[^{]*\{[^}]*opacity:\s*0/);
    expect(css).toMatch(/\.cs-gatehead-q\s*\{[^}]*line-clamp:\s*2/);
    expect(css).not.toMatch(/\.cs-guessgate \.cs-figgate-hint\s*\{/);
    expect(css).not.toMatch(/\.cs-guessgate \.cs-figgate-skip\s*\{/);
  });
});
