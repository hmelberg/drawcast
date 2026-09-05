// Publishing ONE drawcast to the drawcast server (round 0 spec §4): the
// third publish target. publishToServer is a pure function of fetch, so it is
// exercised for real, mocks in; the Share panel and main.ts's wiring need a
// DOM this suite does not have, so they are pinned as drift against the
// source, the way drive-publish.test.ts pins its halves.
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { formatPlaylist, formatPublished, parsePlaylistText } from "../src/playlist/playlist";
import { publishToServer, serverCastKey, splitBakedYaml } from "../src/publish/server";
import type { Spec } from "../src/spec/types";
import { parseViewerHash } from "../src/viewer";

const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const course = readFileSync(new URL("../src/ui/course.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/store.ts", import.meta.url), "utf8");

type Call = [string, RequestInit];
/** A fetch stub answering per URL, whose calls the tests read back in order. */
function fetchWith(answer: (url: string) => Response) {
  const f = vi.fn(async (url: string) => answer(url));
  return { impl: f as unknown as typeof fetch, calls: () => f.mock.calls as unknown as Call[] };
}
const okJson = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const refusal = (status: number, error: string) => new Response(JSON.stringify({ error }), { status });
const isAudio = (url: string) => url.includes("/_/api/cast/audio?");

const BAKED = "meta: {}\n---\naudio:\n  lang: en\n";
const ARGS = { slug: "spanish1", file: "01-intro.yaml", title: "Intro", yaml: BAKED, access: "enrolled" as const, token: "t", api: "https://a" };

describe("serverCastKey", () => {
  test("is a/b/c-shaped so events and progress never notice", () => {
    expect(serverCastKey("spanish1", "01-intro.yaml")).toBe("anvil/spanish1/01-intro.yaml");
  });
  test("is what the viewer parses back out of the published link", () => {
    expect(parseViewerHash("#anvil=spanish1/01-intro.yaml")?.anvil?.cast).toBe(serverCastKey("spanish1", "01-intro.yaml"));
  });
});

describe("splitBakedYaml", () => {
  test("separates the audio document from the spec", () => {
    const { spec, audio } = splitBakedYaml("meta: {}\n---\naudio:\n  lang: en\n");
    expect(spec).toBe("meta: {}\n");
    expect(audio).toBe("audio:\n  lang: en\n");
  });
  test("an unbaked document has no audio", () => {
    expect(splitBakedYaml("meta: {}\n").audio).toBeNull();
  });
  test("a --- between two SPEC documents is not the audio separator", () => {
    const stream = "title: A\ncommands: []\n---\ntitle: B\ncommands: []\n";
    expect(splitBakedYaml(stream)).toEqual({ spec: stream, audio: null });
  });
  test("is the exact inverse of formatPublished, byte for byte", () => {
    const spec = {
      title: "Supply and demand",
      elements: [{ id: "a", type: "text", text: "x", x: 1, y: 1 }],
      commands: [{ draw: ["a"], speak: "Supply meets demand." }],
    } as Spec;
    const playlist = {
      meta: { title: "T", advance: "click" as const, gap: 1, transitions: "auto" as const },
      entries: [{ kind: "item" as const, spec }],
      warnings: [],
    };
    const audio = { lang: "en", lines: { "|a||Supply meets demand.": { mp3: "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2", ms: 2140 } } };
    const text = formatPublished(playlist, audio);
    const { spec: specText, audio: audioText } = splitBakedYaml(text);
    // The spec half is the plain serialization with exactly one trailing newline …
    expect(specText).toBe(formatPlaylist(playlist, "yaml").replace(/\n*$/, "\n"));
    // … the audio half begins at the document the server stores as the blob …
    expect(audioText?.startsWith("audio:\n")).toBe(true);
    // … and joined back the way the viewer joins them, the parser reads the
    // same track — and the same bytes.
    expect(`${specText}---\n${audioText}`).toBe(text);
    expect(parsePlaylistText(`${specText}---\n${audioText}`).audio?.lines).toEqual(audio.lines);
  });
});

describe("publishToServer", () => {
  test("writes the spec, then the audio, and reports the address", async () => {
    const { impl, calls } = fetchWith(okJson);
    const out = await publishToServer(ARGS, impl);
    expect(calls()[0][0]).toBe("https://a/_/api/cast");
    expect(calls()[1][0]).toContain("/_/api/cast/audio?");
    expect(out.cast).toBe("anvil/spanish1/01-intro.yaml");
    expect(out.url).toBe("https://drawcast.app/#anvil=spanish1/01-intro.yaml");
    expect(out.audio).toBe("sent");
  });
  test("the spec write is a text/plain JSON body: key, cast, title, the spec ALONE, and the access", async () => {
    const { impl, calls } = fetchWith(okJson);
    await publishToServer(ARGS, impl);
    const [, init] = calls()[0];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(JSON.parse(init.body as string)).toEqual({ key: "t", cast: "anvil/spanish1/01-intro.yaml", title: "Intro", spec: "meta: {}\n", access: "enrolled" });
  });
  test("the audio goes RAW — the document itself as the body, the cast and the token in the query", async () => {
    const { impl, calls } = fetchWith(okJson);
    await publishToServer({ ...ARGS, token: "a b" }, impl);
    const [url, init] = calls()[1];
    expect(url).toBe("https://a/_/api/cast/audio?cast=anvil%2Fspanish1%2F01-intro.yaml&key=a%20b");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("audio:\n  lang: en\n");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
  });
  test("an unbaked document is one request — and says so, because the spec write cleared whatever narration was stored", async () => {
    const { impl, calls } = fetchWith(okJson);
    const out = await publishToServer({ ...ARGS, yaml: "meta: {}\n" }, impl);
    expect(calls()).toHaveLength(1);
    expect(out.audio).toBe("none");
  });
  test("access is passed through as chosen, and a trailing slash on the api is not doubled", async () => {
    const { impl, calls } = fetchWith(okJson);
    await publishToServer({ ...ARGS, access: "open", api: "https://a/" }, impl);
    expect(calls()[0][0]).toBe("https://a/_/api/cast");
    expect(JSON.parse(calls()[0][1].body as string).access).toBe("open");
  });
  test("the link follows the author's own viewer base when there is one", async () => {
    const out = await publishToServer({ ...ARGS, viewerBase: "https://my.site/" }, fetchWith(okJson).impl);
    expect(out.url).toBe("https://my.site/#anvil=spanish1/01-intro.yaml");
  });
  test("a rejected token is an error the caller can show — and the audio is never sent", async () => {
    const { impl, calls } = fetchWith(() => refusal(401, "key"));
    await expect(publishToServer({ slug: "s", file: "a.yaml", title: "t", yaml: "meta: {}\n", access: "open", token: "t", api: "https://a" }, impl)).rejects.toThrow(/sign in/i);
    await expect(publishToServer(ARGS, impl)).rejects.toThrow(/sign in/i);
    expect(calls()).toHaveLength(2);
  });
  test("another account's name is refused in those words; anything else carries its status", async () => {
    await expect(publishToServer(ARGS, fetchWith(() => refusal(403, "owner")).impl)).rejects.toThrow(/another account/);
    await expect(publishToServer(ARGS, fetchWith(() => refusal(429, "rate")).impl)).rejects.toThrow(/try again later/);
    await expect(publishToServer(ARGS, fetchWith(() => refusal(500, "boom")).impl)).rejects.toThrow(/HTTP 500/);
  });
  test("a 400 names its likely causes — the spec cap that embedded images count towards, and the title length", async () => {
    const err = await publishToServer(ARGS, fetchWith(() => refusal(400, "spec")).impl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/HTTP 400/);
    expect((err as Error).message).toMatch(/400 000/);
    expect((err as Error).message).toMatch(/Embed images/);
    expect((err as Error).message).toMatch(/200 characters/);
  });
  test("a narration upload the server refuses is reported, never thrown — the spec has already landed", async () => {
    const { impl } = fetchWith((url) => (isAudio(url) ? refusal(413, "audio") : okJson()));
    const out = await publishToServer(ARGS, impl);
    expect(out.cast).toBe("anvil/spanish1/01-intro.yaml");
    expect(out.url).toBe("https://drawcast.app/#anvil=spanish1/01-intro.yaml");
    expect(out.audio).toEqual({ failed: expect.stringMatching(/HTTP 413/) });
  });
  test("a narration upload that never connects is reported the same way", async () => {
    const { impl } = fetchWith((url) => {
      if (isAudio(url)) throw new Error("offline");
      return okJson();
    });
    const out = await publishToServer(ARGS, impl);
    expect(out.url).toBe("https://drawcast.app/#anvil=spanish1/01-intro.yaml");
    expect(out.audio).toEqual({ failed: expect.stringMatching(/offline/) });
  });
});

describe("the drawcast server in Share", () => {
  test("is a destination row after Drive, labelled for what it is, never for a course", () => {
    expect(share).toMatch(/\{ id: "server", label: "drawcast server", action: "Publish"/);
    expect(share).toMatch(/id: "server"[^\n]*courses: false/);
    const dests = share.slice(share.indexOf("const DESTS: DestRow[] = ["), share.indexOf("/** One destination as Share's rail offers it"));
    expect(dests.indexOf('id: "server"')).toBeGreaterThan(dests.indexOf('id: "drive"'));
    expect(dests.indexOf('id: "server"')).toBeLessThan(dests.indexOf('id: "youtube"'));
  });
  test("ShareTo names it, and a remembered choice survives the migration", () => {
    expect(store).toMatch(/export type ShareTo = [^;]*"server"/);
    expect(store).toMatch(/return v === [^\n]*"server"/);
  });
  test("hands publishServer the shared choices plus the name and the access", () => {
    expect(share).toMatch(/publishServer:\s*\(choices:\s*\{\s*bake:\s*boolean;\s*embedImages:\s*boolean;\s*name\?:\s*string;\s*access:\s*ServerAccess\s*\}\)\s*=>\s*Promise<void>/);
  });
  test("has a panel and an action button of its own in the modal shell", () => {
    expect(share).toMatch(/const panels: Record<ShareTo, HTMLElement> = \{[^}]*server: serverPanel/);
    expect(share).toMatch(/const actionBtns: Record<ShareTo, HTMLButtonElement> = \{[^}]*server: serverGo/);
    expect(share).toMatch(/share-panel-host"\s*\},[^)]*serverPanel/);
  });
  test("sign-in gates the BUTTON, not the row, and is re-read on every open", () => {
    expect(share).toContain('"Sign in to publish here"');
    // The label is an instruction, so the button must be pressable: it was
    // once disabled while wearing it, which made the one control naming the
    // fix the one control that did nothing.
    expect(share).not.toContain("serverGo.disabled");
    expect(share).toMatch(/if \(getToken\(\) === ""\) \{\s*location\.href = signInUrl\(location\.href\);/);
    expect(share).toMatch(/const signedIn = getToken\(\) !== "";/);
    const prep = share.slice(share.indexOf("function prepPanels(): void {"), share.indexOf("function refresh(deps: ShareDeps): void {"));
    expect(prep).toContain("refreshServerSignIn();");
  });
  test("who can watch: two values, closed by default, reset on every open", () => {
    const panel = share.slice(share.indexOf("// ---- drawcast server panel"), share.indexOf("// ---- Drive panel"));
    expect(panel).toContain('["enrolled", "Only you, for now"]');
    expect(panel).toContain('["open", "Anyone with the link"]');
    expect(panel).toMatch(/serverAccess\.value === "open" \? "open" : "enrolled"/);
    expect(share).toContain('serverAccess.value = "enrolled";');
  });
  test("narration is ticked by default on the server panel — storage is free, synthesis is not", () => {
    // Round 0 measured the quota (plans/2026-09-05-round-0-measurements.md):
    // 100 GB, no metered egress. Unbaked audio spends cloud TTS per student
    // per lecture; baked audio is paid once. The default follows the money.
    expect(share).toContain('buildEmbedChoices("server", true)');
    expect(share).not.toContain('buildEmbedChoices("server", false)');
    // Through the SAME builder the other panels use, still gated on a TTS key.
    expect(share).toContain("bakeCb.checked = tts && bakeDefault;");
    // Declaration + three instantiations — still one copy of the rows.
    expect(share.match(/buildEmbedChoices\(/g)).toHaveLength(4);
  });
  test("the name is a slug like Link's, prefilled the same way — and slugified on Publish too, not only on blur", () => {
    const panel = share.slice(share.indexOf("// ---- drawcast server panel"), share.indexOf("// ---- Drive panel"));
    // Once in the blur handler, once in the click handler: Safari does not
    // blur an input when a button is pressed, and a raw `learn-russian/3`
    // would otherwise reach the key as a fourth segment.
    expect(panel.match(/serverNameInput\.value = slugify\(serverNameInput\.value\);/g)).toHaveLength(2);
    const click = panel.slice(panel.indexOf('serverGo.addEventListener("click"'));
    expect(click.indexOf("serverNameInput.value = slugify(serverNameInput.value);")).toBeLessThan(click.indexOf("name: serverNameInput.value"));
    expect(click).not.toContain(".trim()");
    expect(share).toContain("serverNameInput.value = doc.publishedAs ?? slugify(doc.title);");
  });
  test("promises replacement only for an unchanged name AND title — the file half follows the title until GitHub fixes it", () => {
    const panel = share.slice(share.indexOf("// ---- drawcast server panel"), share.indexOf("// ---- Drive panel"));
    expect(panel).toContain("with the same name and title replaces the copy on the server; a changed title may write a new copy beside the old one");
    expect(panel).not.toContain("under the same name replaces the copy");
  });
  test("says before the click that access is set anew on every publish", () => {
    const panel = share.slice(share.indexOf("// ---- drawcast server panel"), share.indexOf("// ---- Drive panel"));
    expect(panel).toContain("Every publish sets this anew");
    expect(panel).toContain("closes a cast that was open");
  });
  test("says before the click what unticked narration does, and that plays are not counted here", () => {
    const panel = share.slice(share.indexOf("// ---- drawcast server panel"), share.indexOf("// ---- Drive panel"));
    expect(panel).toContain("any narration stored there earlier is removed");
    // views.ts refuses every anvil/ key, so the panel offers no Count views
    // box (that is Link's alone) and says why instead.
    expect(panel).not.toContain("countViews");
    expect(panel).toContain("not counted publicly");
    expect(panel).toMatch(/serverNarrationHint,\s*serverViewsHint,\s*serverSignInHint/);
  });
});

describe("publishServerCast — main.ts's wiring", () => {
  const serverCast = main.slice(main.indexOf("async function publishServerCast("), main.indexOf("async function publishDriveCast("));
  test("exists and is what the Share modal's server panel calls", () => {
    expect(serverCast).not.toBe("");
    expect(main).toMatch(/publishServer:\s*\(choices\)\s*=>\s*publishServerCast\(choices\)/);
  });
  test("refuses signed out, empty, and a name that could never be registered — before anything is written", () => {
    expect(serverCast.indexOf("getToken()")).toBeGreaterThan(-1);
    expect(serverCast.indexOf("getToken()")).toBeLessThan(serverCast.indexOf("publishTextFor("));
    expect(serverCast).toContain("itemsOf(doc.playlist).length === 0");
    expect(serverCast.indexOf("normalizeName(")).toBeGreaterThan(-1);
    expect(serverCast.indexOf("normalizeName(")).toBeLessThan(serverCast.indexOf("publishTextFor("));
    // Slugified before normalizeName: a sub-name's slash must never become a
    // fourth key segment, whatever the caller hands over.
    expect(serverCast).toContain("const requested = slugify(name ?? doc.title);");
  });
  test("prepares the copy through the SAME publishTextFor, reusing the SERVER copy's narration through a DYNAMIC import of the viewer", () => {
    expect(serverCast).toContain("publishTextFor(");
    expect(serverCast).toContain("fetchAnvilText({ cast, api: DEFAULT_ENROLL_API }");
    // One definition of the join (the viewer's), loaded only when a bake
    // needs it — never hoisted into the editor's chunk by a static import.
    expect(serverCast).toContain('await import("./viewer")');
    expect(main).not.toMatch(/from "\.\/viewer"/);
  });
  test("keys the copy anvil/<name>/<file>, passes the access through, and registers the name only after the spec landed", () => {
    expect(serverCast).toContain("serverCastKey(slug, file)");
    expect(serverCast).toMatch(/publishToServer\(\{[^}]*access,/);
    expect(serverCast.indexOf("publishToServer(")).toBeLessThan(serverCast.indexOf("registerName("));
    expect(serverCast).toContain('kind: "cast", target: out.cast');
    expect(serverCast).toContain("AbortSignal.timeout(10_000)");
  });
  test("a name under the floor publishes anyway and says why it was not registered (spec §9)", () => {
    expect(serverCast).toContain("isRegistrable(slug)");
    expect(serverCast).toMatch(/name not registered: names need at least \$\{MIN_NAME_LENGTH\} characters/);
  });
  test("a lost narration is reported as what it is: the spec landed, the old narration is gone", () => {
    expect(serverCast).toContain('typeof out.audio === "object"');
    expect(serverCast).toContain("cleared the narration stored before");
    expect(serverCast).toContain("publish again");
  });
  test("the ORDINARY unticked publish says the same truth — it is a deletion, not a no-op", () => {
    // Narration defaults on now, so an unticked box is a deliberate act — and
    // a spec write clears what the server held, so the consequence must be
    // said. The sentence is true whether or not anything was stored: the
    // client cannot know.
    expect(serverCast).toContain('out.audio === "none"');
    expect(serverCast).toContain("without narration — any narration stored there earlier is gone");
    // In the SAME status line as the address, on the ok path.
    expect(serverCast).toMatch(/setStatus\(`Published to \$\{address\}\$\{silent\}/);
  });
  test("a registered name IS the address — the raw key is the fallback", () => {
    // Naming a cast is what buys the short form, so reporting the raw
    // #anvil= key and hanging the name off the end as "also at" buries the
    // one thing the author asked for. They read the long one.
    expect(main).toMatch(/let address = out\.url;/);
    expect(main).toMatch(/if \(outcome === "ok"\) address = `\$\{settings\.viewerBase\.replace\(\/\\\/\+\$\/, ""\)\}\/#\$\{slug\}`;/);
    // and the "also at" note is NOT appended when the short form won
    expect(main).toMatch(/else note = nameNote\(outcome, slug\);/);
  });
  test("every successful publish says which door it set — the server writes access on every spec write, and the panel starts closed", () => {
    // A cast published open, edited and republished with the select left at
    // its default is now closed, and every shared link asks to sign in. The
    // publish is the only party that knows what it sent, so both success
    // lines carry it (the failure line too: the spec, and its access, landed).
    expect(serverCast).toMatch(/const door =\s*access === "open"\s*\?/);
    expect(serverCast).toContain("open: anyone with the link can watch");
    expect(serverCast).toContain("closed: only you can watch, signed in; a link shared while it was open now asks to sign in");
    expect(serverCast).toMatch(/setStatus\(`Published to \$\{address\}\$\{silent\}\$\{door\}/);
    expect(serverCast).toMatch(/`Published to \$\{address\}\$\{door\}, but WITHOUT its narration/);
    // Round 0 stops the silence only; reading the live setting back first is
    // spec §5's cure and round 1's job.
    expect(serverCast).not.toMatch(/api\/cast\?cast=.*access/);
  });
  test("the course panel passes a loud stub, like Drive's", () => {
    expect(course).toMatch(/publishServer: async \(\) => shareStatus\(/);
  });
});

// The Check button (round 0 spec §9). checkName itself is exercised in
// tests/names.test.ts; this pins where the button lives and, above all, what
// it does NOT listen to.
describe("the Check button in Share", () => {
  test("is built once and sits beside BOTH name fields — GitHub's and the server's", () => {
    expect(share).toContain("function buildNameCheck(");
    // Declaration + two instantiations.
    expect(share.match(/buildNameCheck\(/g)).toHaveLength(3);
    expect(share).toMatch(/"Name ", publishNameInput, publishNameCheck\.button\)/);
    expect(share).toMatch(/"Name ", serverNameInput, serverNameCheck\.button\)/);
  });
  test("fires on the click only — no input listener anywhere in Share (the budget is 600/h per IP)", () => {
    expect(share).not.toContain('addEventListener("input"');
    expect(share).not.toContain('addEventListener("keyup"');
    expect(share).not.toContain('addEventListener("keydown"');
    const builder = share.slice(share.indexOf("function buildNameCheck("), share.indexOf("// ---- Link panel"));
    expect(builder).toContain('button.addEventListener("click"');
    expect(builder).toContain("checkNote(await checkName(DEFAULT_ENROLL_API, name, getToken()), name)");
    // Disabled while the answer is on its way — one click, one request.
    expect(builder.indexOf("button.disabled = true;")).toBeLessThan(builder.indexOf("await checkName("));
  });
  test("the verdict is cleared on every open, so a stale answer never describes another document", () => {
    const prep = share.slice(share.indexOf("function prepPanels(): void {"), share.indexOf("function refresh(deps: ShareDeps): void {"));
    expect(prep).toContain("publishNameCheck.reset();");
    expect(prep).toContain("serverNameCheck.reset();");
  });
});
