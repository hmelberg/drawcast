// Compact string codec for portrait traces — photos of historical figures
// converted to polyline strokes and shipped inside a spec as one short
// string. Pure (no imports), so both the tracer and the renderer can share
// it without dragging in DOM types.
//
// Format ("t1"):
//   t1:<AA>:<stroke>.<stroke>...
// - Alphabet: the 64 chars "A..Za..z0..9-_" (base64url order); every encoded
//   value is 2 chars = 12 bits (first char = high 6 bits, second = low 6).
// - <AA> is round(aspect * 500) clamped 0..4095, so aspects up to 8.19 fit
//   with ~0.002 resolution (a non-finite or <= 0 aspect is treated as 1).
// - Coordinates are quantized to a 0..4095 grid: x_q = round(x * 4095),
//   y_q = round(y / aspect * 4095), both clamped. Each point is 4 chars
//   (x then y); strokes are joined by ".".
// - decodeTrace reconstructs x = x_q / 4095, y = (y_q / 4095) * aspect, so
//   decode(encode(t)) matches t within quantization error (1/4095 in x,
//   aspect/4095 in y). Anything malformed — wrong prefix, bad chars, odd
//   lengths, empty input — decodes to null; strokes with < 2 points are
//   skipped on both sides.

export interface PortraitTrace {
  /** Height / width of the traced image. */
  aspect: number;
  /** Polylines; x in [0, 1], y in [0, aspect], y-UP (0 = bottom). */
  strokes: [number, number][][];
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** char -> 0..63, built once from the alphabet. */
const CHAR_VALUE: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) CHAR_VALUE[ALPHABET[i]] = i;

/** One 12-bit value -> 2 alphabet chars (high 6 bits first). */
function enc12(v: number): string {
  return ALPHABET[(v >> 6) & 63] + ALPHABET[v & 63];
}

/** 2 alphabet chars at s[i], s[i+1] -> 12-bit value, or null on a bad char. */
function dec12(s: string, i: number): number | null {
  const hi = CHAR_VALUE[s[i]];
  const lo = CHAR_VALUE[s[i + 1]];
  if (hi === undefined || lo === undefined) return null;
  return (hi << 6) | lo;
}

function clamp12(v: number): number {
  return v < 0 ? 0 : v > 4095 ? 4095 : v;
}

/** Encode a trace as a compact "t1:..." string (see the format above). */
export function encodeTrace(t: PortraitTrace): string {
  const aspect = Number.isFinite(t.aspect) && t.aspect > 0 ? t.aspect : 1;
  const parts: string[] = [];
  for (const stroke of t.strokes) {
    if (stroke.length < 2) continue;
    let out = "";
    for (const [x, y] of stroke) {
      out += enc12(clamp12(Math.round(x * 4095)));
      out += enc12(clamp12(Math.round((y / aspect) * 4095)));
    }
    parts.push(out);
  }
  return "t1:" + enc12(clamp12(Math.round(aspect * 500))) + ":" + parts.join(".");
}

/** Decode a "t1:..." string; null for anything malformed. */
export function decodeTrace(s: string): PortraitTrace | null {
  if (!s.startsWith("t1:")) return null;
  const rest = s.slice(3);
  if (rest.length < 3 || rest[2] !== ":") return null;
  const aspectQ = dec12(rest, 0);
  if (aspectQ === null) return null;
  const aspect = aspectQ / 500;
  const body = rest.slice(3);
  const strokes: [number, number][][] = [];
  if (body !== "") {
    for (const seg of body.split(".")) {
      if (seg.length === 0 || seg.length % 4 !== 0) return null;
      const points: [number, number][] = [];
      for (let i = 0; i < seg.length; i += 4) {
        const xq = dec12(seg, i);
        const yq = dec12(seg, i + 2);
        if (xq === null || yq === null) return null;
        points.push([xq / 4095, (yq / 4095) * aspect]);
      }
      if (points.length >= 2) strokes.push(points);
    }
  }
  return { aspect, strokes };
}
