// The publish panel's "Narration voices" (2026-10-07): the cast's own voice
// for each speaker — a (the narrator, or the explainer in a dialogue) and b
// (the other voice of a dialogue) — and, for a Gemini voice, the style it
// speaks in. What it returns is written into the document's `voices:` header
// at publish (as the thumbnail's `thumb:` is), so the cast sounds the same
// wherever it is played or re-recorded. Empty: the author's Settings voices.

import { GEMINI_VOICES, readCastVoices, splitVoiceSpec, type CastVoices } from "../export/gemini-tts";
import { h } from "./dom";

/** The voices offered, grouped: Studio (Cloud), then Gemini, then Gemini Lite. */
const STUDIO = [
  { id: "en-US-Studio-Q", label: "Studio Q (male, the default narrator)" },
  { id: "en-US-Studio-O", label: "Studio O (female)" },
];

export interface VoicesChoice {
  root: HTMLElement;
  refresh(opts: { voices: CastVoices | undefined; dialogue: boolean }): void;
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
  const hint = h("div", { class: "hint" }, "Written into the cast as you choose, so it sounds the same everywhere. Gemini voices are cheaper than Studio and act on a style; they need your own Google key with the Gemini API allowed.");
  const root = h("details", { class: "publish-choice publish-voices" }, h("summary", {}, "Narration voices"), a.root, b.root, hint);
  // Each change goes straight into the document (its `voices:` header), so
  // every way of publishing — and the editor's own playback — uses it.
  report = () => opts.onChange?.(readCastVoices({ a: a.value(), b: b.value() }) ?? null);
  return {
    root,
    refresh({ voices, dialogue }) {
      a.set(voices?.a);
      b.set(voices?.b);
      b.root.hidden = !dialogue && !voices?.b;
      if (voices) (root as HTMLDetailsElement).open = true;
    },
    value() {
      return readCastVoices({ a: a.value(), b: b.value() }) ?? null;
    },
  };
}
