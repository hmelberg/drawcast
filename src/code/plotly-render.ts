// plotly.js as a static-image renderer, shared by every runtime that yields
// plotly figure JSON (pyodide's plotly, the dialects' plotly.express
// emulation, later R's ggplotly): offscreen newPlot → toImage PNG at 2×, so
// a chart drops into the SVG scene and the video export like any matplotlib
// image. Live interactivity is the overlay of a later round, not this.
//
// Browser-only (it appends a hidden div to render into); the runtime
// modules that call it already refuse to run without a DOM.

import type { CodeFigure } from "./envelope";

/** openstat's production pin — the family's verified plotly.js. */
const PLOTLY_JS_URL = "https://cdn.plot.ly/plotly-2.32.0.min.js";

interface PlotlyJs {
  newPlot(el: HTMLElement, data: unknown[], layout: object, config?: object): Promise<unknown>;
  toImage(el: HTMLElement, opts: { format: string; width: number; height: number; scale?: number }): Promise<string>;
  purge(el: HTMLElement): void;
}

let plotlyPromise: Promise<PlotlyJs> | null = null;
export function loadPlotly(): Promise<PlotlyJs> {
  if (plotlyPromise) return plotlyPromise;
  plotlyPromise = new Promise<PlotlyJs>((resolve, reject) => {
    const w = window as unknown as { Plotly?: PlotlyJs };
    if (w.Plotly) return resolve(w.Plotly);
    const script = document.createElement("script");
    script.src = PLOTLY_JS_URL;
    script.onload = () => (w.Plotly ? resolve(w.Plotly) : reject(new Error("plotly.js loaded but exposed no global")));
    script.onerror = () => reject(new Error("could not load plotly.js"));
    document.head.appendChild(script);
  });
  // A failed load must not poison every later render: clear so the next retries.
  plotlyPromise.catch(() => {
    plotlyPromise = null;
  });
  return plotlyPromise;
}

/** Each plotly figure (fig.to_json()) → offscreen render → static PNG data
 *  URI at 2× scale. A figure without layout width/height gets plotly's
 *  700 × 450 default, so every runtime's charts share one aspect. */
export async function renderPlotlyFigures(jsons: string[]): Promise<CodeFigure[]> {
  const plotly = await loadPlotly();
  const out: CodeFigure[] = [];
  for (const j of jsons) {
    const fig = JSON.parse(j) as { data?: unknown[]; layout?: { width?: number; height?: number } };
    const w = fig.layout?.width ?? 700;
    const h = fig.layout?.height ?? 450;
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-10000px;top:0;";
    document.body.appendChild(holder);
    try {
      await plotly.newPlot(holder, fig.data ?? [], { ...fig.layout, width: w, height: h }, { staticPlot: true });
      const href = await plotly.toImage(holder, { format: "png", width: w, height: h, scale: 2 });
      out.push({ href, w: w * 2, h: h * 2 });
    } finally {
      plotly.purge(holder);
      holder.remove();
    }
  }
  return out;
}
