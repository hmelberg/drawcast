// Client-side video export: replay the drawcast once (real time) while
// painting each frame onto a canvas and mixing pre-synthesized TTS narration
// into the recording — canvas.captureStream + WebAudio destination →
// MediaRecorder → a narrated WebM. The recording is silent (narration flows
// only into the recorder, never the speakers). No servers; audio requires a
// BYOK Google Cloud TTS key (browser speechSynthesis cannot be captured).

import { render, type RenderStyle } from "../render";
import { speechKey, type SpeakLine } from "../render/delivery";
import { subVars } from "../spec/answers";
import { askDemoAt, askDemoDuration, quizDemoAt, quizDemoDuration } from "./demo";
import type { Spec } from "../spec/types";
import type { ExportKeepAlive } from "./keepalive";
import { BufferSpeech, synthesizeAll } from "./tts";
import { WebAudioTones } from "../render/tones";

/** Every distinct narration line in the spec's storyboard, with
 *  speaker/delivery/gender attached, and {var} tokens interpolated with the
 *  asks' defaults — the movie's values — so the audio exists at export time. */
export function collectSpeakLines(spec: Spec): SpeakLine[] {
  const seen = new Map<string, SpeakLine>();
  const vars = new Map<string, string>();
  for (const c of spec.commands ?? []) {
    const push = (text: unknown): void => {
      if (typeof text !== "string" || text.trim().length === 0) return;
      const line: SpeakLine = { text: subVars(text, vars), speaker: c.voice, delivery: c.delivery, gender: spec.voice };
      const key = speechKey(line);
      if (!seen.has(key)) seen.set(key, line);
    };
    const hasSpeak = typeof c.speak === "string" && c.speak.trim().length > 0;
    // The spoken question line mirrors the plan exactly: (intro +) speak-or-
    // question — the bare speak is never voiced on a quiz/ask command.
    const questionLine = (q: { intro?: string; question: string }): string => {
      const base = hasSpeak ? (c.speak as string) : q.question;
      return q.intro ? `${q.intro} ${base}` : base;
    };
    if (!c.quiz && !c.ask) push(c.speak);
    if (c.quiz) {
      // The export's quiz path: the question line, then the reveal — right if
      // present, else the correct choice. The wrong line is never spoken in a
      // movie (auto-reveal answers null).
      push(questionLine(c.quiz));
      push(c.quiz.right ?? c.quiz.choices[c.quiz.correct - 1]);
    }
    if (c.ask) {
      // The export's ask path: the question line, then — check mode only —
      // right-or-answer (the demo always "types" correctly). Collect mode
      // speaks nothing extra; its default feeds later {var} lines instead.
      push(questionLine(c.ask));
      if (c.ask.answer !== undefined) push(c.ask.right ?? c.ask.answer);
      if (c.ask.store) vars.set(c.ask.store.toLowerCase(), c.ask.default ?? "");
    }
  }
  return [...seen.values()];
}

/** Greedy word wrap by measured width; export captions get at most two lines. */
export function wrapCaption(measure: (s: string) => number, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (line && measure(candidate) > maxWidth) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// 720p, paper-colored: title band on top, the 4:3 figure centered, captions
// below. The layout is fixed whether or not a title exists, so parts of a
// playlist never jump.
const W = 1280;
const H = 720;
const FIG_W = 800;
const FIG_H = 600;
const FIG_Y = 42;
const TITLE_BASELINE = 30;
const FPS = 30;
const PAPER = "#f5f1e6";
const INK = "#3d3833";

/** The sketch font as an inline data URI so SVG-as-image frames keep it
 *  (images loaded from SVG cannot fetch external resources). */
let fontStylePromise: Promise<string> | null = null;
function sketchFontStyle(): Promise<string> {
  fontStylePromise ??= (async () => {
    try {
      const css = await (await fetch("https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap")).text();
      const m = /url\((https:[^)]+\.woff2)\)/.exec(css);
      if (!m) return "";
      const buf = new Uint8Array(await (await fetch(m[1])).arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return `<style>@font-face{font-family:'Patrick Hand';src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');}</style>`;
    } catch {
      return ""; // degrade to the fallback font rather than failing the export
    }
  })();
  return fontStylePromise;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A question performance in progress: what the frame painter draws while the
 *  movie "answers" a quiz (hover walk) or an ask (self-typing). */
interface DemoState {
  kind: "quiz" | "ask";
  question: string;
  choices?: string[];
  correct?: number;
  typed?: string;
  t0: number;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number): void {
  ctx.beginPath();
  const c = ctx as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void };
  if (typeof c.roundRect === "function") c.roundRect(x, y, w, hh, r);
  else ctx.rect(x, y, w, hh);
}

/** The DOM card's look, in canvas: paper card, ink border, question on top. */
function paintDemoCard(ctx: CanvasRenderingContext2D, demo: DemoState, elapsed: number): void {
  const rows = demo.kind === "quiz" ? (demo.choices?.length ?? 0) : 1;
  const cardW = 560;
  const pad = 22;
  const qFont = 27;
  const rowH = 46;
  const rowGap = 10;
  ctx.save();
  ctx.textAlign = "left";
  ctx.font = `${qFont}px 'Patrick Hand', 'Segoe Print', cursive`;
  const qLines = wrapCaption((s) => ctx.measureText(s).width, demo.question, cardW - pad * 2).slice(0, 3);
  const qH = qLines.length * (qFont + 6);
  const cardH = pad + qH + 14 + rows * (rowH + rowGap) - rowGap + pad;
  const cx = W / 2 - cardW / 2;
  const cy = FIG_Y + (FIG_H - cardH) / 2;
  ctx.globalAlpha = Math.min(1, elapsed / 400);
  roundedRect(ctx, cx, cy, cardW, cardH, 12);
  ctx.fillStyle = "rgba(255, 253, 246, 0.93)";
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = INK;
  qLines.forEach((line, i) => ctx.fillText(line, cx + pad, cy + pad + (i + 0.8) * (qFont + 6)));
  const rowsTop = cy + pad + qH + 14;
  const rowFont = 24;
  ctx.font = `${rowFont}px 'Patrick Hand', 'Segoe Print', cursive`;
  const textY = (ry: number): number => ry + rowH / 2 + rowFont / 3;
  if (demo.kind === "quiz") {
    const frame = quizDemoAt(elapsed, demo.choices?.length ?? 0, demo.correct ?? 0);
    (demo.choices ?? []).forEach((choice, i) => {
      const ry = rowsTop + i * (rowH + rowGap);
      roundedRect(ctx, cx + pad, ry, cardW - pad * 2, rowH, 8);
      const hovered = frame.hover === i;
      const selected = frame.selected && i === demo.correct;
      ctx.fillStyle = selected ? "rgba(74, 124, 89, 0.12)" : "#fffdf6";
      ctx.fill();
      ctx.strokeStyle = selected ? "#4a7c59" : hovered ? "#b5482e" : "#d8d2c2";
      ctx.lineWidth = selected || hovered ? 2.5 : 1.5;
      ctx.stroke();
      ctx.fillStyle = selected ? "#4a7c59" : INK;
      ctx.fillText(`${i + 1} · ${choice}`, cx + pad + 14, textY(ry));
    });
  } else {
    const frame = askDemoAt(elapsed, demo.typed ?? "");
    roundedRect(ctx, cx + pad, rowsTop, cardW - pad * 2, rowH, 8);
    ctx.fillStyle = "#fffdf6";
    ctx.fill();
    ctx.strokeStyle = frame.done ? "#4a7c59" : "#d8d2c2";
    ctx.lineWidth = frame.done ? 2.5 : 1.5;
    ctx.stroke();
    const shown = (demo.typed ?? "").slice(0, frame.typedChars);
    ctx.fillStyle = frame.done ? "#4a7c59" : INK;
    ctx.fillText(frame.done ? shown : `${shown}|`, cx + pad + 14, textY(rowsTop));
  }
  ctx.restore();
}

async function paintFrame(
  ctx: CanvasRenderingContext2D,
  svgText: string,
  fontStyle: string,
  caption: string,
  title: string,
  demo?: { state: DemoState; elapsed: number },
): Promise<void> {
  // Explicit dimensions: some browsers refuse to draw an SVG image without them.
  let src = svgText.replace("<svg ", `<svg width="${FIG_W}" height="${FIG_H}" `);
  if (fontStyle) src = src.replace(/(<svg[^>]*>)/, `$1${fontStyle}`);
  const url = URL.createObjectURL(new Blob([src], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("could not rasterize a frame"));
      img.src = url;
    });
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    const x = (W - FIG_W) / 2;
    ctx.fillStyle = "#fffefb";
    ctx.fillRect(x, FIG_Y, FIG_W, FIG_H);
    ctx.strokeStyle = "#e5decd";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, FIG_Y, FIG_W, FIG_H);
    ctx.drawImage(img, x, FIG_Y, FIG_W, FIG_H);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    if (title) {
      ctx.font = "30px 'Patrick Hand', 'Segoe Print', cursive";
      ctx.fillText(title, W / 2, TITLE_BASELINE);
    }
    if (caption) {
      ctx.font = "26px 'Patrick Hand', 'Segoe Print', cursive";
      const lines = wrapCaption((s) => ctx.measureText(s).width, caption, W - 200).slice(0, 2);
      lines.forEach((line, i) => ctx.fillText(line, W / 2, FIG_Y + FIG_H + 34 + i * 32));
    }
    if (demo) paintDemoCard(ctx, demo.state, demo.elapsed);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The visibility surface visibilityPauser needs from document. */
export interface VisibilityDoc {
  hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * Pause the recording while the tab is hidden: rAF stops in hidden tabs, so
 * the replay freezes while MediaRecorder would keep recording wall-clock
 * time — the export would be full of frozen stretches. Resume is deferred one
 * frame so the player's rAF loop absorbs the hidden stretch into its `last`
 * timestamp while still paused; resuming synchronously would advance the
 * animation by the whole hidden span in a single tick.
 */
export function visibilityPauser(
  doc: VisibilityDoc,
  hooks: { pause(): void; resume(): void },
  defer: (cb: () => void) => void = (cb) => requestAnimationFrame(() => cb()),
): () => void {
  let paused = false;
  const onChange = (): void => {
    if (doc.hidden) {
      if (!paused) {
        paused = true;
        hooks.pause();
      }
    } else if (paused) {
      defer(() => {
        if (!doc.hidden && paused) {
          paused = false;
          hooks.resume();
        }
      });
    }
  };
  doc.addEventListener("visibilitychange", onChange);
  onChange(); // an export started in a hidden tab must not record frozen frames
  return () => doc.removeEventListener("visibilitychange", onChange);
}

export interface ExportConfig {
  ttsKey: string;
  style: RenderStyle;
  /** Skip quiz/ask questions in the recording too (the viewer preference). */
  questions?: "on" | "skip";
  /** Narration rate (maps to the TTS speakingRate); the animation runs at 1×. */
  rate: number;
}

export interface ExportHooks {
  onStatus(text: string): void;
  /** The recorded canvas; also serves as the live preview. */
  canvas: HTMLCanvasElement;
  /** Offscreen (but laid-out) container the drawcast replays in. */
  workbench: HTMLElement;
  signal: AbortSignal;
  /**
   * When set, the export runs its replay, frame loop, and pacing on this
   * scheduler — which keeps ticking (a Web Worker interval) while the tab is
   * hidden — so the recording continues in the background.
   */
  keepAlive?: ExportKeepAlive;
}

/**
 * Record one or more specs (a single drawcast, or a playlist's items with
 * their title cards) into ONE narrated WebM. The recorder runs continuously
 * while each spec replays in sequence; wait verbs auto-resolve — there is
 * no viewer to click during an export.
 */
export async function exportVideo(items: Spec[], cfg: ExportConfig, hooks: ExportHooks): Promise<Blob> {
  const { canvas, workbench, signal, keepAlive } = hooks;
  // Frame-driven pacing when a keep-alive scheduler is present (hidden tabs
  // throttle setTimeout hard); plain timers otherwise.
  const zzz = (ms: number): Promise<void> => (keepAlive ? keepAlive.sleep(ms) : sleep(ms));
  if (items.length === 0) throw new Error("nothing to export");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D is unavailable");
  const audioCtx = new AudioContext();
  let handle: Awaited<ReturnType<typeof render>> | null = null;
  let stopVisibility: (() => void) | null = null;
  try {
    const buffers = await synthesizeAll(
      { apiKey: cfg.ttsKey, rate: cfg.rate },
      items.flatMap(collectSpeakLines),
      audioCtx,
      (done, total) => hooks.onStatus(`Synthesizing narration ${done}/${total}…`),
      signal,
    );
    const fontStyle = await sketchFontStyle();
    if (signal.aborted) throw new Error("export cancelled");

    const dest = audioCtx.createMediaStreamDestination();
    const speech = new BufferSpeech(audioCtx, dest, buffers);
    // The play command's notes go into the SAME recording destination as the
    // narration: recorded in full, inaudible while exporting (see tones.ts).
    const tones = new WebAudioTones(audioCtx, dest);

    const captureTrack = canvas.captureStream(FPS).getVideoTracks()[0] as Partial<CanvasCaptureMediaStreamTrack> & MediaStreamTrack;
    const stream = new MediaStream([captureTrack, ...dest.stream.getAudioTracks()]);
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5_000_000 } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));

    // The frame loop reads whatever spec is currently mounted.
    let currentSvg: SVGSVGElement | null = null;
    let currentCaption: HTMLElement | null = null;
    let currentTitle = "";
    let currentDemo: DemoState | null = null;
    // Keep the answered card on screen while the feedback line speaks.
    const lingerDemo = (demo: DemoState): void => {
      void zzz(2600).then(() => {
        if (currentDemo === demo) currentDemo = null;
      });
    };
    const serializer = new XMLSerializer();
    let paintError: Error | null = null;
    let stopLoop = false;
    async function runFrameLoop(): Promise<void> {
      while (!stopLoop && !signal.aborted) {
        const t0 = performance.now();
        try {
          if (currentSvg) {
            await paintFrame(
              ctx!,
              serializer.serializeToString(currentSvg),
              fontStyle,
              currentCaption?.textContent ?? "",
              currentTitle,
              currentDemo ? { state: currentDemo, elapsed: performance.now() - currentDemo.t0 } : undefined,
            );
            // Hidden tabs may stop delivering painted frames to the capture
            // stream on their own; asking explicitly keeps the video moving.
            captureTrack.requestFrame?.();
          }
        } catch (err) {
          paintError ??= err as Error;
          stopLoop = true;
        }
        await zzz(Math.max(0, 1000 / FPS - (performance.now() - t0)));
      }
    }
    const frameLoop = runFrameLoop();

    recorder.start(1000);
    // The export runs without a modal, so nothing stops the user from
    // switching tabs mid-recording. With a keep-alive (worker-clock ticks),
    // the recording continues while the tab is hidden and this pauser only
    // fires when the export has no clock left; without one, freeze
    // everything until they return.
    let resumeTarget: Awaited<ReturnType<typeof render>> | null = null;
    stopVisibility = visibilityPauser(keepAlive ?? document, {
      pause: () => {
        // Remember the handle only when its timeline is actually playing:
        // play() on a finished player restarts it from step 0 — hiding the tab
        // during the recording tail must not replay the item into the video.
        resumeTarget = handle?.timeline.state === "playing" ? handle : null;
        handle?.timeline.pause();
        if (recorder.state === "recording") recorder.pause();
        if (audioCtx.state === "running") void audioCtx.suspend();
        hooks.onStatus("Paused — recording continues when this tab is visible again…");
      },
      resume: () => {
        if (audioCtx.state === "suspended") void audioCtx.resume();
        if (recorder.state === "paused") recorder.resume();
        // Only re-play a timeline this pause froze: a handle mounted while the
        // tab was hidden is already playing and must not be started twice.
        if (resumeTarget && resumeTarget === handle) void resumeTarget.timeline.play();
        resumeTarget = null;
        hooks.onStatus("Recording — resumed…");
      },
      // The deferred resume must run on a frame source that actually ticks —
      // e.g. the keep-alive clock attaching while the tab itself is hidden.
    }, keepAlive ? (cb) => keepAlive.raf(() => cb()) : undefined);
    const onAbort = () => handle?.timeline.dispose();
    signal.addEventListener("abort", onAbort);
    try {
      for (let i = 0; i < items.length; i++) {
        if (signal.aborted) break;
        hooks.onStatus(items.length > 1 ? `Recording — playing part ${i + 1}/${items.length}…` : "Recording — playing the drawcast once…");
        handle = await render(items[i], workbench, { style: cfg.style, speech, tones, mode: "narrated", speed: 1, questions: cfg.questions });
        const svg = workbench.querySelector<SVGSVGElement>("svg.cs-svg");
        if (!svg) throw new Error(`nothing to record — spec ${i + 1} rendered no figure`);
        currentSvg = svg;
        currentCaption = workbench.querySelector<HTMLElement>(".cs-caption");
        currentTitle = items[i].title ?? "";
        if (keepAlive) handle.timeline.raf = keepAlive.raf; // replay keeps ticking while the tab is hidden
        handle.timeline.inputGate = (sig) => (sig.aborted ? Promise.resolve() : zzz(600));
        // Movies never wait on an answer: the card performs — the quiz hovers
        // across its options and settles on the correct one; the ask types
        // its answer (or the default) by itself — then the timeline goes on.
        const mounted = handle;
        handle.timeline.quizGate = async (sig, step) => {
          if (sig.aborted) return null;
          const demo: DemoState = {
            kind: "quiz",
            question: subVars(step.question, mounted.timeline.vars),
            choices: step.choices,
            correct: step.correct,
            t0: performance.now(),
          };
          currentDemo = demo;
          await zzz(quizDemoDuration(step.choices.length));
          lingerDemo(demo);
          return null;
        };
        handle.timeline.askGate = async (sig, step) => {
          if (sig.aborted) return null;
          const text = step.answer ?? step.fallback ?? "";
          const demo: DemoState = {
            kind: "ask",
            question: subVars(step.question, mounted.timeline.vars),
            typed: text,
            t0: performance.now(),
          };
          currentDemo = demo;
          await zzz(askDemoDuration(text));
          lingerDemo(demo);
          return text;
        };
        await handle.timeline.play();
        if (i < items.length - 1) {
          await zzz(300); // beat between parts
          currentSvg = null;
          currentCaption = null;
          currentDemo = null;
          handle.destroy();
          handle = null;
        }
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (signal.aborted) throw new Error("export cancelled");
    await zzz(600); // let the last stroke and audio tail land
    stopLoop = true;
    await frameLoop;
    recorder.stop();
    await stopped;
    if (paintError) throw paintError;
    return new Blob(chunks, { type: mime ?? "video/webm" });
  } finally {
    stopVisibility?.();
    handle?.destroy();
    void audioCtx.close();
  }
}
