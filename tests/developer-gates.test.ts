import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const modal = readFileSync(new URL("../src/ui/modal.ts", import.meta.url), "utf8");

describe("developerMode gates (S §6 + review amendment)", () => {
  it("applyDeveloperMode hides the promote button for normal users", () => {
    const fn = /function applyDeveloperMode\(\):\s*void\s*\{([\s\S]*?)\n\}/.exec(main)?.[1] ?? "";
    expect(fn).not.toBe("");
    expect(fn).toMatch(/promoteBtn\.hidden = !on/);
  });

  it("the References tab is gated with the same flag, via Tabs.setHidden", () => {
    const fn = /function applyDeveloperMode\(\):\s*void\s*\{([\s\S]*?)\n\}/.exec(main)?.[1] ?? "";
    expect(fn).toMatch(/instructionsTabs\.setHidden\(\s*["']references["']\s*,\s*!on\s*\)/);
  });

  it("falls back to the instructions tab when developer mode turns off while References is active", () => {
    const fn = /function applyDeveloperMode\(\):\s*void\s*\{([\s\S]*?)\n\}/.exec(main)?.[1] ?? "";
    expect(fn).toMatch(/instructionsTabs\.show\(\s*["']instructions["']\s*\)/);
  });

  it("createTabs exposes a setHidden method on its Tabs interface", () => {
    expect(modal).toMatch(/setHidden\(id: string, hidden: boolean\): void;/);
    const impl = /export function createTabs\(tabs: TabSpec\[\]\): Tabs \{([\s\S]*?)\n\}/.exec(modal)?.[1] ?? "";
    expect(impl).not.toBe("");
    expect(impl).toMatch(/setHidden/);
  });
});
