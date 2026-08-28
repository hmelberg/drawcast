// The portrait trace codec: compact strings for traced artwork. Two shape
// grammars share one format:
//   "line"  — open polyline strokes (the pen).
//   "fill"  — closed regions filled solid ink (the poster/stencil look —
//             the chess-piece idiom).
//   "wash"  — closed regions shaded at region opacity (the mid-tone).
//   "paper" — closed regions filled paper color, drawn last (holes: eyes,
//             teeth, highlights inside dark regions).
//   "dot"   — one halftone dot: two points, the center and a radius
//             carrier at [cx + r, cy] (the newspaper-print look).
//
// The photo looks share the file: `img1:` (a framed grayscale photo) and
// `img2:` (a source page — the same photo plus quote-highlight rects).
//
// Wire format: `t2:<2-char aspect>:<shape>.<shape>...` where each shape is
// one kind char (l/i/m/p) followed by 4 chars per point (12-bit x then
// 12-bit y, high 6 bits first, base64url alphabet). Aspect = height/width,
// stored as round(aspect*500) in 12 bits. Coordinates are normalized:
// x in [0,1], y in [0, aspect], y-UP. Legacy "t1:" (no kind chars, all
// lines) still decodes.

export interface TraceShape {
  /** dot: exactly two points — the center and a radius carrier at [cx + r, cy]. */
  kind: "line" | "fill" | "wash" | "paper" | "dot";
  pts: [number, number][];
}

export interface PortraitTrace {
  /** Height / width of the traced image. */
  aspect: number;
  shapes: TraceShape[];
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CHAR_TO_VAL = new Map([...ALPHABET].map((c, i) => [c, i] as const));
const GRID = 4095;

const KIND_CHAR: Record<TraceShape["kind"], string> = { line: "l", fill: "i", wash: "m", paper: "p", dot: "d" };
const CHAR_KIND: Record<string, TraceShape["kind"]> = { l: "line", i: "fill", m: "wash", p: "paper", d: "dot" };

function enc12(v: number): string {
  const n = Math.max(0, Math.min(GRID, Math.round(v)));
  return ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
}

function dec12(s: string, i: number): number | null {
  const hi = CHAR_TO_VAL.get(s[i]);
  const lo = CHAR_TO_VAL.get(s[i + 1]);
  if (hi === undefined || lo === undefined) return null;
  return (hi << 6) | lo;
}

export function encodeTrace(t: PortraitTrace): string {
  const aspect = Number.isFinite(t.aspect) && t.aspect > 0 ? t.aspect : 1;
  const parts: string[] = [];
  for (const shape of t.shapes) {
    if (shape.pts.length < 2) continue;
    let out = KIND_CHAR[shape.kind] ?? "l";
    for (const [x, y] of shape.pts) {
      out += enc12((x / 1) * GRID) + enc12((y / aspect) * GRID);
    }
    parts.push(out);
  }
  return `t2:${enc12(Math.min(8, aspect) * 500)}:${parts.join(".")}`;
}

/** The photo look's wire form: `img1:<2-char aspect>:<data URI>`. */
export function encodePhoto(aspect: number, href: string): string {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return `img1:${enc12(Math.min(8, a) * 500)}:${href}`;
}

export function decodePhoto(s: string): { aspect: number; href: string } | null {
  if (typeof s !== "string" || !s.startsWith("img1:")) return null;
  const body = s.slice(5);
  if (body[2] !== ":") return null;
  const aspectRaw = dec12(body, 0);
  if (aspectRaw === null) return null;
  const href = body.slice(3);
  if (!href.startsWith("data:image/")) return null;
  return { aspect: Math.max(0.05, aspectRaw / 500), href };
}

/** A highlight rectangle over a source page: [x, y, w, h], lower-left origin. */
export type PhotoRect = [number, number, number, number];

/**
 * The SOURCE element's wire form: a photo PLUS the quote-highlight rectangles
 * the PDF text layer produced — `img2:<2-char aspect>:<rects>:<data URI>`.
 * Each rect is 8 chars (x, y, w, h; 12 bits each, the alphabet above),
 * normalized exactly like trace points: x/w as fractions of the image WIDTH,
 * y/h in [0, aspect], y-UP, (x, y) = the lower-left corner.
 *
 * Rects ride WITH the photo so one cached value carries the whole resolution:
 * the text layer is parsed once per browser, not once per play, and a pinned
 * spec keeps its highlights. `img1:` (a plain portrait photo) decodes here too,
 * with no rects — a photo pinned onto a source element still renders.
 */
export function encodeSourceImage(aspect: number, href: string, rects: readonly PhotoRect[] = []): string {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const body = rects
    .map(([x, y, w, h]) => enc12(x * GRID) + enc12((y / a) * GRID) + enc12(w * GRID) + enc12((h / a) * GRID))
    .join("");
  return `img2:${enc12(Math.min(8, a) * 500)}:${body}:${href}`;
}

export function decodeSourceImage(s: string): { aspect: number; href: string; rects: PhotoRect[] } | null {
  if (typeof s !== "string") return null;
  if (s.startsWith("img1:")) {
    const photo = decodePhoto(s);
    return photo && { ...photo, rects: [] };
  }
  if (!s.startsWith("img2:")) return null;
  const body = s.slice(5);
  if (body[2] !== ":") return null;
  const aspectRaw = dec12(body, 0);
  if (aspectRaw === null) return null;
  const aspect = Math.max(0.05, aspectRaw / 500);
  const sep = body.indexOf(":", 3);
  if (sep < 0) return null;
  const coords = body.slice(3, sep);
  if (coords.length % 8 !== 0) return null;
  const rects: PhotoRect[] = [];
  for (let i = 0; i < coords.length; i += 8) {
    const q = [dec12(coords, i), dec12(coords, i + 2), dec12(coords, i + 4), dec12(coords, i + 6)];
    if (q.some((v) => v === null)) return null;
    const [x, y, w, h] = q as number[];
    rects.push([x / GRID, (y / GRID) * aspect, w / GRID, (h / GRID) * aspect]);
  }
  const href = body.slice(sep + 1);
  if (!href.startsWith("data:image/")) return null;
  return { aspect, href, rects };
}

export function decodeTrace(s: string): PortraitTrace | null {
  if (typeof s !== "string") return null;
  const v2 = s.startsWith("t2:");
  const v1 = s.startsWith("t1:");
  if (!v1 && !v2) return null;
  const body = s.slice(3);
  const sep = body.indexOf(":");
  if (sep !== 2) return null;
  const aspectRaw = dec12(body, 0);
  if (aspectRaw === null) return null;
  const aspect = Math.max(0.05, aspectRaw / 500);
  const payload = body.slice(3);
  const shapes: TraceShape[] = [];
  if (payload !== "") {
    for (const seg of payload.split(".")) {
      let kind: TraceShape["kind"] = "line";
      let coords = seg;
      if (v2) {
        const k = CHAR_KIND[seg[0]];
        if (!k) return null;
        kind = k;
        coords = seg.slice(1);
      }
      if (coords.length === 0 || coords.length % 4 !== 0) return null;
      const pts: [number, number][] = [];
      for (let i = 0; i < coords.length; i += 4) {
        const xq = dec12(coords, i);
        const yq = dec12(coords, i + 2);
        if (xq === null || yq === null) return null;
        pts.push([xq / GRID, (yq / GRID) * aspect]);
      }
      if (pts.length >= 2) shapes.push({ kind, pts });
    }
  }
  return { aspect, shapes };
}
