// The ＋ Insert menu — today just "Portrait…", joined by "Source…" in a later
// task. Replaces a raw window.prompt() that dropped the portrait at a fixed
// x/y with NO draw command, so it only ever surfaced through the renderer's
// implicit tail-draw (render/plan.ts) as an extra step at the very end of the
// piece — and always into part 1, whichever part you were actually viewing.
//
// Everything that touches the DOM lives inside build(), called lazily from
// openInsertPortrait() — never at module scope. vitest runs this suite with
// no DOM (environment: "node"), so a top-level `h(...)` call would crash the
// import of this file's pure exports (portraitInsert included) the moment
// any test so much as imports them.

import { resolvePortraits, traceFromBlob } from "../render/portrait";
import { resolveSources } from "../render/source";
import { resolveImages } from "../render/image";
import { ASSET_MAX_BYTES, assetBytes, formatAssetSize, hoistStrokes } from "../spec/assets";
import { resolveIcons } from "../render/icon";
import type { SpecElement } from "../spec/types";
import { itemsOf, itemTitle, type Playlist, type PlaylistItem } from "../playlist/playlist";
import { createModal } from "./modal";
import { h } from "./dom";

export type PortraitSource =
  | { of: string }
  | { url: string }
  // A file has no regenerable source — the strokes embed in the spec, and the
  // filename is all there is for the caption drawn under the portrait
  // (layout/tier2.ts reads `of`) and the provenance attribution: unlike the
  // name/url arms, resolvePortraits never backfills `source` for an element
  // that already has strokes, so it has to travel with the choice itself.
  | { strokes: string; of?: string; source?: string };

export interface PortraitChoice {
  source: PortraitSource;
  /** Index into itemsOf(playlist) — the part being viewed, not always 0. */
  part: number;
  /** Cameo: centered, larger, frameless; omits x/y/width per the schema. */
  cameo: boolean;
  /** Insert the draw command after this many existing commands. */
  afterStep: number;
}

/**
 * Insert a portrait element AND the draw command that reveals it, at the
 * step the caller chose. This is the one behaviour change in the redesign:
 * the old flow left the element to the implicit final-draw rule, which is
 * why it always landed at the very end, in a fixed corner, in part 1 no
 * matter which part was on screen. Mutates `playlist` in place (same
 * pattern the rest of the editor's spec-mutation helpers use) and returns
 * it, for a fluent call at the point of use.
 */
export function portraitInsert(playlist: Playlist, choice: PortraitChoice): Playlist {
  const items = itemsOf(playlist);
  const spec = items[choice.part]?.spec;
  if (!spec) return playlist;
  spec.elements = spec.elements ?? [];
  spec.commands = spec.commands ?? [];
  const n = spec.elements.filter((e) => e.type === "portrait").length + 1;
  const id = `portrait_${n}`;
  // Cameo omits x/y/width per the schema (spec/types.ts: cameo is centered,
  // larger, frameless — carrying corner coordinates would just be dead data).
  const placement = choice.cameo ? { cameo: true } : { x: 170, y: 550, width: 170 };
  spec.elements.push({ id, type: "portrait", ...placement, ...choice.source } as SpecElement);
  const at = Math.max(0, Math.min(choice.afterStep, spec.commands.length));
  spec.commands.splice(at, 0, { draw: id });
  return playlist;
}

export interface InsertPortraitDeps {
  /** Parse+validate the current editor text; null means the caller already
   *  reported why through setStatus (mirrors main.ts's readPlaylistText). */
  readPlaylist: () => Playlist | null;
  /** Index of the part currently being previewed — the dialog's default part,
   *  so a portrait lands where you were looking, not always into part 1. */
  viewedPart: () => number;
  /** Write the mutated playlist back to the editor and re-render from it. */
  applyPlaylist: (playlist: Playlist) => void;
  setStatus: (text: string, kind?: "info" | "error" | "ok") => void;
}

interface InsertSession {
  open(deps: InsertPortraitDeps): void;
}

let session: InsertSession | null = null;

/** Opens the "Insert image from disk" dialog. Safe to call repeatedly — the modal is
 *  built once and reused, refreshed with whichever `deps` this call passed. */
export function openInsertPortrait(deps: InsertPortraitDeps): void {
  if (!session) session = build();
  session.open(deps);
}

function build(): InsertSession {
  // Reassigned on every open() and read only from inside the handlers below,
  // rather than captured once — so a reopen never acts on a stale document.
  let current: InsertPortraitDeps;
  let items: PlaylistItem[] = [];

  const explanation = h(
    "p",
    { class: "settings-note" },
    // Moved here verbatim in spirit from the old portraitBtn's title= — a
    // tooltip a touch device never showed in the first place. By-name and
    // by-URL portraits still exist — the AI already emits them, and they're
    // one line of YAML (`of:`/`url:`) either way — but a file's bytes have no
    // YAML substitute, so this dialog is the only door for them (C6, P §4).
    "A picked file, traced into sketch strokes in the house style. Portraits by name or image URL are one line of YAML — write them directly in the spec.",
  );

  const fileInput = h("input", { type: "file", accept: "image/*" }) as HTMLInputElement;

  const partSel = h("select", {}) as HTMLSelectElement;
  const placeSel = h("select", {}) as HTMLSelectElement;
  placeSel.append(h("option", { value: "cameo" }, "Cameo"), h("option", { value: "corner" }, "Corner"));
  const afterInput = h("input", { type: "number", min: "0", step: "1" }) as HTMLInputElement;

  // How many commands the chosen part already has — the "after step" default,
  // so leaving the field alone appends after everything already there instead
  // of splicing in before the part's existing draws.
  const stepsFor = (i: number): number => items[i]?.spec.commands?.length ?? 0;
  partSel.addEventListener("change", () => {
    afterInput.value = String(stepsFor(Number(partSel.value)));
  });

  const modal = createModal("Insert image from disk", { size: "s" });
  // createModal builds the element but does not put it in the document, and
  // showModal() on a detached <dialog> throws — the click looks like it does
  // nothing at all. Every other modal in the app attaches here; these two did
  // not, so both this dialog and Pin's were dead from the day they shipped.
  document.body.append(modal.dialog);
  modal.body.append(
    explanation,
    h("div", { class: "settings-field" }, fileInput),
    h("div", { class: "settings-field" }, h("label", {}, "Part"), partSel),
    h("div", { class: "settings-field" }, h("label", {}, "Place"), placeSel),
    h("div", { class: "settings-field" }, h("label", {}, "After step"), afterInput),
  );

  const insertBtn = h("button", { class: "primary" }, "Insert");
  modal.footer.append(insertBtn);

  /** Insert into a FRESH playlist and apply. Never called with a playlist read
   *  before the async trace/resolve above it — see the WHY note at the call
   *  site below. */
  const commit = (playlist: Playlist, part: number, source: PortraitSource, cameo: boolean, afterStep: number): void => {
    const result = portraitInsert(playlist, { source, part, cameo, afterStep });
    const els = itemsOf(result)[part]?.spec.elements ?? [];
    const el = els[els.length - 1];
    if (el) {
      // The traced bytes go to the bottom of the spec, the element keeps a
      // one-line `strokes: "@id"` (spec/assets.ts).
      hoistStrokes(itemsOf(result)[part].spec);
      current.applyPlaylist(result);
      current.setStatus(`Portrait "${el.id}" inserted into "${itemTitle(itemsOf(result)[part])}".`, "ok");
      modal.dialog.close();
    } else {
      // The chosen part no longer exists in this fresh read — the text
      // changed out from under the dialog while it waited. Leave the dialog
      // open AND leave the editor text untouched — applyPlaylist must not
      // run here: `result` is semantically the same playlist, but formatting
      // it back out can still change the TEXT (whitespace/ordering), which
      // would reformat the editor after inserting nothing. Nothing to undo,
      // so the user can pick a part that still exists and retry.
      current.setStatus("That part no longer exists in the current text — nothing was inserted.", "error");
    }
  };

  insertBtn.addEventListener("click", () => {
    const part = Number(partSel.value) || 0;
    const cameo = placeSel.value === "cameo";
    const afterStep = Math.max(0, Math.floor(Number(afterInput.value) || 0));

    const file = fileInput.files?.[0];
    if (!file) {
      current.setStatus("Choose a file to trace.", "error");
      return;
    }
    current.setStatus("Tracing portrait…", "ok");
    insertBtn.disabled = true;
    void traceFromBlob(file)
      .then((encoded) => {
        const base = file.name.replace(/\.[a-z0-9]+$/i, "");
        // The playlist is read HERE, after traceFromBlob above settles, never
        // before it starts: the deleted window.prompt() flow's own comment
        // named the hazard this avoids — "an upload that lands mid-revise
        // would be overwritten by the revise that resolves after it".
        // Reading early and holding onto the result would silently clobber
        // whatever the editor text became during the trace.
        const playlist = current.readPlaylist();
        if (!playlist) return; // readPlaylist already reported why
        commit(playlist, part, { strokes: encoded, of: base, source: file.name }, cameo, afterStep);
      })
      .catch((err: Error) => current.setStatus(`Portrait failed: ${err.message}`, "error"))
      .finally(() => (insertBtn.disabled = false));
  });

  return {
    open: (deps) => {
      current = deps;
      insertBtn.disabled = false;
      const playlist = deps.readPlaylist();
      items = playlist ? itemsOf(playlist) : [];
      partSel.replaceChildren(...items.map((it, i) => h("option", { value: String(i) }, itemTitle(it))));
      const def = Math.max(0, Math.min(deps.viewedPart(), items.length - 1));
      partSel.value = String(def);
      afterInput.value = String(stepsFor(def));
      placeSel.value = "cameo";
      fileInput.value = "";
      modal.open();
    },
  };
}

// The 🖼 Images menu's "Embed images in the file" item — the verb used to be
// "Pin", and before that a bare "📌" icon-only button whose ONLY explanation
// was a hover title=: invisible on touch, and forgettable enough that even
// the person who wrote this feature had to ask what it did. Same node-safety
// rule as build() above: nothing DOM-shaped at module scope, so importing
// this file for its pure exports (portraitInsert, unembeddedImages) never
// touches a document that vitest's node environment doesn't have.

export interface EmbedImagesDeps {
  /** Parse+validate the current editor text; null means the caller already
   *  reported why through setStatus (mirrors InsertPortraitDeps.readPlaylist).
   *  Called once when the dialog opens, to size the count and explanation
   *  against what's there right now — and again, fresh, right before the work
   *  starts (see the Embed button below), never the same snapshot reused
   *  across the two: the dialog can sit open a while, and embedding must act
   *  on whatever is actually in the editor at the moment it runs. */
  readPlaylist: () => Playlist | null;
  /** Write the embedded playlist back to the editor and re-render from it. */
  applyPlaylist: (playlist: Playlist) => void;
  /** Unpaywall wants a contact email (render/source.ts); read fresh at embed
   *  time rather than captured at open, since Settings can change under an
   *  open dialog. */
  contactEmail: () => string;
  setStatus: (text: string, kind?: "info" | "error" | "ok") => void;
}

interface EmbedSession {
  open(deps: EmbedImagesDeps): void;
}

let embedSession: EmbedSession | null = null;

/** Opens the "Embed images in the file" dialog. Safe to call repeatedly — the
 *  modal is built once and reused, refreshed with whichever `deps` this call
 *  passed (same pattern as openInsertPortrait above). */
export function openEmbedDialog(deps: EmbedImagesDeps): void {
  if (!embedSession) embedSession = buildEmbedDialog();
  embedSession.open(deps);
}

/** Every portrait/source element in the document, embedded or not. */
/** The element types that resolve borrowed artwork into `strokes`. */
const EMBEDDABLE = ["portrait", "source", "image", "icon"] as const;
const embeddable = (type: string): boolean => (EMBEDDABLE as readonly string[]).includes(type);

function imageElements(playlist: Playlist): number {
  return itemsOf(playlist).reduce((n, it) => n + (it.spec.elements ?? []).filter((e) => embeddable(e.type)).length, 0);
}

/**
 * How many images would actually change if this playlist were embedded: the
 * portrait/source/image/icon elements that carry no `strokes` yet. Every
 * resolver skips an element that already has them, so this — not the total —
 * is the number worth showing, whether the author is embedding into their own
 * document (the dialog below) or into the copy Publish sends (ui/share.ts's
 * "Embed images (N)").
 *
 * All FOUR types, not just portrait/source: a freehand figure whose only
 * borrowed art is a Commons `image` or an Iconify `icon` counted zero, so
 * Publish's bake gate (`before > 0`) skipped it entirely and the Share panel
 * said "Embed images (0) — all images are already in the file" about a cast
 * that would re-fetch both in every viewer's browser.
 *
 * A count, deliberately: an estimate in bytes would have to guess at trace
 * sizes it cannot know before resolving, and the review cut it.
 */
export function unembeddedImages(playlist: Playlist): number {
  return itemsOf(playlist).reduce(
    (n, it) => n + (it.spec.elements ?? []).filter((e) => embeddable(e.type) && !e.strokes).length,
    0,
  );
}

function buildEmbedDialog(): EmbedSession {
  // Reassigned on every open(), read only from inside the handler below —
  // same reason as build()'s `current` above: a reopen must never act on a
  // stale document.
  let current: EmbedImagesDeps;

  // Moved here verbatim in spirit from the old pin button's title= attribute.
  const explanation = h(
    "p",
    { class: "settings-note" },
    "Every portrait's traced strokes, every source's page image, every Commons photo and every icon are written into the spec text. The drawcast then renders identically forever — offline, on any machine, and after a link dies or an API is discontinued. The document gets larger.",
  );
  // The distinction that made "Pin" a confusing name (P §3.6): this button
  // rewrites the file the author has open. Publishing does the same job to the
  // copy it sends and leaves this document exactly as it is, so nobody has to
  // come here first just to publish something self-contained.
  const scopeLine = h(
    "p",
    { class: "settings-note" },
    "This changes this document. Publishing embeds images into the copy it sends without touching the file you are editing.",
  );
  const countLine = h("p", { class: "settings-note" });
  // The nothing-to-do case: today (well, before this change) that was a red
  // status line AFTER a click that did nothing. Reported here, at open time,
  // instead — so the button that cannot do anything is never offered at all.
  // Two ways to get here, and they mean opposite things to the author: no
  // images at all, or every image already in the file.
  const nothingLine = h("p", { class: "settings-note" });

  const modal = createModal("Embed images in the file", { size: "s" });
  document.body.append(modal.dialog);
  modal.body.append(explanation, scopeLine, countLine, nothingLine);

  // Not appended to the footer here — open() below adds it only when there
  // is something to embed, and removes it otherwise (rather than merely
  // hiding it), so .dialog-footer:empty (styles.css) collapses the footer
  // bar away entirely instead of leaving an empty strip under the message.
  const embedBtn = h("button", { class: "primary" }, "Embed");

  embedBtn.addEventListener("click", () => {
    // Read fresh here — not the playlist counted in open() below — for the
    // same reason insertBtn's handler reads fresh above: nothing may hold a
    // playlist across a wait and then mutate it, once the text underneath
    // could have changed. The pinning logic itself (resolve, count failures,
    // write back, report) is unchanged from the old click handler.
    const playlist = current.readPlaylist();
    if (!playlist) return; // readPlaylist already reported why
    const items = itemsOf(playlist);
    current.setStatus("Embedding images…", "ok");
    embedBtn.disabled = true;
    // Sources embed for the same reason portraits do, and one more: a resolved
    // page image outlives the link rot and API deaths that dynamic
    // resolution accepts as its risk (docs/2026-08-28-source-element-spec.md
    // §2).
    //
    // Resolving IN PLACE is correct here and only here: this dialog's whole
    // job is to change the open document. Publish must not, which is why
    // publish/embed.ts clones first (P §3.4).
    void Promise.all(
      items.flatMap((it) => [
        resolvePortraits(it.spec),
        resolveSources(it.spec, { contactEmail: current.contactEmail() }),
        resolveImages(it.spec),
        resolveIcons(it.spec),
      ]),
    )
      .then((all) => {
        const failed = all.flat().filter((r) => !r.ok);
        // Every payload just resolved moves under `assets:` at the bottom of
        // its spec; the elements keep one-line references (spec/assets.ts).
        for (const it of items) hoistStrokes(it.spec);
        current.applyPlaylist(playlist);
        current.setStatus(
          failed.length > 0
            ? `Embedded with ${failed.length} failure${failed.length === 1 ? "" : "s"}: ${failed[0].error}`
            : "Embedded — the spec is now fully self-contained.",
          failed.length > 0 ? "error" : "ok",
        );
        modal.dialog.close();
      })
      .finally(() => {
        embedBtn.disabled = false;
      });
  });

  return {
    open: (deps) => {
      current = deps;
      embedBtn.disabled = false;
      const playlist = deps.readPlaylist();
      // Unreadable/invalid text: readPlaylist already reported why through
      // setStatus, same as the old handler's own early return — there is
      // nothing sensible to count, so there is nothing sensible to show.
      if (!playlist) return;
      // The count that decides everything here is the one that would actually
      // CHANGE — both resolvers skip an element that already has strokes, so
      // offering the button for a document whose images are all embedded
      // would offer a no-op.
      const count = unembeddedImages(playlist);
      explanation.hidden = count === 0;
      scopeLine.hidden = count === 0;
      countLine.hidden = count === 0;
      countLine.textContent = count > 0 ? `${count} image${count === 1 ? "" : "s"} will be embedded.` : "";
      nothingLine.hidden = count > 0;
      nothingLine.textContent =
        imageElements(playlist) > 0
          ? "Every image is already in the file."
          : "No portrait, source, image or icon elements to embed.";
      embedBtn.remove();
      if (count > 0) modal.footer.append(embedBtn);
      modal.open();
    },
  };
}

// The ＋ Insert menu's "Data from disk…" — a JSON or CSV file becomes a
// spec.assets entry, named, parsed, size-checked, in the part being viewed.
// Same node-safety rule as build() above: parseDataFile and assetNameFor
// touch no DOM and sit at module scope so the test file can import them;
// everything else lives inside buildData(), called lazily.

/**
 * One CSV line's cells — RFC 4180's basics, not the whole spec (round 1
 * review, finding 3): a field wrapped in double quotes may contain commas,
 * and `""` inside it is one escaped literal quote. The surrounding quotes
 * are stripped from the result. Whitespace around an UNQUOTED field is
 * trimmed, matching the plain split(",") this replaces; whitespace inside a
 * quoted field is kept exactly as written.
 *
 * Embedded newlines inside a quoted field are OUT of scope — the reader
 * splits on line breaks before this ever runs, so a field that legitimately
 * spans lines has nowhere to go. Returns an error string, instead of a row,
 * when a quote never closes on its own line, or when text follows a closing
 * quote that is not the next comma — either way there is no cell value a
 * reader could honestly report, so the caller names the file and reports it
 * rather than guessing.
 */
function splitCsvLine(line: string): string[] | string {
  const cells: string[] = [];
  const n = line.length;
  let i = 0;
  while (i <= n) {
    let start = i;
    while (start < n && (line[start] === " " || line[start] === "\t")) start++;
    if (line[start] === '"') {
      let j = start + 1;
      let value = "";
      let closed = false;
      while (j < n) {
        if (line[j] === '"') {
          if (line[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        value += line[j];
        j++;
      }
      if (!closed) return "has an unterminated quote — a quoted field cannot span multiple lines";
      // Whitespace between the closing quote and the next comma is skipped
      // (`"a" , "b"` — the space before the comma is not part of either
      // cell). Anything else there — `"x"junk,c` — is text this format has
      // no cell to put it in, so it is reported instead of silently dropped.
      while (j < n && (line[j] === " " || line[j] === "\t")) j++;
      if (j < n && line[j] !== ",") {
        return "has text right after a closing quote that is not a comma — a quoted field cannot be followed by more text";
      }
      cells.push(value);
      i = j + 1;
      continue;
    }
    const comma = line.indexOf(",", start);
    if (comma === -1) {
      cells.push(line.slice(start).trim());
      i = n + 1;
    } else {
      cells.push(line.slice(start, comma).trim());
      i = comma + 1;
    }
  }
  return cells;
}

/**
 * A data file's rows. JSON as written; CSV's header row as keys.
 *
 * A column becomes numbers only when EVERY cell in it parses as one — the
 * overpromising trap from the steepness round (2026-09-20): a rule that
 * mostly works is worse than one that is stated. One "n/a" and the column
 * stays text, which the author can see in the editor. A quoted "2400" is
 * still a number under this rule — quoting only protects a comma, it does
 * not change the value.
 */
export function parseDataFile(text: string, filename: string): { rows: unknown; error?: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { rows: null, error: `${filename} is empty` };
  if (/\.json$/i.test(filename)) {
    try {
      return { rows: JSON.parse(trimmed) as unknown };
    } catch (err) {
      return { rows: null, error: `${filename} could not be read as JSON: ${(err as Error).message}` };
    }
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { rows: null, error: `${filename} has a header but no rows` };
  const parsed: string[][] = [];
  for (const line of lines) {
    const cells = splitCsvLine(line);
    if (typeof cells === "string") {
      return { rows: null, error: `${filename} ${cells}` };
    }
    parsed.push(cells);
  }
  const headers = parsed[0];
  const body = parsed.slice(1);
  const numeric = headers.map((_, c) => body.every((r) => r[c] !== undefined && r[c] !== "" && Number.isFinite(Number(r[c]))));
  const rows = body.map((r) => {
    const row: Record<string, unknown> = {};
    headers.forEach((h, c) => {
      const raw = r[c] ?? "";
      row[h] = numeric[c] ? Number(raw) : raw;
    });
    return row;
  });
  return { rows };
}

/** A filename as an asset name: the reference character set, and never one already taken. */
export function assetNameFor(filename: string, taken: readonly string[]): string {
  const base = filename.replace(/\.[^.]+$/, "");
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "data";
  if (!taken.includes(slug)) return slug;
  for (let n = 2; ; n++) if (!taken.includes(`${slug}_${n}`)) return `${slug}_${n}`;
}

/**
 * The name to write at confirm time, and whether writing it overwrites an
 * asset already there. Round 1 review, finding 1: the previous logic deduped
 * against `taken.filter(n => n !== nameInput.value)`, which erased the typed
 * name from the taken list and made every retype of an existing name look
 * free — a silent overwrite reported as "Added".
 *
 * The two cases are genuinely different and both are correct, once told
 * apart: an untouched PREFILL (edited: false) keeps auto-deduping, so a
 * careless confirm can never clobber anything by accident. A name the author
 * actually TYPED (edited: true) is taken at face value — no renaming, no
 * filtering the taken list — because overwriting it is a wanted re-import
 * (the oversize message already tells an author to "re-import the file"),
 * not a bug. The caller reports `replacing` as "Replaced" instead of "Added".
 */
export function pickAssetName(typed: string, edited: boolean, taken: readonly string[]): { name: string; replacing: boolean } {
  const trimmed = typed.trim();
  const name = edited && trimmed !== "" ? trimmed : assetNameFor(trimmed, taken);
  return { name, replacing: taken.includes(name) };
}

let dataSession: InsertSession | null = null;

/** Opens the "Insert data from disk" dialog. Safe to call repeatedly — the
 *  modal is built once and reused, refreshed with whichever `deps` this call
 *  passed (same pattern as openInsertPortrait above). */
export function openInsertData(deps: InsertPortraitDeps): void {
  if (!dataSession) dataSession = buildData();
  dataSession.open(deps);
}

function buildData(): InsertSession {
  // Reassigned on every open() and read only from inside the handlers below,
  // rather than captured once — so a reopen never acts on a stale document.
  let current: InsertPortraitDeps;
  let items: PlaylistItem[] = [];
  /** The picked file's parsed rows and size — null until a file reads cleanly. */
  let picked: { rows: unknown; bytes: number } | null = null;
  /** False for the auto-filled prefill, true the moment the author edits the
   *  Name field by hand — the distinction pickAssetName runs on (round 1
   *  review, finding 1). */
  let nameEdited = false;

  const explanation = h(
    "p",
    { class: "settings-note" },
    "A JSON or CSV file, carried inside the drawcast as an asset. A template's params point at it by name, so a published cast needs none of your files. CSV's header row becomes the keys.",
  );

  const fileInput = h("input", { type: "file", accept: ".json,.csv" }) as HTMLInputElement;
  const partSel = h("select", {}) as HTMLSelectElement;
  const nameInput = h("input", { type: "text", spellcheck: "false" }) as HTMLInputElement;
  const nameNote = h("p", { class: "settings-note" }, "");
  const sizeNote = h("p", { class: "settings-note" }, "");

  const modal = createModal("Insert data from disk", { size: "s" });
  // Detached <dialog>.showModal() throws, and the click then looks like it did
  // nothing at all — the bug that made two dialogs dead from the day they
  // shipped. Attach here, like every other modal in the app.
  document.body.append(modal.dialog);
  modal.body.append(
    explanation,
    h("div", { class: "settings-field" }, fileInput),
    h("div", { class: "settings-field" }, h("label", {}, "Part"), partSel),
    h("div", { class: "settings-field" }, h("label", {}, "Name"), nameInput),
    nameNote,
    sizeNote,
  );

  const insertBtn = h("button", { class: "primary" }, "Insert") as HTMLButtonElement;
  insertBtn.disabled = true;
  modal.footer.append(insertBtn);

  /** Asset names already in the chosen part — what a new name must not collide with. */
  const takenIn = (i: number): string[] => Object.keys(items[i]?.spec.assets ?? {});

  /** Says so BEFORE the click, in the author's own words: a typed name that
   *  matches an asset already in the chosen part will replace it. */
  const updateNameNote = (): void => {
    const typed = nameInput.value.trim();
    const taken = takenIn(Number(partSel.value));
    nameNote.textContent = nameEdited && typed !== "" && taken.includes(typed) ? `Replaces the existing "@${typed}".` : "";
  };

  nameInput.addEventListener("input", () => {
    nameEdited = true;
    updateNameNote();
  });
  partSel.addEventListener("change", () => updateNameNote());

  fileInput.addEventListener("change", () => {
    picked = null;
    insertBtn.disabled = true;
    sizeNote.textContent = "";
    const file = fileInput.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      const { rows, error } = parseDataFile(text, file.name);
      if (error) {
        current.setStatus(error, "error");
        return;
      }
      const bytes = assetBytes(rows);
      // Refused BEFORE anything is embedded, so an oversized file never
      // reaches the document at all.
      if (bytes > ASSET_MAX_BYTES) {
        current.setStatus(`${file.name} is ${formatAssetSize(bytes)} — the limit is ${formatAssetSize(ASSET_MAX_BYTES)}`, "error");
        return;
      }
      picked = { rows, bytes };
      nameInput.value = assetNameFor(file.name, takenIn(Number(partSel.value)));
      nameEdited = false;
      updateNameNote();
      sizeNote.textContent = `${formatAssetSize(bytes)}${Array.isArray(rows) ? `, ${rows.length} rows` : ""}`;
      insertBtn.disabled = false;
    });
  });

  insertBtn.addEventListener("click", () => {
    const playlist = current.readPlaylist();
    if (!playlist || !picked) return;
    const part = Number(partSel.value);
    const item = itemsOf(playlist)[part];
    if (!item) {
      // Same race, same wording as openInsertPortrait's commit(): the chosen
      // part no longer exists in a fresh read, so there is nothing sensible
      // to insert into and nothing was.
      current.setStatus("That part no longer exists in the current text — nothing was inserted.", "error");
      return;
    }
    const { name, replacing } = pickAssetName(nameInput.value, nameEdited, takenIn(part));
    ((item.spec.assets ??= {}) as Record<string, unknown>)[name] = picked.rows;
    current.applyPlaylist(playlist);
    current.setStatus(
      `${replacing ? "Replaced" : "Added"} "@${name}" — ${formatAssetSize(picked.bytes)}. Point a param at it, e.g. set: "@${name}"`,
      "ok",
    );
    modal.dialog.close();
  });

  return {
    open(deps: InsertPortraitDeps) {
      current = deps;
      const playlist = deps.readPlaylist();
      if (!playlist) return; // readPlaylist already reported why
      items = itemsOf(playlist);
      partSel.replaceChildren(
        ...items.map((it, i) => h("option", { value: String(i) }, itemTitle(it) || `Part ${i + 1}`)),
      );
      // The part being VIEWED, never 0 — the bug this file's header comment
      // calls out for portraits, one dialog over.
      partSel.value = String(Math.min(deps.viewedPart(), items.length - 1));
      picked = null;
      fileInput.value = "";
      nameInput.value = "";
      nameEdited = false;
      nameNote.textContent = "";
      sizeNote.textContent = "";
      insertBtn.disabled = true;
      modal.open();
    },
  };
}
