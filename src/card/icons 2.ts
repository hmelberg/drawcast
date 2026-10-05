// The drawings of a card's named icons (2026-10-05): a card names its icons
// (`twemoji:shark`) instead of carrying their SVG, and the page fetches every
// name it needs from Iconify — one request per icon set, cached here and by
// the browser — the same source the player already draws them from
// (render/icon.ts). Nothing is fetched from drawcast.app.

import type { Icons } from "./draw";

const ICONIFY = "https://api.iconify.design";
/** Iconify's names: a set prefix and an icon name, letters, digits and dashes. */
const NAME_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/;

const known: Icons = {};
const pending = new Map<string, Promise<void>>();

interface IconifyJson {
  prefix?: string;
  width?: number;
  height?: number;
  icons?: Record<string, { body?: string; width?: number; height?: number; left?: number; top?: number }>;
}

/** One icon set's answer as SVG markup by `set:name`. */
export function iconsFromJson(json: IconifyJson): Icons {
  const out: Icons = {};
  const prefix = json.prefix ?? "";
  for (const [name, icon] of Object.entries(json.icons ?? {})) {
    if (!icon?.body) continue;
    const w = icon.width ?? json.width ?? 16;
    const h = icon.height ?? json.height ?? 16;
    out[`${prefix}:${name}`] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.left ?? 0} ${icon.top ?? 0} ${w} ${h}">${icon.body}</svg>`;
  }
  return out;
}

/** Names asked for in the same moment (a page drawing all its cards), fetched together. */
let queued = new Set<string>();
let flush: Promise<void> | null = null;

function fetchSet(set: string, list: string[], fetchImpl: typeof fetch): Promise<void> {
  return fetchImpl(`${ICONIFY}/${set}.json?icons=${list.join(",")}`, { signal: AbortSignal.timeout(10_000) })
    .then((r) => (r.ok ? (r.json() as Promise<IconifyJson>) : null))
    .then((json) => {
      if (json) Object.assign(known, iconsFromJson(json));
    })
    .catch(() => undefined);
}

/**
 * The drawings for `names` (valid Iconify names only). Every name asked for
 * before the next task — a page drawing forty cards — goes out together, one
 * request per icon set (60 names at most each), and is remembered. A name
 * that fails is simply absent: the card draws without that icon.
 */
export async function loadIcons(names: Iterable<string>, fetchImpl: typeof fetch = fetch): Promise<Icons> {
  const want = [...new Set(names)].filter((n) => NAME_RE.test(n));
  for (const n of want) if (!(n in known) && !pending.has(n)) queued.add(n);
  if (queued.size && !flush) {
    flush = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(async () => {
      const batch = [...queued];
      queued = new Set();
      flush = null;
      const bySet = new Map<string, string[]>();
      for (const n of batch) {
        const [, set, name] = NAME_RE.exec(n)!;
        bySet.set(set, [...(bySet.get(set) ?? []), name]);
      }
      const jobs: Promise<void>[] = [];
      for (const [set, list] of bySet)
        for (let i = 0; i < list.length; i += 60) {
          const chunk = list.slice(i, i + 60);
          const job = fetchSet(set, chunk, fetchImpl).finally(() => chunk.forEach((name) => pending.delete(`${set}:${name}`)));
          chunk.forEach((name) => pending.set(`${set}:${name}`, job));
          jobs.push(job);
        }
      await Promise.all(jobs);
    });
  }
  const wait = flush;
  if (wait) await wait;
  await Promise.all(want.map((n) => pending.get(n)).filter(Boolean));
  const out: Icons = {};
  for (const n of want) if (known[n]) out[n] = known[n];
  return out;
}
