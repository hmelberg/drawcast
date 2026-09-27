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
