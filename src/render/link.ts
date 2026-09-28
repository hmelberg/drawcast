// The ensure phase for `link` elements (spec 2026-09-28-drawcast-links §6):
// before layout, a link learns what it says (its target's own title, when
// the author wrote none) and a CARD learns its picture — the author's
// `image`, else the target's thumbnail (`<name>.png` beside it), else the
// target document's own `poster:`. Every miss is simply left unset: the card
// then draws as the fallback title card (layout/tier2.ts linkDrawable).
// Never a throw, never a stalled render — the resolvers' shared contract.
//
// Pictures are embedded (encodePhoto data URIs) like every other picture in
// the drawing, so layout stays synchronous and a video export shows them.
// Remembered per page (in memory): a lecture's end page is drawn again every
// time it is scrubbed to, and should not refetch its neighbours each time.

import type { Spec } from "../spec/types";
import { encodePhoto } from "../spec/trace";
import { resolveLink } from "../links/resolve";
import { linkBase, viewerBase } from "../links/base";
import { LOOK_DIM, loadRaster, styledPhotoDataUri, type Raster } from "./portrait";

export interface LinkDeps {
  fetch: typeof fetch;
  loadRaster: (url: string, maxDim: number) => Promise<Raster>;
  encode: (raster: Raster) => string;
  base: typeof linkBase;
  viewerBase: typeof viewerBase;
}

function defaultDeps(): LinkDeps {
  return { fetch: (...a) => globalThis.fetch(...a), loadRaster, encode: styledPhotoDataUri, base: linkBase, viewerBase };
}

interface DocFacts {
  title?: string;
  poster?: string;
}

const docMemo = new Map<string, Promise<DocFacts>>();
const pictureMemo = new Map<string, Promise<string | null>>();

/** The target document's title and poster — read from its YAML text with two
 *  line matches rather than a full parse: the top-level `title:` / `poster:`
 *  of a playlist file (a nested item's title is indented and never matches). */
export function docFacts(text: string): DocFacts {
  const field = (name: string): string | undefined => {
    const m = new RegExp(`^${name}:\\s*(.+?)\\s*$`, "m").exec(text);
    if (!m) return undefined;
    const v = m[1].replace(/^(["'])(.*)\1$/, "$2").trim();
    return v === "" ? undefined : v;
  };
  const out: DocFacts = {};
  const title = field("title");
  const poster = field("poster");
  if (title) out.title = title;
  if (poster) out.poster = poster;
  return out;
}

function factsOf(url: string, deps: LinkDeps): Promise<DocFacts> {
  let hit = docMemo.get(url);
  if (!hit) {
    hit = deps
      .fetch(url)
      .then((r) => (r.ok ? r.text() : ""))
      .then(docFacts)
      .catch(() => ({}));
    docMemo.set(url, hit);
  }
  return hit;
}

function pictureOf(url: string, deps: LinkDeps): Promise<string | null> {
  let hit = pictureMemo.get(url);
  if (!hit) {
    hit = deps
      .loadRaster(url, LOOK_DIM.photo)
      .then((raster) => encodePhoto(raster.height / raster.width, deps.encode(raster)))
      .catch(() => null);
    pictureMemo.set(url, hit);
  }
  return hit;
}

/** Forget what was fetched (tests; a republish the author wants to see). */
export function clearLinkMemo(): void {
  docMemo.clear();
  pictureMemo.clear();
}

/** Resolve every link of `spec` IN PLACE (render/resolve.ts hands a copy). */
export async function resolveLinks(spec: Spec, deps: LinkDeps = defaultDeps()): Promise<void> {
  const base = deps.base();
  const vb = deps.viewerBase();
  await Promise.all(
    (spec.elements ?? [])
      .filter((el) => el.type === "link")
      .map(async (el) => {
        const r = resolveLink(el.href, base, vb);
        const card = el.form !== "text";
        const needTitle = !(el.title ?? "").trim();
        const needPicture = card && !el.strokes;
        const facts = r?.docUrl && (needTitle || needPicture) ? await factsOf(r.docUrl, deps) : {};
        if (needTitle && facts.title) el.title = facts.title;
        if (!needPicture) return;
        for (const url of [el.image, r?.posterUrl, facts.poster]) {
          if (typeof url !== "string" || url.trim() === "") continue;
          const strokes = await pictureOf(url, deps);
          if (strokes) {
            el.strokes = strokes;
            return;
          }
        }
      }),
  );
}
