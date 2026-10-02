// The guess gate with a budget (spec 2026-10-03-looks-feedback-account §5):
// Answer is disabled and Enter does nothing until the account balances; the
// hint says what is left or over.
//
// There is no jsdom in this repo (vite.config.ts: environment "node"), so
// the gate is mounted on a minimal fake DOM — just the calls guess-gate.ts
// and gate-dock.ts make. No svg: the pill hides, the keys do the work.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { formatterFor, type GuessHandle } from "../src/guess/handles";
import type { GuessSession } from "../src/render/player";
import type { AskGateStep } from "../src/ui/controls";

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
});
afterAll(() => {
  g.document = saved.document;
  g.window = saved.window;
});

const key = (k: string, shiftKey = false): void => {
  for (const f of [...(docListeners["keydown"] ?? [])]) f({ key: k, shiftKey, target: null, preventDefault: () => {}, stopPropagation: () => {} });
};

const bar = (k: number): GuessHandle => ({
  part: `bar_${k + 1}`, shows: [`bar_${k + 1}`], kind: "height", truth: [10], min: 0, max: 100, step: 1, label: `B${k + 1}`,
  format: formatterFor(1), unit: "", paths: [`values.${k}`], cx: 100 * (k + 1), halfW: 30, toLogical: ([x, y]) => [x, 50 + y], toDomain: ([x, y]) => [x, y - 50],
});

describe("the guess gate with a budget", () => {
  test("Answer and Enter wait until the account balances; the hint says what is left or over", async () => {
    const { guessGateFor } = await import("../src/ui/guess-gate");
    const stage = new FakeEl("div");
    const painted: number[][][] = [];
    const session: GuessSession = {
      setup: { handles: [bar(0), bar(1)], pin: {}, warnings: [] },
      start: [[5], [5]],
      paint: (v) => void painted.push(v.map((r) => r.slice())),
      account: { budget: 20, label: "Left", isDefault: true },
    };
    const ac = new AbortController();
    let result: string | null | undefined;
    const done = guessGateFor(stage as unknown as HTMLElement, null as never)(ac.signal, { question: "Split?", guess: session } as unknown as AskGateStep).then((r) => (result = r));
    const answer = stage.find("cs-guess-answer")!;
    const hint = stage.find("cs-figgate-hint")!;
    const settle = () => new Promise((r) => setTimeout(r, 5));

    expect(hint.textContent).toBe("Balance the budget: 10 left");
    expect(answer.disabled).toBe(true);
    // Enter, and the button, do nothing while unbalanced.
    key("Enter");
    answer.click();
    await settle();
    expect(result).toBeUndefined();

    key("ArrowUp"); // bar 1: 5 → 10 (a key moves five steps)
    expect(hint.textContent).toBe("Balance the budget: 5 left");
    key("Tab");
    key("ArrowUp"); // bar 2: 5 → 10 — balanced
    expect(answer.disabled).toBe(false);
    expect(hint.textContent).toBe("Drag each bar to your guess, then Answer");
    key("ArrowUp"); // bar 2: 15 — over
    expect(hint.textContent).toBe("Balance the budget: 5 over");
    expect(answer.disabled).toBe(true);
    key("Enter");
    await settle();
    expect(result).toBeUndefined();
    // Only the moved bar moved: the other kept its 10.
    key("ArrowDown");
    expect(answer.disabled).toBe(false);
    key("Enter");
    await done;
    expect(result).toBe("10;10");
  });

  test("a budget the bars cannot reach never strands the viewer: Answer stays enabled", async () => {
    const { guessGateFor } = await import("../src/ui/guess-gate");
    const stage = new FakeEl("div");
    // Two bars capped at 100 each cannot make 500.
    const session: GuessSession = {
      setup: { handles: [bar(0), bar(1)], pin: {}, warnings: [] },
      start: [[5], [5]],
      paint: () => {},
      account: { budget: 500, label: "Left", isDefault: true },
    };
    const ac = new AbortController();
    let result: string | null | undefined;
    const done = guessGateFor(stage as unknown as HTMLElement, null as never)(ac.signal, { question: "Split?", guess: session } as unknown as AskGateStep).then((r) => (result = r));
    const answer = stage.find("cs-guess-answer")!;
    expect(answer.disabled).toBe(false);
    key("Enter");
    await done;
    expect(result).toBe("5;5");
  });
});

describe("budgetReachable", () => {
  test("a budget within the bars' summed range is reachable; beyond it, or under the floors, is not", async () => {
    const { budgetReachable } = await import("../src/guess/handles");
    expect(budgetReachable([bar(0), bar(1)], 20)).toBe(true);
    expect(budgetReachable([bar(0), bar(1)], 200)).toBe(true);
    expect(budgetReachable([bar(0), bar(1)], 201)).toBe(false);
    const floored = (k: number): GuessHandle => ({ ...bar(k), min: 10 });
    expect(budgetReachable([floored(0), floored(1)], 15)).toBe(false);
  });
});
