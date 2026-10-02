// The one word a right answer earns (Hans 2026-09-27: "if you answer a
// question correctly, maybe not repeat it … just say 'correct'"). In the
// language the cast is written in — its declared `lang`, else what the
// question reads as — so a Norwegian cast says "Riktig". A subtitle or voice
// track translates it like any other line: subtitles.ts offers it.
import { detectLang } from "./speech";

const CORRECT: Record<string, string> = {
  en: "Correct.",
  nb: "Riktig.",
  nn: "Rett.",
  no: "Riktig.",
  sv: "Rätt.",
  da: "Rigtigt.",
  de: "Richtig.",
  nl: "Goed.",
  fr: "Exact.",
  es: "Correcto.",
  it: "Esatto.",
  pt: "Correto.",
  fi: "Oikein.",
  pl: "Dobrze.",
};

export function correctWord(lang: string | null | undefined, question: string): string {
  const code = (lang ?? detectLang(question)).toLowerCase().split("-")[0];
  return CORRECT[code] ?? CORRECT.en;
}

/** What castLang reads: the narration and the questions. */
interface CastText {
  lang?: string | null;
  commands?: { speak?: string; ask?: { question?: string }; quiz?: { question?: string } }[];
}

/**
 * The language a cast is written in: its declared `lang`, else what its
 * narration and questions read as (detectLang) — a generated Norwegian cast
 * often has no lang. Null when there is nothing to read. One rule for the
 * words the player and the gates say themselves (the dock, Correct, the
 * bundled English feedback lines, which only an English cast hears).
 */
export function castLang(spec: CastText): string | null {
  if (spec.lang) return spec.lang;
  const text = (spec.commands ?? []).map((c) => [c.speak, c.ask?.question, c.quiz?.question].filter((t) => typeof t === "string").join(" ")).join(" ").trim();
  return text ? detectLang(text) : null;
}

