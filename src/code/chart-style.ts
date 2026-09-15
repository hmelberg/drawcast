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

export const CHART_STYLES = ["seaborn", "xkcd", "plain"] as const;
export type ChartStyle = (typeof CHART_STYLES)[number];

/**
 * What a code element gets when it says nothing: the look the DRAWING has.
 * A figure sketched by hand has no business carrying one machine-ruled chart
 * in the middle of it — so the hand-drawn renderer gets matplotlib's xkcd
 * wobble (in the app's own handwriting, see chartPrelude), and the clean one
 * gets the calm grid. Undefined is sketchy: that is render()'s own default
 * (src/render/index.ts, `options.style ?? "sketchy"`).
 */
export function defaultChartStyle(render: "sketchy" | "clean" | undefined): ChartStyle {
  return render === "clean" ? "seaborn" : "xkcd";
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

/** Only these tiers have a real matplotlib to style. */
export function stylable(language: string): boolean {
  return language === "python";
}

/** A script that never mentions matplotlib pays nothing — importing it to set
 *  rcParams would be the most expensive no-op in the app. */
export function plots(code: string): boolean {
  return /\b(matplotlib|pyplot|plt|seaborn|sns)\b/.test(code);
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
  if (!stylable(language) || !plots(code)) return "";
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
