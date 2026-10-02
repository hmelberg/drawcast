// The guess gate's typed number (round 5 fix wave, M1) and its words (M2, L6).
//
// Typing into a bar's value pill swaps the pill for a field and back. In a
// browser, taking the FOCUSED field out of the page fires its blur at once,
// while it is still connected — the blur handler then closed the field a
// second time, the second swap threw NotFoundError, and Escape committed
// (the blur's close(true)). The fake DOM below does what the browser does:
// replaceWith on the focused element fires blur first, and replaceWith on an
// element with no parent throws.
//
// No jsdom in this repo (vite.config.ts: environment "node"), as in
// tests/guess-account-gate.test.ts.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { formatterFor, type GuessHandle } from "../src/guess/handles";
import type { GuessSession } from "../src/render/player";
import type { AskGateStep } from "../src/ui/controls";
import { budgetLine, dockNumber, gateLang, gateLangOf, gateWords } from "../src/ui/gate-words";

type Listener = (e: unknown) => void;

let active: FakeEl | null = null;

class FakeEl {
  className = "";
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  text = "";
  value = "";
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
  get isConnected(): boolean {
    return this.parent !== null;
  }
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
    // The browser: a focused element leaving the page blurs first, while connected.
    if (active === this) {
      active = null;
      this.fire("blur", {});
    }
    if (!this.parent) throw new Error("NotFoundError: Failed to execute 'replaceWith'");
    const p = this.parent;
    p.children = p.children.map((c) => (c === this ? x : c));
    x.parent = p;
    this.parent = null;
  }
  focus(): void {
    active = this;
  }
  select(): void {}
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
  fire(t: string, e: Record<string, unknown>): void {
    for (const f of [...(this.listeners[t] ?? [])]) f({ stopPropagation: () => {}, preventDefault: () => {}, ...e });
  }
  click(): void {
    this.fire("click", {});
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

const bar = (k: number): GuessHandle => ({
  part: `bar_${k + 1}`, shows: [`bar_${k + 1}`], kind: "height", truth: [10], min: 0, max: 100, step: 1, label: `B${k + 1}`,
  format: formatterFor(1), unit: "", paths: [`values.${k}`], cx: 100 * (k + 1), halfW: 30, toLogical: ([x, y]) => [x, 50 + y], toDomain: ([x, y]) => [x, y - 50],
});

const settle = () => new Promise((r) => setTimeout(r, 250));

async function mount(opts: { bars: number; account?: { budget: number; label: string; isDefault?: boolean }; lang?: string }) {
  const { guessGateFor } = await import("../src/ui/guess-gate");
  const stage = new FakeEl("div");
  const session: GuessSession = {
    setup: { handles: Array.from({ length: opts.bars }, (_, k) => bar(k)), pin: {}, warnings: [] },
    start: Array.from({ length: opts.bars }, () => [5]),
    paint: () => {},
    ...(opts.account ? { account: opts.account } : {}),
  };
  const hd = { spec: { lang: opts.lang } };
  let result: string | null | undefined;
  let finishes = 0;
  const done = guessGateFor(stage as unknown as HTMLElement, hd as never)(new AbortController().signal, { question: "?", guess: session } as unknown as AskGateStep).then((r) => {
    finishes++;
    result = r;
  });
  return { stage, done, get result() { return result; }, get finishes() { return finishes; } };
}

/** Tap the pill, type, press a key in the field. Returns the field. */
function typeInto(stage: FakeEl, text: string, keyName: string): FakeEl {
  const pill = stage.find("cs-guess-value")!;
  pill.click();
  const field = stage.find("cs-guess-field")!;
  expect(active).toBe(field);
  field.value = text;
  field.fire("keydown", { key: keyName });
  return field;
}

describe("typing a bar's number (M1)", () => {
  test("Enter commits once: no NotFoundError, the pill comes back, the value is set", async () => {
    const m = await mount({ bars: 2, account: { budget: 20, label: "Left", isDefault: true } });
    const hint = m.stage.find("cs-figgate-hint")!;
    expect(hint.textContent).toBe("Balance the budget: 10 left");
    expect(() => typeInto(m.stage, "12", "Enter")).not.toThrow();
    expect(m.stage.find("cs-guess-field")).toBeNull();
    expect(m.stage.find("cs-guess-value")).not.toBeNull();
    // Bar 1: 5 → 12, bar 2 still 5: 3 left.
    expect(hint.textContent).toBe("Balance the budget: 3 left");
  });

  test("Escape cancels: the typed number is not kept", async () => {
    const m = await mount({ bars: 2, account: { budget: 20, label: "Left", isDefault: true } });
    const hint = m.stage.find("cs-figgate-hint")!;
    expect(() => typeInto(m.stage, "12", "Escape")).not.toThrow();
    expect(m.stage.find("cs-guess-field")).toBeNull();
    expect(hint.textContent).toBe("Balance the budget: 10 left");
  });

  test("a blur (a tap elsewhere) keeps what was typed", async () => {
    const m = await mount({ bars: 2, account: { budget: 20, label: "Left", isDefault: true } });
    const hint = m.stage.find("cs-figgate-hint")!;
    m.stage.find("cs-guess-value")!.click();
    const field = m.stage.find("cs-guess-field")!;
    field.value = "15";
    active = null;
    field.fire("blur", {});
    expect(m.stage.find("cs-guess-field")).toBeNull();
    expect(hint.textContent).toBe("Drag each bar to your guess, then Answer");
  });

  test("one bar: a typed number answers, exactly once", async () => {
    const m = await mount({ bars: 1 });
    expect(() => typeInto(m.stage, "42", "Enter")).not.toThrow();
    await m.done;
    await settle();
    expect(m.result).toBe("42");
    expect(m.finishes).toBe(1);
  });
});

describe("the gate's words (M2, L6)", () => {
  test("a Norwegian cast's dock is Norwegian", async () => {
    const m = await mount({ bars: 2, account: { budget: 20, label: "Igjen", isDefault: true }, lang: "nb" });
    expect(m.stage.find("cs-guess-answer")!.textContent).toBe("Svar ▸");
    expect(m.stage.find("cs-figgate-skip")!.textContent).toBe("Hopp over ▸");
    expect(m.stage.find("cs-figgate-hint")!.textContent).toBe("Fordel budsjettet: 10 igjen");
  });

  test("the default flag, not the word, decides: an authored \"Left\" names the account", async () => {
    const m = await mount({ bars: 2, account: { budget: 20, label: "Left" } });
    expect(m.stage.find("cs-figgate-hint")!.textContent).toBe("Left: 10");
  });

  test("the cast's account label names the account in the dock", async () => {
    const m = await mount({ bars: 2, account: { budget: 20, label: "Hours left" } });
    const hint = m.stage.find("cs-figgate-hint")!;
    expect(hint.textContent).toBe("Hours left: 10");
    typeInto(m.stage, "20", "Enter");
    expect(hint.textContent).toBe("Hours left: −5");
  });

  test("gateLang, dockNumber and budgetLine", () => {
    expect(gateLang("nb")).toBe("nb");
    expect(gateLang("no")).toBe("nb");
    expect(gateLang("nn-NO")).toBe("nb");
    expect(gateLang("en")).toBe("en");
    expect(gateLang(undefined)).toBe("en");
    expect(dockNumber("22.0")).toBe("22");
    expect(dockNumber("4.8")).toBe("4.8");
    expect(dockNumber("1 190 000")).toBe("1 190 000");
    expect(dockNumber("10,0 %")).toBe("10 %");
    const en = gateWords("en");
    expect(budgetLine(en, 22, "22.0", null)).toBe("Balance the budget: 22 left");
    expect(budgetLine(en, -4.8, "4.8", null)).toBe("Balance the budget: 4.8 over");
    expect(budgetLine(en, 22, "22.0", "Hours left")).toBe("Hours left: 22");
  });

  test("a cast with no lang speaks the dock in the language its narration is written in", () => {
    const nb = { spec: { commands: [{ speak: "Hvor mange dør hvert år av myggstikk? Det er flere enn du tror." }, { ask: { question: "Hvor mange?" } }] } };
    const en = { spec: { commands: [{ speak: "How many people die each year from a mosquito bite? More than you think." }] } };
    expect(gateLangOf(nb as never)).toBe("nb");
    expect(gateLangOf(en as never)).toBe("en");
    // A declared lang wins over what the lines read as.
    expect(gateLangOf({ spec: { ...nb.spec, lang: "en" } } as never)).toBe("en");
    expect(gateLangOf(null)).toBe("en");
  });
});
