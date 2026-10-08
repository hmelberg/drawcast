// The publish panel's "Narration voices" (2026-10-07): the cast's own voice
// for each speaker — a (the narrator, or the explainer in a dialogue) and b
// (the other voice of a dialogue) — and, for a Gemini voice, the style it
// speaks in. What it returns is written into the document's `voices:` header
// at publish (as the thumbnail's `thumb:` is), so the cast sounds the same
// wherever it is played or re-recorded. Empty: the author's Settings voices.

import { GEMINI_VOICES, readCastVoices, splitVoiceSpec, type CastVoices } from "../export/gemini-tts";
import { stampedVoice, runLang } from "../export/tts";
import { linesToBake } from "../export/bake";
import { isGeminiLine } from "../export/gemini-batch";
import type { SpeakLine } from "../render/delivery";
import type { AudioTrack } from "../playlist/playlist";
import { h } from "./dom";

/** How many of a cast's Gemini lines have no clip in their current voice. */
export function notYetRecorded(lines: SpeakLine[], existing: AudioTrack["lines"], voices: Record<string, string>, lang: string | undefined): number {
  const gem = lines.filter((l) => isGeminiLine(voices, lang, l));
  return linesToBake(gem, existing, (l) => stampedVoice(voices, runLang(l, lang), l)).length;
}

/** The voices offered, grouped: Studio (Cloud), then Gemini, then Gemini Lite. */
const STUDIO = [
  { id: "en-US-Studio-Q", label: "Studio Q (male, the default narrator)" },
  { id: "en-US-Studio-O", label: "Studio O (female)" },
];

export interface VoicesChoice {
  root: HTMLElement;
  /**
   * `pending`: how many Gemini lines have no clip in the voices given (the
   * cast's own recorded narration) — recounted on every change, so a new
   * style shows at once how many lines it would re-record.
   */
  refresh(opts: { voices: CastVoices | undefined; dialogue: boolean; pending?: (voices: CastVoices | undefined) => number }): void;
  /** The voices as chosen, or null for none (the header is removed). */
  value(): CastVoices | null;
}

export function voicesChoice(opts: { listen?: (spec: string, text: string) => Promise<void>; onChange?: (voices: CastVoices | null) => void } = {}): VoicesChoice {
  let report = (): void => {};
  const row = (who: "a" | "b", label: string, sample: string) => {
    const sel = h("select", { id: `share-voice-${who}` }) as HTMLSelectElement;
    sel.append(
      h("option", { value: "" }, "Default (Settings)"),
      h("optgroup", { label: "Google Studio" }, ...STUDIO.map((v) => h("option", { value: v.id }, v.label))),
      h("optgroup", { label: "Gemini 3.8 Flash TTS — takes a style" }, ...GEMINI_VOICES.map((v) => h("option", { value: `gemini:${v.name}` }, `${v.name} — ${v.note}`))),
      h("optgroup", { label: "Gemini 3.8 Flash-Lite TTS (cheaper)" }, ...GEMINI_VOICES.map((v) => h("option", { value: `gemini-lite:${v.name}` }, `${v.name} (Lite) — ${v.note}`))),
    );
    const style = h("input", { type: "text", id: `share-voice-${who}-style`, placeholder: "style, e.g. dry, warm historian", maxlength: "160" }) as HTMLInputElement;
    const listen = h("button", { type: "button", class: "publish-listen" }, "Listen") as HTMLButtonElement;
    const sync = (): void => {
      const gem = sel.value.startsWith("gemini");
      style.disabled = !gem;
      style.title = gem ? "How this voice should speak (Gemini acts on it)" : "Only a Gemini voice takes a style";
      listen.disabled = !opts.listen || !sel.value;
    };
    sel.addEventListener("change", () => (sync(), report()));
    style.addEventListener("change", () => report());
    listen.addEventListener("click", () => {
      const spec = value();
      if (!spec || !opts.listen) return;
      listen.disabled = true;
      listen.textContent = "…";
      void opts.listen(spec, sample).finally(() => {
        listen.textContent = "Listen";
        sync();
      });
    });
    const value = (): string => {
      const v = sel.value;
      const s = style.value.trim();
      return v ? (v.startsWith("gemini") && s ? `${v} | ${s}` : v) : "";
    };
    const set = (spec: string | undefined): void => {
      const { voice, style: st } = splitVoiceSpec(spec ?? "");
      // A voice the list does not offer (a hand-written Cloud name) is kept as its own option.
      if (voice && ![...sel.options].some((o) => o.value === voice)) sel.append(h("option", { value: voice }, voice));
      sel.value = voice;
      style.value = st ?? "";
      sync();
    };
    const root = h("div", { class: "publish-voice-row" }, h("label", { for: `share-voice-${who}` }, label), sel, style, listen);
    return { root, value, set };
  };
  const a = row("a", "Narrator (a)", "Here is a question worth asking, and here is how we will answer it.");
  const b = row("b", "Second voice (b)", "Wait, so that's not the whole story?");
  // How Gemini voices are recorded (spec 2026-10-08): a whole conversation
  // per stretch (the default), or line by line. Only a Gemini voice has a take.
  const takeSel = h(
    "select",
    { id: "share-voice-take" },
    h("option", { value: "conversation" }, "Conversation (default)"),
    h("option", { value: "lines" }, "Line by line"),
  ) as HTMLSelectElement;
  takeSel.addEventListener("change", () => report());
  const takeRow = h("div", { class: "publish-voice-row publish-voice-take" }, h("label", { for: "share-voice-take" }, "Recorded as"), takeSel);
  const pendingNote = h("div", { class: "hint publish-voice-pending", hidden: "" });
  const hint = h("div", { class: "hint" }, "Written into the cast as you choose, so it sounds the same everywhere. Gemini voices are cheaper than Studio and act on a style; they need your own Google key with the Gemini API allowed. The editor plays recorded Gemini lines from its clip store and the rest in the Studio voice; publishing records them.");
  const root = h("details", { class: "publish-choice publish-voices" }, h("summary", {}, "Narration voices"), a.root, b.root, takeRow, pendingNote, hint);
  let pendingOf: ((voices: CastVoices | undefined) => number) | undefined;
  const current = (): CastVoices | undefined => {
    const gem = a.value().startsWith("gemini") || b.value().startsWith("gemini");
    return readCastVoices({ a: a.value(), b: b.value(), ...(gem && takeSel.value === "lines" ? { take: "lines" } : {}) });
  };
  const sync = (): void => {
    const v = current();
    takeRow.hidden = !(a.value().startsWith("gemini") || b.value().startsWith("gemini"));
    const n = pendingOf ? pendingOf(v) : 0;
    pendingNote.hidden = n <= 0;
    pendingNote.textContent = n > 0 ? `${n} line${n === 1 ? "" : "s"} not yet recorded in Gemini` : "";
  };
  // Each change goes straight into the document (its `voices:` header), so
  // every way of publishing — and the editor's own playback — uses it.
  report = () => {
    sync();
    opts.onChange?.(current() ?? null);
  };
  return {
    root,
    refresh({ voices, dialogue, pending }) {
      a.set(voices?.a);
      b.set(voices?.b);
      takeSel.value = voices?.take === "lines" ? "lines" : "conversation";
      b.root.hidden = !dialogue && !voices?.b;
      pendingOf = pending;
      sync();
      if (voices) (root as HTMLDetailsElement).open = true;
    },
    value() {
      return current() ?? null;
    },
  };
}
