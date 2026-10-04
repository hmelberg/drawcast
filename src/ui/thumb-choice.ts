// The publish panel's "Front-page picture" (thumbnail round, 2026-10-04):
// the style, the character and the words the site draws over the poster
// (netlify/lib/thumb.mts), with a live preview — the very SVG the card
// function rasterises, drawn here in the browser with the same three faces.
// What it returns is written into the document's `thumb:` block at publish.

import { ACCENT_WORDS, ADULT_ACCENTS, KID_CHARACTERS, planThumb, readThumb, thumbSvg, HEADLINE_MAX, LISTING_TITLE_MAX, QUESTION_MAX, WORDS_MAX, type ThumbCharacter, type ThumbSpec, type ThumbStyle } from "../../netlify/lib/thumb.mts";
import { h } from "./dom";

const STYLE_LABEL: Record<ThumbStyle | "auto", string> = {
  auto: "Automatic",
  plain: "Plain — the picture as it is",
  strip: "Headline strip",
  question: "Question card",
  loud: "Ironic clickbait (over the top)",
};
const CHARACTER_LABEL: Record<ThumbCharacter | "auto", string> = {
  auto: "Automatic",
  none: "None",
  surprised: "Surprised",
  thinking: "Thinking deeply",
  puzzled: "Puzzled",
  aha: "Aha!",
  reader: "The reader",
  skeptic: "The skeptic",
  hand: "Pointing hand",
  eyes: "Peeking eyes",
  note: "Margin note",
  stamp: "Stamp",
  bubble: "Speech bubble",
};

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

export interface ThumbChoice {
  root: HTMLElement;
  /** Seed from the open document: its thumb block, title and format, and a way to draw its poster. */
  refresh(opts: { thumb?: ThumbSpec; title: string; format?: string; kids?: boolean; poster: () => Promise<Uint8Array | null> }): void;
  /** What to write into the document: the block, or undefined to remove it. */
  value(): ThumbSpec | undefined;
}

export function thumbChoice(): ThumbChoice {
  const styleSel = h("select", { id: "share-thumb-style" }) as HTMLSelectElement;
  const charSel = h("select", { id: "share-thumb-character" }) as HTMLSelectElement;
  const headline = h("input", { id: "share-thumb-headline", type: "text", maxlength: String(HEADLINE_MAX), placeholder: "A few words, shouted — It's not the shark" }) as HTMLInputElement;
  const question = h("input", { id: "share-thumb-question", type: "text", maxlength: String(QUESTION_MAX) }) as HTMLInputElement;
  const listing = h("input", { id: "share-thumb-title", type: "text", maxlength: String(LISTING_TITLE_MAX) }) as HTMLInputElement;
  const preview = h("div", { class: "thumb-preview", "aria-label": "Preview of the front-page picture" });
  for (const [v, t] of Object.entries(STYLE_LABEL)) styleSel.append(h("option", { value: v }, t));
  // Grown-up accents first; the cartoon busts are for children's casts.
  charSel.append(h("option", { value: "auto" }, CHARACTER_LABEL.auto), h("option", { value: "none" }, CHARACTER_LABEL.none));
  const group = (label: string, ids: readonly ThumbCharacter[]): HTMLElement => {
    const g = h("optgroup", {}, ...ids.map((v) => h("option", { value: v }, CHARACTER_LABEL[v])));
    g.setAttribute("label", label);
    return g;
  };
  charSel.append(group("For adults", ADULT_ACCENTS), group("For children", KID_CHARACTERS));
  const words = h("input", { id: "share-thumb-words", type: "text", maxlength: String(WORDS_MAX) }) as HTMLInputElement;

  const row = (label: string, control: HTMLElement, id: string, hint?: string): HTMLElement =>
    h("label", { class: "publish-choice thumb-row", for: id }, h("span", {}, label), control, ...(hint ? [h("div", { class: "hint" }, hint)] : []));
  const headlineRow = row("Headline ", headline, "share-thumb-headline");
  const questionRow = row("Question ", question, "share-thumb-question");
  const charRow = row("Figure ", charSel, "share-thumb-character");
  const wordsRow = row("Words ", words, "share-thumb-words", "what the note, stamp or bubble says");
  const root = h(
    "details",
    { class: "thumb-choice" },
    h("summary", {}, "Front-page picture"),
    h("div", { class: "hint" }, "How drawcast.app and link previews (Facebook, Slack…) show it. The cast itself is unchanged."),
    row("Style ", styleSel, "share-thumb-style"),
    headlineRow,
    questionRow,
    charRow,
    wordsRow,
    row("Listing title ", listing, "share-thumb-title", "optional — when the front page should say it differently from the title card"),
    preview,
  );

  let title = "";
  let format: string | undefined;
  let kids = false;
  let posterHref: string | null = null;
  let posterFor: (() => Promise<Uint8Array | null>) | null = null;

  const spec = (): ThumbSpec => {
    const raw: Record<string, unknown> = {};
    if (styleSel.value !== "auto") raw.style = styleSel.value;
    if (charSel.value !== "auto") raw.character = charSel.value;
    raw.headline = headline.value;
    raw.question = question.value;
    raw.title = listing.value;
    raw.words = words.value;
    return readThumb(raw) ?? {};
  };

  const paint = (): void => {
    const s = spec();
    const plan = planThumb(s, { title, format, kids });
    const st = styleSel.value as ThumbStyle | "auto";
    headlineRow.hidden = st === "plain" || st === "question";
    questionRow.hidden = st !== "question";
    charRow.hidden = st === "plain" || st === "question";
    wordsRow.hidden = charRow.hidden || ACCENT_WORDS[plan.character] === undefined;
    words.placeholder = ACCENT_WORDS[plan.character] ?? "";
    question.placeholder = /\?\s*$/.test(title) ? title : "Which animal kills the most people?";
    listing.placeholder = title;
    // Name what Automatic will do with what is typed now.
    styleSel.options[0].textContent = `Automatic (${plan.style === "strip" ? "headline strip" : plan.style === "plain" ? "plain — add a headline for a strip" : STYLE_LABEL[plan.style].toLowerCase()})`;
    charSel.options[0].textContent = `Automatic (${CHARACTER_LABEL[plan.style === "strip" || plan.style === "loud" ? (planThumb({ ...s, character: "auto" }, { title, format, kids }).character) : "none"].toLowerCase()})`;
    if (!posterHref) {
      preview.replaceChildren(h("div", { class: "hint" }, "Drawing the preview…"));
      return;
    }
    preview.innerHTML = thumbSvg(plan, posterHref).replace("<svg ", '<svg class="thumb-svg" ');
  };

  for (const el of [styleSel, charSel]) el.addEventListener("change", paint);
  for (const el of [headline, question, listing, words]) el.addEventListener("input", paint);
  // The poster is drawn only once the section is opened: it costs a render.
  root.addEventListener("toggle", () => {
    if (!(root as HTMLDetailsElement).open || posterHref || !posterFor) return;
    const draw = posterFor;
    void Promise.all([loadFaces(), draw()]).then(([, png]) => {
      if (draw !== posterFor) return; // a newer document opened meanwhile
      posterHref = png ? `data:image/png;base64,${btoa(Array.from(png, (b) => String.fromCharCode(b)).join(""))}` : "data:,";
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
      posterFor = opts.poster;
      const t = opts.thumb ?? {};
      styleSel.value = t.style ?? "auto";
      charSel.value = t.character ?? "auto";
      headline.value = t.headline ?? "";
      question.value = t.question ?? "";
      listing.value = t.title ?? "";
      words.value = t.words ?? "";
      (root as HTMLDetailsElement).open = false;
      paint();
    },
    value() {
      const s = spec();
      return Object.keys(s).length ? s : undefined;
    },
  };
}
