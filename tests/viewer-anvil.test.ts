// The fourth source: a cast stored on the drawcast server (spec §4). The
// parse and the fetch are pure enough for the node suite; runViewer's wiring
// is guarded by source text, like tests/views-viewer.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { anvilHashFor } from "../src/names";
import { fetchAnvilText, parseViewerHash } from "../src/viewer";

const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const REF = { cast: "anvil/spanish1/01.yaml", api: "https://a" };

/** A fetch stub the tests can also inspect: what was asked for, and in what order. */
function fetchWith(answer: (url: string) => Response) {
  const f = vi.fn(async (url: string) => answer(url));
  return { f, impl: f as unknown as typeof fetch };
}

describe("parseViewerHash", () => {
  test("reads #anvil=<course>/<file> and keeps the common parameters", () => {
    const req = parseViewerHash("#anvil=spanish1/01-intro.yaml&mode=silent");
    expect(req?.anvil?.cast).toBe("anvil/spanish1/01-intro.yaml");
    expect(req?.mode).toBe("silent");
  });
  test("the key has the GitHub shape, and points at the default server", () => {
    // Three segments, `anvil` first: CAST_KEY_RE in views.ts / learn.ts /
    // view-key.mts accepts it unchanged, and the dashboard needs no new case.
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
  test("refuses anything that is not a document", () => {
    expect(parseViewerHash("#anvil=spanish1/01-intro.html")).toBeNull();
    expect(parseViewerHash("#anvil=spanish1")).toBeNull();
  });
});

describe("fetchAnvilText", () => {
  test("concatenates the spec and its audio into one document", async () => {
    const { impl } = fetchWith((url) =>
      url.includes("/cast/audio") ? new Response("audio:\n  lang: en\n", { status: 200 }) : new Response("meta:\n  title: Intro\n", { status: 200 }),
    );
    const text = await fetchAnvilText(REF, impl);
    expect(text).toBe("meta:\n  title: Intro\n---\naudio:\n  lang: en\n");
  });
  test("a spec without a trailing newline still gets exactly one before the separator", async () => {
    const { impl } = fetchWith((url) => (url.includes("/cast/audio") ? new Response("audio: {}\n", { status: 200 }) : new Response("meta: {}", { status: 200 })));
    expect(await fetchAnvilText(REF, impl)).toBe("meta: {}\n---\naudio: {}\n");
  });
  test("a cast without audio is just its spec", async () => {
    const { impl } = fetchWith((url) => (url.includes("/cast/audio") ? new Response("{}", { status: 404 }) : new Response("meta: {}\n", { status: 200 })));
    expect(await fetchAnvilText(REF, impl)).toBe("meta: {}\n");
  });
  test("an audio request that fails on the network still yields the spec", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes("/cast/audio")) throw new TypeError("offline");
      return new Response("meta: {}\n", { status: 200 });
    });
    expect(await fetchAnvilText(REF, f as unknown as typeof fetch)).toBe("meta: {}\n");
  });
  test("asks the given server for the cast, and sends the session token as key=", async () => {
    const { f, impl } = fetchWith(() => new Response("meta: {}\n", { status: 200 }));
    await fetchAnvilText(REF, impl);
    const [spec, audio] = f.mock.calls.map((c) => c[0]);
    expect(spec).toMatch(/^https:\/\/a\/_\/api\/cast\?cast=anvil%2Fspanish1%2F01\.yaml&key=/);
    expect(audio).toMatch(/^https:\/\/a\/_\/api\/cast\/audio\?cast=anvil%2Fspanish1%2F01\.yaml&key=/);
  });
  test("a refusal names the door, not the network", async () => {
    const { impl } = fetchWith(() => new Response("{}", { status: 403 }));
    await expect(fetchAnvilText(REF, impl)).rejects.toThrow(/sign in|not yours/i);
  });
  test("401 — the server's answer to no token at all — is the same door", async () => {
    const { f, impl } = fetchWith(() => new Response("{}", { status: 401 }));
    await expect(fetchAnvilText(REF, impl)).rejects.toThrow(/sign in/i);
    // Refused at the spec: the audio is never asked for.
    expect(f).toHaveBeenCalledTimes(1);
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
  test("the load picks fetchAnvilText for req.anvil, ahead of the GitHub branch", () => {
    const load = /const text = req\.anvil\s*\?\s*await fetchAnvilText\(req\.anvil\)\s*:\s*req\.gh\s*\?\s*await fetchGhText\(req\.gh\)/;
    expect(viewer).toMatch(load);
  });
  test("counting and learner reporting are keyed by the one castKey, never by req.gh alone", () => {
    expect(viewer).toMatch(/countingEnabled\(playlist\.meta\)\s*&&\s*castKey\b/);
    expect(viewer).toMatch(/if \(castKey\) \{\s*learnerCast = castKey;/);
    // The old shape — a second castKeyFor(req.gh) inside each block — is gone.
    expect(viewer.match(/castKeyFor\(req\.gh\)/g)?.length).toBe(1);
  });
  test("comments stay GitHub-only: data-repo comes from the repository URL", () => {
    expect(viewer).toMatch(/playlist\.meta\.comments && req\.gh/);
  });
  test("the loading line names the server", () => {
    expect(viewer).toMatch(/Loading drawing from the drawcast server/);
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
  });
  test("runNamed hands the resolved target through anvilHashFor", () => {
    expect(viewer).toMatch(/parseViewerHash\(anvilHashFor\(hash, resolved\.target\)\)/);
  });
});
