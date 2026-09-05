// The Internet Archive's Commodore 64 library, as a source the VIEWER picks
// from — nothing hosted by drawcast, nothing chosen by the author.
//
// Why it runs in the Archive's OWN emulator and not in vc64web: the Archive's
// C64 items are almost all .d64 disk images (one of the sixty most-downloaded
// had anything else), and the MEGA65 Open ROMs vc64web boots with have no
// disk-drive ROM — a .d64 there ends in a dialog asking for a floppy ROM
// (measured 2026-09-05). archive.org/embed/<id> is the Archive's Emularity
// player with the Archive's own ROM arrangement, embeddable (no
// frame-ancestors), click-to-start. So: catalogue and own URLs → vc64web;
// Archive picks → the Archive.
//
// Both endpoints answer cross-origin (`access-control-allow-origin: *` on the
// search and metadata APIs, measured), and the search is a plain GET, so the
// tray can call it from the page without a proxy. Dependency-free.

export interface ArchiveHit {
  id: string;
  title: string;
  year?: string;
}

const ID_RE = /^[A-Za-z0-9._-]+$/;

/** A full-text search over the Archive's C64 software, newest-popular first. */
export function archiveSearchUrl(query: string, rows = 12): string {
  const q = `collection:softwarelibrary_c64 AND (${query.trim().replace(/[()"]/g, " ").trim() || "*"})`;
  const p = new URLSearchParams({ q, rows: String(rows), output: "json", "sort[]": "downloads desc" });
  return `https://archive.org/advancedsearch.php?${p.toString()}&fl[]=identifier&fl[]=title&fl[]=year`;
}

/** The hits out of the search's JSON, in the order the Archive ranked them. */
export function parseArchiveSearch(json: unknown): ArchiveHit[] {
  const docs = (json as { response?: { docs?: unknown[] } })?.response?.docs;
  if (!Array.isArray(docs)) return [];
  const out: ArchiveHit[] = [];
  for (const d of docs) {
    const doc = d as { identifier?: unknown; title?: unknown; year?: unknown };
    if (typeof doc.identifier !== "string" || !ID_RE.test(doc.identifier)) continue;
    const title = typeof doc.title === "string" ? doc.title : Array.isArray(doc.title) ? String(doc.title[0] ?? doc.identifier) : doc.identifier;
    const year = typeof doc.year === "string" || typeof doc.year === "number" ? String(doc.year) : undefined;
    out.push({ id: doc.identifier, title, ...(year ? { year } : {}) });
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
