// The Spec source editor folds what nobody reads (round 6 §8): the `assets:`
// block (a fenced ```assets block in script notation, or a top-level
// `assets:` key in YAML) and any long machine-written string — traced
// strokes, a picture's base64, an icon's SVG — each becomes a one-line
// marker such as `⟪folded k3f9#2 · 3 KB⟫`. The text the app reads is always
// the whole thing: attachSpecFolding puts the folding on the textarea's own
// `value`, so every one of main.ts's reads and writes keeps working on the
// full spec, and only what is SHOWN is short.
//
// The data must never leave by a marker (fix round 1):
//   - every fold carries a fresh random NONCE, and only the current one's
//     markers are unfolded — a marker pasted from another document is never
//     read as this document's data;
//   - copy and cut put the UNFOLDED text on the clipboard;
//   - a marker that is left over (pasted, half-edited) is text that names
//     data which is not there: leftoverFoldMarker finds it, and the playlist
//     parser and the save gate say so rather than saving it as content;
//   - "Show data" turns the folding off.
// A marker the author deletes whole takes its data with it, as deleting the
// data itself would.

/** Strings at least this long that look like data are folded. */
export const FOLD_MIN = 200;

const MARK_OPEN = "⟪";
const MARK_CLOSE = "⟫";
const MARKER = new RegExp(`${MARK_OPEN}folded ([a-z0-9]+)#(\\d+)[^${MARK_CLOSE}\\n]*${MARK_CLOSE}`, "g");
/** Anything that still reads as a marker, whole or half-edited. */
const ANY_MARKER = new RegExp(`${MARK_OPEN}folded\\b[^\\n]*`);

/** A fresh fold nonce: four base-36 characters. */
export function foldNonce(): string {
  return Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
}

/** A size the way a person reads it. */
function size(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}

/** The encoded payloads drawcast writes (spec/trace.ts, spec/icon-data.ts), and data: URIs — as a word of their own, never inside "metadata:". */
const DATA_START = /(?<![\w-])(["']?)(?:t1|t2|img1|img2|lnk1|ic1|ics1|data):/g;
/** A run of this many characters with no space is data, whatever it is. */
const LONG_RUN = new RegExp(`\\S{${FOLD_MIN},}`, "g");

/**
 * The text as the editor shows it, what each marker stands for (marker #n
 * is folds[n]) and the nonce its markers carry. Folding is line by line, so
 * a fold never spans two lines except the assets block, which is folded whole.
 */
export function foldSpecText(text: string, nonce: string = foldNonce()): { shown: string; folds: string[]; nonce: string } {
  const folds: string[] = [];
  const mark = (original: string, what: string): string => {
    folds.push(original);
    return `${MARK_OPEN}folded ${nonce}#${folds.length - 1} · ${what}${MARK_CLOSE}`;
  };
  const lines = text.split("\n");
  const out: string[] = [];
  const entries = (n: number): string => `${n} ${n === 1 ? "entry" : "entries"}`;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // ```assets … ``` (script notation): the body becomes one marker line.
    if (/^```assets\s*$/.test(line)) {
      let end = i + 1;
      while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
      if (end < lines.length && end > i + 1) {
        const body = lines.slice(i + 1, end).join("\n");
        out.push(line, mark(body, `assets, ${entries(end - i - 1)}, ${size(body)}`), lines[end]);
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
        out.push(line, `${indent}${mark(body, `assets, ${entries(end - i - 1)}, ${size(body)}`)}`);
        i = end - 1;
        continue;
      }
    }
    out.push(foldLine(line, mark));
  }
  return { shown: out.join("\n"), folds, nonce };
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

/** The full text back: every marker of THIS nonce is replaced by what it folded; any other marker stays as written. */
export function unfoldSpecText(shown: string, folds: readonly string[], nonce: string): string {
  if (folds.length === 0) return shown;
  return shown.replace(MARKER, (marker, n: string, k: string) => {
    if (n !== nonce) return marker;
    const original = folds[Number(k)];
    return original === undefined ? marker : original;
  });
}

/** The first fold marker left in a text (pasted from elsewhere, or half-edited) — or null. */
export function leftoverFoldMarker(text: string): string | null {
  const m = ANY_MARKER.exec(text);
  return m ? m[0].slice(0, 60) : null;
}

/** What to say about a leftover marker. */
export function leftoverFoldMessage(marker: string): string {
  return `a folded-data marker is in the text ("${marker}") — its data is not in this document. Undo the edit or paste, or delete the marker.`;
}

/** The parts of a textarea the folding uses; everything but `value` is optional (a test's stand-in has none). */
export interface FoldableArea {
  value: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  setSelectionRange?: (start: number, end: number) => void;
  addEventListener?: (type: string, fn: (e: ClipboardLike) => void) => void;
  removeEventListener?: (type: string, fn: (e: ClipboardLike) => void) => void;
  dispatchEvent?: (e: Event) => boolean;
}

/** What a copy/cut event offers. */
export interface ClipboardLike {
  type: string;
  clipboardData?: { setData(format: string, data: string): void } | null;
  preventDefault(): void;
}

export interface SpecFolding {
  /** Stop folding: the plain value again. */
  detach(): void;
  /** true: show the whole text (no folding) until turned off again. */
  showData(on: boolean): void;
  readonly showingData: boolean;
}

/**
 * Fold a textarea in place: reading `value` gives the whole text, writing it
 * shows the folded one. Typing changes only what is shown; the folds stay
 * until the next write. Copy and cut carry the unfolded selection.
 */
export function attachSpecFolding(area: FoldableArea): SpecFolding {
  let proto = Object.getPrototypeOf(area) as object | null;
  let desc: PropertyDescriptor | undefined;
  while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, "value"))) proto = Object.getPrototypeOf(proto) as object | null;
  if (!desc?.get || !desc.set) return { detach: () => undefined, showData: () => undefined, showingData: true };
  const get = desc.get, set = desc.set;
  let folds: string[] = [];
  let nonce = foldNonce();
  let open = false;
  const full = (): string => unfoldSpecText(get.call(area) as string, folds, nonce);
  const write = (text: string): void => {
    if (open) {
      folds = [];
      set.call(area, text);
      return;
    }
    const f = foldSpecText(text);
    folds = f.folds;
    nonce = f.nonce;
    set.call(area, f.shown);
  };
  Object.defineProperty(area, "value", {
    configurable: true,
    enumerable: true,
    get: full,
    set(v: string) {
      write(String(v ?? ""));
    },
  });
  // Copy and cut: the selection's markers become their data on the clipboard.
  const onClip = (e: ClipboardLike): void => {
    const s = area.selectionStart ?? 0, t = area.selectionEnd ?? 0;
    if (t <= s || folds.length === 0 || !e.clipboardData) return;
    const shown = get.call(area) as string;
    const sel = shown.slice(s, t);
    const data = unfoldSpecText(sel, folds, nonce);
    if (data === sel) return;
    e.clipboardData.setData("text/plain", data);
    e.preventDefault();
    if (e.type === "cut") {
      set.call(area, shown.slice(0, s) + shown.slice(t));
      area.setSelectionRange?.(s, s);
      if (typeof Event === "function") area.dispatchEvent?.(new Event("input", { bubbles: true }));
    }
  };
  area.addEventListener?.("copy", onClip);
  area.addEventListener?.("cut", onClip);
  return {
    detach() {
      const text = full();
      area.removeEventListener?.("copy", onClip);
      area.removeEventListener?.("cut", onClip);
      delete (area as { value?: string }).value;
      set.call(area, text);
    },
    showData(on: boolean) {
      if (on === open) return;
      const text = full();
      open = on;
      write(text);
    },
    get showingData() {
      return open;
    },
  };
}
