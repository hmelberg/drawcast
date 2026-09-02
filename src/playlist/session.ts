// Playlist playback: a thin sequence controller above the unchanged renderer.
// Each item is a fresh render (its own template, domain, ids), but the cut is
// softened: the finished drawing stays up until the viewer continues, then
// un-draws itself (fadeOutAll). Cards — the opening title page and the
// chapter card where a new chapter begins — are synthesized specs played
// through the same renderer so they show up in live playback, the #gdoc
// viewer and video export alike. Navigation: chapter-tree panel (native
// <details> for collapse), per-item dots in the control bar, and n/p keys.

import { render, type RenderHandle, type RenderStyle } from "../render";
import { speechKey, type SpeakLine } from "../render/delivery";
import type { PlaybackMode } from "../render/player";
import type { SpeechManager } from "../render/speech";
import { attachPlayerControls, clickGate, type ControlsOptions, type PlaybackPrefs } from "../ui/controls";
import { h } from "../ui/dom";
import { collectSpeakLines } from "../export/video";
import { exportSequence, itemsOf, itemTitle, makeChapterCard, makeTitlePage, ZOOM_EXIT, type Playlist, type PlaylistItem } from "./playlist";
import { subtitleLanguages, subtitleTrack } from "../spec/subtitles";
import { parseVoiceId, voiceOptions } from "../render/voices";
import type { Spec } from "../spec/types";
import { elementBBoxes } from "../layout/layout";
import { makeBrowserMeasure } from "../render/svg-backend";
import type { BBox } from "../layout/geometry";

/** The layout bbox of the zoom target in the CURRENT item's scene, or null. */
function zoomTargetBox(handle: RenderHandle, id: string): BBox | null {
  try {
    return elementBBoxes(handle.layout, makeBrowserMeasure()).get(id) ?? null;
  } catch {
    return null;
  }
}

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
  /** Viewer preference: skip quiz/ask questions entirely. */
  questions?: "on" | "skip";
  /**
   * Subtitles: the remembered choice coming in, and where a change goes out.
   * The session owns the live state because the CC bar is rebuilt with every
   * item — the viewer's language must survive the next mount, and a chosen
   * language must apply to the whole playlist rather than one figure.
   */
  captions?: {
    on: boolean;
    /** Remembered language code; ignored when this playlist has no such track. */
    lang: string;
    onChange(next: { on: boolean; lang: string }): void;
    /** Editor only: offer "＋ Add a language…" in the subtitle picker. */
    onAdd?(): void;
    /** A cloud TTS key is present, so Default's label can say so. */
    hasCloudVoice?: boolean;
  };
  /** Called with each item's handle after it mounts (editor lint, title sync). */
  onItemMounted?(hd: RenderHandle, item: PlaylistItem): void;
  /**
   * Start playback the moment the first item (or the title page) mounts,
   * instead of waiting for a click on the poster's Play button. Set when this
   * session is replacing one whose own Play button was just pressed against
   * stale text — see beforePlay in ui/controls.ts.
   */
  autoplay?: boolean;
}

export interface SessionHandle {
  destroy(): void;
}

/**
 * Every narration line the playlist can speak — items, the title page, and
 * chapter cards. Derived from exportSequence, so live playback and video
 * export can never disagree about what needs pre-synthesized speech.
 * Deduped by speechKey: the same text in two voices stays distinct.
 */
export function playlistSpeakLines(playlist: Playlist): SpeakLine[] {
  const seen = new Map<string, SpeakLine>();
  for (const line of exportSequence(playlist).flatMap(collectSpeakLines)) {
    const key = speechKey(line);
    if (!seen.has(key)) seen.set(key, line);
  }
  return [...seen.values()];
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
  const renderOpts = { style: opts.style, speech: opts.speech, mode: opts.mode, speed: opts.speed, questions: opts.questions };

  // ---- subtitles ----------------------------------------------------------
  // One choice for the whole playlist, held here rather than in the control
  // bar: the bar is rebuilt from scratch with every item mount, so anything it
  // owned would be forgotten at the first cut. Offered languages are the ones
  // EVERY item can show (see spec/subtitles.ts) — a language that runs out
  // halfway is worse than one never offered.
  const captionLanguages = subtitleLanguages(items.map((i) => i.spec));
  const cc = {
    on: opts.captions?.on ?? true,
    lang: captionLanguages.some((l) => l.code === opts.captions?.lang)
      ? opts.captions!.lang
      : (captionLanguages[0]?.code ?? ""),
  };

  /** The spec on screen. Cards (title page, chapter card) are synthesized in
   *  the source language and carry no track, so they set this to null. */
  let shownSpec: Spec | null = null;

  // The VOICE is a separate choice from the subtitles, and deliberately not
  // remembered across drawcasts: it names a language and a specific installed
  // voice, so a stale pick would silently override the next drawcast's own
  // narration — including a recording its author baked in.
  let voicePick = "";
  /** Whatever the host configured, so "Default" can put it back. */
  const hostVoice = opts.speech.voice;

  /** Point the figure now on screen at the chosen subtitles, CC state and voice. */
  function applyCaptions(hd: RenderHandle): void {
    hd.timeline.setSubtitles(shownSpec ? subtitleTrack(shownSpec, cc.lang) : undefined);
    host.querySelector(".cs-figure")?.classList.toggle("cs-cc-off", !cc.on);

    const chosen = parseVoiceId(voicePick);
    // An explicit browser voice means the baked recording and the cloud are
    // both not what was asked for; Default puts the whole chain back.
    opts.speech.preferBrowserVoice(chosen !== null);
    opts.speech.setVoice(chosen ? chosen.voiceURI : hostVoice);
    hd.timeline.setSpokenTrack(chosen && shownSpec ? subtitleTrack(shownSpec, chosen.lang) : undefined);
  }

  const captionControls: ControlsOptions["captions"] | undefined =
    captionLanguages.length > 0
      ? {
          languages: captionLanguages,
          onAdd: opts.captions?.onAdd,
          voice: {
            options: () =>
              voiceOptions({
                languages: captionLanguages,
                voices: opts.speech.voices().map((v) => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI })),
                hasBaked: Object.keys(playlist.audio?.lines ?? {}).length > 0,
                hasCloud: opts.captions?.hasCloudVoice === true,
              }),
            get current() {
              return voicePick;
            },
            onPick: (id) => {
              voicePick = id;
              if (handle) applyCaptions(handle);
            },
            onVoicesChanged: (cb) => opts.speech.onVoicesChanged(cb),
          },
          get lang() {
            return cc.lang;
          },
          get on() {
            return cc.on;
          },
          onChange: (next) => {
            cc.on = next.on;
            cc.lang = next.lang;
            // The figure on screen changes language at once — the viewer is
            // looking at a caption when they press the button.
            if (handle) applyCaptions(handle);
            opts.captions?.onChange(next);
          },
        }
      : undefined;

  const controlOpts: ControlsOptions = { ...opts.controls, captions: captionControls };

  // One item: exactly the pre-playlist behavior — no dots, no panel, no cards.
  if (items.length <= 1) {
    if (items.length === 1) {
      const hd = await render(items[0].spec, host, renderOpts);
      handle = hd;
      shownSpec = items[0].spec;
      attachPlayerControls(host, hd, prefs, controlOpts);
      applyCaptions(hd);
      opts.onItemMounted?.(hd, items[0]);
      if (opts.autoplay) void hd.timeline.play();
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
  /**
   * The panel is an absolutely positioned overlay above the control bar, so
   * once it is open it covers the ☰ that opened it — toggling was never a way
   * back out. Three ways out instead: the close button in its own corner,
   * Escape, and a click anywhere outside it.
   */
  function closePanel(): void {
    panel.classList.remove("open");
  }
  panelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("open");
  });
  const onHostClick = (e: MouseEvent): void => {
    if (!panel.classList.contains("open")) return;
    const t = e.target as Node | null;
    if (t && !panel.contains(t) && !panelBtn.contains(t)) closePanel();
  };
  host.addEventListener("click", onHostClick);
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
    const close = h("button", { class: "pl-close", title: "Close (Esc)", "aria-label": "Close the playlist" }, "✕");
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closePanel();
    });
    const head = playlist.meta.title ? [h("div", { class: "pl-panel-title" }, playlist.meta.title)] : [];
    return h("aside", { class: "pl-panel" }, close, ...head, list);
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
    shownSpec = items[i].spec;
    attachPlayerControls(host, hd, prefs, {
      ...controlOpts,
      trailing: [dotsWrap, panelBtn, ...(opts.controls?.trailing ?? [])],
    });
    applyCaptions(hd);
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
    // A semantic zoom IS the transition — it replaces the chapter card.
    const crossing = next.chapter !== items[idx].chapter && !next.spec.zoom_from ? next.chapter : undefined;
    const ac = new AbortController();
    gateAbort = ac;
    await continueGate(next, ac.signal);
    if (destroyed || ac.signal.aborted) return;
    if (playlist.meta.transitions === "auto") {
      // Semantic-zoom exit: push into the named element of THIS scene, then
      // un-draw there — the next figure emerges as the inside of this one.
      if (next.spec.zoom_from && handle) {
        const box = zoomTargetBox(handle, next.spec.zoom_from);
        if (box) await handle.timeline.zoomInto(box, { zoom: ZOOM_EXIT.zoom, ms: ZOOM_EXIT.seconds * 1000 });
        if (destroyed || ac.signal.aborted) return;
      }
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
    // A card is synthesized here, in the playlist's own language, and carries
    // no track — its caption stays as written whatever CC is set to.
    shownSpec = null;
    const hd = await render(card, host, renderOpts);
    if (destroyed) {
      hd.destroy();
      return;
    }
    handle = hd;
    const stage = host.querySelector<HTMLElement>(".cs-stage");
    // The chapter gate wears its own words (C11): "Click to continue ▸" is
    // the authored wait verb's pill — a request to engage — and a boundary
    // that borrowed it made every click stop reading as a request. Under the
    // auto default this gate rarely appears at all; the card holds gap
    // seconds and dissolves.
    if (stage) hd.timeline.inputGate = clickGate(stage, "Next chapter ▸");
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
   * title in and out, then chains into the first item. `autoplay` starts that
   * fade immediately instead of waiting for the click.
   */
  async function mountTitlePage(title: string, autoplay: boolean): Promise<void> {
    if (destroyed) return;
    idx = -1; // before item 0: no dot current, n jumps to the first item
    handle?.destroy();
    handle = null;
    shownSpec = null; // the title page is synthesized too
    const hd = await render(makeTitlePage({ title, subtitle: playlist.meta.subtitle, gap }), host, renderOpts);
    if (destroyed) {
      hd.destroy();
      return;
    }
    handle = hd;
    attachPlayerControls(host, hd, prefs, {
      ...controlOpts,
      trailing: [dotsWrap, panelBtn, ...(opts.controls?.trailing ?? [])],
    });
    applyCaptions(hd);
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
    if (autoplay) void hd.timeline.play();
  }

  const onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (e.key === "Escape" && panel.classList.contains("open")) {
      // Before n/p: while the list is open, Escape means "close this", not
      // "leave the player".
      e.stopPropagation();
      closePanel();
      return;
    }
    if (e.key === "n") void jump(Math.min(idx + 1, items.length - 1));
    else if (e.key === "p") void jump(Math.max(idx - 1, 0));
  };
  document.addEventListener("keydown", onKey);

  if (playlist.meta.title !== undefined) await mountTitlePage(playlist.meta.title, opts.autoplay ?? false);
  else await mountItem(0, opts.autoplay ?? false);

  return {
    destroy: () => {
      destroyed = true;
      cancelPending();
      document.removeEventListener("keydown", onKey);
      host.removeEventListener("click", onHostClick);
      handle?.destroy();
      panel.remove();
      dotsWrap.remove();
      panelBtn.remove();
      host.classList.remove("pl-host");
    },
  };
}
