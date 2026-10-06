// The free link hint in the Pretty link panel (registry delivery 1, task 9):
// once a GitHub publish has registered a drawcast with the registry
// (Doc.freeName / SavedDrawing.freeName, task 7), the panel that sells a
// SHORTER name should first remind the visitor a free one already exists —
// above the buy form, so it is read before the price line.
//
// share.ts's build() is DOM code that cannot run in this suite's node
// environment (see tests/share-youtube.test.ts, tests/course-claim.test.ts),
// so — following those files — the wiring is pinned by reading the source.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");

describe("ShareDoc.freeName", () => {
  test("is an optional field, read-only, never written by share.ts", () => {
    expect(share).toMatch(/freeName\?:\s*string;/);
    expect(share).not.toMatch(/doc\.freeName\s*=/);
  });
});

describe("the free link hint in the Pretty link panel", () => {
  test("is built with h(), never innerHTML — the name never goes through markup", () => {
    expect(share).toContain('const freeNameLink = h("a", { target: "_blank", rel: "noopener" })');
    expect(share).toMatch(/const freeNameHint = h\(\s*"div",\s*\{ class: "hint" \},\s*"Your free link: ",\s*freeNameLink,/);
    expect(share).not.toContain("innerHTML");
  });

  test("sits above the buy form (before the Name field row) in the panel's own children", () => {
    const panel = share.slice(share.indexOf("const prettyPanel = h("), share.indexOf("const prettyGo = h("));
    expect(panel).toMatch(/prettyHelp,\s*freeNameHint,\s*h\("div", \{\}, h\("label", \{ class: "quiet-label" \}, "Name "/);
  });

  test("refreshPretty hides it when the document carries no freeName, and fills drawcast.app/#<freeName> when it does", () => {
    const fn = share.slice(share.indexOf("function refreshPretty("), share.indexOf("prettyGo.addEventListener("));
    expect(fn).toContain("freeNameHint.hidden = !doc.freeName;");
    expect(fn).toMatch(/freeNameLink\.href = `https:\/\/www\.drawcast\.app\/#\$\{doc\.freeName\}`;/);
    expect(fn).toMatch(/freeNameLink\.textContent = `drawcast\.app\/#\$\{doc\.freeName\}`;/);
  });

  test("the sentence tells the visitor a shorter name is still for sale below", () => {
    expect(share).toContain("Buy a shorter name below if you want one.");
  });
});

// HARD CONSTRAINT (tests/publish-server.test.ts:332-350): adding the hint
// must not add a new input listener, or a second buildNameCheck(.
describe("the hard constraint holds after the free-link hint", () => {
  test("still exactly one input listener and two buildNameCheck( calls", () => {
    expect(share.match(/addEventListener\("input"/g)).toHaveLength(1);
    expect(share.match(/buildNameCheck\(/g)).toHaveLength(2);
    expect(share).not.toContain('addEventListener("keyup"');
    expect(share).not.toContain('addEventListener("keydown"');
  });
});
