// Warm the card pictures after a production deploy (2026-10-04). A deploy
// empties Netlify's CDN cache, so the first front page after it asked the
// card function for a hundred posters at once: slow, and lookups that timed
// out showed the plain logo. This asks for every card once, a few at a time,
// so visitors find them cached. It never fails the build.
import { readFileSync } from "node:fs";

const CONCURRENCY = 4;
const PER_REQUEST_MS = 20000;
const TOTAL_MS = 180000;
const CATALOGUE = "https://drawcast.anvil.app/_/api/catalogue";

async function json(url, signal) {
  const res = await fetch(url, { signal });
  return res.ok ? res.json() : null;
}

async function names(signal) {
  const out = new Set();
  try {
    for (const e of JSON.parse(readFileSync("src/home/featured.json", "utf8"))) if (e && typeof e.name === "string") out.add(e.name);
  } catch {
    /* no curated list: the catalogue alone */
  }
  for (const kind of ["cast", "course"]) {
    for (let page = 0; page < 10; page++) {
      const d = await json(`${CATALOGUE}?kind=${kind}&page=${page}`, signal).catch(() => null);
      if (!d) break;
      for (const i of d.items ?? []) if (typeof i.name === "string") out.add(i.name);
      if (!d.more) break;
    }
  }
  return [...out];
}

export const onSuccess = async ({ utils }) => {
  if (process.env.CONTEXT !== "production") return;
  const origin = process.env.URL;
  if (!origin) return;
  const deadline = AbortSignal.timeout(TOTAL_MS);
  try {
    const list = await names(deadline);
    let next = 0, ok = 0, miss = 0;
    const worker = async () => {
      while (next < list.length && !deadline.aborted) {
        const name = list[next++];
        try {
          const res = await fetch(`${origin}/card/${encodeURIComponent(name)}.png`, { redirect: "manual", signal: AbortSignal.any([deadline, AbortSignal.timeout(PER_REQUEST_MS)]) });
          res.status === 200 ? ok++ : miss++;
          await res.arrayBuffer().catch(() => {});
        } catch {
          miss++;
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(`warm-cards: ${ok} posters cached, ${miss} without one (of ${list.length})`);
  } catch (e) {
    utils.status.show({ summary: `warm-cards skipped: ${e instanceof Error ? e.message : e}` });
  }
};
