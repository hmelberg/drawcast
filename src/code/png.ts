// ImageBitmap → PNG data URI with pixel dimensions: what webR's canvas
// device hands back per plot page. Browser-only (a canvas is the encoder);
// the runtime modules that call it already refuse to run without a DOM.

import type { CodeFigure } from "./envelope";

export function bitmapToFigure(bitmap: ImageBitmap): CodeFigure {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas context to encode the plot");
  ctx.drawImage(bitmap, 0, 0);
  return { href: canvas.toDataURL("image/png"), w: bitmap.width, h: bitmap.height };
}
