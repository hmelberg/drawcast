// The Spec source editor folds what nobody reads (round 6 §8): the `assets:`
// block (a fenced ```assets block in script notation, or a top-level
// `assets:` key in YAML) and any long machine-written string — traced
// strokes, a picture's base64, an icon's SVG — each becomes a one-line
// marker such as `⟪folded #2 · 3 KB⟫`. The text the app reads is always the
// whole thing: attachSpecFolding puts the folding on the textarea's own
// `value`, so every one of main.ts's reads and writes keeps working on the
// full spec, and only what is SHOWN is short.
//
// A marker the author deletes takes its data with it, as deleting the data
// itself would; a marker edited into something else is left as typed.

/** Strings at least this long that look like data are folded. */
export const FOLD_MIN = 200;

const MARK_OPEN = "⟪";
const MARK_CLOSE = "⟫";
const MARKER = new RegExp(`${MARK_OPEN}folded #(\\d+)[^${MARK_CLOSE}\\n]*${MARK_CLOSE}`, "g");

/** A size the way a person reads it. */
function size(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}

/** The encoded payloads drawcast writes (spec/trace.ts, spec/icon-data.ts), and data: URIs. */
const DATA_START = /(["']?)(?:t1|t2|img1|img2|lnk1|ic1|ics1|data):/g;
/** A run of this many characters with no space is data, whatever it is. */
const LONG_RUN = new RegExp(`\\S{${FOLD_MIN},}`, "g");

/**
 * The text as the editor shows it, and what each marker stands for (marker
 * #n is folds[n]). Folding is line by line, so a fold never spans two lines
 * except the assets block, which is folded whole.
 */
export function foldSpecText(text: string): { shown: string; folds: string[] } {
  const folds: string[] = [];
  const mark = (original: string, what: string): string => {
    folds.push(original);
    return `${MARK_OPEN}folded #${folds.length - 1} · ${what}${MARK_CLOSE}`;
  };
  // A marker already in the text (pasted from a folded editor) is left alone:
  // unfolding never maps it to data that is not there.
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // ```assets … ``` (script notation): the body becomes one marker line.
    if (/^```assets\s*$/.test(line)) {
      let end = i + 1;
      while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
      if (end < lines.length && end > i + 1) {
        const body = lines.slice(i + 1, end).join("\n");
        out.push(line, mark(body, `assets, ${end - i - 1} ${end - i - 1 === 1 ? "entry" : "entries"}, ${size(body)}`), lines[end]);
        i = end;
        continue;
      }
    }
    // assets: (YAML, top level): its indented lines become one marker line.
    if (/^assets:\s*$/.test(line)) {
      let end = i + 1;
      while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
      if (end > i + 1) {
        // The marker keeps the first line's indent, so the fold starts after it.
        const indent = /^(\s+)/.exec(lines[i + 1])![1];
        const body = lines.slice(i + 1, end).join("\n").slice(indent.length);
        out.push(line, `${indent}${mark(body, `assets, ${end - i - 1} ${end - i - 1 === 1 ? "entry" : "entries"}, ${size(body)}`)}`);
        i = end - 1;
        continue;
      }
    }
    out.push(foldLine(line, mark));
  }
  return { shown: out.join("\n"), folds };
}

/** One line: from an encoded payload's start to the end of the line, or a long space-free run. */
function foldLine(line: string, mark: (original: string, what: string) => string): string {
  if (line.length < FOLD_MIN) return line;
  for (const m of line.matchAll(DATA_START)) {
    const tail = line.slice(m.index);
    if (tail.length >= FOLD_MIN) return line.slice(0, m.index) + mark(tail, size(tail));
  }
  return line.replace(LONG_RUN, (run) => mark(run, size(run)));
}

/** The full text back: every marker that names a fold is replaced by what it folded. */
export function unfoldSpecText(shown: string, folds: readonly string[]): string {
  if (folds.length === 0) return shown;
  return shown.replace(MARKER, (marker, n: string) => {
    const original = folds[Number(n)];
    return original === undefined ? marker : original;
  });
}

/**
 * Fold a textarea in place: reading `value` gives the whole text, writing it
 * shows the folded one. Typing changes only what is shown; the folds stay
 * until the next write. Returns a way to stop (the plain value again).
 */
export function attachSpecFolding(area: { value: string }): () => void {
  let proto = Object.getPrototypeOf(area) as object | null;
  let desc: PropertyDescriptor | undefined;
  while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, "value"))) proto = Object.getPrototypeOf(proto) as object | null;
  if (!desc?.get || !desc.set) return () => undefined;
  const get = desc.get, set = desc.set;
  let folds: string[] = [];
  Object.defineProperty(area, "value", {
    configurable: true,
    enumerable: true,
    get(): string {
      return unfoldSpecText(get.call(area) as string, folds);
    },
    set(v: string) {
      const f = foldSpecText(String(v ?? ""));
      folds = f.folds;
      set.call(area, f.shown);
    },
  });
  return () => {
    const full = (area as { value: string }).value;
    delete (area as { value?: string }).value;
    set.call(area, full);
  };
}
