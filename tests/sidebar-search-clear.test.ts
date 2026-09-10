import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICON_PATHS } from "../src/ui/icons";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

// Hans 2026-09-10: a × to the right of the sidebar's search box.
describe("the sidebar search box has a clear button", () => {
  it("main.ts mounts a clear button beside the input, inside one wrapper", () => {
    expect(main).toMatch(/class:\s*"sidebar-search-clear"[^)]*icon\("close"\)/);
    expect(main).toMatch(/"sidebar-search-wrap"\s*\},\s*sidebarSearch,\s*sidebarSearchClear/);
    // The wrapper, not the bare input, is what the sidebar holds.
    expect(main).toMatch(/blankBtn,\s*sidebarSearchWrap,/);
  });
  it("clearing empties the box, re-applies the (now empty) filter and refocuses", () => {
    const handler = main.match(/sidebarSearchClear\.addEventListener\("click", \(\) => \{([\s\S]*?)\}\);/)?.[1] ?? "";
    expect(handler).toMatch(/sidebarSearch\.value = ""/);
    expect(handler).toMatch(/applySidebarFilter\(\)/);
    expect(handler).toMatch(/sidebarSearch\.focus\(\)/);
  });
  it("the button is hidden while there is nothing to clear", () => {
    expect(main).toMatch(/sidebarSearchClear\.hidden = sidebarSearch\.value === ""/);
    expect(main).toMatch(/class:\s*"sidebar-search-clear"[^)]*hidden:\s*""/);
  });
  it("has an icon and a stylesheet rule", () => {
    expect(ICON_PATHS.close).toMatch(/^M/);
    expect(css).toMatch(/\.sidebar-search-clear\s*\{/);
  });
});
