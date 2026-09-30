// The Listed switch (registry deliveries 3–4, task 9): a "Listed in the
// catalogue" checkbox beside Private, default ticked. Unlike Private, it
// takes effect at once through src/registry.ts's setListing/
// startPrivatePayment rather than waiting for Publish — share.ts's build()
// is DOM code this suite's node environment cannot run (tests/share-private
// .test.ts's own header explains why), so the wiring is pinned against the
// source the same way that file does.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { payListedFields } from "../src/ui/share";

const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");

describe("the Listed checkbox — structure", () => {
  test("is a publish-choice label beside Private, in the Link panel", () => {
    expect(share).toContain('const listedCb = h("input", { type: "checkbox", id: "share-listed" })');
    expect(share).toMatch(/const listedLabel = h\("label", \{ class: "publish-choice", for: "share-listed" \}, listedCb, h\("span", \{\}, "Listed in the catalogue"\), listedHint\)/);
    const panel = share.slice(share.indexOf("const linkPanel = h("), share.indexOf("const publishGo = h("));
    expect(panel).toContain("listedLabel");
    expect(panel).toContain("listedPayRow");
  });

  test("default ticked, and the Pay row starts hidden", () => {
    expect(share).toContain("listedPayRow.hidden = true;");
  });
});

describe("listedCb's change handler — setListing IS the check (no separate quote)", () => {
  const fn = share.slice(share.indexOf('listedCb.addEventListener("change"'), share.indexOf('listedPayBtn.addEventListener("click"'));

  test("signed out reads 'Sign in to change listing', before any network call", () => {
    expect(fn).toMatch(/const token = getToken\(\);\s*if \(!token\) \{\s*listedHint\.textContent = "Sign in to change listing";/);
  });

  test("calls setListing with the checkbox's own state — ticking true, unticking false", () => {
    expect(fn).toContain("const r = await setListing(DEFAULT_ENROLL_API, token, registryItemKey(item.kind, item.target), listedCb.checked);");
  });

  test("every outcome is worded on the hint line, never a throw", () => {
    expect(fn).toContain('listedHint.textContent = "";'); // ok
    expect(fn).toContain('listedHint.textContent = "Sign in to change listing";');
    expect(fn).toContain('"Registered to another account";');
    expect(fn).toContain('listedHint.textContent = "Could not update listing — try again.";');
  });

  test("a 403 on an item with no registration yet (the open-time quote said owner: none, for THIS target) says publish first — not 'another account' (final review M5)", () => {
    expect(fn).toMatch(/if \(r === "owner"\) \{(?:\s*\/\/.*)*\s*listedHint\.textContent =\s*serverOwner === "none" && probedTarget === item\.target \? "Publish first, then choose listing" : "Registered to another account";/);
    const probe = share.slice(share.indexOf("function probeServerPrivate(): void {"), share.indexOf('privateCb.addEventListener("change"'));
    expect(probe).toContain("serverOwner = null;");
    expect(probe).toContain('serverOwner = typeof q === "object" ? q.owner : null;');
  });

  test("a {due} answer (unlisting never paid) shows the one-time fee and reveals the Pay row", () => {
    expect(fn).toMatch(/listedHint\.textContent = `Unlisted costs \$\{formatPrice\(r\.due, "usd"\)\} — one-time`/);
    expect(fn).toMatch(/listedPayBtn\.textContent = `Pay \$\{formatPrice\(r\.due, "usd"\)\}`/);
    expect(fn).toContain("listedPayRow.hidden = false;");
  });

  test("a stale in-flight call can never clobber a newer state (superseded guard, same idiom as Private's)", () => {
    expect(fn).toContain("const my = ++listedToken;");
    expect(fn).toContain("if (my !== listedToken) return;");
  });

  test("hides the Pay row again at the start of every change, so a stale price never lingers", () => {
    const start = fn.slice(0, fn.indexOf("const item = listedItem();"));
    expect(start).toContain("listedPayRow.hidden = true;");
  });
});

describe("the Listed Pay button", () => {
  const fn = share.slice(share.indexOf('listedPayBtn.addEventListener("click"'), share.indexOf("/** A fresh async quote supersedes"));

  test("pays through the SAME endpoint Private's Pay button uses, via payListedFields(privateCb.checked, false) — an unlist-only purchase must send private EXPLICITLY, never omit it", () => {
    expect(fn).toContain("startPrivatePayment(DEFAULT_ENROLL_API,");
    expect(fn).toContain("...payListedFields(privateCb.checked, false),");
    expect(fn).toContain('return: location.href.split("#")[0],');
  });

  test("a returned url navigates the browser there — Stripe Checkout", () => {
    expect(fn).toMatch(/if \(typeof started === "object"\) \{\s*location\.href = started\.url;/);
  });

  test("every refusal is a word, worded on the hint line, never a throw", () => {
    expect(fn).toContain('"Nothing is due — listing already updated."');
    expect(fn).toContain('"A payment for this item is already open — finish it, or wait an hour and try again."');
    expect(fn).toContain('"Registered to another account"');
    expect(fn).toContain('"Sign in to change listing"');
    expect(fn).toContain('"Could not start the payment — try again in a moment."');
  });
});

describe("payListedFields — a real, DOM-free invariant test (controller review)", () => {
  test("both fields are always explicit booleans, never omitted — the server defaults an absent `private` to TRUE on pay", () => {
    expect(payListedFields(true, true)).toEqual({ private: true, listed: true });
    expect(payListedFields(true, false)).toEqual({ private: true, listed: false });
    // The unlist-only purchase (Private off, paying only to unlist): must
    // send private:false EXPLICITLY — an omission here, relying on the
    // server's true-by-default, would silently lock a public item private
    // (a minted key, joins turned approval-only) purely because someone
    // wanted it left off the catalogue.
    expect(payListedFields(false, false)).toEqual({ private: false, listed: false });
    expect(payListedFields(false, true)).toEqual({ private: false, listed: true });
  });

  test("every key is present on every result (Object.keys, not just value equality)", () => {
    for (const [p, l] of [
      [true, true],
      [true, false],
      [false, false],
      [false, true],
    ] as const) {
      expect(Object.keys(payListedFields(p, l)).sort()).toEqual(["listed", "private"]);
    }
  });
});

describe("Private's own quote/pay now carry the current Listed intent too", () => {
  test("refreshPrivateLine's quote passes listed: listedCb.checked", () => {
    const fn = share.slice(share.indexOf("function refreshPrivateLine("), share.indexOf("privateCb.addEventListener("));
    expect(fn).toContain("listed: listedCb.checked,");
  });

  test("probeServerPrivate's quote passes listed: listedCb.checked too", () => {
    const fn = share.slice(share.indexOf("function probeServerPrivate(): void {"), share.indexOf('privateCb.addEventListener("change"'));
    expect(fn).toContain("listed: listedCb.checked,");
  });

  test("Private's own Pay button sends private:true and the current Listed state via payListedFields(true, listedCb.checked) — one payment covers both when requested together", () => {
    const fn = share.slice(share.indexOf('privatePayBtn.addEventListener("click"'), share.indexOf('const linkPanel = h('));
    expect(fn).toContain("...payListedFields(true, listedCb.checked),");
  });

  test("neither Pay button ever spreads a literal { private, listed } object of its own — payListedFields is the one place these two booleans are assembled", () => {
    const privateClick = share.slice(share.indexOf('privatePayBtn.addEventListener("click"'), share.indexOf('const linkPanel = h('));
    const listedClick = share.slice(share.indexOf('listedPayBtn.addEventListener("click"'), share.indexOf("/** A fresh async quote supersedes"));
    for (const fn of [privateClick, listedClick]) {
      expect(fn).not.toMatch(/\bprivate:\s*(true|false|privateCb\.checked),/);
      expect(fn).not.toMatch(/\blisted:\s*(true|false|listedCb\.checked),/);
    }
  });
});

// fix round 1: the server is being changed (in parallel) to answer `listed`
// on the SAME quote probeServerPrivate already sends — Listed is seeded
// from it on open, the same way Private is (serverPrivate above).
describe("probeServerPrivate seeds Listed from the server's own quote (fix round 1)", () => {
  const fn = share.slice(share.indexOf("function probeServerPrivate(): void {"), share.indexOf('privateCb.addEventListener("change"'));

  test("reads q.listed, defaulting to true for an older server that omits it", () => {
    expect(fn).toContain("const serverListed = q.listed ?? true;");
  });

  test("only touches the checkbox/hint/pay-row when the server disagrees with what's currently shown", () => {
    expect(fn).toMatch(/if \(serverListed !== listedCb\.checked\) \{\s*listedCb\.checked = serverListed;\s*listedHint\.textContent = "";\s*listedPayRow\.hidden = true;\s*\}/);
  });

  test("guarded by the same superseded token as Private's own seeding, and never fires a second network call", () => {
    const afterGuard = fn.slice(fn.indexOf("if (my !== serverProbeToken) return;"));
    expect(afterGuard).toContain("serverListed");
    expect(afterGuard).not.toContain("quotePrivate(");
    expect(afterGuard).not.toContain("setListing(");
  });
});

describe("a payment never re-lists on the server — ticking Listed back on is always /register/listing, never a payment", () => {
  test("listedCb's change handler calls setListing for BOTH directions and never calls startPrivatePayment directly — Pay only happens from listedPayBtn's own click, after a 402", () => {
    const change = share.slice(share.indexOf('listedCb.addEventListener("change"'), share.indexOf('listedPayBtn.addEventListener("click"'));
    expect(change).toContain("setListing(DEFAULT_ENROLL_API, token, registryItemKey(item.kind, item.target), listedCb.checked)");
    expect(change).not.toContain("startPrivatePayment");
  });

  test("listing true is never priced — setListing's call site sends the checkbox's raw boolean, not a quote result", () => {
    const change = share.slice(share.indexOf('listedCb.addEventListener("change"'), share.indexOf('listedPayBtn.addEventListener("click"'));
    expect(change).not.toContain("quotePrivate(");
  });
});

describe("wiring into prepPanels", () => {
  test("Listed always opens ticked, with a clear hint and Pay row", () => {
    const prep = share.slice(share.indexOf("function prepPanels(): void {"), share.indexOf("function refresh(deps: ShareDeps): void {"));
    expect(prep).toContain("listedCb.checked = true;");
    expect(prep).toContain('listedHint.textContent = "";');
    expect(prep).toContain("listedPayRow.hidden = true;");
  });
});

// HARD CONSTRAINT (docs/superpowers/plans/2026-09-30-registry-deliveries-3-4.md,
// Global Constraints; tests/share-private.test.ts's own copy): the Listed
// switch adds no keyup/keydown listener and no second `input` listener — it
// is change/click-only, like Private's own controls.
describe("the hard constraint holds after the Listed switch", () => {
  test("still exactly one input listener and two buildNameCheck( calls; no keyup/keydown", () => {
    expect(share.match(/addEventListener\("input"/g)).toHaveLength(1);
    expect(share.match(/buildNameCheck\(/g)).toHaveLength(2);
    expect(share).not.toContain('addEventListener("keyup"');
    expect(share).not.toContain('addEventListener("keydown"');
  });

  test("Listed's own listeners are change/click only", () => {
    expect(share).toContain('listedCb.addEventListener("change"');
    expect(share).toContain('listedPayBtn.addEventListener("click"');
  });
});
