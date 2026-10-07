// A poster with its paper made see-through, in the browser (2026-10-07):
// netlify/lib/paper-key.mts through a canvas, so a thumbnail's background
// shows behind the poster as it does in the server's /card picture.

import { keyPaper } from "../../netlify/lib/paper-key.mts";

/** `src` (a poster) as a PNG data: URL with see-through paper; `src` itself when it cannot be read (another site's image without CORS). */
export async function seeThroughUrl(src: string): Promise<string> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return src;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    keyPaper(data.data, c.width, c.height);
    ctx.putImageData(data, 0, 0);
    return c.toDataURL("image/png");
  } catch {
    return src;
  }
}
