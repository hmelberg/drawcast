import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");

/**
 * Pulls the full text of a balanced h(...) call starting at the index of its
 * opening "(". The brief's own suggested regex — a lazy `[^]*?\)` — stops at
 * the FIRST ")" it meets, which in this file's actual (single-line) pane-bar
 * markup is a nested call's close (e.g. `h("span", { class: "pane-spacer" })`)
 * long before the outer call ends. Depth counting is the only thing that
 * survives that nesting, so drift here can't silently pass by matching a
 * truncated fragment.
 */
function balancedCall(text: string, openParenIdx: number): string {
  let depth = 0;
  for (let i = openParenIdx; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return text.slice(openParenIdx, i + 1);
    }
  }
  throw new Error(`unbalanced parens scanning from index ${openParenIdx}`);
}

/** Every `h("div", { class: "pane-bar" }, ...)` call, in file order. */
function paneBars(text: string): string[] {
  const bars: string[] = [];
  const re = /h\(\s*"div",\s*\{\s*class:\s*"pane-bar"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    bars.push(balancedCall(text, m.index + m[0].indexOf("(")));
  }
  return bars;
}

const bars = paneBars(main);

describe("Publish placement and naming (A1, A2, A4)", () => {
  // Guard: if the scan above ever finds nothing (a reformat that the regex
  // no longer matches), every test below would vacuously find `undefined`
  // and could pass for the wrong reason — so pin the scan itself first.
  it("finds both pane bars (spec and preview) to test against", () => {
    expect(bars.length).toBeGreaterThanOrEqual(2);
  });

  it("the button says Publish, not Share", () => {
    expect(main).toMatch(/"↗ Publish"/);
    expect(main).not.toMatch(/"↗ Share"/);
  });

  it("the modal is titled Publish", () => {
    expect(share).toMatch(/createModal\("↗ Publish"/);
  });

  it("the GitHub destination is named for what it does", () => {
    expect(share).toMatch(/label: "Publish to GitHub"/);
    expect(share).not.toMatch(/label: "Link"/);
  });

  it("Publish is built in the preview bar, directly after Review (P §2, §6)", () => {
    // The preview bar is the pane-bar that holds the Review button — the spec
    // bar never did and, after this change, still doesn't.
    const previewBar = bars.find((b) => b.includes("reviewBtn"));
    expect(previewBar).toBeTruthy();
    expect(previewBar).toContain("shareBtn");
    expect(previewBar!.indexOf("reviewBtn")).toBeLessThan(previewBar!.indexOf("shareBtn"));
  });

  it("Publish no longer lives in the spec bar (S §7.1)", () => {
    const specBar = bars.find((b) => b.includes("insertMenu"));
    expect(specBar).toBeTruthy();
    expect(specBar).not.toContain("shareBtn");
  });

  it("the spec bar groups Open ▾ Save ▾ before Insert ▾ (S §7.1)", () => {
    // Identified by content, not position: the spec bar is the pane-bar that
    // is NOT the preview bar (it never contains reviewBtn).
    const specBar = bars.find((b) => b.includes("insertMenu") && !b.includes("reviewBtn"));
    expect(specBar).toBeTruthy();
    const openIdx = specBar!.indexOf("openMenuHost");
    const insertIdx = specBar!.indexOf("insertMenu");
    expect(openIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(openIdx);
  });
});
