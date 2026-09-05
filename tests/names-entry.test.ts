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
  test("resolves against the registry, opens the door for a course, plays casts through parseViewerHash", () => {
    expect(viewer).toMatch(/export async function runNamed\(hash: string\)/);
    expect(viewer).toMatch(/resolveName\(DEFAULT_ENROLL_API, name\)/);
    expect(viewer).toMatch(/kind === "course"/);
    // A course name is the door the published page links to (identity
    // round): bouncing to that page would send a learner who just clicked
    // Join straight back to where they came from.
    expect(viewer).not.toMatch(/location\.replace\(resolved\.page\)/);
    expect(viewer).toMatch(/status\.replaceWith\(courseDoor\(name, resolved\)\)/);
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

// The course view at drawcast.app/#<name> (spec §3, §8): where a learner
// joins, in one click when signed in. Source pins — h() needs a document.
describe("the course door", () => {
  const door = viewer.slice(viewer.indexOf("function courseDoor("), viewer.indexOf("export async function runViewer("));
  test("exists, takes the resolved pointer, and is what a course name opens", () => {
    expect(door).toMatch(/^function courseDoor\(name: string, resolved: Resolved\): HTMLElement/);
    expect(viewer).toMatch(/import \{ anvilHashFor, nameInHash, resolveName, type Resolved \} from "\.\/names"/);
  });
  test("signed out, the button IS the sign-in, and the handshake returns to this very address — a bare #<name>", () => {
    expect(door).toContain('getToken() === "" ? "Sign in to join" : "Join this course"');
    expect(door).toMatch(/if \(key === ""\) \{\s*location\.href = signInUrl\(location\.href\);\s*return;/);
  });
  test("signed in, one click joins: the token and the resolved course key, through the learner client, bounded", () => {
    expect(door).toMatch(/joinCourse\(DEFAULT_ENROLL_API, key, \{ course: resolved\.target, title, page: resolved\.page \?\? `https:\/\/drawcast\.app\/#\$\{name\}` \}/);
    expect(door).toContain("AbortSignal.timeout(10_000)");
    expect(door).not.toMatch(/\/_\/api\//); // the client owns the address
  });
  test("the answer is said in the door's own words, a dead token is dropped, and the button is disabled only while the answer is on its way", () => {
    expect(door).toContain("note.textContent = joinNote(outcome);");
    expect(door.indexOf("button.disabled = true;")).toBeLessThan(door.indexOf("joinCourse("));
    expect(door).toContain("button.disabled = false;");
    expect(door).toMatch(/if \(outcome === "key"\) \{\s*setToken\(""\);/);
    expect(door).toContain('button.hidden = outcome === "ok";');
  });
  test("the course's own page is linked either way, so the name still reaches the course", () => {
    expect(door).toMatch(/if \(resolved\.page\) wrap\.append\(h\("p", \{\}, h\("a", \{ href: resolved\.page \}, "Open the course page"\)\)\);/);
  });
});
