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

/** What a code element gets when it says nothing: the calm gridded look. */
export const DEFAULT_CHART_STYLE: ChartStyle = "seaborn";

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
 * The Python to run BEFORE the script — as its own statement, never prepended
 * to the source, so a traceback still names the line the author wrote.
 * Returns "" when there is nothing to do.
 */
export function chartPrelude(style: ChartStyle, code: string, language: string): string {
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
