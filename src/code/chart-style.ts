// How a matplotlib figure LOOKS — the one token an author sets, and the
// Python that carries it out.
//
// Two grounds for this file existing. First, a chart drawn by a script is the
// only ink in drawcast that does not come from the app's own hand: everything
// else is sketched in the figure's palette on the figure's paper, and
// matplotlib's factory default (a white card, blue-and-orange lines, a black
// frame) lands in the middle of a drawing like a screenshot. Second, rcParams
// are GLOBAL and outlive a run, so styling has to start by resetting them or
// the second script in a lesson inherits the first one's look.
//
// python only. The light tiers' "matplotlib" is a plotly-backed emulation
// with no rcParams to set (public/pylib/<v>/brython/matplotlib_brython.py) —
// the lint says so rather than this failing quietly.

import { COLORS } from "../layout/model";

export const CHART_STYLES = ["seaborn", "xkcd", "plain", "native"] as const;
export type ChartStyle = (typeof CHART_STYLES)[number];

/**
 * What a code element gets when it says nothing: xkcd, in EVERY drawing style
 * (Hans, 2026-09-16, after seeing it live). This function first returned
 * seaborn for the clean renderer — but "clean" is only the strokes: the app's
 * own default (src/store.ts) and the text in BOTH styles are handwritten, so
 * a ruled matplotlib chart was the one foreign object on a clean page too.
 * An author who wants the calm grid writes `chart: "seaborn"` (or "plain")
 * and gets it.
 *
 * The parameter stays, and so does the threading behind it (render/code.ts,
 * render/sweep-run.ts, the tray through RenderHandle.style): it costs one
 * argument, and the next ruling about a style may well use it.
 */
export function defaultChartStyle(_render: "sketchy" | "clean" | undefined): ChartStyle {
  return "xkcd";
}

/** The face the xkcd style draws its text in: the app's own sketch font
 *  (public/fonts/patrickhand/), so a chart's labels are written in the same
 *  hand as every other word in the figure. matplotlib's own xkcd list asks
 *  for Humor Sans, which no runtime ships — the fallback is a plain sans, and
 *  a plain sans in a hand-drawn figure is exactly what this round is about. */
const FONT_FAMILY = "Patrick Hand";
const FONT_PATH = "/tmp/PatrickHand-Regular.ttf";

export function isChartStyle(x: unknown): x is ChartStyle {
  return typeof x === "string" && (CHART_STYLES as readonly string[]).includes(x);
}

/** Only these tiers have a real plotting library to style: matplotlib, and
 *  R's ggplot (a theme per run, code/harvest-r.ts). */
export function stylable(language: string): boolean {
  return language === "python" || language === "r";
}

/** A script that never plots pays nothing — importing matplotlib to set
 *  rcParams would be the most expensive no-op in the app. */
export function plots(code: string, language = "python"): boolean {
  return language === "r" ? /\b(ggplot|qplot)\b/.test(code) : /\b(matplotlib|pyplot|plt|seaborn|sns)\b/.test(code);
}

/** Whether the chart style changes what a run draws (and so its cache key). */
export function styled(code: string, language: string): boolean {
  return stylable(language) && plots(code, language);
}

/**
 * The chart style a code element runs with — the ONE place it is decided
 * (Hans 2026-09-26: "the user should be able to choose … in a tutorial we
 * would like to keep the native R or Python feel; at other times the
 * drawcast feel"). An explicit `chart` wins; then `look`; and with neither,
 * a script whose CODE is on screen — a lesson — looks native, and any other
 * (output only, knobs only, a calculation) looks like the drawing.
 */
export function chartFor(
  el: { chart?: unknown; feel?: unknown; show?: unknown; pane?: unknown },
  render?: "sketchy" | "clean",
): ChartStyle {
  if (isChartStyle(el.chart)) return el.chart;
  const codeShown = ["left", "right", "above", "below", "code"].includes(String(el.show)) && el.pane !== "controls";
  const feel = el.feel === "native" || el.feel === "drawcast" ? el.feel : codeShown ? "native" : "drawcast";
  return feel === "native" ? "native" : defaultChartStyle(render);
}

/**
 * The Python that fetches the handwriting face into the interpreter's FS and
 * registers it with matplotlib — ONCE per session (the file survives in
 * MEMFS, so the existence check is the whole cache). Top-level `await` is
 * legal here because the prelude runs through `runPythonAsync`.
 *
 * Empty without a URL: only the caller knows the app's origin (node tests
 * have no `location`, and Python cannot guess it), and a missing font is not
 * worth a broken fetch — xkcd's own fallback face draws the chart instead.
 */
function fontLines(fontUrl: string | undefined): string[] {
  if (!fontUrl) return [];
  return [
    "    import os as _os, matplotlib.font_manager",
    `    if not _os.path.exists(${JSON.stringify(FONT_PATH)}):`,
    "        from pyodide.http import pyfetch as _pyfetch",
    `        _resp = await _pyfetch(${JSON.stringify(fontUrl)})`,
    "        _data = await _resp.bytes()",
    `        with open(${JSON.stringify(FONT_PATH)}, "wb") as _f:`,
    "            _f.write(_data)",
    `    _m.font_manager.fontManager.addfont(${JSON.stringify(FONT_PATH)})`,
    // AFTER _plt.xkcd(), which sets its own font.family list (Humor Sans and
    // friends); the size xkcd picked is left alone.
    `    _m.rcParams["font.family"] = ${JSON.stringify(FONT_FAMILY)}`,
  ];
}

/**
 * The Python to run BEFORE the script — as its own statement, never prepended
 * to the source, so a traceback still names the line the author wrote.
 * Returns "" when there is nothing to do.
 *
 * `opts.fontUrl` is where the handwriting face can be fetched from (the app
 * origin's /fonts/…). The caller supplies it; see fontLines above.
 */
export function chartPrelude(style: ChartStyle, code: string, language: string, opts: { fontUrl?: string } = {}): string {
  if (language !== "python" || !plots(code)) return "";
  // Native: matplotlib's own defaults, and nothing of an earlier run's style
  // (rcParams are global and outlive a run).
  if (style === "native") return ["try:", "    import matplotlib as _m", "    _m.rcdefaults()", "except Exception:", "    pass"].join("\n");
  // The grid has to read on the figure's cream paper: matplotlib's own white
  // grid lines (what every seaborn style ships) would be invisible there, and
  // its black frame is heavier than anything else in the drawing.
  const grid = "#d8d2c4";
  const look =
    style === "xkcd"
      ? "    _plt.xkcd()\n"
      : style === "seaborn"
        ? '    _plt.style.use("seaborn-v0_8-whitegrid")\n'
        : "";
  return [
    "try:",
    "    import matplotlib as _m, matplotlib.pyplot as _plt, logging as _lg",
    // xkcd asks for fonts no runtime ships; the fallback is fine, its warning
    // in the output pane is not.
    '    _lg.getLogger("matplotlib.font_manager").setLevel(_lg.ERROR)',
    "    _m.rcdefaults()",
    look.replace(/\n$/, ""),
    ...(style === "xkcd" ? fontLines(opts.fontUrl) : []),
    "    _m.rcParams.update({",
    '        "figure.facecolor": "none", "axes.facecolor": "none", "savefig.facecolor": "none",',
    `        "text.color": "${COLORS.ink}", "axes.labelcolor": "${COLORS.ink}", "axes.edgecolor": "${COLORS.ink}",`,
    `        "xtick.color": "${COLORS.guide}", "ytick.color": "${COLORS.guide}",`,
    `        "grid.color": "${grid}", "grid.linewidth": 0.9,`,
    `        "axes.prop_cycle": _plt.cycler(color=${JSON.stringify([...COLORS.series])}),`,
    "    })",
    "except Exception:",
    "    pass",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
