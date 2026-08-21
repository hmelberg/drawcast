// Client-side video export: replay the drawcast once (real time) while
// painting each frame onto a canvas and mixing pre-synthesized TTS narration
// into the recording — canvas.captureStream + WebAudio destination →
// MediaRecorder → a narrated WebM. No servers; audio requires a BYOK Google
// Cloud TTS key (browser speechSynthesis cannot be captured).

import { render, type RenderStyle } from "../render";
import type { Spec } from "../spec/types";
import { BufferSpeech, synthesizeAll } from "./tts";

/** Every distinct narration line in the spec's storyboard. */
export function collectSpeakTexts(spec: Spec): string[] {
  const texts = (spec.commands ?? [])
    .map((c) => c.speak)
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  return [...new Set(texts)];
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

// 720p, paper-colored, with the 4:3 figure centered and captions below it.
const W = 1280;
const H = 720;
const FIG_W = 840;
const FIG_H = 630;
const FIG_Y = 12;
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

async function paintFrame(ctx: CanvasRenderingContext2D, svgText: string, fontStyle: string, caption: string): Promise<void> {
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
    if (caption) {
      ctx.fillStyle = INK;
      ctx.font = "28px 'Patrick Hand', 'Segoe Print', cursive";
      ctx.textAlign = "center";
      const lines = wrapCaption((s) => ctx.measureText(s).width, caption, W - 200).slice(0, 2);
      lines.forEach((line, i) => ctx.fillText(line, W / 2, FIG_Y + FIG_H + 36 + i * 34));
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface ExportConfig {
  ttsKey: string;
  style: RenderStyle;
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
}

/**
 * Record one or more specs (a single drawcast, or a playlist's items with
 * their title cards) into ONE narrated WebM. The recorder runs continuously
 * while each spec replays in sequence; wait verbs auto-resolve — there is
 * no viewer to click during an export.
 */
export async function exportVideo(items: Spec[], cfg: ExportConfig, hooks: ExportHooks): Promise<Blob> {
  const { canvas, workbench, signal } = hooks;
  if (items.length === 0) throw new Error("nothing to export");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D is unavailable");
  const audioCtx = new AudioContext();
  let handle: Awaited<ReturnType<typeof render>> | null = null;
  try {
    const buffers = await synthesizeAll(
      { apiKey: cfg.ttsKey, rate: cfg.rate },
      [...new Set(items.flatMap(collectSpeakTexts))],
      audioCtx,
      (done, total) => hooks.onStatus(`Synthesizing narration ${done}/${total}…`),
      signal,
    );
    const fontStyle = await sketchFontStyle();
    if (signal.aborted) throw new Error("export cancelled");

    const dest = audioCtx.createMediaStreamDestination();
    const speech = new BufferSpeech(audioCtx, dest, buffers);

    const stream = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
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
    const serializer = new XMLSerializer();
    let paintError: Error | null = null;
    let stopLoop = false;
    async function runFrameLoop(): Promise<void> {
      while (!stopLoop && !signal.aborted) {
        const t0 = performance.now();
        try {
          if (currentSvg) await paintFrame(ctx!, serializer.serializeToString(currentSvg), fontStyle, currentCaption?.textContent ?? "");
        } catch (err) {
          paintError ??= err as Error;
          stopLoop = true;
        }
        await sleep(Math.max(0, 1000 / FPS - (performance.now() - t0)));
      }
    }
    const frameLoop = runFrameLoop();

    recorder.start(1000);
    const onAbort = () => handle?.timeline.dispose();
    signal.addEventListener("abort", onAbort);
    try {
      for (let i = 0; i < items.length; i++) {
        if (signal.aborted) break;
        hooks.onStatus(items.length > 1 ? `Recording — playing part ${i + 1}/${items.length}…` : "Recording — playing the drawcast once…");
        handle = await render(items[i], workbench, { style: cfg.style, speech, mode: "narrated", speed: 1 });
        const svg = workbench.querySelector<SVGSVGElement>("svg.cs-svg");
        if (!svg) throw new Error(`nothing to record — spec ${i + 1} rendered no figure`);
        currentSvg = svg;
        currentCaption = workbench.querySelector<HTMLElement>(".cs-caption");
        handle.timeline.inputGate = (sig) => (sig.aborted ? Promise.resolve() : sleep(600));
        await handle.timeline.play();
        if (i < items.length - 1) {
          await sleep(300); // beat between parts
          currentSvg = null;
          currentCaption = null;
          handle.destroy();
          handle = null;
        }
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (signal.aborted) throw new Error("export cancelled");
    await sleep(600); // let the last stroke and audio tail land
    stopLoop = true;
    await frameLoop;
    recorder.stop();
    await stopped;
    if (paintError) throw paintError;
    return new Blob(chunks, { type: mime ?? "video/webm" });
  } finally {
    handle?.destroy();
    void audioCtx.close();
  }
}
