// The vendored pure-Python libraries the dialects load lazily: which file
// serves which import name, what it depends on, and which token in a script
// (df.plot) pulls it in without an import. Ported from openstat's
// LIB_REGISTRY + scanImports; over-matching is harmless (a library the
// script never uses loads once), under-matching surfaces as the script's
// own honest ModuleNotFoundError.
//
// Where the files live: candidates in order — an explicit
// window.DRAWCAST_PYLIB_BASE, the app's own pylib/<version>/ (dev server,
// Pages, Netlify), and drawcast's published origin (the engine vendored
// into another host has no pylib folder of its own; the engine build has
// publicDir: false). The first candidate that serves the runner wins.
import { PYLIB_VERSION } from "./languages";

export interface PyLib {
  file: string;
  /** Import names that resolve to this module; a dotted alias must follow its parent. */
  aliases: string[];
  deps: string[];
  /** Substrings whose presence loads the module even without an import. */
  tokens?: string[];
}

export const BRYTHON_LIBS: Record<string, PyLib> = {
  pandas_brython: { file: "brython/pandas_brython.py", aliases: ["pandas"], deps: [] },
  plotly_express_brython: { file: "brython/plotly_express_brython.py", aliases: ["plotly", "plotly.express"], deps: [], tokens: [".plot"] },
  numpy_brython: { file: "brython/numpy_brython.py", aliases: ["numpy"], deps: [] },
  matplotlib_brython: { file: "brython/matplotlib_brython.py", aliases: ["matplotlib", "matplotlib.pyplot"], deps: ["plotly_express_brython"] },
  scipy_stats_brython: { file: "brython/scipy_stats_brython.py", aliases: ["scipy", "scipy.stats"], deps: [] },
  statsmodels_brython: {
    file: "brython/statsmodels_brython.py",
    aliases: ["statsmodels", "statsmodels.formula", "statsmodels.formula.api"],
    deps: ["scipy_stats_brython"],
  },
  seaborn_brython: { file: "brython/seaborn_brython.py", aliases: ["seaborn"], deps: ["matplotlib_brython", "plotly_express_brython"] },
};

/** The minimal tier's set: openstat ships only these two for MicroPython
 *  (numpy/matplotlib/scipy/statsmodels/seaborn emulations are Brython-only). */
export const MICROPYTHON_LIBS: Record<string, PyLib> = {
  pandas_mpy: { file: "micropython/pandas_mpy.py", aliases: ["pandas"], deps: [] },
  plotly_express_mpy: { file: "micropython/plotly_express_mpy.py", aliases: ["plotly", "plotly.express"], deps: [], tokens: [".plot"] },
};

const PUBLISHED_BASE = `https://hmelberg.github.io/drawcast/pylib/${PYLIB_VERSION}/`;

function canonicalOf(name: string, libs: Record<string, PyLib>): string | null {
  const root = name.split(".")[0];
  if (libs[root]) return root;
  for (const [key, lib] of Object.entries(libs)) if (lib.aliases.includes(root)) return key;
  return null;
}

/** Canonical module names a script needs, dependencies first, each once. */
export function libsFor(code: string, libs: Record<string, PyLib>): string[] {
  const wanted: string[] = [];
  const want = (name: string) => {
    const c = canonicalOf(name, libs);
    if (c && !wanted.includes(c)) wanted.push(c);
  };
  for (const [key, lib] of Object.entries(libs)) {
    if (lib.tokens?.some((t) => code.includes(t))) want(key);
  }
  const re = /^[ \t]*(?:from[ \t]+([A-Za-z_][A-Za-z0-9_.]*)|import[ \t]+([^#\r\n]+))/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m[1]) want(m[1]);
    else
      for (const part of m[2].split(",")) {
        const t = part.trim().split(/[ \t]/)[0];
        if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(t)) want(t);
      }
  }
  const out: string[] = [];
  const visit = (name: string, trail: string[]) => {
    if (out.includes(name)) return;
    if (trail.includes(name)) throw new Error(`circular pylib dependency: ${[...trail, name].join(" → ")}`);
    for (const d of libs[name].deps) visit(d, [...trail, name]);
    out.push(name);
  };
  for (const w of wanted) visit(w, []);
  return out;
}

let resolved: Promise<{ base: string; runner: string }> | null = null;

/** The base URL the library files load from, plus the runner's source
 *  (fetched as the probe). Memoized; a failure clears it so a later render
 *  retries. */
export function resolvePylib(): Promise<{ base: string; runner: string }> {
  if (resolved) return resolved;
  resolved = (async () => {
    const w = window as unknown as { DRAWCAST_PYLIB_BASE?: string };
    const candidates = [w.DRAWCAST_PYLIB_BASE, new URL(`pylib/${PYLIB_VERSION}/`, document.baseURI).href, PUBLISHED_BASE].filter(
      (c): c is string => typeof c === "string" && c !== "",
    );
    for (const base of candidates) {
      try {
        const r = await fetch(base + "drawcast_runner.py");
        // A host with an SPA fallback answers 200 with its index.html for
        // any path — only a body that is the runner counts.
        if (r.ok) {
          const text = await r.text();
          if (text.includes("def _run(")) return { base, runner: text };
        }
      } catch {
        /* next candidate */
      }
    }
    throw new Error("could not find the Python library files (pylib)");
  })();
  resolved.catch(() => {
    resolved = null;
  });
  return resolved;
}

export async function fetchLib(base: string, file: string): Promise<string> {
  const r = await fetch(base + file);
  if (!r.ok) throw new Error(`could not fetch ${file} (${r.status})`);
  return r.text();
}
