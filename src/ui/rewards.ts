// Rewards on the stage (spec 2026-10-03-looks-feedback-account §4.3): the
// confetti burst, its still badge under prefers-reduced-motion, and the
// reaction picture. All on an overlay ABOVE the figure, never in it (so no
// movie or export ever records one), pointer-events: none (so a click still
// reaches the stage and its gates), and removed once it has played. The
// sparkle is the player's own glow; the joke is a spoken line — neither
// needs an overlay.

import type { BBox } from "../layout/geometry";
import { pictureFor, TWEMOJI_CREDIT, type RewardEvent, type RewardKind } from "../feedback/rewards";
import { REACTION_SVGS } from "../feedback/reaction-svgs";
import { clientPointFor } from "./dom";

export type OverlayKind = "confetti" | "badge" | "picture";

/** The overlay a reward shows, or null: sparkle and joke have none; confetti is a still badge under reduced motion. */
export function overlayFor(kind: RewardKind, reducedMotion: boolean): OverlayKind | null {
  if (kind === "confetti") return reducedMotion ? "badge" : "confetti";
  if (kind === "picture") return "picture";
  return null;
}

/** The still badge's words. */
export function badgeText(e: Pick<RewardEvent, "streak" | "band">): string {
  return e.band === "perfect" && e.streak >= 3 ? `★ ${e.streak} in a row` : "★ All right";
}

export const CONFETTI_MS = 1500;
export const CONFETTI_PIECES = 60;
export const PICTURE_MS = 2000;
const COLORS = ["#e4572e", "#f3a712", "#4a7c59", "#2e86ab", "#a23b72", "#f6d55c"];
const GRAVITY = 900; // px/s²

export interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  w: number;
  h: number;
  color: string;
}

/** A tiny seeded generator, so a burst is testable. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** `n` paper pieces bursting up and out from `origin` (stage pixels). */
export function confettiPieces(n: number, origin: [number, number], seed = 1): Piece[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const a = -Math.PI / 2 + (r() - 0.5) * Math.PI * 0.9; // mostly up
    const v = 280 + r() * 360;
    return {
      x: origin[0],
      y: origin[1],
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      spin: (r() - 0.5) * 12,
      w: 5 + r() * 5,
      h: 3 + r() * 4,
      color: COLORS[Math.floor(r() * COLORS.length)],
    };
  });
}

/** Where a piece is `ms` after the burst: thrown, falling, fading over the last third. */
export function pieceAt(p: Piece, ms: number): { x: number; y: number; rot: number; alpha: number } {
  const t = ms / 1000;
  const drag = Math.exp(-1.2 * t);
  return {
    x: p.x + p.vx * t * drag,
    y: p.y + p.vy * t * drag + 0.5 * GRAVITY * t * t,
    rot: p.spin * t,
    alpha: Math.max(0, Math.min(1, (CONFETTI_MS - ms) / (CONFETTI_MS / 3))),
  };
}

/**
 * The confetti's floor (stage px): the top of the caption band when one is
 * showing (the words being said — pieces falling through them hid them for
 * most of the burst), else the stage's bottom. The burst is drawn above it
 * only, and starts at least `lift` px above it.
 */
export function confettiFloor(stageH: number, captionTop: number | null): number {
  return captionTop !== null && captionTop > 0 && captionTop < stageH ? captionTop : stageH;
}

/** The burst's origin, kept `lift` px over the floor (and on the stage). */
export function confettiOrigin(origin: [number, number], floor: number, lift = 40): [number, number] {
  return [origin[0], Math.max(0, Math.min(origin[1], floor - lift))];
}

/** A reaction picture as a data: URL from the bundled SVGs — never fetched at answer time. Null for an unknown name. */
export function pictureSrc(name: string): string | null {
  const svg = REACTION_SVGS[name];
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
}

export const PICTURE_PX = 120;

/**
 * Where the picture's centre goes (stage pixels): just right of the part,
 * kept on the stage, and clear of the bottom band where the caption and the
 * answer dock sit (and of the top edge).
 */
export function picturePlace(x: number, y: number, sw: number, sh: number): { left: number; top: number } {
  const half = PICTURE_PX / 2;
  const left = Math.min(x + 16, Math.max(0, sw - PICTURE_PX - 20));
  const dock = Math.max(96, sh * 0.28);
  const minTop = half + 8;
  const maxTop = Math.max(minTop, sh - dock - half);
  return { left, top: Math.min(Math.max(y, minTop), maxTop) };
}

const reducedNow = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A box's point (fx, fy fractions across it) in stage pixels, or the stage's middle. */
function stagePoint(stage: HTMLElement, box: BBox | null, fx: number, fy: number): [number, number] {
  const p = box ? clientPointFor(stage, [box.x + box.w * fx, box.y + box.h * fy]) : null;
  if (p) return p;
  const r = stage.getBoundingClientRect();
  return [r.width / 2, r.height / 2];
}

function overlayEl(stage: HTMLElement, cls: string, tag: "canvas" | "div" = "div"): HTMLElement {
  const el = document.createElement(tag);
  el.className = `cs-reward ${cls}`;
  el.setAttribute("aria-hidden", "true");
  // Inline as well as in styles.css: an overlay must never take a click.
  el.style.pointerEvents = "none";
  stage.appendChild(el);
  return el;
}

/**
 * Play a reward on the stage; returns a function that removes it early (a
 * seek, a new answer). Removes itself once played. Nothing for sparkle/joke.
 */
export function playReward(stage: HTMLElement, e: RewardEvent, opts: { reducedMotion?: boolean } = {}): () => void {
  const kind = overlayFor(e.kind, opts.reducedMotion ?? reducedNow());
  if (kind === null) return () => {};
  stage.querySelectorAll(".cs-reward").forEach((el) => el.remove());
  let el: HTMLElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let raf = 0;
  const remove = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    if (raf) cancelAnimationFrame(raf);
    el.remove();
  };
  if (kind === "confetti") {
    const canvas = overlayEl(stage, "cs-reward-confetti", "canvas") as HTMLCanvasElement;
    el = canvas;
    const sr = stage.getBoundingClientRect();
    // Above the caption only: the canvas ends where the words begin.
    const cap = stage.querySelector<HTMLElement>(".cs-caption");
    const capText = cap && !cap.classList.contains("cs-caption-empty") && (cap.textContent ?? "").trim() !== "";
    const floor = confettiFloor(sr.height, capText ? cap.getBoundingClientRect().top - sr.top : null);
    const r = { width: sr.width, height: floor };
    canvas.style.height = `${floor}px`;
    canvas.style.bottom = "auto";
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = canvas.getContext("2d");
    const pieces = confettiPieces(CONFETTI_PIECES, confettiOrigin(stagePoint(stage, e.box, 0.5, 0.5), floor), e.n + 1);
    const t0 = performance.now();
    const frame = (now: number): void => {
      const ms = now - t0;
      if (ms >= CONFETTI_MS || !ctx) return remove();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      for (const p of pieces) {
        const q = pieceAt(p, ms);
        ctx.save();
        ctx.globalAlpha = q.alpha;
        ctx.translate(q.x, q.y);
        ctx.rotate(q.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // A backstop: a background tab may never run the frames.
    timer = setTimeout(remove, CONFETTI_MS + 500);
    return remove;
  }
  if (kind === "badge") {
    el = overlayEl(stage, "cs-reward-badge");
    el.textContent = badgeText(e);
    const [x, y] = stagePoint(stage, e.box, 0.5, 1);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    timer = setTimeout(remove, CONFETTI_MS);
    return remove;
  }
  // The picture: a big twemoji beside the figure (right of the part), 2 s.
  const pic = pictureFor(e.band, e.n);
  const src = pic ? pictureSrc(pic.name) : null;
  if (!pic || !src) return () => {};
  el = overlayEl(stage, "cs-reward-picture");
  const img = document.createElement("img");
  img.src = src;
  img.alt = pic.char;
  // The CC BY credit stays off the canvas: here as the picture's title, and
  // in the player's credits menu (rewardCredits).
  img.title = TWEMOJI_CREDIT;
  img.onerror = () => remove();
  el.appendChild(img);
  const [x, y] = stagePoint(stage, e.box, 1, 0.5);
  const sr = stage.getBoundingClientRect();
  const at = picturePlace(x, y, sr.width, sr.height);
  el.style.left = `${at.left}px`;
  el.style.top = `${at.top}px`;
  if (opts.reducedMotion ?? reducedNow()) el.classList.add("is-still");
  timer = setTimeout(remove, PICTURE_MS);
  return remove;
}
