// The Internet Archive's Commodore 64 library, as a source the VIEWER picks
// from — nothing hosted by drawcast, nothing chosen by the author.
//
// Which player a pick runs in depends on what the item boots from, and the
// Archive says so itself: every item carries `emulator_ext` (measured
// 2026-09-06 over the whole C64 collection — 96 038 boot from .d64, 2 520
// from .tap, 196 from .prg, 14 from .t64/.crt).
//
//   .prg  → OUR emulator (vc64web + Open ROMs): no click to start, the
//           keyboard is a joystick from the first frame, our modal. Six of
//           the eight most-downloaded ran when booted this way; the other
//           two jammed the CPU on the free ROMs. The file comes from
//           archive.org/cors/, the one path of theirs that answers
//           cross-origin (/download/ redirects to a node that does not).
//   everything else → the ARCHIVE's own player. Disks and tapes need ROMs
//           the free set lacks: a .d64 sits at READY with no drive, a .tap
//           answers ?DEVICE NOT PRESENT (both measured 2026-09-06, with
//           vc64web's own dialogs suppressed). archive.org/embed/<id> is
//           their Emularity player with their ROM arrangement, embeddable
//           (no frame-ancestors), click-to-start.
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

/** A full-text search over the Archive's C64 software, newest-popular first. */
export function archiveSearchUrl(query: string, rows = 12): string {
  const q = `collection:softwarelibrary_c64 AND (${query.trim().replace(/[()"]/g, " ").trim() || "*"})`;
  const p = new URLSearchParams({ q, rows: String(rows), output: "json", "sort[]": "downloads desc" });
  // emulator_ext/emulator_start ride along in the SEARCH result (measured), so
  // deciding which player a hit needs costs no second request per result.
  return `https://archive.org/advancedsearch.php?${p.toString()}&fl[]=identifier&fl[]=title&fl[]=year&fl[]=emulator_ext&fl[]=emulator_start`;
}

/** The hits out of the search's JSON, in the order the Archive ranked them. */
export function parseArchiveSearch(json: unknown): ArchiveHit[] {
  const docs = (json as { response?: { docs?: unknown[] } })?.response?.docs;
  if (!Array.isArray(docs)) return [];
  const out: ArchiveHit[] = [];
  for (const d of docs) {
    const doc = d as { identifier?: unknown; title?: unknown; year?: unknown; emulator_ext?: unknown; emulator_start?: unknown };
    if (typeof doc.identifier !== "string" || !ID_RE.test(doc.identifier)) continue;
    const title = typeof doc.title === "string" ? doc.title : Array.isArray(doc.title) ? String(doc.title[0] ?? doc.identifier) : doc.identifier;
    const year = typeof doc.year === "string" || typeof doc.year === "number" ? String(doc.year) : undefined;
    const direct = archiveDirectUrl(doc.identifier, doc.emulator_ext, doc.emulator_start);
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

/**
 * The ready-to-load URL for an item that boots from a .prg — the only kind
 * the free ROMs can start — or null for everything else. The file name is the
 * Archive's, not ours: it is checked as a single path segment and encoded,
 * never pasted into a URL as it came. A name we cannot address is not an
 * error; the item simply goes to the Archive's player like a disk.
 */
export function archiveDirectUrl(id: string, ext: unknown, start: unknown): string | null {
  if (!ID_RE.test(id)) return null;
  if (typeof ext !== "string" || ext.toLowerCase() !== "prg") return null;
  if (typeof start !== "string" || !FILE_RE.test(start) || !start.toLowerCase().endsWith(".prg")) return null;
  return `https://archive.org/cors/${id}/${encodeURIComponent(start)}`;
}
