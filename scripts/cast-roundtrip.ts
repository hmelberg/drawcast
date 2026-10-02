// Does every drawcast file under a folder survive YAML → .cast → playlist?
// The gate before any real file is converted (2026-10-03, .cast files):
//   npx vite-node scripts/cast-roundtrip.ts <folder>
// Prints one line per file that does not come back identical (and why), then
// a tally. Exit code 1 when any file fails. Reads only; writes nothing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { formatPublished, parsePlaylistText, type Playlist } from "../src/playlist/playlist";
import { normalizeSpec } from "../src/spec/schema";

const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;

function diff(a: unknown, b: unknown, path = ""): string[] {
  if (JSON.stringify(canon(a)) === JSON.stringify(canon(b))) return [];
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    return [...keys].flatMap((k) => diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`));
  }
  return [`${path}: ${JSON.stringify(a)?.slice(0, 100)} → ${JSON.stringify(b)?.slice(0, 100)}`];
}

const norm = (p: Playlist) => ({ meta: p.meta, audio: p.audio ?? null, entries: p.entries.map((e) => (e.kind === "item" ? { kind: "item", spec: normalizeSpec(e.spec) } : e)) });

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ya?ml|json)$/i.test(name)) yield p;
  }
}

const root = process.argv[2];
if (!root) throw new Error("usage: cast-roundtrip.ts <folder>");
let ok = 0, failed = 0, skipped = 0;
for (const f of files(root)) {
  let p: Playlist;
  try {
    p = parsePlaylistText(readFileSync(f, "utf8"));
  } catch {
    skipped++; // not a drawcast (a manifest, a storyboard)
    continue;
  }
  if (!p.entries.some((e) => e.kind === "item" && ((e.spec.commands?.length ?? 0) > 0 || e.spec.template))) { skipped++; continue; }
  try {
    const back = parsePlaylistText(formatPublished(p, p.audio ?? null, "script"));
    const d = diff(norm(p), norm(back));
    if (d.length === 0 && JSON.stringify(back.warnings) === JSON.stringify(p.warnings)) { ok++; continue; }
    failed++;
    console.log(`FAIL ${f}\n  ${[...d.slice(0, 6), ...(d.length === 0 ? [`warnings ${JSON.stringify(p.warnings)} → ${JSON.stringify(back.warnings)}`] : [])].join("\n  ")}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${f}\n  ${(err as Error).message}`);
  }
}
console.log(`${ok} ok, ${failed} failed, ${skipped} not drawcasts`);
process.exit(failed > 0 ? 1 : 0);
