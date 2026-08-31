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
import type { Spec, SpecElement } from "../spec/types";
import { itemsOf, itemTitle, type Playlist, type PlaylistItem } from "../playlist/playlist";
import { createModal } from "./modal";
import { h } from "./dom";

export type PortraitSource = { of: string } | { url: string } | { strokes: string };

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

type SourceMode = "name" | "url" | "file";

interface InsertSession {
  open(deps: InsertPortraitDeps): void;
}

let session: InsertSession | null = null;

/** Opens the "Insert portrait" dialog. Safe to call repeatedly — the modal is
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
    // tooltip a touch device never showed in the first place. The "leave it
    // empty" instruction is gone because there is no longer one shared field
    // to leave empty; the three ways now have their own radio each.
    "A portrait: a person's name (Wikipedia lookup), an image URL, or a picked file — traced into sketch strokes in the house style.",
  );

  const nameRadio = h("input", { type: "radio", name: "portrait-source", value: "name", checked: "" }) as HTMLInputElement;
  const urlRadio = h("input", { type: "radio", name: "portrait-source", value: "url" }) as HTMLInputElement;
  const fileRadio = h("input", { type: "radio", name: "portrait-source", value: "file" }) as HTMLInputElement;

  const nameInput = h("input", { type: "text", placeholder: "A person's name" }) as HTMLInputElement;
  const urlInput = h("input", { type: "text", placeholder: "https://…" }) as HTMLInputElement;
  urlInput.hidden = true;
  const fileInput = h("input", { type: "file", accept: "image/*" }) as HTMLInputElement;
  fileInput.hidden = true;

  const sourceMode = (): SourceMode => (fileRadio.checked ? "file" : urlRadio.checked ? "url" : "name");
  const syncSourceMode = (): void => {
    const mode = sourceMode();
    nameInput.hidden = mode !== "name";
    urlInput.hidden = mode !== "url";
    fileInput.hidden = mode !== "file";
  };
  for (const r of [nameRadio, urlRadio, fileRadio]) r.addEventListener("change", syncSourceMode);

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

  const modal = createModal("Insert portrait", { size: "s" });
  modal.body.append(
    explanation,
    h(
      "div",
      { class: "settings-field" },
      h("label", { class: "settings-check" }, nameRadio, " By name"),
      h("label", { class: "settings-check" }, urlRadio, " Image URL"),
      h("label", { class: "settings-check" }, fileRadio, " From file"),
    ),
    h("div", { class: "settings-field" }, nameInput, urlInput, fileInput),
    h("div", { class: "settings-field" }, h("label", {}, "Part"), partSel),
    h("div", { class: "settings-field" }, h("label", {}, "Place"), placeSel),
    h("div", { class: "settings-field" }, h("label", {}, "After step"), afterInput),
  );

  const insertBtn = h("button", { class: "primary" }, "Insert");
  modal.footer.append(insertBtn);

  /** Insert, patch in anything portraitInsert's typed source can't carry, apply, close. */
  const commit = (playlist: Playlist, part: number, source: PortraitSource, cameo: boolean, afterStep: number, patch?: (el: SpecElement) => void): void => {
    const result = portraitInsert(playlist, { source, part, cameo, afterStep });
    const els = itemsOf(result)[part]?.spec.elements ?? [];
    const el = els[els.length - 1];
    if (patch && el) patch(el);
    current.applyPlaylist(result);
    current.setStatus(el ? `Portrait "${el.id}" inserted into "${itemTitle(itemsOf(result)[part])}".` : "Portrait inserted.", "ok");
    modal.dialog.close();
  };

  insertBtn.addEventListener("click", () => {
    const playlist = current.readPlaylist();
    if (!playlist) return; // readPlaylist already reported why
    const part = Number(partSel.value) || 0;
    const cameo = placeSel.value === "cameo";
    const afterStep = Math.max(0, Math.floor(Number(afterInput.value) || 0));
    const mode = sourceMode();

    if (mode === "file") {
      const file = fileInput.files?.[0];
      if (!file) {
        current.setStatus("Choose a file to trace.", "error");
        return;
      }
      current.setStatus("Tracing portrait…", "ok");
      insertBtn.disabled = true;
      void traceFromBlob(file)
        .then((encoded) => {
          // PortraitSource's `strokes` branch is a single-key union — it can't
          // also carry the filename-derived caption/provenance the old file
          // flow set, so those are patched onto the element after insertion
          // (same fields, same values, as before: a file has no regenerable
          // source, so the strokes embed and the filename is all there is).
          const base = file.name.replace(/\.[a-z0-9]+$/i, "");
          commit(playlist, part, { strokes: encoded }, cameo, afterStep, (el) => {
            el.source = file.name;
            el.of = base;
          });
        })
        .catch((err: Error) => current.setStatus(`Portrait failed: ${err.message}`, "error"))
        .finally(() => (insertBtn.disabled = false));
      return;
    }

    const raw = (mode === "url" ? urlInput.value : nameInput.value).trim();
    if (!raw) {
      current.setStatus(mode === "url" ? "Enter an image URL." : "Enter a name.", "error");
      return;
    }
    const source: PortraitSource = mode === "url" ? { url: raw } : { of: raw };
    current.setStatus("Tracing portrait…", "ok");
    insertBtn.disabled = true;
    // Resolve eagerly, against a throwaway probe element, so a misspelled
    // name or a CORS-blocked URL fails LOUDLY here and now — not as a silent
    // placeholder at playback. The probe is never inserted; only its
    // ok/error result is used, same as the flow this replaces.
    const probe: Spec = { elements: [{ id: "probe", type: "portrait", ...source } as SpecElement], commands: [] };
    void resolvePortraits(probe)
      .then((results) => {
        const r = results[0];
        if (!r?.ok) {
          current.setStatus(`Portrait failed: ${r?.error ?? "unknown error"}`, "error");
          return;
        }
        commit(playlist, part, source, cameo, afterStep);
      })
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
      nameRadio.checked = true;
      urlRadio.checked = false;
      fileRadio.checked = false;
      nameInput.value = "";
      urlInput.value = "";
      fileInput.value = "";
      syncSourceMode();
      modal.open();
    },
  };
}
