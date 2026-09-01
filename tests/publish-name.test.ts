import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

describe("the name is visible and editable where a panel exists (B3, F.1(2))", () => {
  it("the publish panel shows an editable slug", () => {
    expect(share).toMatch(/publishedAs \?\? slugify\(/);
  });
  it("the disk dialog carries a name field fed through fileSafe", () => {
    const listener = /saveDiskBtn\.addEventListener\("click",[^]*?\n\}\);/.exec(main)?.[0] ?? "";
    expect(listener).not.toBe("");
    expect(listener).toMatch(/fileSafe\(/);
  });
  it("Drive and GitHub saves stay one click — no new dialogs (ruling §F.3.1)", () => {
    const fn = /function buildSaveMenu\(\):[^]*?\n\}/.exec(main)?.[0] ?? "";
    expect(fn).toMatch(/onSelect: \(\) => void saveToDrive\(\)/);
    expect(fn).toMatch(/onSelect: \(\) => void saveSourceToGithub\(\)/);
  });
});
