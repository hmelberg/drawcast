import { describe, expect, it } from "vitest";
import { shouldIdle } from "../src/ui/controls";

describe("shouldIdle", () => {
  it("idles out while playing with nothing waiting on the viewer", () => {
    expect(shouldIdle({ playing: true, gateOpen: false })).toBe(true);
  });

  it("never idles out while a gate is open — on a phone the tap that would\n     bring the bar back is the tap that answers the question", () => {
    expect(shouldIdle({ playing: true, gateOpen: true })).toBe(false);
  });

  it("never idles out when paused", () => {
    expect(shouldIdle({ playing: false, gateOpen: false })).toBe(false);
    expect(shouldIdle({ playing: false, gateOpen: true })).toBe(false);
  });
});
