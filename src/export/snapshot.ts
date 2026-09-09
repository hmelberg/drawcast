// Visual repair's eyes (freehand-figures Task 14): render a spec's last
// frame off-screen and hand back a PNG data URL, so the compile round can
// show the model exactly what the viewer would see. Browser-only — a no-DOM
// environment (vitest's node environment, a future server-side compile) gets
// null back rather than a fabricated image, the same "no DOM, no side
// effect" guard render/index.ts's ensureFonts uses.

import { render } from "../render";
import type { Spec } from "../spec/types";
import { paintFrame, sketchFontStyle } from "./video";

export async function snapshotPng(spec: Spec): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px";
  document.body.appendChild(host);
  try {
    const hd = await render(spec, host, { mode: "silent" });
    try {
      hd.timeline.renderUpTo(hd.plan.steps.length);
      const svg = host.querySelector<SVGSVGElement>("svg.cs-svg");
      if (!svg) return null;
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      await paintFrame(canvas.getContext("2d")!, new XMLSerializer().serializeToString(svg), await sketchFontStyle(), "", spec.title ?? "");
      return canvas.toDataURL("image/png");
    } finally {
      hd.destroy();
    }
  } finally {
    host.remove();
  }
}
