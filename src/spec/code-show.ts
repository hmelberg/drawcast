// The ONE rule for a code element's `show` when the author left it out —
// read by the layout (layout/code.ts) and by lint (lint/lint.ts) alike, so
// the two can never disagree about what an unset `show` means.
//
// A script with controls — sliders in the tray or knobs drawn on the canvas
// (`pane: "controls"`) — defaults to its output on top and the code or the
// knobs UNDER it, full width (Hans 2026-09-23): the viewer turns a knob and
// watches the picture change, never a pane beside the picture unless the
// request asks. A plain script keeps showing its output alone.

export type CodeShow = "output" | "left" | "right" | "above" | "below" | "code" | "none";

export function effectiveShow(el: { show?: string; controls?: string[] }): CodeShow {
  if (el.show !== undefined) return el.show as CodeShow;
  return (el.controls?.length ?? 0) > 0 ? "below" : "output";
}
