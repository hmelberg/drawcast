import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("the Player/Editor pill is gone (A5, S §7.3)", () => {
  it("main.ts no longer builds mode-btn buttons", () => {
    expect(main).not.toMatch(/class:\s*"mode-btn/);
  });
  it("a ▶ Player sidebar row opens player mode", () => {
    expect(main).toMatch(/sidebar-row[^)]*"Player"/);
  });
  it("the dead pill CSS is deleted", () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\.mode-btn/);
  });
});
