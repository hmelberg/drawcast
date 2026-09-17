// Playlist playback: a thin sequence controller above the unchanged renderer.
// Each item is a fresh render (its own template, domain, ids), but the cut is
// softened: the finished drawing stays up until the viewer continues, then
// un-draws itself (fadeOutAll). Cards — the opening title page and the
// chapter card where a new chapter begins — are synthesized specs played
// through the same renderer so they show up in live playback, the #gdoc
// viewer and video export alike. Navigation: chapter-tree panel (native
// <details> for collapse), per-item dots in the control bar, and n/p keys.

import { render, type RenderHandle, type RenderStyle } from "../render";
import type { TextOverride } from "../layout/text-style";
import { speechKey, type SpeakLine } from "../render/delivery";
import type { AnswerEvent, PlaybackMode, PlayerState } from "../render/player";
import type { SpeechManager } from "../render/speech";
import { attachPlayerControls, clickGate, type ControlsOptions, type PlaybackPrefs } from "../ui/controls";
import { h } from "../ui/dom";
import { collectSpeakLines } from "../export/video";
import { AnswerCarry, questionOffsets } from "./carry";
import { ItemTimer, type ItemView } from "./item-timer";
import { exportSequence, itemsOf, itemTitle, makeChapterCard, makeTitlePage, ZOOM_EXIT, type Playlist, type PlaylistItem } from "./playlist";
import { subtitleLanguages, subtitleTrack } from "../spec/subtitles";
import { parseCloudVoiceId, parseVoiceId, voiceOptions } from "../render/voices";
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

/** The hand-in poster button's state (spec 2026-09-16-course-progress §4). */
export interface HandInState {
  /** ISO time this account handed in, when it did — the button then reads "Handed in ✓". */
  handedAt?: string;
  /** The run's due date, shown in the button's title. */
  due?: string;
  /** Press: sweep the outbox, send handed_in; resolves the hand-in time, or null when it did not go through. */
  press: () => Promise<string | null>;
}

export interface SessionOptions {
  style: RenderStyle;
  /** The viewer's text override; absent = the spec's defaults (render/index.ts). */
  text?: TextOverride;
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
    /** Cloud catalog for the quick pick (B12); empty until the host fetched it. */
    cloudVoices?(): { lang: string; name: string }[];
    /** The durable per-language preference, to mark the current pick. */
    cloudPicked?(): Record<string, string>;
    /** A cloud voice was picked in the bar: save the preference, speak a sample. */
    onCloudVoice?(lang: string, name: string): void;
  };
  /** Called with each item's handle after it mounts (editor lint, title sync). */
  onItemMounted?(hd: RenderHandle, item: PlaylistItem): void;
  /** A live viewer answered a quiz/ask in the current item (spec §4). The
   *  item's index travels with it because AnswerEvent.index counts plan
   *  steps WITHIN one item — a lecture's parts each restart it, so only the
   *  pair (item, step) names a question across the whole playlist. */
  onAnswer?(answer: AnswerEvent, item: PlaylistItem, index: number): void;
  /** The LAST item finished — once per mount, whether or not meta.next is set.
   *  Fires from either mount path: the single-drawcast lecture (the common
   *  case) as well as a multi-item playlist. */
  onDone?(): void;
  /** One view of one item ended (spec 2026-09-16-course-progress §2): an
   *  item change, a jump, the tab hiding, the page leaving, or destroy.
   *  Seconds visible and playing, and whether it reached done. */
  onItem?(view: ItemView): void;
  /**
   * The hand-in state for this playlist, asked for when the LAST item
   * reaches done (spec §4): null = the run asks for no hand-in, so no
   * button. Read lazily because the answer arrives from the server after
   * the mount.
   */
  handIn?: () => HandInState | null;
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
  // The same carry the movie plays with: a {name} stored in part 1 is spoken
  // in part 3 as the default the export types, so the baked line matches.
  const seq = exportSequence(playlist);
  const offsets = questionOffsets(seq);
  const vars = new Map<string, string>();
  for (const line of seq.flatMap((spec, i) => collectSpeakLines(spec, { vars, questionOffset: offsets[i] }))) {
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
  // Guards opts.onDone: it must fire once for the whole mount, even though a
  // single-drawcast playlist mounts its one item on a path that returns
  // before the multi-item state below (idx, dots, panel) is ever set up.
  let doneReported = false;

  const prefs: PlaybackPrefs = {
    ...opts.prefs,
    onMode: (m) => {
      modeRef = m;
      opts.prefs.onMode?.(m);
    },
  };
  const renderOpts = { style: opts.style, text: opts.text, speech: opts.speech, mode: opts.mode, speed: opts.speed, questions: opts.questions, siblings: items.map((it) => it.spec) };
  // Stored answers survive the cut between items (spec 2026-09-15-stored-
  // answers): every ITEM render is seeded from the carry and its static
  // question offset; cards (title, chapter) render plain. Absorbed back on
  // every answer and at "done" (a collect ask fires no answer event).
  const carry = new AnswerCarry();
  const offsets = questionOffsets(items.map((it) => it.spec));

  // ---- item views (spec 2026-09-16-course-progress §2) ---------------------
  // One timer for the session: a view opens when an item mounts and closes
  // on every figure swap (items and cards alike), on hide, on the page
  // leaving and on destroy — each close is one onItem call. A return from
  // hidden reopens a view for the same item, so the teacher sums per item.
  const timer = new ItemTimer();
  function flushItemView(): void {
    const view = timer.close();
    if (view) opts.onItem?.(view);
  }
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      flushItemView();
      timer.setVisible(false);
    } else {
      timer.setVisible(true);
      const cur = timer.current();
      if (!cur && handle && !destroyed) timer.start(idx, itemTitle(items[idx]));
    }
  };
  const onPageHide = (): void => flushItemView();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  function removeItemListeners(): void {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
  }

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
                cloud: opts.captions?.cloudVoices?.() ?? [],
                cloudPicked: opts.captions?.cloudPicked?.() ?? {},
              }),
            get current() {
              return voicePick;
            },
            onPick: (id) => {
              // A cloud pick sets the durable per-language preference and
              // never becomes a per-session voice: the default chain (baked →
              // cloud → browser) stays the played path, now wearing the
              // preferred voice (B12).
              const cloudPick = parseCloudVoiceId(id);
              if (cloudPick) {
                opts.captions?.onCloudVoice?.(cloudPick.lang, cloudPick.name);
                // A per-session browser voice would keep preferBrowserVoice in
                // force and the new preference would be inaudible (final
                // review 2026-09-02): the pick puts the DEFAULT chain back,
                // which is the path the preference now colors.
                voicePick = "";
                if (handle) applyCaptions(handle);
                return;
              }
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
      const hd = await render(items[0].spec, host, { ...renderOpts, vars: carry.vars, questionOffset: offsets[0] });
      handle = hd;
      shownSpec = items[0].spec;
      attachPlayerControls(host, hd, prefs, controlOpts);
      applyCaptions(hd);
      // Chain here too (see chainCallbacks): a single-drawcast playlist is a
      // lecture's normal shape, so onAnswer/onDone must still reach the host.
      // onItemDone/showNextLink are the multi-item "next" affordance and stay
      // no-ops here (guarded by items.length in their own bodies).
      chainCallbacks(hd, 0);
      timer.start(0, itemTitle(items[0]));
      opts.onItemMounted?.(hd, items[0]);
      if (opts.autoplay) void hd.timeline.play();
    }
    return {
      destroy: () => {
        destroyed = true;
        flushItemView();
        removeItemListeners();
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

  // An inset's modal asks to go to the page it shows (ui/inset-modal.ts).
  host.addEventListener("cs-goto-item", (e) => {
    const index = (e as CustomEvent<{ index: number }>).detail?.index;
    if (typeof index === "number" && index >= 0 && index < items.length && index !== idx) void jump(index);
  });

  /**
   * Replace the figure on screen with a freshly rendered one without the box
   * collapsing in between. destroy() removes the old figure at once, and
   * render() takes a moment (fonts, portraits, layout) before it appends the
   * new one; in that gap a content-sized host is its padding and border — a
   * 16 px strip — so the page jumped twice at every item change, mid-playback
   * (player round). The host keeps its height across the swap; the hold
   * lifts the moment the new figure is in, and the box settles to it.
   */
  async function swapFigure(make: () => Promise<RenderHandle>): Promise<RenderHandle> {
    const held = host.offsetHeight;
    if (held > 0) host.style.minHeight = `${held}px`;
    flushItemView();
    handle?.destroy();
    handle = null;
    try {
      return await make();
    } finally {
      host.style.minHeight = "";
    }
  }

  /** Whether "done" on item i is a cut to the next item rather than the end
   *  of the drawcast — the case the big replay button must not flash for. */
  function chainsOn(i: number): boolean {
    return items.length > 1 && i < items.length - 1 && modeRef !== "instant";
  }

  /** Hide the big replay button for a "done" that continues (styles.css
   *  .cs-chaining). The class lives on the stage, so the next mount starts
   *  clean; a state other than done — a scrub back — takes it off. */
  function markChaining(s: PlayerState, chaining: boolean): void {
    host.querySelector(".cs-stage")?.classList.toggle("cs-chaining", s === "done" && chaining);
  }

  async function mountItem(i: number, autoplay: boolean): Promise<void> {
    if (destroyed) return;
    idx = i;
    const hd = await swapFigure(() => render(items[i].spec, host, { ...renderOpts, vars: carry.vars, questionOffset: offsets[i] }));
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
    chainCallbacks(hd, i);
    timer.start(i, itemTitle(items[i]));
    opts.onItemMounted?.(hd, items[i]);
    markCurrent();
    if (autoplay) void hd.timeline.play();
  }

  /** Wires a mounted item's timeline callbacks after the controls install
   *  their own (see the AFTER comment above): forwards onStep untouched,
   *  forwards onAnswer to the host with the item and its index attached,
   *  and on the LAST item's "done" fires opts.onDone once for the whole
   *  mount. Shared by both mount paths — the single-drawcast branch above
   *  (i is always 0 there) and mountItem — so onAnswer/onDone reach the
   *  host either way. */
  function chainCallbacks(hd: RenderHandle, i: number): void {
    const prev = hd.timeline.callbacks;
    hd.timeline.callbacks = {
      onState: (s) => {
        prev.onState?.(s);
        timer.setPlaying(s === "playing");
        if (s === "done") timer.markDone();
        // Between items "done" is a cut, not the end: the replay button used
        // to flash at every chapter boundary of a lecture (player round).
        markChaining(s, chainsOn(i));
        if (s === "done") {
          carry.absorb(hd.timeline.vars);
          void onItemDone();
          showNextLink();
          if (i === items.length - 1) showHandIn();
          if (i === items.length - 1 && !doneReported) {
            doneReported = true;
            opts.onDone?.();
          }
        } else {
          host.querySelector(".cs-nextlink")?.remove();
          host.querySelector(".cs-handin")?.remove();
        }
      },
      onStep: prev.onStep,
      onAnswer: (a) => {
        prev.onAnswer?.(a);
        opts.onAnswer?.(a, items[i], i);
        carry.absorb(hd.timeline.vars);
      },
    };
  }

  /** The clickable half of the drawn "Next" card: when the LAST item finishes
   *  and the published copy names its successor (meta.next, written by
   *  publishCourse), a real link rides the poster — one click to the next
   *  lecture. A plain hash change would not remount the viewer, hence the
   *  reload; modified clicks keep real-anchor semantics (new tab). */
  function showNextLink(): void {
    // A single-drawcast playlist has no "next item" chaining (no idx, no
    // dots) — that affordance is multi-item only, and stays absent here.
    if (items.length <= 1) return;
    const nx = playlist.meta.next;
    if (!nx || idx < items.length - 1) return;
    const stage = host.querySelector<HTMLElement>(".cs-stage");
    if (!stage || stage.querySelector(".cs-nextlink")) return;
    const a = h("a", { class: "cs-nextlink", href: nx.href, title: `Next lecture: ${nx.title}` }, `Next: ${nx.title} ▸`);
    a.addEventListener("click", (e) => {
      e.stopPropagation(); // never also the stage's play/pause toggle
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      location.href = nx.href;
      location.reload();
    });
    stage.appendChild(a);
  }

  /**
   * The hand-in button on the LAST item's poster (spec 2026-09-16-course-
   * progress §4) — only when the run asks for it: opts.handIn answers null
   * otherwise, and for every playlist without a course. Unlike showNextLink
   * this is not multi-item only: a one-lecture course can ask for a hand-in.
   */
  function showHandIn(): void {
    const state = opts.handIn?.();
    if (!state) return;
    const stage = host.querySelector<HTMLElement>(".cs-stage");
    if (!stage || stage.querySelector(".cs-handin")) return;
    const label = (at: string | undefined): string => (at ? `Handed in ✓ ${new Date(at).toLocaleString()}` : "Hand in");
    const btn = h("button", { class: "cs-handin", title: state.due ? `Due ${state.due}` : "Hand in your answers to the course" }, label(state.handedAt)) as HTMLButtonElement;
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // never also the stage's play/pause toggle
      btn.disabled = true;
      void state.press().then((at) => {
        btn.disabled = false;
        if (at) {
          state.handedAt = at;
          btn.textContent = label(at);
        } else {
          btn.textContent = "Could not hand in — try again";
        }
      });
    });
    stage.appendChild(btn);
  }

  /** The between-items gate: a gap timer on auto, otherwise the continue pill on the finished drawing. */
  function continueGate(next: PlaylistItem, signal: AbortSignal): Promise<void> {
    if (advance === "auto") return delay(gap * 1000, signal);
    const stage = host.querySelector<HTMLElement>(".cs-stage");
    if (!stage) return Promise.resolve();
    return clickGate(stage, `Click to go on to ${itemTitle(next)} ▸`)(signal);
  }

  async function onItemDone(): Promise<void> {
    // A single-drawcast playlist has no next item to chain into (idx is
    // never even set up on that path) — same no-op boundary as showNextLink.
    if (items.length <= 1) return;
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
    const card = makeChapterCard({ chapter: crossing, next: itemTitle(next), gate: advance, gap });
    // A card is synthesized here, in the playlist's own language, and carries
    // no track — its caption stays as written whatever CC is set to.
    shownSpec = null;
    const hd = await swapFigure(() => render(card, host, renderOpts));
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
    shownSpec = null; // the title page is synthesized too
    const hd = await swapFigure(() => render(makeTitlePage({ title, subtitle: playlist.meta.subtitle, gap }), host, renderOpts));
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
        // The cover's "done" is the cut into the first item — no replay flash.
        markChaining(s, modeRef !== "instant");
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
      flushItemView();
      removeItemListeners();
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
