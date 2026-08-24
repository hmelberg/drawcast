import { describe, expect, it } from "vitest";
import { parseFigureAttrs } from "../src/engine-element";

const attrs = (map: Record<string, string>) => parseFigureAttrs((n) => (n in map ? map[n] : null));

describe("drawcast-figure attribute parsing", () => {
  it("defaults to sketchy / narrated / speed 1 / no autoplay", () => {
    expect(attrs({})).toEqual({ look: "sketchy", mode: "narrated", speed: 1, autoplay: false });
  });
  it("honours explicit values and treats bare autoplay as true", () => {
    expect(attrs({ look: "clean", mode: "instant", speed: "1.5", autoplay: "" })).toEqual({
      look: "clean", mode: "instant", speed: 1.5, autoplay: true,
    });
  });
  it("falls back on junk values", () => {
    expect(attrs({ look: "neon", mode: "fast", speed: "quick" })).toEqual({
      look: "sketchy", mode: "narrated", speed: 1, autoplay: false,
    });
  });
});
