// The fourth source: a cast stored on the drawcast server (spec §4). The
// parse and the fetch are pure enough for the node suite; runViewer's wiring
// is guarded by source text, like tests/views-viewer.test.ts. The guards
// that a server cast is never COUNTED publicly are behavioural and live
// where the refusal does: tests/views-client.test.ts (the client never sends
// it) and tests/views-endpoint.test.ts (the function refuses it).
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { anvilHashFor } from "../src/names";
import { fetchAnvilText, parseViewerHash } from "../src/viewer";

const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const entry = readFileSync(new URL("../src/entry.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");

const REF = { cast: "anvil/spanish1/01.yaml", api: "https://a" };

/** A fetch stub the tests can also inspect: what was asked for, and in what order. */
function fetchWith(answer: (url: string) => Response) {
  const f = vi.fn(async (url: string) => answer(url));
  return { f, impl: f as unknown as typeof fetch };
}

/** A spec that loads, then whatever the audio endpoint answers. */
function withAudio(audio: () => Response, spec = "meta: {}\n") {
  return fetchWith((url) => (url.includes("/cast/audio") ? audio() : new Response(spec, { status: 200 })));
}

describe("parseViewerHash", () => {
  test("reads #anvil=<course>/<file> and keeps the common parameters", () => {
    const req = parseViewerHash("#anvil=spanish1/01-intro.yaml&mode=silent");
    expect(req?.anvil?.cast).toBe("anvil/spanish1/01-intro.yaml");
    expect(req?.mode).toBe("silent");
  });
  test("the key has the GitHub shape, and points at the default server", () => {
    // Three segments, `anvil` first: CAST_KEY_RE in learn.ts accepts it
    // unchanged, so learner events and the dashboard need no new case.
    const req = parseViewerHash("#anvil=spanish1/01-intro.yaml");
    expect(req?.anvil).toEqual({ cast: "anvil/spanish1/01-intro.yaml", api: "https://drawcast.anvil.app" });
    expect(req?.gh).toBeUndefined();
    expect(req?.docId).toBeUndefined();
    expect(req?.driveId).toBeUndefined();
  });
  test("accepts the dash alias, like the other sources", () => {
    const req = parseViewerHash("#anvil-spanish1/01-intro.yaml&style=sketchy");
    expect(req?.anvil?.cast).toBe("anvil/spanish1/01-intro.yaml");
    expect(req?.style).toBe("sketchy");
  });
  test("a file whose name starts with anvil- is left alone", () => {
    const req = parseViewerHash("#anvil=spanish1/anvil-intro.yaml&mode=instant");
    expect(req?.anvil?.cast).toBe("anvil/spanish1/anvil-intro.yaml");
    expect(req?.mode).toBe("instant");
  });
  test("refuses a path that climbs out", () => {
    expect(parseViewerHash("#anvil=spanish1/../../etc/passwd.yaml")).toBeNull();
  });
  test("refuses a slug that is not one plain segment — DOC_PATH_RE never sees the slug", () => {
    expect(parseViewerHash("#anvil=../x.yaml")).toBeNull();
    expect(parseViewerHash("#anvil=./x.yaml")).toBeNull();
    expect(parseViewerHash("#anvil=a..b/x.yaml")).toBeNull();
    expect(parseViewerHash("#anvil=.hidden/x.yaml")).toBeNull();
    // Dots INSIDE a slug are ordinary.
    expect(parseViewerHash("#anvil=v1.2/x.yaml")?.anvil?.cast).toBe("anvil/v1.2/x.yaml");
  });
  test("refuses anything that is not a document", () => {
    expect(parseViewerHash("#anvil=spanish1/01-intro.html")).toBeNull();
    expect(parseViewerHash("#anvil=spanish1")).toBeNull();
  });
  test("a malformed percent-escape is null, not a thrown blank page", () => {
    // entry.ts runs boot() uncaught: a throw from here would be a blank page
    // with no message. nameInHash guards the same hazard; so does this now,
    // for the GitHub branch too.
    expect(parseViewerHash("#anvil=spanish1/b%.yaml")).toBeNull();
    expect(parseViewerHash("#gh=o/r/b%.yaml")).toBeNull();
  });
});

describe("fetchAnvilText", () => {
  test("concatenates the spec and its audio into one document", async () => {
    const { impl } = withAudio(() => new Response("audio:\n  lang: en\n", { status: 200 }), "meta:\n  title: Intro\n");
    expect(await fetchAnvilText(REF, impl)).toBe("meta:\n  title: Intro\n---\naudio:\n  lang: en\n");
  });
  test("a spec without a trailing newline still gets exactly one before the separator", async () => {
    const { impl } = withAudio(() => new Response("audio: {}\n", { status: 200 }), "meta: {}");
    expect(await fetchAnvilText(REF, impl)).toBe("meta: {}\n---\naudio: {}\n");
  });
  test("a cast without audio is just its spec, and nothing is reported — 404 is normal", async () => {
    const problem = vi.fn();
    const { impl } = withAudio(() => new Response("{}", { status: 404 }));
    expect(await fetchAnvilText(REF, impl, problem)).toBe("meta: {}\n");
    expect(problem).not.toHaveBeenCalled();
  });
  test("a present track reports nothing either", async () => {
    const problem = vi.fn();
    const { impl } = withAudio(() => new Response("audio: {}\n", { status: 200 }));
    await fetchAnvilText(REF, impl, problem);
    expect(problem).not.toHaveBeenCalled();
  });
  test("an audio request that fails on the network still yields the spec — and says so", async () => {
    const problem = vi.fn();
    const f = vi.fn(async (url: string) => {
      if (url.includes("/cast/audio")) throw new TypeError("offline");
      return new Response("meta: {}\n", { status: 200 });
    });
    expect(await fetchAnvilText(REF, f as unknown as typeof fetch, problem)).toBe("meta: {}\n");
    expect(problem).toHaveBeenCalledTimes(1);
    expect(problem).toHaveBeenCalledWith("network");
  });
  test("a server failure on the audio keeps the lecture playing, and is reported once with its status", async () => {
    // Silence here would be wrong: a baked voice that quietly became a
    // synthesiser looks exactly like one that was never baked.
    const problem = vi.fn();
    const { impl } = withAudio(() => new Response("{}", { status: 503 }));
    expect(await fetchAnvilText(REF, impl, problem)).toBe("meta: {}\n");
    expect(problem).toHaveBeenCalledTimes(1);
    expect(problem).toHaveBeenCalledWith("HTTP 503");
  });
  test("a 200 that is not an audio document is dropped, not appended", async () => {
    // classifyDocs makes an unrecognised mapping a spec, and validateSpec
    // then fails the whole drawcast — an HTML shell or a captive portal would
    // turn an OPTIONAL resource into a dead lecture.
    const problem = vi.fn();
    const { impl } = withAudio(() => new Response("<!doctype html><html><body>Sign in</body></html>", { status: 200 }));
    expect(await fetchAnvilText(REF, impl, problem)).toBe("meta: {}\n");
    expect(problem).toHaveBeenCalledWith("not an audio document");
  });
  test("a 200 whose body is a spec, not audio, is dropped too — a mapping alone is not enough", async () => {
    const problem = vi.fn();
    const { impl } = withAudio(() => new Response("meta:\n  title: Not audio\n", { status: 200 }));
    expect(await fetchAnvilText(REF, impl, problem)).toBe("meta: {}\n");
    expect(problem).toHaveBeenCalledWith("not an audio document");
  });
  test("an audio body carrying a second document is dropped whole — the first line is not the only line", async () => {
    const problem = vi.fn();
    for (const body of ["audio: {}\n---\nfoo: bar\n", "audio: {}\r\n---\r\nfoo: bar\r\n", "audio: {}\n--- \nfoo: bar\n", "audio: {}\n---"]) {
      problem.mockClear();
      const { impl } = withAudio(() => new Response(body, { status: 200 }));
      expect(await fetchAnvilText(REF, impl, problem)).toBe("meta: {}\n");
      expect(problem).toHaveBeenCalledWith("not an audio document");
    }
    // A `---` that is not a line on its own is ordinary content.
    const { impl } = withAudio(() => new Response("audio:\n  note: a --- b\n  more: ---x\n", { status: 200 }));
    expect(await fetchAnvilText(REF, impl)).toBe("meta: {}\n---\naudio:\n  note: a --- b\n  more: ---x\n");
  });
  test("works without a reporter — the callback is optional", async () => {
    const { impl } = withAudio(() => new Response("{}", { status: 503 }));
    expect(await fetchAnvilText(REF, impl)).toBe("meta: {}\n");
  });
  test("asks the given server for the cast, and sends the session token as key=", async () => {
    const { f, impl } = fetchWith(() => new Response("meta: {}\n", { status: 200 }));
    await fetchAnvilText(REF, impl);
    // Order-independent: the two leave together, so which lands first is not
    // this function's promise. Both addresses and the token are.
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(2);
    expect(urls.some((u) => /^https:\/\/a\/_\/api\/cast\?cast=anvil%2Fspanish1%2F01\.yaml&key=/.test(u))).toBe(true);
    expect(urls.some((u) => /^https:\/\/a\/_\/api\/cast\/audio\?cast=anvil%2Fspanish1%2F01\.yaml&key=/.test(u))).toBe(true);
  });
  test("a refusal names the door, not the network", async () => {
    const { impl } = fetchWith(() => new Response("{}", { status: 403 }));
    await expect(fetchAnvilText(REF, impl)).rejects.toThrow(/sign in|not yours/i);
  });
  test("401 — the server's answer to no token at all — is the same door", async () => {
    const { f, impl } = fetchWith(() => new Response("{}", { status: 401 }));
    await expect(fetchAnvilText(REF, impl)).rejects.toThrow(/sign in/i);
    // BOTH requests went out, and that is the accepted cost of fetching them
    // in parallel: the audio leaves before the spec's status is known, so a
    // reader who will be refused asks for audio it will also be refused.
    // Pinned rather than tolerated — if this ever reads 1 again, the fetches
    // have gone back to sequential and every first play pays an extra
    // round trip (measured 2026-09-05: ~0.25 s of a ~0.7 s start).
    expect(f).toHaveBeenCalledTimes(2);
  });
  test("a missing cast says so, without blaming the sign-in", async () => {
    const { impl } = fetchWith(() => new Response("{}", { status: 404 }));
    const err = await fetchAnvilText(REF, impl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/not on the drawcast server/);
    expect((err as Error).message).not.toMatch(/sign in/i);
  });
  test("any other failure carries the status", async () => {
    const { impl } = fetchWith(() => new Response("{}", { status: 503 }));
    await expect(fetchAnvilText(REF, impl)).rejects.toThrow(/HTTP 503/);
  });
});

describe("runViewer takes the fourth source through the same door as the others", () => {
  test("the load picks fetchAnvilText for req.anvil, ahead of the GitHub branch, with a reporter for lost narration", () => {
    expect(viewer).toMatch(/const text = req\.anvil\s*\?\s*await fetchAnvilText\(req\.anvil, fetch, \(why\) =>/);
    expect(viewer).toMatch(/:\s*req\.gh\s*\?\s*await fetchGhText\(req\.gh\)/);
  });
  test("counting stays GitHub-only: a private cast's views are the teacher's business, not a public counter's", () => {
    // netlify/functions/views is public and ?repo= enumerates an owner; an
    // anvil/ key there would list a private course's lectures to anyone
    // (round 0's Critical). The property: the guard tests req.gh and NOTHING
    // else — no anvil branch, no shared castKey, no `||` widening it.
    expect(viewer).toMatch(/if \(countingEnabled\(playlist\.meta\) && req\.gh\) \{/);
    expect(viewer).not.toMatch(/countingEnabled\(playlist\.meta\)[^\n]*(req\.anvil|castKey|\|\|)/);
    // …and the whole counting block, up to where the learner block begins,
    // derives its key from req.gh alone. Both anchors must be found: a
    // missing end anchor would slice to the end of the file and this test
    // would fail for the wrong reason (it once did).
    const start = viewer.indexOf("countingEnabled(playlist.meta)");
    const end = viewer.indexOf("const castKey = req.anvil");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const counting = viewer.slice(start, end);
    expect(counting).toMatch(/castKeyFor\(req\.gh\)/);
    expect(counting).not.toMatch(/req\.anvil|\bcastKey\b/);
  });
  test("learner reporting is keyed by the one castKey — server or GitHub — because it goes to the authenticated backend", () => {
    // One key for both sources, decided once; the reporter carries it with
    // the session token, and every event goes out under it. The public
    // counter never sees this key (the test above), and this block never
    // uses the counter's.
    expect(viewer).toMatch(/const castKey = req\.anvil \? req\.anvil\.cast : req\.gh \? castKeyFor\(req\.gh\) : null;/);
    expect(viewer).toMatch(/const reporter = castKey !== null && enroll === DEFAULT_ENROLL_API && key !== "" \? \{ api: enroll, key, cast: castKey \} : null;/);
    expect(viewer.match(/void sendEvent\(reporter\.api, \{ kind: "[a-z]+", cast: reporter\.cast/g)).toHaveLength(3);
    const learners = viewer.slice(viewer.indexOf("const castKey = req.anvil"), viewer.indexOf("const settings = loadSettings();"));
    expect(learners.length).toBeGreaterThan(0);
    expect(learners).not.toMatch(/viewKey|recordView|readViewCount/);
  });
  test("comments stay GitHub-only: data-repo comes from the repository URL", () => {
    expect(viewer).toMatch(/playlist\.meta\.comments && req\.gh/);
  });
  test("the loading line names the server", () => {
    expect(viewer).toMatch(/Loading drawing from the drawcast server/);
  });
  test("a lost narration is said once, in the meta row where the view count lives", () => {
    expect(viewer).toMatch(/h\("div", \{ class: "viewer-meta" \}, viewsEl, noteEl\)/);
    expect(viewer).toMatch(/if \(audioNote\) noteEl\.textContent = audioNote;/);
    expect(viewer).toMatch(/Recorded narration unavailable \(\$\{why\}\)/);
  });
});

describe("a link the router accepts but the parser refuses is a message, not a blank page", () => {
  // parseViewerHash returning null used to be dropped by entry.ts's
  // `if (req) await runViewer(req)` — so a bad slug, a climbing path or a
  // broken escape was a blank page with no message, the very failure the
  // guarded decode was meant to end.
  test("entry.ts shows the message on null", () => {
    expect(entry).toMatch(/const \{ parseViewerHash, runViewer, showUnplayable \} = await import\("\.\/viewer"\)/);
    expect(entry).toMatch(/if \(req\) await runViewer\(req\);\s*else showUnplayable\(\);/);
  });
  test("the message names the problem and is styled as the viewer's error status", () => {
    expect(viewer).toMatch(/export function showUnplayable\(\): void/);
    const fn = viewer.slice(viewer.indexOf("export function showUnplayable"), viewer.indexOf("export async function runNamed"));
    expect(fn).toMatch(/class: "viewer-status error"/);
    expect(fn).toMatch(/cannot play/);
    expect(fn).toMatch(/document\.body\.append\(status\)/);
  });
});

describe("a name pointing at the server", () => {
  test("becomes an #anvil= hash, keeping the parameters", () => {
    expect(anvilHashFor("#spanish1&mode=silent", "anvil/spanish1/01-intro.yaml")).toBe("#anvil=spanish1/01-intro.yaml&mode=silent");
  });
  test("a github target still becomes a gh hash", () => {
    expect(anvilHashFor("#spanish1", "hmelberg/dcast/casts/one.yaml")).toBe("#gh=hmelberg/dcast/casts/one.yaml");
  });
  test("a name with a lecture segment keeps its parameters too", () => {
    expect(anvilHashFor("#learn-russian/3&mode=silent&learner=fjell-rev-havn", "anvil/learn-russian/03.yaml")).toBe(
      "#anvil=learn-russian/03.yaml&mode=silent&learner=fjell-rev-havn",
    );
  });
  test("round-trips through parseViewerHash to the very key the registry held", () => {
    const req = parseViewerHash(anvilHashFor("#spanish1&mode=silent", "anvil/spanish1/01-intro.yaml"));
    expect(req?.anvil?.cast).toBe("anvil/spanish1/01-intro.yaml");
    expect(req?.mode).toBe("silent");
  });
  test("an anvil target that climbs out is refused at the parse, like a bad gh one", () => {
    expect(parseViewerHash(anvilHashFor("#spanish1", "anvil/spanish1/../secret.yaml"))).toBeNull();
    expect(parseViewerHash(anvilHashFor("#spanish1", "anvil/../secret.yaml"))).toBeNull();
  });
  test("runNamed hands the resolved target through anvilHashFor", () => {
    expect(viewer).toMatch(/parseViewerHash\(anvilHashFor\(hash, resolved\.target\)\)/);
  });
});
