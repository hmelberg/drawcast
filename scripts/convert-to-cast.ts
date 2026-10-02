// Convert a folder's drawcast files from .yaml to .cast (2026-10-03).
//   npx vite-node scripts/convert-to-cast.ts <folder> [--write] [--delete]
// Without --write it only reports what it would do. Every file is converted
// in memory first and read back; if ANY file would not come back identical,
// nothing at all is written. --write writes each <name>.cast beside its
// .yaml and points course.md's `file:` lines at the .cast; --delete also
// removes the .yaml. Files that are not drawcasts (storyboards, manifests,
// template packs) are left alone. Runs locally only: it never touches git.
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { formatPublished, parsePlaylistText, type Playlist } from "../src/playlist/playlist";
import { normalizeSpec } from "../src/spec/schema";

const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
const norm = (p: Playlist) => JSON.stringify(canon({ meta: p.meta, audio: p.audio ?? null, warnings: p.warnings, entries: p.entries.map((e) => (e.kind === "item" ? { kind: "item", spec: normalizeSpec(e.spec) } : e)) }));

function* yamls(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* yamls(p);
    else if (/\.ya?ml$/i.test(name)) yield p;
  }
}

const [root, ...flags] = process.argv.slice(2);
if (!root) throw new Error("usage: convert-to-cast.ts <folder> [--write] [--delete]");
const write = flags.includes("--write");
const del = flags.includes("--delete");

const plan: { from: string; to: string; text: string }[] = [];
const refused: string[] = [];
for (const f of yamls(root)) {
  let p: Playlist;
  try {
    p = parsePlaylistText(readFileSync(f, "utf8"));
  } catch {
    continue;
  }
  if (!p.entries.some((e) => e.kind === "item" && ((e.spec.commands?.length ?? 0) > 0 || e.spec.template || e.spec.elements?.length))) continue;
  const text = formatPublished(p, p.audio ?? null, "script");
  const to = f.replace(/\.ya?ml$/i, ".cast");
  if (norm(parsePlaylistText(text)) !== norm(p)) refused.push(relative(root, f));
  else if (existsSync(to)) refused.push(`${relative(root, to)} already exists`);
  else plan.push({ from: f, to, text });
}
if (refused.length > 0) {
  console.log(`Nothing written — these would not convert exactly:\n  ${refused.join("\n  ")}`);
  process.exit(1);
}

// course.md files whose `file:` lines name a converted lecture.
const renamed = new Map(plan.map((x) => [relative(root, x.from), relative(root, x.to)]));
const courses: { path: string; text: string }[] = [];
for (const f of [...yamls(root)].map((y) => join(y, "..")).filter((d, i, all) => all.indexOf(d) === i)) {
  const md = join(f, "course.md");
  if (!existsSync(md)) continue;
  const before = readFileSync(md, "utf8");
  const after = before.replace(/(\bfile:\s*)([^\s·]+\.ya?ml)\b/g, (m, lead: string, file: string) => {
    const key = relative(root, join(f, file));
    return renamed.has(key) ? `${lead}${file.replace(/\.ya?ml$/i, ".cast")}` : m;
  });
  if (after !== before) courses.push({ path: md, text: after });
}

for (const x of plan) console.log(`${write ? "wrote" : "would write"} ${relative(root, x.to)}${del ? (write ? " (removed the .yaml)" : " (and remove the .yaml)") : ""}`);
for (const c of courses) console.log(`${write ? "updated" : "would update"} ${relative(root, c.path)}`);
if (write) {
  for (const x of plan) {
    writeFileSync(x.to, x.text);
    if (del) unlinkSync(x.from);
  }
  for (const c of courses) writeFileSync(c.path, c.text);
}
console.log(`${plan.length} file(s)${write ? "" : " — dry run, nothing written (add --write)"}`);
