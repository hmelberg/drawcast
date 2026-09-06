// The BodyParts3D catalogue and fetcher. The GitHub mirror holds one binary
// STL per LEAF element (FMA<id>.stl, a few BP<id>.stl); composites — heart,
// brain, skull, rib cage, the sets of hand and foot bones — exist only as rows
// in composite_parts.txt. Hand and foot bone sets are laterality-neutral and
// list "scaphoid", "right scaphoid" and "left scaphoid" alike; a sided part
// keeps only the elements named for its side.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MIRROR = "https://raw.githubusercontent.com/Kevin-Mattheus-Moerman/BodyParts3D/main/assets/BodyParts3D_data/";

const rows = (text) => text.split(/\r?\n/).slice(1).filter((l) => l.trim() !== "").map((l) => l.split("\t"));

/** parts_list_e.txt + composite_parts.txt → { names, composites }. */
export function parseCatalogue(partsText, compositeText) {
  const names = new Map();
  for (const [id, name] of rows(partsText)) names.set(id, name);
  const composites = new Map();
  for (const [cid, , eid, ename] of rows(compositeText)) {
    if (!composites.has(cid)) composites.set(cid, []);
    composites.get(cid).push({ id: eid, name: ename });
    if (!names.has(eid)) names.set(eid, ename);
  }
  return { names, composites };
}

/** The element ids a part is made of. */
export function elementsFor(cat, spec) {
  let ids;
  if (spec.composite) {
    const els = cat.composites.get(spec.composite);
    if (!els) throw new Error(`composite ${spec.composite} is not in composite_parts.txt`);
    let keep = els;
    if (spec.side) {
      const word = new RegExp(`\\b${spec.side}\\b`);
      keep = keep.filter((e) => word.test(e.name));
    }
    if (spec.filter) keep = keep.filter((e) => spec.filter.test(e.name));
    ids = keep.map((e) => e.id);
  } else {
    ids = [...(spec.fma ?? [])];
  }
  if (spec.exclude) ids = ids.filter((id) => !spec.exclude.includes(id));
  return ids;
}

const HEADERS = { "user-agent": "drawcast/1.0 (anatomy atlas build)" };

/** One STL from the cache or the mirror. null when the mirror has no such file
 *  (remembered as <id>.missing so the build never asks twice). */
export async function fetchStl(id, { cacheDir, mirror = MIRROR, fetchImpl = fetch, log = () => {} }) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${id}.stl`);
  const miss = join(cacheDir, `${id}.missing`);
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  if (existsSync(miss)) return null;
  const url = `${mirror}stl/${id}.stl`;
  const res = await fetchImpl(url, { headers: HEADERS });
  if (res.status === 404) {
    writeFileSync(miss, "404");
    log(`  ${id}: not in the mirror`);
    return null;
  }
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(file, bytes);
  log(`  ${id}: ${(bytes.length / 1024).toFixed(0)} KB`);
  return bytes;
}

/** parts_list_e.txt and composite_parts.txt, cached like the meshes. */
export async function fetchCatalogue({ cacheDir, mirror = MIRROR, fetchImpl = fetch }) {
  mkdirSync(cacheDir, { recursive: true });
  const get = async (name) => {
    const file = join(cacheDir, name);
    if (existsSync(file)) return readFileSync(file, "utf8");
    const res = await fetchImpl(`${mirror}${name}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`${mirror}${name}: HTTP ${res.status}`);
    const text = await res.text();
    writeFileSync(file, text);
    return text;
  };
  return parseCatalogue(await get("parts_list_e.txt"), await get("composite_parts.txt"));
}
