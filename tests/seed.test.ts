import { describe, expect, test } from "vitest";
import { attachSeedCredit, seedBlock } from "../src/llm/seed";

const ring = Array.from({ length: 200 }, (_, i): [number, number] => [0.5 + 0.4 * Math.cos((i / 200) * 2 * Math.PI), 0.5 + 0.4 * Math.sin((i / 200) * 2 * Math.PI)]);

// Fine detail spread evenly across the whole span: RDP can't collapse this
// below 40 points before its epsilon ceiling, so the decimation fallback
// must kick in.
const zigzag = Array.from({ length: 400 }, (_, i): [number, number] => {
  const radius = i % 2 === 0 ? 0.1 : 0.9;
  const theta = (i / 400) * 2 * Math.PI;
  return [0.5 + radius * Math.cos(theta), 0.5 + radius * Math.sin(theta)];
});
const BOX = 300, CX = 500, CY = 375;
const toBoxPt = ([u, v]: [number, number]): number[] => [Math.round(CX - BOX / 2 + u * BOX), Math.round(CY + BOX / 2 - v * BOX)];

describe("seedBlock", () => {
  test("simplifies to ≤ 40 points per path, names parts seed_k, wraps in a fitted group", () => {
    const s = seedBlock("bicycle pump", [ring, [[0, 0], [1, 1]]], "pump from lucide · ISC");
    expect(s.ids).toEqual(["seed_1", "seed_2"]);
    const json = JSON.parse(s.text.slice(s.text.indexOf("["), s.text.lastIndexOf("]") + 1)) as { id: string; type: string; points?: number[][]; members?: string[]; fit?: string }[];
    expect(json.find((e) => e.id === "seed_1")!.points!.length).toBeLessThanOrEqual(40);
    expect(json.find((e) => e.id === "seed")).toMatchObject({ type: "group", members: ["seed_1", "seed_2"], fit: "left" });
    expect(s.text).toMatch(/keep, edit, rename, extend or drop/);
  });
  test("a ring RDP cannot shrink below 40 is decimated to exactly 40, keeping the first point", () => {
    const s = seedBlock("x", [zigzag], "c");
    const json = JSON.parse(s.text.slice(s.text.indexOf("["), s.text.lastIndexOf("]") + 1)) as { id: string; points?: number[][] }[];
    const path = json.find((e) => e.id === "seed_1")!;
    expect(path.points!.length).toBe(40);
    expect(path.points![0]).toEqual(toBoxPt(zigzag[0]));
  });
  test("credit attaches only when a seed path survives", () => {
    const s = seedBlock("x", [[[0, 0], [1, 0], [1, 1]]], "c");
    const kept = { elements: [{ id: "seed_1", type: "path", points: [[1, 1]] }, { id: "pump", type: "group", members: ["seed_1"] }], commands: [] };
    expect(attachSeedCredit(kept as never, s)).toBe(true);
    expect((kept.elements[1] as { credit?: string }).credit).toBe("based on c");
    const dropped = { elements: [{ id: "body", type: "path", points: [[1, 1]] }], commands: [] };
    expect(attachSeedCredit(dropped as never, s)).toBe(false);
  });
});
