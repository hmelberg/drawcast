import { describe, expect, test } from "vitest";
import { layoutElements } from "../src/layout/tier2";
import { flattenDrawables } from "../src/layout/model";
import type { SpecElement } from "../src/spec/types";

const get = (ds: ReturnType<typeof flattenDrawables>, id: string) => ds.find((d) => d.id === id)!;

describe("path smooth + fill", () => {
  const pts: [number, number][] = [[100, 100], [200, 180], [300, 100], [400, 200]];
  test("smooth: many points through the waypoints; start/end anchors unchanged", () => {
    const r = layoutElements([{ id: "p", type: "path", points: pts, smooth: true }] as SpecElement[], undefined);
    const p = get(flattenDrawables(r.drawables), "p") as { pts: [number, number][] };
    expect(p.pts.length).toBe((pts.length - 1) * 8 + 1);
    expect(r.namedAnchors.p.start).toEqual([100, 100]);
    expect(r.namedAnchors.p.end).toEqual([400, 200]);
  });
  test("closed + smooth + fill: a wash area below the outline", () => {
    const r = layoutElements([{ id: "b", type: "path", points: [[0, 0], [100, 0], [100, 100], [0, 100]], closed: true, smooth: true, style: { fill: "#c00" } }] as SpecElement[], undefined);
    const ds = flattenDrawables(r.drawables);
    expect(get(ds, "b_wash")).toMatchObject({ kind: "area" });
    expect(get(ds, "b")).toMatchObject({ kind: "stroke", closed: true });
    expect((get(ds, "b") as { pts: unknown[] }).pts.length).toBe(16);
  });
  test("without smooth the polyline is untouched", () => {
    const r = layoutElements([{ id: "p", type: "path", points: pts }] as SpecElement[], undefined);
    expect((get(flattenDrawables(r.drawables), "p") as { pts: unknown[] }).pts).toEqual(pts);
  });
});
