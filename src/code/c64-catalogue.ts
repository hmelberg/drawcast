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
  /** Why we may point at it: the SPDX licence of its repository, or whose demo it is. */
  licence: string;
}

// Every URL below was checked 2026-09-05: an https host that answers
// cross-origin (`access-control-allow-origin: *`), a real PRG (the two
// load-address bytes 01 08), and a repository whose LICENSE says it may be
// shared. GitHub's raw files are the ideal host for that: the licence sits
// beside the file, and CORS is on for the whole domain.
export const C64_PROGRAMS: readonly C64Program[] = [
  {
    key: "c64maze",
    title: "C64maze",
    url: "https://raw.githubusercontent.com/DarwinNE/C64maze/master/c64maze.prg",
    note: "A 3D maze to find your way out of, written in C — the most-starred open C64 game on GitHub.",
    licence: "GPL-3.0 (github.com/DarwinNE/C64maze)",
  },
  {
    key: "crowboy",
    title: "Crowboy",
    url: "https://raw.githubusercontent.com/de-mux/c64-crowboy-demo/master/crowboy.prg",
    note: "A side-scrolling beat-em-up demo: sprites, scrolling, a joystick.",
    licence: "MIT (github.com/de-mux/c64-crowboy-demo)",
  },
  {
    key: "space-shooter",
    title: "Space Shooter",
    url: "https://raw.githubusercontent.com/lvcabral/spaceshooter/master/space-shooter.prg",
    note: "A vertical shooter from the RetroGameDev book's example, extended.",
    licence: "MIT (github.com/lvcabral/spaceshooter)",
  },
  {
    key: "tenlander",
    title: "Ten-line Lander",
    url: "https://raw.githubusercontent.com/rosdec/lander64/master/tenliner/tenlander.prg",
    note: "A lunar lander in ten lines of BASIC — 749 bytes, and it LISTs.",
    licence: "GPL-3.0 (github.com/rosdec/lander64)",
  },
  {
    key: "wolfling",
    title: "Wolfling",
    // vc64web's own demonstration program, served from their docs with CORS —
    // the one URL the emulator's authors publish for exactly this use.
    url: "https://vc64web.github.io/doc/media/wolfling14.prg",
    note: "A small platform game — the demo vc64web's own documentation ships.",
    licence: "vc64web's own demonstration file, on their URL",
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
