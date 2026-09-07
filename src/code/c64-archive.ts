// The Internet Archive's Commodore 64 library, as a source the VIEWER picks
// from — nothing hosted by drawcast, nothing chosen by the author.
//
// Which player a pick runs in depends on what the item boots from, and the
// Archive says so itself: every item carries `emulator_ext` (measured
// 2026-09-06 over the whole C64 collection — 96 038 boot from .d64, 2 520
// from .tap, 196 from .prg, 14 from .t64/.crt).
//
//   .prg  → OUR emulator (vc64web + Open ROMs): no click to start, the
//   .crt    keyboard is a joystick from the first frame, our modal. Six of
//           the eight most-downloaded .prg items ran when booted this way;
//           the other two jammed the CPU on the free ROMs. A .crt is a
//           CARTRIDGE: it takes the machine over at reset and never asks the
//           ROMs to load anything, so it is the one format with nothing to
//           go wrong — both in the collection's five were perfect (Joust's
//           unreleased prototype, Nono Pixie), measured 2026-09-07. The file
//           comes from archive.org/cors/, the one path of theirs that
//           answers cross-origin (/download/ redirects to a node that does
//           not).
//   everything else → the ARCHIVE's own player. Disks and tapes need ROMs
//           the free set lacks: a .d64 sits at READY with no drive, a .tap
//           answers ?DEVICE NOT PRESENT (both measured 2026-09-06, with
//           vc64web's own dialogs suppressed). A .t64 is the odd one out: it
//           is a tape ARCHIVE, so it loads into memory with no drive at all
//           — and then does not start, because these titles lean on a BASIC
//           the free ROMs have not finished (`?NOT IMPLEMENTED ERROR`, or a
//           silent RUN). Both tried, both failed, and there are nine of them
//           in the collection, so they stay with the Archive too.
//           archive.org/embed/<id> is their Emularity player with their ROM
//           arrangement, embeddable (no frame-ancestors), click-to-start.
//
// Mounting a 1541 ROM to unlock .d64 was investigated on 2026-09-07 and does
// not work: VirtualC64 accepts a drive ROM only if it is 16384 bytes AND
// starts with one of four original Commodore signatures (or Dolphin DOS) —
// see Emulator/Media/RomFile.cpp. The free MIT one (Pascual_DOS-1541) starts
// 78 D8 A2 and is refused outright, and by its own account does not do fast
// loaders anyway. The full measurement is in the M9 section of
// docs/superpowers/specs/2026-09-05-c64-round-design.md.
//
// The catalogue and the viewer's own URLs always go to vc64web.
//
// Both endpoints answer cross-origin (`access-control-allow-origin: *` on the
// search and metadata APIs, measured), and the search is a plain GET, so the
// tray can call it from the page without a proxy. Dependency-free.

export interface ArchiveHit {
  id: string;
  title: string;
  year?: string;
  /**
   * The file this item boots from, when that file can run in OUR emulator —
   * a ready-to-load URL. Absent means the Archive's own player (see the
   * header): a disk, a tape, or a name we would not put in a URL.
   */
  direct?: string;
}

const ID_RE = /^[A-Za-z0-9._-]+$/;
/** A file name we are willing to address: one path segment, no traversal. */
const FILE_RE = /^[^/\\]+$/;

/**
 * The demoscene half of the collection: pouet.net's C64 productions, as the
 * Archive imported them (245 of them, 147 in one file). Nobody would guess to
 * search for "pouet", so the tray has a button for this — and it is narrowed
 * to what the free ROMs can start, because a demo you watch RIGHT NOW is the
 * point. Famous multi-part demos (We Are Demo, Comaland, Edge of Disgrace)
 * are disk images and are not in here; the plain search still finds them, in
 * the Archive's own player.
 */
const DEMOS = "identifier:pouet_* AND emulator_ext:prg";

/** A full-text search over the Archive's C64 software, newest-popular first. */
export function archiveSearchUrl(query: string, opts: { rows?: number; demos?: boolean } = {}): string {
  const { rows = 12, demos = false } = opts;
  const scope = demos ? `collection:softwarelibrary_c64 AND ${DEMOS}` : "collection:softwarelibrary_c64";
  const q = `${scope} AND (${query.trim().replace(/[()"]/g, " ").trim() || "*"})`;
  const p = new URLSearchParams({ q, rows: String(rows), output: "json", "sort[]": "downloads desc" });
  // emulator_ext/emulator_start ride along in the SEARCH result (measured), so
  // deciding which player a hit needs costs no second request per result.
  return `https://archive.org/advancedsearch.php?${p.toString()}&fl[]=identifier&fl[]=title&fl[]=year&fl[]=emulator_ext&fl[]=emulator_start`;
}

/**
 * The hits out of the search's JSON, in the order the Archive ranked them.
 * `disks` says the viewer has installed a drive ROM, which is the one thing
 * that moves a `.d64` from the Archive's player into ours.
 */
export function parseArchiveSearch(json: unknown, opts: { disks?: boolean } = {}): ArchiveHit[] {
  const docs = (json as { response?: { docs?: unknown[] } })?.response?.docs;
  if (!Array.isArray(docs)) return [];
  const out: ArchiveHit[] = [];
  for (const d of docs) {
    const doc = d as { identifier?: unknown; title?: unknown; year?: unknown; emulator_ext?: unknown; emulator_start?: unknown };
    if (typeof doc.identifier !== "string" || !ID_RE.test(doc.identifier)) continue;
    const title = typeof doc.title === "string" ? doc.title : Array.isArray(doc.title) ? String(doc.title[0] ?? doc.identifier) : doc.identifier;
    const year = typeof doc.year === "string" || typeof doc.year === "number" ? String(doc.year) : undefined;
    const direct = archiveDirectUrl(doc.identifier, doc.emulator_ext, doc.emulator_start, opts);
    out.push({ id: doc.identifier, title, ...(year ? { year } : {}), ...(direct ? { direct } : {}) });
  }
  return out;
}

/** The Archive's own player for an item — what the modal loads. */
export function archiveEmbedUrl(id: string): string | null {
  return ID_RE.test(id) ? `https://archive.org/embed/${id}` : null;
}

/** The item's page — where "Open in new tab" goes. */
export function archivePageUrl(id: string): string {
  return `https://archive.org/details/${id}`;
}

/** What the free ROMs can start on their own: a program, or a cartridge. */
const DIRECT_EXT = ["prg", "crt"];
/** What a drive ROM adds. Tapes are not here: they load and then will not run. */
const DISK_EXT = ["d64", "g64"];

/**
 * The ready-to-load URL for an item the free ROMs can start — or null for
 * everything else. The file name is the Archive's, not ours: it is checked as
 * a single path segment, made to agree with the item's own declared type, and
 * encoded, never pasted into a URL as it came. A name we cannot address is
 * not an error; the item simply goes to the Archive's player like a disk.
 */
export function archiveDirectUrl(id: string, ext: unknown, start: unknown, opts: { disks?: boolean } = {}): string | null {
  if (!ID_RE.test(id)) return null;
  if (typeof ext !== "string") return null;
  const kind = ext.toLowerCase();
  const allowed = opts.disks ? [...DIRECT_EXT, ...DISK_EXT] : DIRECT_EXT;
  if (!allowed.includes(kind)) return null;
  if (typeof start !== "string" || !FILE_RE.test(start) || !start.toLowerCase().endsWith(`.${kind}`)) return null;
  return `https://archive.org/cors/${id}/${encodeURIComponent(start)}`;
}
