import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// Hans 2026-09-02, four sidebar rulings in one message:
//  1. "it is not really necessary to list the number of files (for instance
//     (2) after headings like library courses and examples"
//  2. "The choices like Player, Style and Sign in etc should be in the same
//     style (font, size, bold?) as the other headings"
//  3. "styles should be a dropdown like examples and library since the user
//     may create multiple styles"
//  4. "the vertical size of the sidebar should align with the vertical size
//     of the script editor and player. End in same place? (or longer if the
//     sidebar is longer)"
// The DOM cannot be built in node (h() throws), so the shell is checked at
// the source, the way the other sidebar tests do.

const read = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");

describe("the sidebar after Hans's four rulings", () => {
  it("1 · a section heading is its label alone — no count, filtering or not", async () => {
    const sidebar = await read("../src/ui/sidebar.ts");
    expect(sidebar).not.toMatch(/sectionCountLabel/);
    expect(sidebar).toMatch(/summary\.textContent = model\.label;/);
  });

  it("2 · tool rows are set like the section headings: bold, in ink", async () => {
    const css = await read("../src/styles.css");
    const rule = css.match(/\.sidebar-tools \.sidebar-row \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/font-weight: 600/);
    expect(rule).toMatch(/color: var\(--ink\)/);
    expect(rule).not.toMatch(/--muted/);
  });

  it("3 · Style is a fifth section with a Manage… row, and no longer a tool row", async () => {
    const main = await read("../src/main.ts");
    expect(main).toMatch(/createSidebarSection\(onSectionToggle\("style"\)\)/);
    expect(main).toMatch(/manageStylesRow[\s\S]{0,200}openStyleModal\(\)/);
    expect(main).not.toMatch(/"sidebar-row" \}, "Style"\)/);
    // The search box filters it like the others.
    expect(main).toMatch(/sidebarSearch\.addEventListener\("input"[\s\S]{0,300}refreshStyleSection\(\)/);
  });

  it("4 · the sidebar stretches to the workbench's height — it ends where the editor ends, or later", async () => {
    const css = await read("../src/styles.css");
    const rule = css.match(/body\.mode-editor main \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/align-items: stretch/);
    // Still sticky and viewport-capped, so a long script keeps the tools in reach.
    const sidebar = css.match(/\n\.sidebar \{([^}]*)\}/)?.[1] ?? "";
    expect(sidebar).toMatch(/position: sticky/);
    expect(sidebar).toMatch(/max-height: calc\(100vh/);
  });
});
