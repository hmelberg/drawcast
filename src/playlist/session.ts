// Playlist playback: a thin sequence controller above the unchanged renderer.
// Each item is a fresh render (its own template, domain, ids), but the cut is
// softened: the finished drawing stays up until the viewer continues, then
// un-draws itself (fadeOutAll). Cards — the opening title page and the
// chapter card where a new chapter begins — are synthesized specs played
// through the same renderer so they show up in live playback, the #gdoc
// viewer and video export alike. Navigation: chapter-tree panel (native
// <details> for collapse), per-item dots in the control bar, and n/p keys.

import { render, type RenderHandle, type RenderStyle } from "../render";
import type { PlaybackMode } from "../render/player";
import type { SpeechManager } from "../render/speech";
import { attachPlayerControls, clickGate, type ControlsOptions, type PlaybackPrefs } from "../ui/controls";
import { h } from "../ui/dom";
import { collectSpeakTexts } from "../export/video";
import { exportSequence, itemsOf, itemTitle, makeChapterCard, makeTitlePage, type Playlist, type PlaylistItem } from "./playlist";

export { itemTitle };

export interface SessionOptions {
  style: RenderStyle;
  mode: PlaybackMode;
  speed: number;
  speech: SpeechManager;
  prefs: PlaybackPrefs;
  controls?: ControlsOptions;
  /** Viewer/kiosk override of the playlist's advance mode (&advance=auto). */
  advanceOverride?: "click" | "auto";
  /** Called with each item's handle after it mounts (editor lint, title sync). */
  onItemMounted?(hd: RenderHandle, item: PlaylistItem): void;
}

export interface SessionHandle {
  destroy(): void;
}

/**
 * Every narration line the playlist can speak — items, the title page, and
 * chapter cards. Derived from exportSequence, so live playback and video
 * export can never disagree about what needs pre-synthesized speech.
 */
export function playlistSpeakTexts(playlist: Playlist): string[] {
  return [...new Set(exportSequence(playlist).flatMap(collectSpeakTexts))];
}

/** An abortable sleep for auto-advance gaps; resolves (never rejects) on abort. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      window.clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const t = window.setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

export async function mountPlaylist(host: HTMLElement, playlist: Playlist, opts: SessionOptions): Promise<SessionHandle> {
  const items = itemsOf(playlist);
  const advance = opts.advanceOverride ?? playlist.meta.advance;
  const gap = playlist.meta.gap;

  let handle: RenderHandle | null = null;
  let destroyed = false;
  let gateAbort: AbortController | null = null;
  let modeRef: PlaybackMode = opts.mode;

  const prefs: PlaybackPrefs = {
    ...opts.prefs,
    onMode: (m) => {
      modeRef = m;
      opts.prefs.onMode?.(m);
    },
  };
  const renderOpts = { style: opts.style, speech: opts.speech, mode: opts.mode, speed: opts.speed };

  // One item: exactly the pre-playlist behavior — no dots, no panel, no cards.
  if (items.length <= 1) {
    if (items.length === 1) {
      const hd = await render(items[0].spec, host, renderOpts);
      handle = hd;
      attachPlayerControls(host, hd, prefs, opts.controls);
      opts.onItemMounted?.(hd, items[0]);
    }
    return {
      destroy: () => {
        destroyed = true;
        handle?.destroy();
      },
    };
  }

  let idx = 0;

  const dots = items.map((it, i) => {
    const d = h("button", { class: "pl-dot", title: itemTitle(it) });
    d.addEventListener("click", (e) => {
      e.stopPropagation();
      void jump(i);
    });
    return d;
  });
  const dotsWrap = h("span", { class: "pl-dots" }, ...dots);

  const panel = buildPanel();
  const panelBtn = h("button", { class: "cs-bar-btn", title: "Playlist (n/p: next/previous)" }, "☰");
  panelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("open");
  });
  host.classList.add("pl-host");
  host.appendChild(panel);

  function buildPanel(): HTMLElement {
    const list = h("div", { class: "pl-list" });
    const itemRow = (item: PlaylistItem): HTMLElement => {
      const badge = item.spec.level ? [h("span", { class: `pl-badge pl-badge-${item.spec.level}` }, item.spec.level)] : [];
      const btn = h(
        "button",
        { class: "pl-item", "data-i": String(item.index) },
        h("span", { class: "pl-item-no" }, String(item.index + 1)),
        h("span", { class: "pl-item-title" }, itemTitle(item)),
        ...badge,
      );
      btn.addEventListener("click", () => {
        panel.classList.remove("open");
        void jump(item.index);
      });
      return btn;
    };
    // Group consecutive items under their chapter; chapters collapse natively.
    let i = 0;
    while (i < items.length) {
      const chapter = items[i].chapter;
      const group: HTMLElement[] = [];
      while (i < items.length && items[i].chapter === chapter) {
        group.push(itemRow(items[i]));
        i++;
      }
      if (chapter === undefined) list.append(...group);
      else {
        const det = h("details", { class: "pl-chapter", open: "" }, h("summary", {}, chapter), ...group);
        list.appendChild(det);
      }
    }
    const head = playlist.meta.title ? [h("div", { class: "pl-panel-title" }, playlist.meta.title)] : [];
    return h("aside", { class: "pl-panel" }, ...head, list);
  }

  function markCurrent(): void {
    dots.forEach((d, i) => d.classList.toggle("current", i === idx));
    panel.querySelectorAll<HTMLElement>(".pl-item").forEach((b) => {
      b.classList.toggle("current", Number(b.dataset.i) === idx);
    });
  }

  function cancelPending(): void {
    gateAbort?.abort();
    gateAbort = null;
  }

  async function jump(i: number): Promise<void> {
    cancelPending();
    await mountItem(i, true);
  }

  async function mountItem(i: number, autoplay: boolean): Promise<void> {
    if (destroyed) return;
    idx = i;
    handle?.destroy();
    handle = null;
    const hd = await render(items[i].spec, host, renderOpts);
    if (destroyed) {
      hd.destroy();
      return;
    }
    handle = hd;
    attachPlayerControls(host, hd, prefs, {
      ...opts.controls,
      trailing: [dotsWrap, panelBtn, ...(opts.controls?.trailing ?? [])],
    });
    // Chain AFTER the controls install their callbacks (and their showPoster),
    // so the poster's initial "done" never triggers an advance.
    const prev = hd.timeline.callbacks;
    hd.timeline.callbacks = {
      onState: (s) => {
        prev.onState?.(s);
        if (s === "done") void onItemDone();
      },
      onStep: prev.onStep,
    };
    opts.onItemMounted?.(hd, items[i]);
    markCurrent();
    if (autoplay) void hd.timeline.play();
  }

  /** The between-items gate: a gap timer on auto, otherwise the continue pill on the finished drawing. */
  function continueGate(next: PlaylistItem, signal: AbortSignal): Promise<void> {
    if (advance === "auto") return delay(gap * 1000, signal);
    const stage = host.querySelector<HTMLElement>(".cs-stage");
    if (!stage) return Promise.resolve();
    return clickGate(stage, `Click to go on to ${itemTitle(next)} ▸`)(signal);
  }

  async function onItemDone(): Promise<void> {
    // Instant mode is for inspecting final states — never auto-chain there.
    if (destroyed || idx >= items.length - 1 || modeRef === "instant") return;
    const next = items[idx + 1];
    const crossing = next.chapter !== items[idx].chapter ? next.chapter : undefined;
    const ac = new AbortController();
    gateAbort = ac;
    await continueGate(next, ac.signal);
    if (destroyed || ac.signal.aborted) return;
    if (playlist.meta.transitions === "auto") {
      // The finished drawing un-draws itself instead of a hard cut.
      await handle?.timeline.fadeOutAll();
      if (destroyed || ac.signal.aborted) return;
      if (crossing) return mountCard(next, crossing);
    }
    void mountItem(next.index, true);
  }

  /** The interstitial that remains: a card where a new chapter begins. */
  async function mountCard(next: PlaylistItem, crossing: string): Promise<void> {
    handle?.destroy();
    handle = null;
    const card = makeChapterCard({ chapter: crossing, next: itemTitle(next), gate: advance, gap });
    const hd = await render(card, host, renderOpts);
    if (destroyed) {
      hd.destroy();
      return;
    }
    handle = hd;
    const stage = host.querySelector<HTMLElement>(".cs-stage");
    if (stage) hd.timeline.inputGate = clickGate(stage);
    hd.timeline.callbacks = {
      onState: (s) => {
        if (s === "done") void mountItem(next.index, true);
      },
    };
    void hd.timeline.play();
  }

  /**
   * The TV-style opening: the title page mounts as the cover (its finished
   * state is the poster behind the big play button); pressing play fades the
   * title in and out, then chains into the first item.
   */
  async function mountTitlePage(title: string): Promise<void> {
    if (destroyed) return;
    idx = -1; // before item 0: no dot current, n jumps to the first item
    handle?.destroy();
    handle = null;
    const hd = await render(makeTitlePage({ title, subtitle: playlist.meta.subtitle, gap }), host, renderOpts);
    if (destroyed) {
      hd.destroy();
      return;
    }
    handle = hd;
    attachPlayerControls(host, hd, prefs, {
      ...opts.controls,
      trailing: [dotsWrap, panelBtn, ...(opts.controls?.trailing ?? [])],
    });
    // Chain AFTER the controls install their callbacks (and their showPoster),
    // so the poster's initial "done" never triggers an advance.
    const prev = hd.timeline.callbacks;
    hd.timeline.callbacks = {
      onState: (s) => {
        prev.onState?.(s);
        if (s === "done" && modeRef !== "instant") void mountItem(0, true);
      },
      onStep: prev.onStep,
    };
    markCurrent();
  }

  const onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (e.key === "n") void jump(Math.min(idx + 1, items.length - 1));
    else if (e.key === "p") void jump(Math.max(idx - 1, 0));
  };
  document.addEventListener("keydown", onKey);

  if (playlist.meta.title !== undefined) await mountTitlePage(playlist.meta.title);
  else await mountItem(0, false);

  return {
    destroy: () => {
      destroyed = true;
      cancelPending();
      document.removeEventListener("keydown", onKey);
      handle?.destroy();
      panel.remove();
      dotsWrap.remove();
      panelBtn.remove();
      host.classList.remove("pl-host");
    },
  };
}
