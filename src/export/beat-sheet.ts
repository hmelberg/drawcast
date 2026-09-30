// The look pass's eyes (src/llm/look.ts): render a spec off-screen and lay
// out one frame per spoken line — what the viewer sees while that line is
// said — on contact sheets, each frame with its line under it. JPEG, so a
// sheet of eight frames stays a small image for the critic. Browser-only: a
// no-DOM environment gets null, the same guard snapshot.ts uses.

import { render } from "../render";
import type { Spec } from "../spec/types";
import type { LookImage } from "../llm/look";
import { sketchFontStyle } from "./video";
import { placeholdLinkedPictures } from "./linked-pictures";

const COLS = 2;
const ROWS = 4;
const CELL_W = 480;
const FIG_H = 360;
const CAP_H = 58;
const PAD = 16;
/** At most this many sheets (eight frames each) — a long cast keeps its first 48 lines' frames. */
const MAX_SHEETS = 6;

function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = next;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, "…");
  return lines;
}

async function svgImage(svgText: string, fontStyle: string): Promise<HTMLImageElement> {
  let src = placeholdLinkedPictures(svgText).replace("<svg ", `<svg width="${CELL_W}" height="${FIG_H}" `);
  if (fontStyle) src = src.replace(/(<svg[^>]*>)/, `$1${fontStyle}`);
  const url = URL.createObjectURL(new Blob([src], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("could not rasterize a frame"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function beatSheets(spec: Spec): Promise<LookImage[] | null> {
  if (typeof document === "undefined") return null;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px";
  document.body.appendChild(host);
  try {
    const hd = await render(spec, host, { mode: "silent" });
    try {
      const steps = hd.plan.steps as { kind: string; text?: string; narration?: string }[];
      let beats = steps.map((s, i) => ({ at: i + 1, line: (s.kind === "speak" ? s.text : s.narration) ?? "" })).filter((b) => b.line);
      if (beats.length === 0) beats = [{ at: steps.length, line: "" }];
      beats = beats.slice(0, COLS * ROWS * MAX_SHEETS);
      const fontStyle = await sketchFontStyle();
      const sheets: LookImage[] = [];
      for (let start = 0; start < beats.length; start += COLS * ROWS) {
        const chunk = beats.slice(start, start + COLS * ROWS);
        const rows = Math.ceil(chunk.length / COLS);
        const canvas = document.createElement("canvas");
        canvas.width = COLS * CELL_W + (COLS + 1) * PAD;
        canvas.height = rows * (FIG_H + CAP_H) + (rows + 1) * PAD;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let k = 0; k < chunk.length; k++) {
          const { at, line } = chunk[k];
          hd.timeline.renderUpTo(at);
          const svg = host.querySelector<SVGSVGElement>("svg.cs-svg");
          if (!svg) continue;
          const x = PAD + (k % COLS) * (CELL_W + PAD);
          const y = PAD + Math.floor(k / COLS) * (FIG_H + CAP_H + PAD);
          ctx.drawImage(await svgImage(new XMLSerializer().serializeToString(svg), fontStyle), x, y, CELL_W, FIG_H);
          ctx.strokeStyle = "#d8d2c6";
          ctx.strokeRect(x, y, CELL_W, FIG_H);
          ctx.fillStyle = "#2b2724";
          ctx.font = "16px system-ui, sans-serif";
          wrapLines(ctx, `${start + k + 1}. ${line}`, CELL_W - 8, 3).forEach((l, n) => ctx.fillText(l, x + 4, y + FIG_H + 18 + n * 18));
        }
        sheets.push({ mediaType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.8).replace(/^data:image\/jpeg;base64,/, "") });
      }
      return sheets;
    } finally {
      hd.destroy();
    }
  } catch {
    return null;
  } finally {
    host.remove();
  }
}
