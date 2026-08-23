import { describe, expect, test } from "vitest";
import { radialGradientParts } from "../src/render/svg-backend";

// Pure attribute-building only — the vitest environment is node, so the DOM
// assembly path (appendRadialGradient) is exercised by the visual gate, not here.
describe("radialGradientParts", () => {
  test("defaults: r=0.5, no focal offset attrs when unset", () => {
    const p = radialGradientParts({ stops: [{ offset: 0, color: "#fff" }, { offset: 1, color: "#000" }] });
    expect(p.attrs).toEqual({ r: "0.5" });
    expect(p.stops).toEqual([
      { offset: "0%", "stop-color": "#fff" },
      { offset: "100%", "stop-color": "#000" },
    ]);
  });

  test("focal point and radius pass through; offsets become percentages in order", () => {
    const p = radialGradientParts({
      fx: 0.32, fy: 0.3, r: 0.75,
      stops: [
        { offset: 0, color: "#e8f1f8" },
        { offset: 0.55, color: "#bcd2e0" },
        { offset: 1, color: "#4a5a66", opacity: 0.9 },
      ],
    });
    expect(p.attrs).toEqual({ fx: "0.32", fy: "0.3", r: "0.75" });
    expect(p.stops[1]).toEqual({ offset: "55%", "stop-color": "#bcd2e0" });
    expect(p.stops[2]).toEqual({ offset: "100%", "stop-color": "#4a5a66", "stop-opacity": "0.9" });
  });
});
