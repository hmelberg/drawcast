// Where the vendored microdata emulator lives and what may be loaded from
// it. Same shape as pylib.ts, and for the same reason: the engine build has
// publicDir: false, so an engine embedded in another host has no mdlib
// folder of its own and must fall back to drawcast's published origin.
//
// The file list is NOT written here. scripts/sync-mdlib.mjs stamps a
// manifest.json into the snapshot, and that manifest is the single source of
// truth at runtime — so a file added upstream cannot drift out of sync with
// a hand-kept list.

import { MDLIB_VERSION } from "./languages";

const PUBLISHED_BASE = `https://hmelberg.github.io/drawcast/mdlib/${MDLIB_VERSION}/`;

/**
 * The vendored files a manifest names, in order. The manifest arrives over
 * the network and its names become paths in the pyodide filesystem, so a
 * name that could climb out of the snapshot directory is refused rather
 * than sanitized.
 */
export function parseMdlibManifest(text: string): string[] {
  const parsed = JSON.parse(text) as { files?: Record<string, string> } | null;
  const files = parsed && typeof parsed === "object" ? parsed.files : undefined;
  if (!files || typeof files !== "object") throw new Error("mdlib manifest has no files");
  const names = Object.keys(files);
  if (names.length === 0) throw new Error("mdlib manifest lists no files");
  for (const n of names) {
    if (n.startsWith("/") || n.split("/").includes("..") || /^[A-Za-z]:/.test(n)) {
      throw new Error(`mdlib manifest: unsafe file name ${JSON.stringify(n)}`);
    }
  }
  return names;
}

let resolved: Promise<{ base: string; runner: string; files: string[] }> | null = null;

/** The snapshot's base URL, drawcast's runner source, and what to install.
 *  Memoized; a failure clears it so a later render retries. */
export function resolveMdlib(): Promise<{ base: string; runner: string; files: string[] }> {
  if (resolved) return resolved;
  resolved = (async () => {
    const w = window as unknown as { DRAWCAST_MDLIB_BASE?: string };
    const candidates = [w.DRAWCAST_MDLIB_BASE, new URL(`mdlib/${MDLIB_VERSION}/`, document.baseURI).href, PUBLISHED_BASE].filter(
      (c): c is string => typeof c === "string" && c !== "",
    );
    for (const base of candidates) {
      try {
        const r = await fetch(base + "drawcast_microdata_runner.py");
        // A host with an SPA fallback answers 200 with its index.html for any
        // path — only a body that IS the runner counts.
        if (!r.ok) continue;
        const runner = await r.text();
        if (!runner.includes("def _md_run(")) continue;
        const m = await fetch(base + "manifest.json");
        if (!m.ok) continue;
        return { base, runner, files: parseMdlibManifest(await m.text()) };
      } catch {
        /* next candidate */
      }
    }
    throw new Error("could not find the microdata emulator files (mdlib)");
  })();
  resolved.catch(() => {
    resolved = null;
  });
  return resolved;
}

export async function fetchMdlibFile(base: string, file: string): Promise<string> {
  const r = await fetch(base + file);
  if (!r.ok) throw new Error(`could not fetch ${file} (${r.status})`);
  return r.text();
}
