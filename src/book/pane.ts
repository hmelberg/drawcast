// A book's text pane (spec 2026-10-01-book-layout §5, §6.2): the blocks the
// `write` steps put there, the marks on them, and the scroll that keeps the
// newest in view. Every operation runs either ANIMATED (as the cast plays)
// or INSTANT (a rebuild after a seek) — the same state machine, so a seek
// lands exactly where playing would have.

import rough from "roughjs";
import type { TextMarkEffect, TextOp } from "../render/plan";
import { renderMarkdown } from "./markdown";
import { texSvg } from "./math";
import { settle, transitionOut, type BookTransition } from "./transitions";

const SVG_NS = "http://www.w3.org/2000/svg";

interface Mark {
  svg: SVGSVGElement;
  target: Element;
  block: HTMLElement;
  effect: TextMarkEffect;
  temp: boolean;
  seed: number;
}

export interface TextPaneOptions {
  /** Marks drawn with rough.js (the sketchy look) or as clean strokes. */
  sketchy: boolean;
  /** How a cleared pane empties. */
  transition: BookTransition;
  /** A `view` step: the shell resizes the panes. */
  onView(view: "text" | "figure" | "both", animate: boolean): void;
}

/** Time a block takes to write on: by its length, 0.35–1.4 s. */
export function wipeMs(text: string): number {
  return Math.min(1400, Math.max(350, text.length * 22));
}

/**
 * Where the pane scrolls for a new block at `top..bottom` (px in the content):
 * nowhere while it fits above 85 % of the pane; past that, so the block sits
 * at 45 % — half a page of room, so the next few blocks need no scrolling.
 */
export function fillScroll(scrollTop: number, paneH: number, bottom: number): number {
  if (bottom <= scrollTop + paneH * 0.85) return scrollTop;
  return Math.max(0, bottom - paneH * 0.45);
}

export class TextPane {
  readonly root: HTMLElement;
  private blocks = new Map<string, HTMLElement>();
  private marks: Mark[] = [];
  private scratch: HTMLElement | null = null;
  private scrollAnim = 0;
  /** Bumped by every reset: an animated write still waiting when the pane
   *  is emptied belongs to the old pane and must not land in the new one. */
  private generation = 0;
  private opts: TextPaneOptions;

  constructor(root: HTMLElement, opts: TextPaneOptions) {
    this.root = root;
    this.opts = opts;
  }

  setOptions(opts: Partial<TextPaneOptions>): void {
    this.opts = { ...this.opts, ...opts };
  }

  /** Empty, at once — the start of a rebuild. */
  reset(): void {
    settle(this.root);
    this.root.replaceChildren();
    this.blocks.clear();
    this.marks = [];
    this.scratch = null;
    this.scrollAnim++;
    this.generation++;
    this.root.scrollTop = 0;
  }

  /** Perform one text step. */
  async apply(op: TextOp, animate: boolean): Promise<void> {
    switch (op.op) {
      case "write":
        return this.write(op.id, op.text, op.temp, animate);
      case "mark":
        for (const id of op.ids) this.mark(id, op.effect, op.part, !op.keep, animate);
        return;
      case "erase":
        for (const id of op.ids) this.erase(id, animate);
        return;
      case "point":
        if (animate) this.lookBack(op.id);
        return;
      case "clear":
        if (animate && this.root.childElementCount > 0) await transitionOut(this.root, this.opts.transition);
        this.reset();
        return;
      case "view":
        this.opts.onView(op.view, animate);
        return;
    }
  }

  /** Re-place every mark (the pane re-wrapped: a resize, a new font size). */
  relayout(): void {
    for (const m of this.marks) this.place(m);
  }

  // ---- blocks ------------------------------------------------------------

  private async write(id: string, text: string, temp: boolean, animate: boolean): Promise<void> {
    const gen = this.generation;
    this.dropTempMarks(animate);
    // Instant (a rebuild) must stay synchronous to the end: a rebuild calls
    // apply for op after op without awaiting, and a clear among them has to
    // land after the writes before it, not before.
    const gone = this.dropScratch(animate);
    if (animate) await gone;
    if (gen !== this.generation) return;
    const el = document.createElement("div");
    el.className = "bk-block";
    el.innerHTML = renderMarkdown(text, texSvg);
    const heading = /^H[1-3]$/.test(el.firstElementChild?.tagName ?? "");
    // Body text under a heading sits a little in from it.
    if (!heading && this.root.querySelector(".bk-block h1, .bk-block h2, .bk-block h3")) el.classList.add("bk-under");
    el.dataset.id = id;
    if (temp) {
      el.classList.add("bk-temp");
      this.scratch = el;
    }
    this.blocks.set(id, el);
    this.root.appendChild(el);
    this.scrollTo(fillScroll(this.root.scrollTop, this.root.clientHeight, el.offsetTop + el.offsetHeight), animate);
    if (!animate) {
      el.classList.add("bk-shown");
      return;
    }
    el.style.setProperty("--bk-wipe", `${wipeMs(text)}ms`);
    // Two frames: the block must be laid out clipped before the wipe starts.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    el.classList.add("bk-shown");
  }

  /** A scratch note leaves BEFORE the next block arrives (Hans 2026-10-01). */
  private dropScratch(animate: boolean): Promise<void> {
    const b = this.scratch;
    this.scratch = null;
    if (!b) return Promise.resolve();
    this.dropMarksOf(b);
    if (b.dataset.id) this.blocks.delete(b.dataset.id);
    if (!animate) {
      b.remove();
      return Promise.resolve();
    }
    return this.collapse(b);
  }

  private erase(id: string, animate: boolean): void {
    const b = this.blocks.get(id);
    if (!b) return;
    this.blocks.delete(id);
    if (this.scratch === b) this.scratch = null;
    this.dropMarksOf(b);
    if (!animate) {
      b.remove();
      this.relayout();
      return;
    }
    void this.collapse(b).then(() => this.relayout());
  }

  private collapse(b: HTMLElement): Promise<void> {
    b.style.maxHeight = `${b.offsetHeight}px`;
    b.classList.add("bk-erasing");
    requestAnimationFrame(() => {
      b.style.opacity = "0";
      b.style.maxHeight = "0px";
      b.style.marginBottom = "0px";
    });
    return new Promise((r) =>
      setTimeout(() => {
        b.remove();
        r();
      }, 520),
    );
  }

  // ---- marks ---------------------------------------------------------------

  private mark(id: string, effect: TextMarkEffect, part: string | undefined, temp: boolean, animate: boolean): Mark | null {
    const block = this.blocks.get(id);
    if (!block) return null;
    if (effect === "strike") block.classList.add("bk-struck");
    const target = part ? (wrapPart(block, part) ?? block) : block;
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    // The highlighter goes behind the words; ink marks over them.
    svg.setAttribute("class", effect === "light" ? "bk-mark bk-behind" : "bk-mark");
    this.root.appendChild(svg);
    const m: Mark = { svg, target, block, effect, temp, seed: 1 + Math.floor(Math.random() * 1e6) };
    this.marks.push(m);
    this.place(m);
    if (animate) inkOn(svg);
    return m;
  }

  private dropTempMarks(animate: boolean): void {
    this.marks = this.marks.filter((m) => {
      if (!m.temp) return true;
      if (animate) {
        m.svg.classList.add("bk-fading");
        setTimeout(() => m.svg.remove(), 520);
      } else m.svg.remove();
      return false;
    });
  }

  private dropMarksOf(block: HTMLElement): void {
    this.marks = this.marks.filter((m) => {
      if (m.block !== block) return true;
      m.svg.remove();
      return false;
    });
  }

  /** "As we wrote earlier": scroll back to the block and flash it; the next
   *  write scrolls forward to the newest again. */
  private lookBack(id: string): void {
    const b = this.blocks.get(id);
    if (!b) return;
    this.scrollTo(Math.max(0, b.offsetTop + b.offsetHeight / 2 - this.root.clientHeight / 2), true);
    setTimeout(() => {
      const m = this.mark(id, "light", undefined, false, true);
      if (!m) return;
      m.svg.classList.add("bk-flash");
      setTimeout(() => m.svg.classList.add("bk-fading"), 2200);
      setTimeout(() => {
        m.svg.remove();
        this.marks = this.marks.filter((x) => x !== m);
      }, 2800);
    }, 450);
  }

  private place(m: Mark): void {
    const rs = inkRects(m.target, this.root);
    m.svg.replaceChildren();
    m.svg.setAttribute("width", String(this.root.scrollWidth));
    m.svg.setAttribute("height", String(this.root.scrollHeight));
    if (rs.length === 0) return;
    if (m.effect === "light") {
      for (const r of rs) {
        const rect = document.createElementNS(SVG_NS, "rect");
        // A little taller than the line box on both sides: it covers the letters.
        const attrs: Record<string, number | string> = { x: r.x - 3, y: r.y - r.h * 0.12, width: r.w + 6, height: r.h * 1.24, rx: 4, class: "bk-hl" };
        for (const [k, v] of Object.entries(attrs)) rect.setAttribute(k, String(v));
        m.svg.appendChild(rect);
      }
      return;
    }
    const d = markPath(m.effect, rs);
    if (this.opts.sketchy) {
      const node = rough.svg(m.svg).path(d, { roughness: 1.3, bowing: 1.2, strokeWidth: 2.2, stroke: "#b5482e", seed: m.seed });
      node.querySelectorAll("path").forEach((p) => p.setAttribute("class", "bk-ink"));
      m.svg.appendChild(node);
    } else {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "bk-ink");
      m.svg.appendChild(path);
    }
  }

  // ---- scroll --------------------------------------------------------------

  /** Cubic ease-in-out, longer for longer distances; a newer scroll takes over. */
  private scrollTo(to: number, animate: boolean): void {
    const id = ++this.scrollAnim;
    const from = this.root.scrollTop;
    const dist = to - from;
    if (Math.abs(dist) < 1) return;
    if (!animate) {
      this.root.scrollTop = to;
      return;
    }
    const ms = Math.min(1400, 500 + Math.abs(dist) * 1.2);
    const t0 = performance.now();
    const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now: number): void => {
      if (id !== this.scrollAnim) return;
      const t = Math.min(1, (now - t0) / ms);
      this.root.scrollTop = from + dist * ease(t);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

// ---- geometry helpers --------------------------------------------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Wrap the first occurrence of `part` (inside one text run) in a span. */
function wrapPart(block: HTMLElement, part: string): HTMLElement | null {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const i = n.data.indexOf(part);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(n, i);
    r.setEnd(n, i + part.length);
    const span = document.createElement("span");
    r.surroundContents(span);
    return span;
  }
  // A formula named by its TeX: the formula's own box.
  const formula = [...block.querySelectorAll<SVGElement>("svg.bk-tex")].find((s) => s.getAttribute("aria-label")?.includes(part));
  return (formula as unknown as HTMLElement) ?? null;
}

/** The ink of a target, as boxes in the pane's content coordinates: a display
 *  formula's own box; otherwise every text run and inline formula, folded
 *  into one box per line. */
function inkRects(target: Element, pane: HTMLElement): Box[] {
  const p = pane.getBoundingClientRect();
  const off = (r: DOMRect): Box => ({ x: r.left - p.left + pane.scrollLeft, y: r.top - p.top + pane.scrollTop, w: r.width, h: r.height });
  if (target.classList.contains("bk-block")) {
    const display = target.querySelector(".bk-display > svg");
    if (display && !target.querySelector("p, li, h1, h2, blockquote, table, pre")) return [off(display.getBoundingClientRect())];
  }
  const rs: DOMRect[] = [];
  if (target instanceof SVGElement) rs.push(target.getBoundingClientRect());
  else {
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
      if (!t.data.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      rs.push(...range.getClientRects());
    }
    target.querySelectorAll("svg.bk-tex").forEach((m) => rs.push(m.getBoundingClientRect()));
  }
  return mergeLines(rs.map(off).filter((r) => r.w > 2));
}

function mergeLines(rs: Box[]): Box[] {
  const out: Box[] = [];
  for (const r of rs.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = out.find((o) => Math.abs(o.y + o.h / 2 - (r.y + r.h / 2)) < Math.min(o.h, r.h) * 0.6);
    if (!line) {
      out.push({ ...r });
      continue;
    }
    const x1 = Math.max(line.x + line.w, r.x + r.w);
    const y1 = Math.max(line.y + line.h, r.y + r.h);
    line.x = Math.min(line.x, r.x);
    line.y = Math.min(line.y, r.y);
    line.w = x1 - line.x;
    line.h = y1 - line.y;
  }
  return out;
}

/** The stroke of a mark round boxes `rs`, with room left around the ink. */
export function markPath(effect: TextMarkEffect, rs: Box[]): string {
  const u = rs.reduce(
    (a, r) => ({ x0: Math.min(a.x0, r.x), y0: Math.min(a.y0, r.y), x1: Math.max(a.x1, r.x + r.w), y1: Math.max(a.y1, r.y + r.h) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );
  const p = 10;
  if (effect === "circle") {
    // An ellipse through the box's corners would touch them; 1.12 × clears them.
    const cx = (u.x0 + u.x1) / 2;
    const cy = (u.y0 + u.y1) / 2;
    const rx = ((u.x1 - u.x0) / 2 + p) * 1.12;
    const ry = ((u.y1 - u.y0) / 2 + p) * 1.12;
    const pts: string[] = [];
    for (let t = -0.3; t <= Math.PI * 2 + 0.35; t += 0.2) pts.push(`${(cx + rx * Math.cos(t) * (1 + t * 0.015)).toFixed(1)},${(cy + ry * Math.sin(t) * (1 + t * 0.012)).toFixed(1)}`);
    return "M" + pts.join("L");
  }
  if (effect === "box") {
    const x0 = u.x0 - p;
    const y0 = u.y0 - p * 0.7;
    const x1 = u.x1 + p;
    const y1 = u.y1 + p * 0.7;
    return `M${x0},${y0}L${x1},${y0}L${x1},${y1}L${x0},${y1}Z`;
  }
  if (effect === "underline") return rs.map((r) => `M${r.x},${r.y + r.h}Q${r.x + r.w / 2},${r.y + r.h + 3} ${r.x + r.w},${r.y + r.h}`).join("");
  // strike
  return rs.map((r) => `M${r.x - 3},${r.y + r.h * 0.55}L${r.x + r.w + 3},${r.y + r.h * 0.52}`).join("");
}

/** Draw a mark on like ink: strokes by their length, the highlighter by a wipe. */
function inkOn(svg: SVGSVGElement): void {
  for (const el of svg.querySelectorAll<SVGPathElement>("path.bk-ink")) {
    const len = el.getTotalLength();
    el.animate(
      [
        { strokeDasharray: `${len}`, strokeDashoffset: `${len}` },
        { strokeDasharray: `${len}`, strokeDashoffset: "0" },
      ],
      { duration: Math.min(900, 250 + len * 1.2), easing: "ease-out" },
    );
  }
  for (const el of svg.querySelectorAll("rect.bk-hl")) {
    el.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: 500, easing: "ease-out" });
  }
}
