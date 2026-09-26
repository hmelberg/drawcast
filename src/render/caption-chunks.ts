// A spoken line as the caption shows it: pages of at most two lines, each
// shown while its words are said (Hans, 2026-09-26, agreeing to "a fixed band
// of at most two lines … chunked by phrase, pop-on, not roll-up"). A long
// line used to grow the band to four lines over the lower third of the
// figure; scrolling was the other idea, and was turned down because moving
// text is harder to read than text that holds still — subtitles for
// recorded video page, only live TV rolls.
//
// Where a line breaks, in order of preference: between sentences, at a
// clause (, ; : or a dash), then between words. Pure, for the tests.

/** Split `text` into pages of at most `budget` characters, preferring the strongest breaks. */
export function chunkCaption(text: string, budget: number): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (t === "") return [""];
  if (t.length <= budget) return [t];
  const units = pieces(t, budget, 0);
  const pages: string[] = [];
  let cur = "";
  for (const u of units) {
    const next = cur === "" ? u : `${cur} ${u}`;
    if (next.length <= budget) cur = next;
    else {
      if (cur !== "") pages.push(cur);
      cur = u;
    }
  }
  if (cur !== "") pages.push(cur);
  return balanceTail(pages, budget);
}

const LEVELS: RegExp[] = [
  /(?<=[.!?…]["”’)]?)\s+/, // sentences
  /(?<=[,;:])\s+|\s+(?=[—–]\s)/, // clauses, and before a dash
  /\s+/, // words
];

/** The text cut at the strongest level that makes every piece fit, recursing into any piece still too long. */
function pieces(text: string, budget: number, level: number): string[] {
  if (text.length <= budget || level >= LEVELS.length) return [text];
  const parts = text.split(LEVELS[level]).filter((p) => p !== "");
  if (parts.length === 1) return pieces(text, budget, level + 1);
  return parts.flatMap((p) => (p.length <= budget ? [p] : pieces(p, budget, level + 1)));
}

/** A last page of a word or two reads as an afterthought: take words from the page before until the two are closer in size. */
function balanceTail(pages: string[], budget: number): string[] {
  if (pages.length < 2) return pages;
  const last = pages[pages.length - 1];
  if (last.length >= budget * 0.3) return pages;
  const prev = pages[pages.length - 2].split(" ");
  let tail = last;
  while (prev.length > 1) {
    const moved = `${prev[prev.length - 1]} ${tail}`;
    const rest = prev.slice(0, -1).join(" ");
    if (moved.length > budget || moved.length > rest.length) break;
    prev.pop();
    tail = moved;
  }
  return [...pages.slice(0, -2), prev.join(" "), tail];
}

/** When each page after the first comes up, in ms from the start of the voice: by its share of the characters. */
export function pageTimes(pages: string[], durationMs: number): number[] {
  const total = pages.reduce((n, p) => n + p.length, 0) || 1;
  const at: number[] = [];
  let acc = 0;
  for (let k = 0; k < pages.length - 1; k++) {
    acc += pages[k].length;
    at.push((durationMs * acc) / total);
  }
  return at;
}
