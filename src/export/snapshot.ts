// Visual repair's eyes (freehand-figures Task 14): render a spec's last
// frame off-screen and hand back a PNG data URL, so the compile round can
// show the model exactly what the viewer would see. Browser-only — a no-DOM
// environment (vitest's node environment, a future server-side compile) gets
// null back rather than a fabricated image, the same "no DOM, no side
// effect" guard render/index.ts's ensureFonts uses.

import { render } from "../render";
import type { Spec } from "../spec/types";
import { paintFrame, sketchFontStyle } from "./video";

export async function snapshotPng(spec: Spec): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px";
  document.body.appendChild(host);
  try {
    const hd = await render(spec, host, { mode: "silent" });
    try {
      hd.timeline.renderUpTo(hd.plan.steps.length);
      const svg = host.querySelector<SVGSVGElement>("svg.cs-svg");
      if (!svg) return null;
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      await paintFrame(canvas.getContext("2d")!, new XMLSerializer().serializeToString(svg), await sketchFontStyle(), "");
      return canvas.toDataURL("image/png");
    } finally {
      hd.destroy();
    }
  } finally {
    host.remove();
  }
}

/** The poster's size: the stage's own 4:3, at a width a phone or a laptop
 *  shows sharp without the file growing past ~100 KB for a line drawing. */
export const POSTER_W = 1000;
export const POSTER_H = 750;

/**
 * The published cast's poster (2026-09-24): the FINISHED drawing — exactly
 * what the player's first page shows (timeline.showPoster: everything drawn,
 * the whole page in view) — as PNG bytes. The viewer shows it the moment the
 * page opens, while the cast itself is still arriving. Null without a DOM or
 * when anything fails: a publish without a poster is still a publish.
 */
export async function posterPng(spec: Spec): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null;
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${POSTER_W}px;height:${POSTER_H}px`;
  document.body.appendChild(host);
  try {
    const hd = await render(spec, host, { mode: "silent" });
    try {
      hd.timeline.showPoster();
      const svg = host.querySelector<SVGSVGElement>("svg.cs-svg");
      if (!svg) return null;
      let src = new XMLSerializer().serializeToString(svg).replace("<svg ", `<svg width="${POSTER_W}" height="${POSTER_H}" `);
      const fontStyle = await sketchFontStyle();
      if (fontStyle) src = src.replace(/(<svg[^>]*>)/, `$1${fontStyle}`);
      return await rasterize(src, "image/svg+xml");
    } finally {
      hd.destroy();
    }
  } catch {
    return null;
  } finally {
    host.remove();
  }
}

/**
 * An author's own poster image (the `poster:` meta field — a URL or a data
 * URL), re-encoded to a PNG of the poster's size so the published file is
 * always what the viewer expects. Null when it cannot be fetched (CORS, 404):
 * the drawn poster is used instead.
 */
export async function authorPosterPng(url: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await rasterize(blob);
  } catch {
    return null;
  }
}

/** Draw an image (svg text, or an image blob) onto paper, contained and centred. */
async function rasterize(src: string | Blob, type = ""): Promise<Uint8Array | null> {
  const url = URL.createObjectURL(typeof src === "string" ? new Blob([src], { type }) : src);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("could not rasterize the poster"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = POSTER_W;
    canvas.height = POSTER_H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fffefb";
    ctx.fillRect(0, 0, POSTER_W, POSTER_H);
    const iw = img.naturalWidth || POSTER_W, ih = img.naturalHeight || POSTER_H;
    const k = Math.min(POSTER_W / iw, POSTER_H / ih);
    ctx.drawImage(img, (POSTER_W - iw * k) / 2, (POSTER_H - ih * k) / 2, iw * k, ih * k);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return out ? new Uint8Array(await out.arrayBuffer()) : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
