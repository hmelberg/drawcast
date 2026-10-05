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
  get parentNode(): El | null {
    return this.parent;
  }
  get firstChild(): El | null {
    return this.children[0] ?? null;
  }
  insertBefore(x: El, ref: El | null): El {
    x.remove();
    x.parent = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(x);
    else this.children.splice(i, 0, x);
    return x;
  }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    this.children = [];
    this.text = v;
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  append(...xs: (El | string)[]): void {
    for (const x of xs) typeof x === "string" ? (this.text += x) : this.appendChild(x);
  }
  appendChild(x: El): El {
    x.remove();
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
    m.dock.relayout();
    const [head] = m.heads();
    // Stage 700, drawing 600, dock 38, headline 36: room for all — above it.
    expect(head.style.top).toBe("0px");
    expect(props["--cs-head-h"]).toBe(`${head.offsetHeight + 6}px`);
    m.dock.dispose();
  });

  test("no room above (a small player, W25): the headline stands over the drawing; the drawing keeps its size", async () => {
    const stage = new El("div");
    stage.classList.add("cs-caption-strip");
    stage.getBoundingClientRect = () => ({ top: 0, left: 0, width: 800, height: 640 });
    const props: Record<string, string> = {};
    stage.style.setProperty = (k: string, v: string) => void (props[k] = v);
    const m = await mount(Q, stage);
    m.dock.relayout();
    const [head] = m.heads();
    expect(head.style.top).toBe("46px");
    expect(props["--cs-head-h"]).toBe("0px");
    // The hidden caption takes nothing: 600 + 38 ≤ 640.
    expect(props["--cs-dock-shrink"] ?? "0px").toBe("0px");
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

describe("the page's heading already asks it (Hans 2026-10-05, ants-on-earth)", () => {
  async function mountBeside(question: string, heading: string | null, hintText = "Click where you think it is") {
    const { mountGateDock } = await import("../src/ui/gate-dock");
    const { h } = await import("../src/ui/dom");
    const stage = new El("div");
    const gate = new El("div");
    stage.appendChild(gate);
    const how = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, hintText) as unknown as El;
    const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip" }, "Skip ▸") as unknown as El;
    const dock = mountGateDock(stage as unknown as HTMLElement, gate as unknown as HTMLElement, [skip] as unknown as HTMLElement[], () => {}, { question, how: how as unknown as HTMLElement, heading });
    const heads = () => stage.children.filter((c) => c.className.split(" ").includes("cs-gatehead"));
    return { stage, how, dock, heads };
  }

  test("the heading stays; only the task stands under it, in place of the hint", async () => {
    const m = await mountBeside("How many ants live on Earth? Click on the line: each step is ten times the last.", "How many ants are on Earth?");
    const [head] = m.heads();
    expect(head.className).toContain("cs-gatehead-task");
    expect(head.textContent).toBe("Click on the line: each step is ten times the last.");
    expect(head.children).toEqual([m.how]);
    // No headline: the heading is not hidden.
    expect(m.stage.classList.contains("cs-headline")).toBe(false);
    // The caption would only repeat the task: it steps aside meanwhile.
    expect(m.stage.classList.contains("cs-gatetask")).toBe(true);
    m.dock.dispose();
    expect(m.stage.classList.contains("cs-gatetask")).toBe(false);
  });

  test("no task: the gate's own hint under the heading", async () => {
    const m = await mountBeside("How many ants live on Earth?", "How many ants are on Earth?");
    expect(m.heads()[0].textContent).toBe("Click where you think it is");
    expect(m.stage.classList.contains("cs-headline")).toBe(false);
  });

  test("a task-only question under a heading: the task", async () => {
    const m = await mountBeside("Click on the line where you think it is.", "How many ants are on Earth?");
    expect(m.heads()[0].textContent).toBe("Click on the line where you think it is.");
    expect(m.stage.classList.contains("cs-headline")).toBe(false);
  });

  test("a different question takes the heading's place, as before", async () => {
    const m = await mountBeside("How much do all the ants weigh? Drag the bar.", "How many ants are on Earth?");
    const [head] = m.heads();
    expect(head.className).toBe("cs-gatehead");
    expect(head.textContent).toContain("How much do all the ants weigh?");
    expect(m.stage.classList.contains("cs-headline")).toBe(true);
  });

  test("no heading on the page: the headline, as before", async () => {
    const m = await mountBeside("How many ants live on Earth? Click on the line.", null);
    expect(m.heads()[0].className).toBe("cs-gatehead");
    expect(m.stage.classList.contains("cs-headline")).toBe(true);
  });
});

describe("fitHeadline (W25): the headline over the drawing fits the heading strip", () => {
  // A fake headline: 1.2 line height, the question in lines of 40 em-chars at 22 px.
  const measure = (chars: number, width: number) => (f: number, how: boolean) => Math.ceil((chars * f * 0.5) / width) * f * 1.2 + (how ? 18 : 0);
  test("room for it all: the full size, the how line kept", async () => {
    const { fitHeadline } = await import("../src/ui/gate-dock");
    expect(fitHeadline(80, measure(60, 760))).toEqual({ fontPx: 22.4, how: true });
  });
  test("a small player: the how line goes to the dock before the question drops under 17 px", async () => {
    const { fitHeadline, HEAD_STRIP } = await import("../src/ui/gate-dock");
    const room = 334 * HEAD_STRIP - 6; // the 460 px editor player
    const fit = fitHeadline(room, measure(76, 430));
    expect(fit.how).toBe(false);
    expect(fit.fontPx).toBeGreaterThanOrEqual(13);
    expect(measure(76, 430)(fit.fontPx, false)).toBeLessThanOrEqual(room);
  });
  test("no room at all: the least font, no how line", async () => {
    const { fitHeadline } = await import("../src/ui/gate-dock");
    expect(fitHeadline(5, measure(76, 430))).toEqual({ fontPx: 13, how: false });
  });
  test("the strip is the page frame's heading strip", async () => {
    const { HEAD_STRIP } = await import("../src/ui/gate-dock");
    const { CONTENT_TOP, PAGE_H } = await import("../src/layout/page");
    expect(HEAD_STRIP).toBeCloseTo((PAGE_H - CONTENT_TOP) / PAGE_H);
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
