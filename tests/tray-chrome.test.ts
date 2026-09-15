// The tray is chrome under the bar, not a drawing (Hans 2026-09-15: the
// hand-drawn box around it "is ugly"). Paper, ink and the sketch face stay;
// the sketchy border and the scroll box go.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles.css", "utf8");
const rule = (sel: string): string => {
  const i = css.indexOf(`\n${sel} {`);
  expect(i, `${sel} rule must exist`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("}", i));
};

describe("tray chrome", () => {
  test("docked: a plain top edge, no sketchy radius", () => {
    const r = rule(".cs-paramtray");
    expect(r).toMatch(/border-top: 1px solid var\(--line\)/);
    expect(r).not.toMatch(/border-radius: 255px/);
    expect(r).not.toMatch(/overflow: auto/);
  });
  test("popped out: a plain 1px line, still resizable", () => {
    const r = rule(".cs-paramtray.cs-popped");
    expect(r).toMatch(/border: 1px solid var\(--line\)/);
    expect(r).toMatch(/resize: both/);
  });
  test("no rule anywhere carries the sketchy-box radius for tray chrome", () => {
    expect(css).not.toMatch(/\.cs-ctlcard/);
    expect(css).not.toMatch(/:root\[data-theme="dark"\] \.cs-paramtray/);
  });
});
