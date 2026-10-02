// (Re)builds the offline icon cache, src/scenes/icon-cache.json (round 6 §8):
// every icon keyword the bundled examples and the fewshots ask for — icon
// elements, node icons, card and match icons, per look — resolved through
// Iconify once and stored under its asset name (spec/icon-data.ts
// iconAssetName), so the examples carry keywords only and the lint, the tests
// and the app read the artwork from here with no network.
//
//   npx vite-node scripts/build-icon-cache.ts            add what is missing, drop what no example asks for
//   npx vite-node scripts/build-icon-cache.ts --refresh  fetch every entry again
//   npx vite-node scripts/build-icon-cache.ts --strip    also strip inline icon data from src/examples.json
//   npx vite-node scripts/build-icon-cache.ts --keep     never drop an entry
//
// Also `npm run icons`.
import { readFileSync, writeFileSync } from "node:fs";
import { resolveIcons } from "../src/render/icon";
import { iconAssetName, iconSlots, isIconData, type IconAsk, type IconLook } from "../src/spec/icon-data";
import { itemsOf, parsePlaylistText } from "../src/playlist/playlist";
import type { Spec } from "../src/spec/types";

const CACHE = new URL("../src/scenes/icon-cache.json", import.meta.url);
const EXAMPLES = new URL("../src/examples.json", import.meta.url);
const FEWSHOTS = new URL("../src/llm/prompts/fewshots.json", import.meta.url);
const args = new Set(process.argv.slice(2));

interface Example {
  spec?: Spec;
  playlist?: string;
}

function specsOf(entries: Example[]): Spec[] {
  const out: Spec[] = [];
  for (const e of entries) {
    if (e.spec) out.push(e.spec);
    if (typeof e.playlist === "string") {
      try {
        out.push(...itemsOf(parsePlaylistText(e.playlist)).map((it) => it.spec));
      } catch {
        // a playlist that does not parse has no icons to offer
      }
    }
  }
  return out;
}

const examples = JSON.parse(readFileSync(EXAMPLES, "utf8")) as Example[];
const fewshots = JSON.parse(readFileSync(FEWSHOTS, "utf8")) as unknown;
const fewshotEntries = (Array.isArray(fewshots) ? fewshots : []) as Example[];
const specs = [...specsOf(examples), ...specsOf(fewshotEntries)];

const wanted = new Map<string, { ask: IconAsk; look: IconLook }>();
for (const spec of specs) for (const s of iconSlots(spec)) wanted.set(iconAssetName(s.ask, s.look), { ask: s.ask, look: s.look });

const old = JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, string>;
const next: Record<string, string> = args.has("--keep") ? { ...old } : {};
const failed: string[] = [];
// Iconify's API answers 429 to a burst. The same sets are published as
// @iconify-json packages on jsDelivr: when the API refuses, an SVG is built
// from the package (exactly what the API would have served), and a search
// becomes an exact-name lookup in the sets it named.
const sets = new Map<string, Promise<{ icons: Record<string, { body: string; width?: number; height?: number }>; aliases?: Record<string, { parent: string }>; width?: number; height?: number } | null>>();
const setJson = (prefix: string) => {
  if (!sets.has(prefix)) {
    sets.set(
      prefix,
      globalThis
        .fetch(`https://cdn.jsdelivr.net/npm/@iconify-json/${prefix}/icons.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return sets.get(prefix)!;
};
const reply = (status: number, body: unknown): Response =>
  ({ ok: status === 200, status, json: async () => body, text: async () => body as string }) as unknown as Response;
const realFetch: typeof fetch = async (input, init) => {
  const res = await globalThis.fetch(input, init);
  if (res.status !== 429) return res;
  const url = new URL(String(input));
  if (url.pathname === "/search") {
    const name = (url.searchParams.get("query") ?? "").trim().toLowerCase().replace(/\s+/g, "-");
    const icons: string[] = [];
    for (const prefix of (url.searchParams.get("prefixes") ?? "").split(",")) {
      const j = await setJson(prefix);
      if (j && (j.icons[name] || j.aliases?.[name])) icons.push(`${prefix}:${name}`);
    }
    return reply(200, { icons });
  }
  const m = /^\/([^/]+)\/([^/]+)\.svg$/.exec(url.pathname);
  if (!m) return res;
  const j = await setJson(m[1]);
  const icon = j ? (j.icons[m[2]] ?? (j.aliases?.[m[2]] ? j.icons[j.aliases[m[2]].parent] : undefined)) : undefined;
  if (!j || !icon) return reply(404, "");
  const w = icon.width ?? j.width ?? 16, h = icon.height ?? j.height ?? 16;
  return reply(200, `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 ${w} ${h}">${icon.body}</svg>`);
};
for (const [name, { ask, look }] of [...wanted].sort(([a], [b]) => a.localeCompare(b))) {
  if (!args.has("--refresh") && isIconData(old[name])) {
    next[name] = old[name];
    continue;
  }
  // Iconify answers 429 to a burst: one icon at a time, a breath apart.
  await new Promise((r) => setTimeout(r, 1200));
  const probe = { elements: [{ id: "n", type: "node", shape: "rect", text: "x", icon: ask, icon_look: look }], commands: [] } as unknown as Spec;
  const [r] = await resolveIcons(probe, { fetch: realFetch });
  const data = probe.elements![0].icon_strokes;
  if (r?.ok && isIconData(data)) {
    next[name] = data;
    console.log(`+ ${name}  (${probe.elements![0].credit})`);
  } else {
    // A failed fetch never costs an entry the cache already had.
    if (isIconData(old[name])) next[name] = old[name];
    failed.push(`${name}: ${r?.error ?? "no data"}`);
  }
}

const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(CACHE, `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`${Object.keys(sorted).length} icons in the offline cache (${wanted.size} asked for).`);
if (failed.length) console.log(`not resolved:\n  ${failed.join("\n  ")}`);

if (args.has("--strip")) {
  // Keywords only (round 6 §8): the data, the key it was resolved for, and a
  // credit the data rebuilds all go; the keyword and a pinned set stay.
  let stripped = 0;
  for (const e of examples) {
    if (!e.spec) continue;
    for (const s of iconSlots(e.spec)) {
      const host = s.host;
      if (host[s.data] === undefined && host.icon_key === undefined && host.match_icon_key === undefined) continue;
      if (isIconData(host[s.data]) || typeof host[s.data] === "string") {
        delete host[s.data];
        stripped++;
      }
      delete host[s.data === "match_icon_strokes" ? "match_icon_key" : "icon_key"];
      delete host[s.credit];
    }
  }
  writeFileSync(EXAMPLES, `${JSON.stringify(examples, null, 2)}\n`);
  console.log(`stripped ${stripped} inline icon data fields from src/examples.json`);
}
