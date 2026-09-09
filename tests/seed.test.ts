import { describe, expect, test } from "vitest";
import { attachSeedCredit, seedBlock } from "../src/llm/seed";

const ring = Array.from({ length: 200 }, (_, i): [number, number] => [0.5 + 0.4 * Math.cos((i / 200) * 2 * Math.PI), 0.5 + 0.4 * Math.sin((i / 200) * 2 * Math.PI)]);

describe("seedBlock", () => {
  test("simplifies to ≤ 40 points per path, names parts seed_k, wraps in a fitted group", () => {
    const s = seedBlock("bicycle pump", [ring, [[0, 0], [1, 1]]], "pump from lucide · ISC");
    expect(s.ids).toEqual(["seed_1", "seed_2"]);
    const json = JSON.parse(s.text.slice(s.text.indexOf("["), s.text.lastIndexOf("]") + 1)) as { id: string; type: string; points?: number[][]; members?: string[]; fit?: string }[];
    expect(json.find((e) => e.id === "seed_1")!.points!.length).toBeLessThanOrEqual(40);
    expect(json.find((e) => e.id === "seed")).toMatchObject({ type: "group", members: ["seed_1", "seed_2"], fit: "left" });
    expect(s.text).toMatch(/keep, edit, rename, extend or drop/);
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
