import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const entry = readFileSync(new URL("../src/entry.ts", import.meta.url), "utf8");
const names = readFileSync(new URL("../src/names.ts", import.meta.url), "utf8");
const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("entry routes names", () => {
  test("gh/gdoc/gdrive/anvil first, then names, then the app", () => {
    const gh = entry.indexOf("(gdoc|gh|gdrive|anvil|cast)[=-]");
    const named = entry.indexOf("isNameHash(hash)");
    const app = entry.indexOf('import("./main")');
    expect(gh).toBeGreaterThan(0);
    expect(named).toBeGreaterThan(gh);
    expect(app).toBeGreaterThan(named);
    expect(entry).toMatch(/runNamed\(hash, early\)/);
    // The lookup starts BEFORE the viewer chunk is imported, so the two overlap.
    expect(entry.indexOf("lookupNamed(hash, DEFAULT_ENROLL_API")).toBeGreaterThan(named);
    expect(entry.indexOf("lookupNamed(hash, DEFAULT_ENROLL_API")).toBeLessThan(entry.indexOf('await import("./viewer");\n    doneBooting();\n    await runNamed'));
  });
  test("spends an arriving sign-in token BEFORE reading the hash it routes on", () => {
    // The redeem strips `t=` from the address; a hash read before it would
    // still carry the token, and a `#name&t=…` would then route on a string
    // the name resolver has never seen.
    const redeem = entry.indexOf("await redeemFromAddress(location.hash, location.href,");
    const read = entry.indexOf("const hash = location.hash");
    const route = entry.indexOf("(gdoc|gh|gdrive|anvil|cast)[=-]");
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
  test("resolves against the registry, opens the door for a course, plays casts through parseViewerHash", () => {
    expect(viewer).toMatch(/export async function runNamed\(hash: string, early\?: Promise<Resolved \| null>\)/);
    expect(viewer).toMatch(/await \(early \?\? lookupNamed\(hash, DEFAULT_ENROLL_API, fetch, typeof document !== "undefined" \? document\.referrer : ""\)\)/);
    // The Netlify name endpoint records a visit per lookup, and needs to know
    // WHY the lookup happened (a bare name vs. a course lecture) and where it
    // came from — src/ref, sent explicitly rather than guessed server-side.
    expect(names).toMatch(/resolveName\(api, name, fetchImpl, \{ src: name\.includes\("\/"\) \? "lecture" : "name", ref: referrer \}\)/);
    expect(viewer).toMatch(/kind === "course"/);
    // A course name with a page opens that page (Task 8) — UNLESS the hash
    // already carries `&join` (the page's own Join link, or a copied one),
    // which reaches the door directly rather than bouncing back to the page
    // a learner who just clicked Join came from.
    // The decision (kind, &join, referrer, owner's github.io) lives in
    // view-origin's coursePageRedirect — tests/view-origin.test.ts.
    expect(viewer).toMatch(/const page = coursePageRedirect\(resolved, hash, typeof document !== "undefined" \? document\.referrer : ""\)/);
    expect(viewer).toMatch(/location\.replace\(page\)/);
    expect(viewer).toMatch(/status\.replaceWith\(courseDoor\(name, resolved\)\)/);
    // The page redirect is checked strictly AFTER namedRoute's own bounce to
    // the main origin, and the door is the fallback once neither applies.
    const namedRouteAt = viewer.indexOf("namedRoute(resolved, hash)");
    const pageRedirectAt = viewer.indexOf("coursePageRedirect(resolved, hash");
    const doorAt = viewer.indexOf("status.replaceWith(courseDoor(name, resolved))");
    expect(namedRouteAt).toBeGreaterThan(0);
    expect(pageRedirectAt).toBeGreaterThan(namedRouteAt);
    expect(doorAt).toBeGreaterThan(pageRedirectAt);
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

  test("the join test reuses view-origin's own JOIN_RE rather than a second literal", () => {
    const rawViewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8");
    // coursePageRedirect (view-origin.ts, beside JOIN_RE) makes the &join test.
    expect(rawViewer).toMatch(/import \{[^}]*\bcoursePageRedirect\b[^}]*\} from "\.\/security\/view-origin"/);
    // stripJoin (above) has its own, differently-shaped pattern for a
    // different job (stripping `&join` or `&join=…` from a copied link) —
    // that one is fine. What must NOT reappear is view-origin's own literal
    // pattern, copy-pasted as a second definition instead of imported.
    expect(rawViewer).not.toContain("/[#&]join(?:=|&|$)/");
  });
});

// The course view at drawcast.app/#<name> (spec §3, §8): where a learner
// joins. Its behaviour is exercised in tests/course-door.test.ts through the
// injected DoorDeps; what only the source can say is pinned here — that the
// LIVE dependencies are the real sign-in, token, forget and join.
describe("the course door's live wiring", () => {
  const live = viewer.slice(viewer.indexOf("const liveDoorDeps: DoorDeps = {"), viewer.indexOf("export function courseDoor("));
  test("courseDoor is exported, takes the resolved pointer and the deps, and is what a course name opens", () => {
    expect(viewer).toMatch(
      /export function courseDoor\(\s*name: string,\s*resolved: Resolved,\s*deps: DoorDeps = liveDoorDeps,\s*opts: \{ onJoined\?: \(\) => void; lead\?: string; title\?: string \} = \{\},\s*\): HTMLElement/,
    );
    expect(viewer).toMatch(/import \{ anvilHashFor, lookupNamed, nameInHash, type Resolved \} from "\.\/names"/);
    expect(live.length).toBeGreaterThan(0);
  });
  test("the token is the account's, a dead one is dropped through setToken, and sign-in is the handshake returning to this very address — a bare #<name>", () => {
    expect(live).toMatch(/token: getToken,/);
    expect(live).toMatch(/forget: \(\) => setToken\(""\),/);
    expect(live).toMatch(/location\.href = signInUrl\(location\.href\);/);
  });
  test("joining goes through the learner client, to the default app, bounded", () => {
    expect(live).toMatch(/joinCourse\(DEFAULT_ENROLL_API, key, req, /);
    expect(live).toContain("AbortSignal.timeout(10_000)");
    expect(live).not.toMatch(/\/_\/api\//); // the client owns the address
  });
});
