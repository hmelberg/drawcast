// The publish panel's "Front-page picture" (thumbnail round, 2026-10-04):
// one line of plain words (netlify/lib/thumb.mts) — `band "It's not the
// shark" stamp "MYTH?" star` — typed, or built from the clickable words
// under it, with a live preview: the very SVG the card function rasterises,
// drawn here with the same three faces and the same emptiest-corner rule.
// What it returns is written into the document's `thumb:` line at publish.

import { cornerBusyness, KID_FIGURES, MARK_WORDS, parseThumbLine, planThumb, readThumb, thumbSvg, THUMB_H, THUMB_W, type Corner } from "../../netlify/lib/thumb.mts";
import { h } from "./dom";

/** The clickable words, in groups: what each inserts. */
const CHIPS: { group: string; words: { label: string; insert: string; title: string }[] }[] = [
  {
    group: "Words",
    words: [
      { label: "band", insert: 'band "', title: "the tilted yellow strip (the default)" },
      { label: "burst", insert: 'burst "', title: "big comic lettering" },
      { label: "question", insert: 'question "', title: "the question card" },
      { label: "none", insert: "none", title: "the picture alone" },
    ],
  },
  {
    group: "Figure",
    words: [
      { label: "eyes", insert: "eyes", title: "peeking over the band" },
      ...KID_FIGURES.map((f) => ({ label: f, insert: f, title: "a cartoon, for children's casts" })),
      { label: "noface", insert: "noface", title: "no figure, even on a children's quiz" },
    ],
  },
  {
    group: "Marks",
    words: [
      { label: "note", insert: 'note "', title: `a red margin note (default “${MARK_WORDS.note}”)` },
      { label: "stamp", insert: 'stamp "', title: `a crooked rubber stamp (default “${MARK_WORDS.stamp}”)` },
      { label: "star", insert: "star", title: "a purple star sticker with ?! (or star \"?\")" },
      { label: "bang", insert: "bang", title: "a red !!" },
      { label: "seal", insert: "seal", title: "a “not clickbait” seal" },
      { label: "arrow", insert: "arrow", title: "a big red arrow" },
    ],
  },
  { group: "Listing", words: [{ label: "title", insert: 'title "', title: "a listing title of its own" }] },
];

let facesLoaded: Promise<void> | null = null;
/** The three faces, for the preview (the card function reads the same files). */
function loadFaces(): Promise<void> {
  if (facesLoaded) return facesLoaded;
  const faces: [string, string][] = [
    ["Permanent Marker", "/fonts/thumb/PermanentMarker-Regular.ttf"],
    ["Bangers", "/fonts/thumb/Bangers-Regular.ttf"],
    ["Patrick Hand", "/fonts/patrickhand/PatrickHand-Regular.ttf"],
  ];
  facesLoaded = Promise.all(
    faces.map(async ([family, url]) => {
      try {
        const f = new FontFace(family, `url(${url})`);
        await f.load();
        document.fonts.add(f);
      } catch {
        /* the preview falls back to a system face */
      }
    }),
  ).then(() => undefined);
  return facesLoaded;
}

/** The poster's corner busyness, read through a canvas (the server reads it with pngjs). */
async function busyOf(href: string): Promise<Record<Corner, number> | undefined> {
  try {
    const img = new Image();
    img.src = href;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = THUMB_W / 4;
    c.height = THUMB_H / 4;
    const ctx = c.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return cornerBusyness(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  } catch {
    return undefined;
  }
}

export interface ThumbChoice {
  root: HTMLElement;
  /** Seed from the open document: its thumb line, title, format and audience, and a way to draw its poster. */
  refresh(opts: { thumb?: string; title: string; format?: string; kids?: boolean; poster: () => Promise<Uint8Array | null> }): void;
  /** The canonical line to write into the document, or undefined to remove it. */
  value(): string | undefined;
}

export function thumbChoice(): ThumbChoice {
  const input = h("input", { id: "share-thumb-line", type: "text", spellcheck: "false", placeholder: 'band "It\'s not the shark" stamp "MYTH?"' }) as HTMLInputElement;
  const unknownNote = h("div", { class: "hint thumb-unknown", hidden: "" });
  const autoNote = h("div", { class: "hint" });
  const preview = h("div", { class: "thumb-preview", "aria-label": "Preview of the front-page picture" });
  const chips = h(
    "div",
    { class: "thumb-chips" },
    ...CHIPS.map((g) =>
      h(
        "div",
        { class: "thumb-chip-group" },
        h("span", { class: "thumb-chip-label" }, g.group),
        ...g.words.map((w) => {
          const b = h("button", { type: "button", class: "thumb-chip", title: w.title }, w.label) as HTMLButtonElement;
          b.addEventListener("click", () => {
            const v = input.value.trimEnd();
            input.value = `${v ? `${v} ` : ""}${w.insert}`;
            input.focus();
            // A word that takes words leaves the cursor inside its quotes.
            if (w.insert.endsWith('"')) {
              input.value += '"';
              input.setSelectionRange(input.value.length - 1, input.value.length - 1);
            }
            paint();
          });
          return b;
        }),
      ),
    ),
  );
  const root = h(
    "details",
    { class: "thumb-choice" },
    h("summary", {}, "Front-page picture"),
    h("div", { class: "hint" }, "How drawcast.app and link previews (Facebook, Slack…) show it — the cast itself is unchanged. Plain words in any order; quoted words where a word takes them."),
    h("label", { class: "publish-choice thumb-row", for: "share-thumb-line" }, input),
    unknownNote,
    chips,
    autoNote,
    preview,
  );

  let title = "";
  let format: string | undefined;
  let kids = false;
  let posterHref: string | null = null;
  let busy: Record<Corner, number> | undefined;
  let posterFor: (() => Promise<Uint8Array | null>) | null = null;

  const paint = (): void => {
    const { unknown } = parseThumbLine(input.value);
    unknownNote.hidden = unknown.length === 0;
    unknownNote.textContent = unknown.length ? `Not a picture word: ${unknown.join(", ")}` : "";
    const plan = planThumb(readThumb(input.value), { title, format, kids });
    autoNote.textContent = input.value.trim() === "" ? (plan.words === "none" ? "Empty: the picture as it is." : "") : "";
    if (!posterHref) {
      preview.replaceChildren(h("div", { class: "hint" }, "Drawing the preview…"));
      return;
    }
    preview.innerHTML = thumbSvg(plan, posterHref, busy).replace("<svg ", '<svg class="thumb-svg" ');
  };
  input.addEventListener("input", paint);
  // The poster is drawn only once the section is opened: it costs a render.
  root.addEventListener("toggle", () => {
    if (!(root as HTMLDetailsElement).open || posterHref || !posterFor) return;
    const draw = posterFor;
    void Promise.all([loadFaces(), draw()]).then(async ([, png]) => {
      if (draw !== posterFor) return; // a newer document opened meanwhile
      posterHref = png ? `data:image/png;base64,${btoa(Array.from(png, (b) => String.fromCharCode(b)).join(""))}` : "data:,";
      busy = png ? await busyOf(posterHref) : undefined;
      paint();
    });
  });

  return {
    root,
    refresh(opts) {
      title = opts.title;
      format = opts.format;
      kids = opts.kids === true;
      posterHref = null;
      busy = undefined;
      posterFor = opts.poster;
      input.value = opts.thumb ?? "";
      (root as HTMLDetailsElement).open = false;
      paint();
    },
    value() {
      return readThumb(input.value);
    },
  };
}
