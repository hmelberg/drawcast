// Narration credit (registry delivery 3, task 4): publishing without an
// own/vended TTS key, signed in, synthesizes on the server against prepaid
// credit instead of throwing "needs a Google TTS key". main.ts's
// publishTextFor and course.ts's bakeLectures are both big, DOM/network-
// wired functions this suite cannot exercise end to end (same reason
// tests/registry-client.test.ts and tests/share-private.test.ts pin their
// GitHub-repo halves against the source) — so the ORDER (own/vended key,
// then credit, then the old error) and the CreditError wiring are pinned as
// source-text drift, the way the existing publish flows already are.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const course = readFileSync(new URL("../src/ui/course.ts", import.meta.url), "utf8");

describe("main.ts publishTextFor — key order (ruling 1: own/vended key, then credit, then the old error)", () => {
  const fn = main.slice(main.indexOf("async function publishTextFor("), main.indexOf("const size = bakeSize(track);"));

  test("imports the credit synthesizer and its error", () => {
    expect(main).toMatch(/import \{ CreditError, creditBalance, creditInHash, creditStatement, describeRow, serverSynthesize, startCreditPayment \} from "\.\/credit";/);
  });

  test("getTtsKey() (own or vended — store.ts conflates the two) is read before getToken()", () => {
    const iKey = fn.indexOf("const apiKey = getTtsKey();");
    const iToken = fn.indexOf("const accountToken = getToken();");
    expect(iKey).toBeGreaterThan(-1);
    expect(iToken).toBeGreaterThan(iKey);
  });

  test("the old error only fires when BOTH a key and an account are missing", () => {
    expect(fn).toContain('if (!apiKey && !accountToken) throw new Error("Publishing with narration needs a Google TTS key — add one in Settings.");');
  });

  test("a key present picks the local synthesizer; none present (but signed in) picks the server one, over the SAME cachingSynthesizer/clip-cache seam", () => {
    expect(fn).toMatch(
      /const synthesizeLine = apiKey\s*\?\s*\(line: SpeakLine\) => synthesizeBase64\(\{ apiKey, rate: settings\.rate, voices: settings\.cloudVoices, lang: declaredLang \}, line\.text, line\)\s*:\s*\(line: SpeakLine\) => serverSynthesize\(DEFAULT_ENROLL_API, accountToken, \{ rate: settings\.rate, voices: settings\.cloudVoices, lang: declaredLang \}, line\.text, line\);/,
    );
    // Both branches feed the one cachingSynthesizer — reuse (the clip cache)
    // works identically whichever path paid for a line.
    const iSynthesizeLine = fn.indexOf("const synthesizeLine =");
    const iCachingSynthesizer = fn.indexOf("cachingSynthesizer(");
    const iSynthesizeLineArg = fn.indexOf("synthesizeLine,");
    expect(iSynthesizeLine).toBeGreaterThan(-1);
    expect(iSynthesizeLine).toBeLessThan(iCachingSynthesizer);
    expect(iCachingSynthesizer).toBeLessThan(iSynthesizeLineArg);
  });
});

describe("ui/course.ts bakeLectures — the same key order", () => {
  const fn = course.slice(course.indexOf("async function bakeLectures("), course.indexOf("/** What the last bake actually did"));

  test("imports the credit synthesizer and its error", () => {
    expect(course).toContain('import { CreditError, serverSynthesize } from "../credit";');
  });

  test("getTtsKey() before getToken(); the old error only when both are absent", () => {
    const iKey = fn.indexOf("const apiKey = getTtsKey();");
    const iToken = fn.indexOf("const accountToken = getToken();");
    expect(iKey).toBeGreaterThan(-1);
    expect(iToken).toBeGreaterThan(iKey);
    expect(fn).toContain('if (!apiKey && !accountToken) throw new Error("Publishing with narration needs a Google TTS key — add one in Settings.");');
  });

  test("per-lecture synthesizeLine picks local vs. server the same way as main.ts, inside the per-lecture loop (declaredLang varies per lecture)", () => {
    expect(fn).toMatch(
      /const synthesizeLine = apiKey\s*\?\s*\(line: SpeakLine\) => synthesizeBase64\(\{ apiKey, rate: settings\.rate, voices: settings\.cloudVoices, lang: declaredLang \}, line\.text, line\)\s*:\s*\(line: SpeakLine\) => serverSynthesize\(DEFAULT_ENROLL_API, accountToken, \{ rate: settings\.rate, voices: settings\.cloudVoices, lang: declaredLang \}, line\.text, line\);/,
    );
    // Declared per iteration of the numbered-lectures loop, after `existing`
    // is read back — a lecture's own declared language governs its voice.
    const iLoop = fn.indexOf("for (const [n, index] of numbered.entries())");
    const iSynthesizeLine = fn.indexOf("const synthesizeLine =");
    expect(iLoop).toBeGreaterThan(-1);
    expect(iSynthesizeLine).toBeGreaterThan(iLoop);
  });
});

describe("CreditError is special-cased everywhere a bake can throw it, exactly like LockError", () => {
  test("publishDrawcast (main.ts): GitHub publish", () => {
    const fn = main.slice(main.indexOf("async function publishDrawcast("), main.indexOf("async function publishServerCast("));
    expect(fn).toContain("e instanceof LockError || e instanceof CreditError ? e.message :");
  });

  test("publishServerCast (main.ts): the drawcast server publish", () => {
    const fn = main.slice(main.indexOf("async function publishServerCast("), main.indexOf("async function publishDriveCast("));
    expect(fn).toContain("e instanceof CreditError ? e.message :");
  });

  test("publishDriveCast (main.ts): the Google Drive publish", () => {
    const fn = main.slice(main.indexOf("async function publishDriveCast("));
    expect(fn.slice(0, fn.indexOf("\n\n// In-flight guards"))).toContain("e instanceof CreditError ? e.message :");
  });

  test("ui/course.ts's publish (the only GitHub publish a course has)", () => {
    const fn = course.slice(course.indexOf("async function publish("), course.indexOf("function showLinks("));
    expect(fn).toContain("e instanceof LockError || e instanceof CreditError ? e.message :");
  });
});

describe("fix round 1: doc().narrationUsd is priced by creditBakeCost, not bakeCost — bakeCost stays the OWN-key label's basis", () => {
  test("main.ts's Share doc() builder", () => {
    expect(main).toContain('import { bakeCost, costLabel, creditBakeCost } from "./export/tts-cost";');
    const fn = main.slice(main.indexOf("doc: () => {"), main.indexOf("private: isPrivateDoc() || undefined };"));
    expect(fn).toContain("const cost = bakeCost(lines, settings.cloudVoices);");
    expect(fn).toContain("const creditCost = creditBakeCost(lines, settings.cloudVoices, declaredLang);");
    expect(fn).toContain("narrationCost: costLabel(cost)");
    expect(fn).toContain("narrationUsd: creditCost.usd");
    // The SAME declared-language decision publishTextFor's own bake makes
    // (never a per-line sniff) — not detectLang, not omitted.
    expect(fn).toContain("const declaredLang = itemsOf(playlist).find((i) => i.spec.lang)?.spec.lang;");
  });

  test("ui/course.ts's Share doc() builder — a parallel doneLectureCreditCosts, not doneLectureCosts, for narrationUsd", () => {
    expect(course).toContain('import { addCosts, bakeCost, costLabel, courseNarrationProjection, creditBakeCost, type BakeCost } from "../export/tts-cost";');
    expect(course).toContain("narrationCost: costLabel(addCosts(doneLectureCosts(course)))");
    expect(course).toContain("narrationUsd: addCosts(doneLectureCreditCosts(course)).usd");
    const fn = course.slice(course.indexOf("function doneLectureCreditCosts("), course.indexOf("function syncBusy("));
    expect(fn).toContain("creditBakeCost(playlistBakeLines(playlist), settings.cloudVoices, declaredLang)");
    // doneLectureCosts itself (the own-key basis, and the Generate
    // projection's) is untouched — still bakeCost, still no declaredLang.
    const untouched = course.slice(course.indexOf("function doneLectureCosts("), course.indexOf("function doneLectureCreditCosts("));
    expect(untouched).toContain("bakeCost(playlistBakeLines(parsePlaylistText(text)), settings.cloudVoices)");
  });
});

describe("the Stripe return for a credit purchase (registry delivery 3) — creditInHash's sibling to privReturn", () => {
  const fn = main.slice(main.indexOf("const creditReturn = creditInHash(location.hash);"), main.indexOf("// ---------- my templates ----------"));

  test("reads location.hash, clears it, and reports the outcome — never reopening Share", () => {
    expect(fn).toContain("history.replaceState(null, \"\", location.pathname + location.search);");
    expect(fn).toContain('creditReturn.outcome === "creditpaid"');
    expect(fn).toContain('Credit added — ${creditReturn.cents.toLocaleString("en-US")} credits.');
    expect(fn).toContain('setStatus("Credit was not bought — nothing was charged.");');
  });

  test("sits after the Private return handler, same file region", () => {
    const iPriv = main.indexOf("const privReturn = privateInHash(location.hash);");
    const iCredit = main.indexOf("const creditReturn = creditInHash(location.hash);");
    expect(iPriv).toBeGreaterThan(-1);
    expect(iCredit).toBeGreaterThan(iPriv);
  });
});
