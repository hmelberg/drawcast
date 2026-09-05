import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const entry = readFileSync(new URL("../src/entry.ts", import.meta.url), "utf8");
const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("entry routes names", () => {
  test("gh/gdoc/gdrive/anvil first, then names, then the app", () => {
    const gh = entry.indexOf("(gdoc|gh|gdrive|anvil)[=-]");
    const named = entry.indexOf("isNameHash(hash)");
    const app = entry.indexOf('import("./main")');
    expect(gh).toBeGreaterThan(0);
    expect(named).toBeGreaterThan(gh);
    expect(app).toBeGreaterThan(named);
    expect(entry).toMatch(/runNamed\(hash\)/);
  });
  test("spends an arriving sign-in token BEFORE reading the hash it routes on", () => {
    // The redeem strips `t=` from the address; a hash read before it would
    // still carry the token, and a `#name&t=…` would then route on a string
    // the name resolver has never seen.
    const redeem = entry.indexOf("await redeemFromAddress(location.hash, location.href,");
    const read = entry.indexOf("const hash = location.hash");
    const route = entry.indexOf("(gdoc|gh|gdrive|anvil)[=-]");
    expect(redeem).toBeGreaterThan(0);
    expect(read).toBeGreaterThan(redeem);
    expect(route).toBeGreaterThan(read);
  });
  test("bounds the redeem — it gates first paint, and a stranger can craft `#name&t=junk`", () => {
    // Same ten-second bound every other registry call carries (main.ts,
    // ui/course.ts): an unreachable or sleeping backend costs ten seconds of
    // blank page, not the whole visit.
    const call = entry.slice(entry.indexOf("await redeemFromAddress("), entry.indexOf("const hash = location.hash"));
    expect(call).toMatch(/AbortSignal\.timeout\(10_000\)/);
  });
});

describe("runNamed", () => {
  test("resolves against the registry, redirects courses, plays casts through parseViewerHash", () => {
    expect(viewer).toMatch(/export async function runNamed\(hash: string\)/);
    expect(viewer).toMatch(/resolveName\(DEFAULT_ENROLL_API, name\)/);
    expect(viewer).toMatch(/kind === "course"/);
    expect(viewer).toMatch(/location\.replace\(/);
    // anvilHashFor, not ghHashFor: a registered name may point at the
    // drawcast server as readily as at GitHub, and names.ts decides which.
    expect(viewer).toMatch(/parseViewerHash\(anvilHashFor\(hash, resolved\.target\)\)/);
    expect(viewer).not.toMatch(/ghHashFor/);
    expect(viewer).toMatch(/No drawcast called/);
  });

  test("parses the resolved target before clearing the lookup status, so a bad target still shows a message", () => {
    const parseCall = viewer.indexOf("parseViewerHash(anvilHashFor(");
    const statusRemove = viewer.indexOf("status.remove()");
    expect(parseCall).toBeGreaterThan(0);
    expect(statusRemove).toBeGreaterThan(parseCall);
    expect(viewer).toMatch(/points at something this viewer cannot play/);
  });
});
