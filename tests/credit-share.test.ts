// Narration credit in the Share panel (registry delivery 3, task 4): the
// "Embed narration" box, shared by the Link/server/Drive panels through
// buildEmbedChoices, gains a third state — signed in with no TTS key — on
// top of the existing "has a key" / "neither" pair. share.ts's build() is DOM
// code this suite's node environment cannot run (see tests/share-private.test.ts's
// own header), so the wiring is pinned against the source the same way; the
// hint's WORDING is a real, DOM-free test of the exported pure function.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CREDIT_MARKUP, creditBakeHint } from "../src/ui/share";

const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");

describe("creditBakeHint — the exact wording the Embed-narration hint shows", () => {
  test("a failed balance check says so instead of waiting forever", () => {
    expect(creditBakeHint(3.45, "key")).toBe("uses narration credit — about $3.45 (sign in again to see your balance)");
    expect(creditBakeHint(3.45, "error")).toBe("uses narration credit — about $3.45 (balance unavailable)");
  });
  test("before the balance arrives: the estimate alone, marked as checking", () => {
    expect(creditBakeHint(3.45, null)).toBe("uses narration credit — about $3.45 (checking balance…)");
  });

  test("once the balance arrives: both dollar amounts, 2 decimals", () => {
    expect(creditBakeHint(3.45, 1)).toBe("uses narration credit — about $3.45 (you have $1.00)");
    expect(creditBakeHint(0, 12.5)).toBe("uses narration credit — about $0.00 (you have $12.50)");
  });
});

describe("CREDIT_MARKUP", () => {
  test("is 3 — the server's own markup (plan ruling 3), estimated here so the hint is never quietly cheaper than what /tts will charge", () => {
    expect(CREDIT_MARKUP).toBe(3);
  });
});

describe("the Embed-narration box — three states through buildEmbedChoices", () => {
  const fn = share.slice(share.indexOf("function buildEmbedChoices("), share.indexOf("// ---- Link panel ----"));

  test("imports the credit client functions", () => {
    expect(share).toContain('import { creditBalance, startCreditPayment } from "../credit";');
  });

  test("an own/vended key: unchanged from before — enabled, checked by default, no Buy-credit row", () => {
    expect(fn).toMatch(/if \(tts\) \{\s*bakeCb\.disabled = false;\s*bakeCb\.checked = bakeDefault;\s*creditBuyRow\.hidden = true;/);
  });

  test("no key but signed in: still enabled and checked by default — credit costs money too, just not on this account's Google bill", () => {
    expect(fn).toMatch(/\} else if \(token\) \{\s*bakeCb\.disabled = false;\s*bakeCb\.checked = bakeDefault;/);
    expect(fn).toContain("const neededUsd = CREDIT_MARKUP * (doc.narrationUsd ?? 0);");
    expect(fn).toContain("bakeHint.textContent = creditBakeHint(neededUsd, null);");
  });

  test("neither: disabled and UNCHECKED (never checked-but-disabled), same fixed hint as before", () => {
    expect(fn).toMatch(/\} else \{\s*bakeCb\.disabled = true;\s*bakeCb\.checked = false;\s*creditBuyRow\.hidden = true;\s*bakeHint\.textContent = "add a Google TTS key in Settings to publish the narration";/);
  });

  test("the balance is fetched from the SAME server every /credit call goes to, keyed on the account token", () => {
    expect(fn).toContain("const bal = await creditBalance(DEFAULT_ENROLL_API, token);");
  });

  test("a stale in-flight balance fetch can never clobber a newer refresh (superseded guard, same idiom as Private's)", () => {
    expect(fn).toContain("const my = ++creditToken;");
    expect(fn).toContain("if (my !== creditToken) return;");
  });

  test("the Buy-credit row shows only once a real balance says it's short, and hides again once it's enough", () => {
    expect(fn).toContain("creditBuyRow.hidden = haveUsd >= neededUsd;");
    // Every OTHER branch (tts / no-account / fresh no-key-but-signed-in) hides it.
    expect(fn.match(/creditBuyRow\.hidden = true;/g)?.length).toBeGreaterThanOrEqual(3);
  });

  test("three fixed packs — 5/10/20 USD, plan ruling 5 — wired to startCreditPayment with the app's own return origin", () => {
    expect(fn).toContain('"Buy $5"');
    expect(fn).toContain('"Buy $10"');
    expect(fn).toContain('"Buy $20"');
    expect(fn).toContain("void buyCredit(500)");
    expect(fn).toContain("void buyCredit(1000)");
    expect(fn).toContain("void buyCredit(2000)");
    expect(fn).toContain("startCreditPayment(DEFAULT_ENROLL_API, { key: token, cents, return: location.href.split(\"#\")[0] });");
  });

  test("a returned Checkout url navigates the browser there, exactly like Private's Pay button", () => {
    expect(fn).toMatch(/if \(typeof started === "object"\) \{\s*location\.href = started\.url;/);
  });

  test("every refusal is a word on the hint line, never a throw", () => {
    expect(fn).toContain('"A credit purchase is already open — finish it, or wait an hour and try again."');
    expect(fn).toContain('"Sign in to buy narration credit"');
    expect(fn).toContain('"Could not start the purchase — try again in a moment."');
  });

  test("still exactly one copy of the rows — creditBuyRow rides in the SAME builder as embedImages/bake, not duplicated per panel", () => {
    expect(fn).toContain("rows: [embedImagesLabel, bakeLabel, creditBuyRow]");
  });
});

describe("ShareDoc carries the raw $ estimate credit needs", () => {
  test("narrationUsd is an optional number, alongside the formatted narrationCost", () => {
    expect(share).toMatch(/narrationUsd\?:\s*number;/);
  });
});

// HARD CONSTRAINT (docs/superpowers/plans/2026-09-30-registry-deliveries-3-4.md,
// Global Constraints; tests/share-private.test.ts's own copy of this same
// check): Buy-credit's three buttons must add no keyup/keydown listener and
// no second `input` listener — they are click-only, like Private's Pay button.
describe("the hard constraint holds after Buy credit", () => {
  test("still exactly one input listener and two buildNameCheck( calls; no keyup/keydown", () => {
    expect(share.match(/addEventListener\("input"/g)).toHaveLength(1);
    expect(share.match(/buildNameCheck\(/g)).toHaveLength(2);
    expect(share).not.toContain('addEventListener("keyup"');
    expect(share).not.toContain('addEventListener("keydown"');
  });

  test("the three Buy-credit buttons are click-only", () => {
    expect(share).toContain('creditBuy5.addEventListener("click"');
    expect(share).toContain('creditBuy10.addEventListener("click"');
    expect(share).toContain('creditBuy20.addEventListener("click"');
  });
});
