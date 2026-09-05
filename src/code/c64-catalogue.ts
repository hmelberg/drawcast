// The programs a viewer can put on the drawn machine, and the rule for what a
// `game` value means.
//
// A catalogue, and not just a URL field, for one reason that matters more than
// convenience: WITHOUT a list the compiler invents .prg URLs — the house rule
// for portraits and sources ("never invent a URL") has no honest way to hold
// for programs. With it, `game` may be a KEY from this list, the schema tells
// the model the keys, and a lesson about game history gets a program that
// actually loads.
//
// Every entry must be somewhere the emulator page can FETCH: vc64web's page
// loads the program from its own origin, so the host has to answer
// cross-origin. Measured 2026-09-05: GitHub Pages (hmelberg.github.io,
// vc64web.github.io) send `access-control-allow-origin: *`; csdb.dk sends no
// CORS header at all, even with an Origin — a program there fails silently
// in the viewer's browser, so the lint names it. Hans's own files go in
// public/c64/ (published to hmelberg.github.io/drawcast/c64/ and
// drawcast.app, CORS for free); only programs he has the right to distribute.

export interface C64Program {
  /** What an author writes in `game` — short, lowercase, hyphenated. */
  key: string;
  title: string;
  url: string;
  /** One line for the tray and the prompt: what it is, whose, when. */
  note: string;
}

export const C64_PROGRAMS: readonly C64Program[] = [
  {
    key: "wolfling",
    title: "Wolfling",
    // vc64web's own demonstration program, served from their docs with CORS —
    // the one URL the emulator's authors publish for exactly this use.
    url: "https://vc64web.github.io/doc/media/wolfling14.prg",
    note: "A small platform game — the demo vc64web's own documentation ships.",
  },
];

/** Hosts measured to refuse cross-origin fetches (no ACAO header, 2026-09-05). */
export const NO_CORS_HOSTS: readonly string[] = ["csdb.dk", "www.csdb.dk"];

export function programByKey(key: string): C64Program | undefined {
  return C64_PROGRAMS.find((p) => p.key === key);
}

/**
 * What a `game` value points at: a catalogue key, or an https URL as written.
 * Null for a value that is neither — the lint and the tray both refuse it,
 * with the same reason.
 */
export function resolveGame(value: string): { url: string; title: string; reason?: undefined } | { url?: undefined; title?: undefined; reason: string } {
  const known = programByKey(value);
  if (known) return { url: known.url, title: known.title };
  if (!/^https:\/\//.test(value)) return { reason: `"${value}" is neither a catalogue key (${C64_PROGRAMS.map((p) => p.key).join(", ")}) nor an https URL — the emulator page is https and cannot fetch anything else` };
  if (value.includes("#")) return { reason: "the program URL may not contain '#' — it is passed in the emulator's own hash" };
  try {
    const host = new URL(value).hostname;
    if (NO_CORS_HOSTS.includes(host)) return { reason: `${host} sends no CORS header, so the emulator page cannot fetch from it — host the file on GitHub Pages instead` };
  } catch {
    return { reason: `"${value}" is not a valid URL` };
  }
  return { url: value, title: value.split("/").pop() ?? value };
}
