// tests/widget-player-api.test.ts — source pins: the four wrappers exist and route through the private machinery.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const src = readFileSync("src/render/player.ts", "utf8");

describe("Player: the widget host's public surface", () => {
  test("glow(ids, ms, color) is one swell of the answer glow, always cleared", () => {
    expect(src).toMatch(/^\s+async glow\(ids: string\[\], ms = ANSWER_GLOW_MS, color\?: string\): Promise<void>/m);
    const body = src.slice(src.indexOf("async glow("), src.indexOf("async glow(") + 900);
    expect(body).toContain('effects.setHighlight(ids, "glow", t, null, color)');
    expect(body).toContain("effects.endHighlight(ids)");
  });
  test("tapAt(box, ms) drives the laser along pointerPath(…, \"tap\") and lifts it", () => {
    expect(src).toMatch(/^\s+async tapAt\(box: BBox, ms = 900\): Promise<void>/m);
    const body = src.slice(src.indexOf("async tapAt("), src.indexOf("async tapAt(") + 700);
    expect(body).toContain('pointerPath({ x: box.x + box.w / 2, y: box.y + box.h / 2, box }, "tap")');
    expect(body).toContain("effects.setPointer(null)");
  });
  test("nudge(id, dx, dy) ghosts a part on TOP of the offset its boundary already gave it", () => {
    expect(src).toMatch(/^\s+nudge\(id: string, dx: number, dy: number\): void/m);
    const body = src.slice(src.indexOf("nudge(id: string"), src.indexOf("nudge(id: string") + 400);
    expect(body).toContain("this.stateAt(this.completed).offsets[id] ?? [0, 0]");
    expect(body).toContain("el.setOffset(base[0] + dx, base[1] + dy)");
  });
  test("caption(text | null) writes the band or restores the source caption", () => {
    expect(src).toMatch(/^\s+caption\(text: string \| null\): void/m);
    const body = src.slice(src.indexOf("caption(text: string | null)"), src.indexOf("caption(text: string | null)") + 300);
    expect(body).toContain("this.showCaption(this.captionSource)");
  });
});
