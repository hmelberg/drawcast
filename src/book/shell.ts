// A book (spec 2026-10-01-book-layout): the playlist session as it always
// plays, with a written text pane beside (or under) its figure.
//
// The session keeps everything it owns — parts, controls, quizzes, the
// explore tray, seeking. The shell adds three things around it:
//   - the layout: a row (or column) of [text pane | the session's host],
//     sized from the screen height (layout.ts) and centred;
//   - the text: each part's Player hands its `text` steps to the pane as
//     they play (Player.textHook), and when the position JUMPS (a seek, a
//     step back, a jump to another part) the pane is rebuilt, instantly,
//     from every text step up to there (ops.ts) — so a seek lands exactly
//     where playing would have;
//   - the transitions between parts, awaited by the session (its `book`
//     hook): TV across a chapter, a short fade within one.

import { itemsOf, type Playlist, type PlaylistItem } from "../playlist/playlist";
import { mountPlaylist, type SessionHandle, type SessionOptions } from "../playlist/session";
import type { RenderHandle } from "../render";
import type { TextOp } from "../render/plan";
import type { BookSettings } from "../spec/types";
import { BOOK_CSS } from "./css";
import { bookLayout, type BookView } from "./layout";
import { loadBookMath } from "./math";
import { crossesChapter, opsBeforePart, partTextOps, prelude } from "./ops";
import { TextPane } from "./pane";
import { settle, transitionIn, transitionOut, type BookTransition } from "./transitions";

/** Whether a playlist is a book: its first part says so. */
export function isBook(playlist: Playlist): boolean {
  return itemsOf(playlist).some((i) => i.spec.book !== undefined);
}

/** The book's settings: the first part's, which the app stamps on every part. */
export function bookSettings(playlist: Playlist): BookSettings {
  return itemsOf(playlist).find((i) => i.spec.book)?.spec.book ?? {};
}

const GAP = 12;

function injectCss(): void {
  if (document.getElementById("bk-style")) return;
  const style = document.createElement("style");
  style.id = "bk-style";
  style.textContent = BOOK_CSS;
  document.head.appendChild(style);
}

export async function mountBookPlaylist(host: HTMLElement, playlist: Playlist, opts: SessionOptions): Promise<SessionHandle> {
  injectCss();
  await loadBookMath();
  const items = itemsOf(playlist);
  const settings = bookSettings(playlist);
  const look = settings.look ?? "mixed";
  const transition: BookTransition = settings.transition ?? "tv";
  const bookTitle = playlist.meta.title;

  // ---- the layout around the session's host ---------------------------------
  const parent = host.parentElement;
  const row = document.createElement("div");
  row.className = `bk-row ${settings.layout === "rows" ? "bk-rows" : "bk-cols"}`;
  const aside = document.createElement("aside");
  aside.className = `bk-text${look === "clean" ? " bk-clean" : ""}`;
  aside.setAttribute("aria-label", "Text");
  const scroll = document.createElement("div");
  scroll.className = "bk-scroll";
  aside.appendChild(scroll);
  parent?.insertBefore(row, host);
  // Columns put the text first (left); rows put it under the figure — what
  // #book_row promises — unless the book says otherwise.
  const textSecond = settings.text === "second" || (settings.text === undefined && settings.layout === "rows");
  if (textSecond) row.append(host, aside);
  else row.append(aside, host);
  host.classList.add("bk-figure", "cs-caption-fixed");
  // The player page (and the viewer) let the book take the window's width;
  // anywhere else — the editor's preview panel — it fits inside its panel.
  const page = parent?.classList.contains("player-wrap") === true || parent?.classList.contains("viewer-wrap") === true;
  if (page) parent?.classList.add("bk-mode");

  /** The width a page offers: its <main> (the app) or the window (the
   *  viewer), less the side padding of what holds the book. */
  const pageWidth = (): number => {
    const main = row.closest("main");
    const box = main ?? document.documentElement;
    const cs = getComputedStyle(box);
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    return box.clientWidth - pad - 32;
  };

  let view: BookView = "both";
  let share = settings.share;
  const layoutNow = (animate: boolean): void => {
    const container = (page ? parent?.parentElement : parent) ?? document.body;
    const pad = (() => {
      const cs = getComputedStyle(container);
      return (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    })();
    const top = row.getBoundingClientRect().top;
    const after = [...(parent?.children ?? [])].filter((c) => c !== row && c.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING);
    const furniture = after.reduce((a, c) => a + (c as HTMLElement).offsetHeight, 0);
    const stage = host.querySelector<HTMLElement>(".cs-stage");
    const barH = stage ? Math.max(40, host.offsetHeight - stage.offsetHeight) : 64;
    const room = {
      // A page (the player, the viewer) offers the page's width, less its
      // padding — the book's own wrapper shrinks to fit the book, so
      // measuring that would be circular.
      w: Math.max(320, (page ? pageWidth() : container.clientWidth - pad - 4) - GAP),
      h: Math.max(320, window.innerHeight - Math.max(0, top) - furniture - 24),
      barH,
    };
    const box = bookLayout(room, { ...settings, share }, view);
    row.classList.toggle("bk-animate", animate);
    row.style.setProperty("--bk-font", `${box.fontPx}px`);
    row.style.width = `${box.w + (box.text.w > 0 && box.figure.w > 0 && box.dir === "row" ? GAP : 0)}px`;
    aside.style.width = `${box.text.w}px`;
    // Columns: the text as tall as the figure beside it; rows: what is left.
    aside.style.height = `${box.dir === "row" ? box.figure.h || box.h : box.text.h}px`;
    aside.classList.toggle("bk-closed", box.text.w < 1 || box.text.h < 1);
    host.style.width = `${box.figure.w}px`;
    host.classList.toggle("bk-closed", box.figure.w < 1 || box.figure.h < 1);
    if (!animate) pane.relayout();
    else window.setTimeout(() => pane.relayout(), 1150);
  };
  const onResize = (): void => {
    layoutNow(false);
    pane.settleScroll();
  };

  const pane = new TextPane(scroll, {
    sketchy: look === "sketchy",
    transition,
    onView: (v, animate) => {
      view = v;
      layoutNow(animate);
    },
  });

  // ---- text: live steps, and rebuilds after a jump ---------------------------
  const ownOps = new Map<number, TextOp[]>(); // a mounted part's ops, from its live plan
  const own = (k: number): TextOp[] => ownOps.get(k) ?? partTextOps(items[k].spec);
  let current = -1;
  let plan: RenderHandle["plan"] | null = null;
  let applied = 0; // text steps of the current part already in the pane
  let advancingTo: number | null = null;
  let preluded = -1; // the part whose prelude was last written by playing into it

  const textStepsBefore = (completed: number): TextOp[] =>
    (plan?.steps.slice(0, completed) ?? []).flatMap((s) => (s.kind === "text" ? [s.op] : []));

  const rebuild = (completed: number): void => {
    preluded = -1;
    layoutNow(false); // the pane needs its size before the blocks go in
    pane.reset();
    view = "both";
    for (const op of opsBeforePart(items, current, bookTitle, own)) void pane.apply(op, false);
    const mine = textStepsBefore(completed);
    for (const op of mine) void pane.apply(op, false);
    applied = mine.length;
    layoutNow(false);
    pane.settleScroll();
  };

  const sync = (completed: number): void => {
    if (current < 0 || !plan) return;
    if (textStepsBefore(completed).length !== applied) rebuild(completed);
  };

  const figureEl = (): Element | null => host.querySelector(".cs-figure");

  const onItemMounted = (hd: RenderHandle, item: PlaylistItem): void => {
    opts.onItemMounted?.(hd, item);
    const i = item.index;
    current = i;
    plan = hd.plan;
    ownOps.set(i, hd.plan.steps.flatMap((s) => (s.kind === "text" ? [s.op] : [])));
    share = item.spec.book?.share ?? settings.share;
    const natural = advancingTo === i;
    advancingTo = null;
    if (natural && preluded === i) {
      // The same part mounted again by the same advance: its prelude is in.
      applied = 0;
    } else if (natural) {
      preluded = i;
      // Played into: the earlier text stays; this part's prelude is written
      // now (a chapter's clear already happened with the TV, so it is instant).
      for (const op of prelude(items, i, bookTitle)) void pane.apply(op, op.op !== "clear");
      applied = 0;
      layoutNow(false);
    } else rebuild(hd.timeline.position);
    hd.timeline.textHook = async (op) => {
      if (plan !== hd.plan) return;
      applied++;
      await pane.apply(op, true);
    };
    const prev = hd.timeline.callbacks;
    hd.timeline.callbacks = {
      ...prev,
      onStep: (completed, total) => {
        prev.onStep?.(completed, total);
        // A part that is no longer on screen may still report a last step
        // (its player winds down after the next part mounted): ignore it.
        if (plan === hd.plan) sync(completed);
      },
    };
    // The poster may already stand at the end of the part (a jump mounts it
    // there): the pane follows wherever the timeline is.
    sync(hd.timeline.position);
  };

  const beforeSwap = async (from: number, to: number): Promise<void> => {
    if (advancingTo === to) return; // already on its way
    advancingTo = to;
    const chapter = crossesChapter(items, from, to);
    const kind: BookTransition = chapter ? transition : "fade";
    const fig = figureEl();
    await Promise.all([fig ? transitionOut(fig, kind) : Promise.resolve(), chapter ? pane.apply({ op: "clear" }, true) : Promise.resolve()]);
    if (fig) settle(fig);
  };

  const session = await mountPlaylist(host, playlist, {
    ...opts,
    style: look,
    // Captions start off in a book: the text pane already carries the words
    // that matter (the CC button still turns them on).
    captions: opts.captions ? { ...opts.captions, on: false } : undefined,
    onItemMounted,
    book: { beforeSwap },
  });

  // A TV switch-on for a part that opened a new chapter.
  const observer = new MutationObserver(() => {
    const fig = figureEl();
    if (fig && !fig.hasAttribute("data-bk-in")) {
      fig.setAttribute("data-bk-in", "");
      if (current > 0 && crossesChapter(items, current - 1, current)) void transitionIn(fig, transition);
    }
  });
  observer.observe(host, { childList: true });

  window.addEventListener("resize", onResize);
  // The control bar appears with the first mount: lay out once it is there.
  requestAnimationFrame(() => layoutNow(false));

  return {
    destroy: () => {
      session.destroy();
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      host.classList.remove("bk-figure", "cs-caption-fixed", "bk-closed");
      host.style.width = "";
      parent?.classList.remove("bk-mode");
      if (row.parentElement) row.parentElement.insertBefore(host, row);
      row.remove();
    },
  };
}
