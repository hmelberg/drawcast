// Licence table for the Iconify prefixes `icon.ts` is willing to draw an
// icon from. Every icon element ends up with a `credit` line built from this
// table, so an icon element always names its set and licence — the same
// promise `image.ts` makes for Commons photos.
//
// `cls` gates what a set may be used for:
//   "permissive" — ISC/MIT/Apache: free reuse, no attribution obligation.
//                  Tried first (DEFAULT_PREFIXES).
//   "by"         — CC BY: free reuse, attribution required (the `credit`
//                  line IS the attribution). Tried second (BY_PREFIXES).
//   "by-sa"      — CC BY-SA: share-alike. Fine when the author names the set
//                  explicitly, but never picked as an unattended seed
//                  (`opts.forSeed`) — share-alike terms would then apply to
//                  the whole document without the author having agreed to it.
//   "logo"       — trademarked brand marks (simple-icons). Never resolvable
//                  at all: a brand logo is not a free icon, no matter who
//                  asks for it.
export const ICON_SETS: Record<string, { licence: string; cls: "permissive" | "by" | "by-sa" | "logo" }> = {
  lucide: { licence: "ISC", cls: "permissive" },
  tabler: { licence: "MIT", cls: "permissive" },
  ph: { licence: "MIT", cls: "permissive" },
  heroicons: { licence: "MIT", cls: "permissive" },
  "material-symbols": { licence: "Apache-2.0", cls: "permissive" },
  "fa6-solid": { licence: "CC BY 4.0", cls: "by" },
  "fa6-regular": { licence: "CC BY 4.0", cls: "by" },
  twemoji: { licence: "CC BY 4.0", cls: "by" },
  openmoji: { licence: "CC BY-SA 4.0", cls: "by-sa" },
  "simple-icons": { licence: "trademarked logo", cls: "logo" },
};
