// The Private switch, the quote and paying (registry delivery 2, task 9):
// a "Private" checkbox beside the GitHub publish choices, priced through the
// SAME registry every publish already registers with (src/registry.ts's
// quotePrivate/startPrivatePayment), a "Pay N USD" button, and the history
// warning for an already-published item.
//
// share.ts's build() is DOM code that cannot run in this suite's node
// environment (see tests/share-free-name.test.ts, tests/course-claim.test.ts),
// so the wiring is pinned by reading the source, exactly as those files do.
// `privateRequest` itself is a pure, exported function and gets real
// behaviour tests.

import { readFileSync } from "node:fs";
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { setPublishesCast } from "../src/cast-file";
import { privateRequest, type ShareDoc } from "../src/ui/share";
import type { Settings } from "../src/store";

// The .yaml generation of publishing: these pin slugs, doors, links and locks,
// which are the same either way; the .cast names are tests/cast-files.test.ts's.
beforeAll(() => setPublishesCast(false));
afterAll(() => setPublishesCast(true));

const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");

const SETTINGS: Pick<Settings, "githubRepo" | "coursesDir"> = { githubRepo: "hmelberg/dcast", coursesDir: "courses" };

describe("privateRequest — what the quote/pay body targets", () => {
  test("a drawcast: kind cast, one lecture, target under the casts dir, using the field (Name) as its slug", () => {
    const doc: Pick<ShareDoc, "title" | "publishedAs" | "folder" | "lectureCount"> = { title: "Micro I" };
    expect(privateRequest(doc, SETTINGS, "drawcast", "my-cast")).toEqual({
      kind: "cast",
      target: "hmelberg/dcast/courses/casts/my-cast.yaml",
      lectures: 1,
    });
  });

  test("a drawcast: an empty field falls back to the title, slugified", () => {
    const doc: Pick<ShareDoc, "title" | "publishedAs" | "folder" | "lectureCount"> = { title: "Micro I" };
    expect(privateRequest(doc, SETTINGS, "drawcast", "")!.target).toBe("hmelberg/dcast/courses/casts/micro-i.yaml");
  });

  test("no repo configured — null, for either subject", () => {
    expect(privateRequest({ title: "T" }, { githubRepo: "", coursesDir: "" }, "drawcast", "t")).toBeNull();
    expect(privateRequest({ title: "T" }, { githubRepo: "", coursesDir: "" }, "course", "t")).toBeNull();
  });

  test("a published course: the target and page use its PERMANENT folder, never the (hidden) field", () => {
    const doc: Pick<ShareDoc, "title" | "publishedAs" | "folder" | "lectureCount"> = { title: "Micro I", folder: "courses/micro-i", lectureCount: 5 };
    expect(privateRequest(doc, SETTINGS, "course", "ignored-once-published")).toEqual({
      kind: "course",
      target: "hmelberg/dcast/courses/micro-i",
      lectures: 5,
      page: "https://hmelberg.github.io/dcast/courses/micro-i/",
    });
  });

  test("a never-published course: the field (Folder) mints the same guess buildPublishPlan would, never a network read", () => {
    const doc: Pick<ShareDoc, "title" | "publishedAs" | "folder" | "lectureCount"> = { title: "Micro I", lectureCount: 0 };
    expect(privateRequest(doc, SETTINGS, "course", "micro-economics")).toEqual({
      kind: "course",
      target: "hmelberg/dcast/courses/micro-economics",
      lectures: 1, // clamped up from 0 — the registry requires 1–200
      page: "https://hmelberg.github.io/dcast/courses/micro-economics/",
    });
  });

  test("a course's lecture count is clamped to at least 1, never sent as 0", () => {
    const doc: Pick<ShareDoc, "title" | "publishedAs" | "folder" | "lectureCount"> = { title: "T", folder: "courses/t" };
    expect(privateRequest(doc, SETTINGS, "course", "")!.lectures).toBe(1);
  });
});

describe("the Private checkbox — structure", () => {
  test("is a publish-choice label beside the other GitHub checkboxes, in the Link panel", () => {
    expect(share).toContain('const privateCb = h("input", { type: "checkbox", id: "share-private" })');
    expect(share).toMatch(/const privateLabel = h\("label", \{ class: "publish-choice", for: "share-private" \}, privateCb, h\("span", \{\}, "Private"\), privateHint\)/);
    const panel = share.slice(share.indexOf("const linkPanel = h("), share.indexOf("const publishGo = h("));
    expect(panel).toContain("privateLabel");
    expect(panel).toContain("privatePayRow");
    expect(panel).toContain("privateWarning");
  });

  test("the warning names the exact fix — publish under a new folder", () => {
    expect(share).toContain("Earlier versions stay readable in the repo's history. To keep them private too, publish under a new folder.");
  });
});

describe("refreshPrivateLine — the line states", () => {
  const fn = share.slice(share.indexOf("function refreshPrivateLine("), share.indexOf("privateCb.addEventListener("));

  test("signed out reads 'Sign in to publish privately', before any network call", () => {
    expect(fn).toMatch(/const token = getToken\(\);\s*if \(!token\) \{\s*privateHint\.textContent = "Sign in to publish privately";/);
  });

  test("owner other refuses privatising", () => {
    expect(fn).toContain(`privateHint.textContent = "Registered to another account — you can't make it private";`);
  });

  test("due > 0 shows the price and enables the Pay row; due 0 says paid", () => {
    expect(fn).toMatch(/privateHint\.textContent = `Private: \$\{formatPrice\(q\.due, q\.currency\)\} — enrolled learners only; you approve who joins`/);
    expect(fn).toMatch(/privatePayBtn\.textContent = `Pay \$\{formatPrice\(q\.due, q\.currency\)\}`/);
    expect(fn).toContain('privateHint.textContent = "Paid — publish to lock the lectures";');
  });

  test("unticking always clears the hint and re-enables Publish, synchronously", () => {
    expect(fn).toMatch(/if \(!privateCb\.checked\) \{\s*privateHint\.textContent = "";\s*publishGo\.disabled = false;\s*return;\s*\}/);
  });

  test("the warning is tied to being ticked AND already published (publishedAs for a drawcast, folder for a course)", () => {
    expect(fn).toContain('const alreadyPublished = current.subject === "course" ? doc.folder !== undefined : Boolean(doc.publishedAs);');
    expect(fn).toContain("privateWarning.hidden = !(privateCb.checked && alreadyPublished);");
  });

  test("Publish is disabled for every state except a resolved due-0 quote (pending, failed, signed-out, owner-other, due>0 all block it)", () => {
    // Every branch that is NOT the final due-0 branch sets disabled = true;
    // the due-0 branch (and the unticked branch) are the only ones setting false.
    const disabledTrue = fn.match(/publishGo\.disabled = true;/g) ?? [];
    const disabledFalse = fn.match(/publishGo\.disabled = false;/g) ?? [];
    expect(disabledTrue.length).toBeGreaterThanOrEqual(5); // no-item, signed-out, key, error, owner-other, due>0
    expect(disabledFalse.length).toBe(2); // unticked, and due===0
  });

  test("a stale in-flight quote can never clobber a newer state (superseded guard)", () => {
    expect(fn).toContain("if (my !== privateQuoteToken) return;");
  });
});

describe("the Pay button", () => {
  const fn = share.slice(share.indexOf('privatePayBtn.addEventListener("click"'), share.indexOf("const linkPanel = h("));

  test("posts through startPrivatePayment with the app's own return origin, like buyPrettyLink does", () => {
    expect(fn).toContain("startPrivatePayment(DEFAULT_ENROLL_API,");
    expect(fn).toContain('return: location.href.split("#")[0],');
  });

  test("a returned url navigates the browser there — Stripe Checkout", () => {
    expect(fn).toMatch(/if \(typeof started === "object" && "url" in started\) \{\s*location\.href = started\.url;/);
  });

  test("every refusal is a word, worded on the same hint line, never a throw", () => {
    expect(fn).toContain('"Nothing is due — publish to lock the lectures."');
    expect(fn).toContain('"A payment for this item is already open — finish it, or wait an hour and try again."');
    expect(fn).toContain(`"Registered to another account — you can't make it private"`);
    expect(fn).toContain('"Sign in to publish privately"');
    expect(fn).toContain('"Could not start the payment — try again in a moment."');
  });
});

describe("wiring into publish and prepPanels", () => {
  test("Publish carries the checkbox's state into deps.publish's choices", () => {
    const click = share.slice(share.indexOf("const linkPanel = h("), share.indexOf("// ---- drawcast server panel"));
    expect(click).toContain("private: privateCb.checked,");
  });

  test("prepPanels seeds the checkbox from the document and asks for a quote at once if it opens ticked", () => {
    const prep = share.slice(share.indexOf("function prepPanels(): void {"), share.indexOf("function refresh(deps: ShareDeps): void {"));
    expect(prep).toContain("privateCb.checked = doc.private === true;");
    expect(prep).toContain("refreshPrivateLine();");
  });

  test("ShareDoc.private and ShareDeps.publish's private choice are both optional booleans", () => {
    expect(share).toMatch(/private\?:\s*boolean;/);
  });
});

// HARD CONSTRAINT (tests/publish-server.test.ts:332-350): adding Private
// must not add a new `input` listener or a second `buildNameCheck(` — Share
// keeps exactly one and two, respectively. Private uses "change"/"click".
describe("the hard constraint holds after the Private switch", () => {
  test("still exactly one input listener and two buildNameCheck( calls; no keyup/keydown", () => {
    expect(share.match(/addEventListener\("input"/g)).toHaveLength(1);
    expect(share.match(/buildNameCheck\(/g)).toHaveLength(2);
    expect(share).not.toContain('addEventListener("keyup"');
    expect(share).not.toContain('addEventListener("keydown"');
  });

  test("Private's own listeners are change/click only", () => {
    expect(share).toContain('privateCb.addEventListener("change"');
    expect(share).toContain('privatePayBtn.addEventListener("click"');
  });
});
