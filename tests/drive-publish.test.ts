// Publish → Google Drive (spec §7-8): the SAME prepared copy the GitHub
// panel sends, written as a plain .yaml file into the app's own "drawcast"
// folder, republishing over the same file id.
//
// `readFileText` is exercised for real — it is the one piece of this
// destination that is a pure function of fetch + a token. Everything else
// lives in main.ts's module-scope wiring and ui/share.ts's build() (both need
// a DOM this suite does not have), so it is pinned as drift against the
// source, the same way cast-publish/publish-embed pin their halves.

import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/google/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/google/auth")>();
  return { ...actual, requireScope: vi.fn(async () => "TOKEN") };
});

import { requireScope } from "../src/google/auth";
import { readFileText } from "../src/google/drive";

const mockRequireScope = vi.mocked(requireScope);

/** A minimal stand-in for the bits of Response these paths touch. */
const reply = (ok: boolean, body = "") => ({ ok, status: ok ? 200 : 404, text: async () => body });

const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const share = await readFile(new URL("../src/ui/share.ts", import.meta.url), "utf8");
const store = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");
/** publishDriveCast's body alone — so a match cannot come from publishDrawcast. */
const driveCast = main.slice(main.indexOf("async function publishDriveCast"), main.indexOf("// In-flight guards for the two Drive operations"));

describe("readFileText — reading the previously published copy back", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockRequireScope.mockResolvedValue("TOKEN");
  });

  it("GETs the file's own bytes with the bearer token", async () => {
    const fetchMock = vi.fn(async () => reply(true, "playlist:\n  title: Old\n"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await readFileText("FILE1")).toBe("playlist:\n  title: Old\n");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://www.googleapis.com/drive/v3/files/FILE1?alt=media");
    expect(init.headers.Authorization).toBe("Bearer TOKEN");
  });

  it("returns null on a non-OK response — a missing previous copy just skips bake reuse", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(false, "not found")));
    expect(await readFileText("GONE")).toBeNull();
  });

  it("returns null when sign-in is declined, without ever calling fetch", async () => {
    const fetchMock = vi.fn(async () => reply(true, "x"));
    vi.stubGlobal("fetch", fetchMock);
    mockRequireScope.mockResolvedValue(null);
    expect(await readFileText("FILE1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null rather than throwing when the network fails — reuse is an optimisation, never a reason to fail a publish", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(readFileText("FILE1")).resolves.toBeNull();
  });
});

describe("publishDriveCast — the same prepared text, into Drive", () => {
  it("exists and is what the Share modal's Drive panel calls", () => {
    expect(main).toContain("async function publishDriveCast(");
    expect(main).toMatch(/publishDrive:\s*\(choices\)\s*=>\s*publishDriveCast\(choices\)/);
  });

  it("prepares the copy through the SAME publishTextFor as GitHub, reusing the previous DRIVE copy's narration", () => {
    expect(driveCast).toContain("publishTextFor(");
    // The bake-reuse source is the previously published Drive file, not the
    // GitHub one — publishTextFor's fourth parameter is exactly this hook.
    expect(driveCast).toContain("readFileText(doc.drivePublishedId)");
  });

  it("writes a plain .yaml file, never a Google Doc (spec §7: Docs cap at ~1M chars and curl quotes)", () => {
    expect(driveCast).toMatch(/saveSpec\(\s*text,\s*`\$\{fileSafe\(name \?\? doc\.title\)\}\.yaml`,\s*"text\/yaml"/);
    expect(driveCast).not.toContain("application/vnd.google-apps.document");
  });

  it("asks for the app folder only when CREATING — saveSpec's PATCH must never carry parents", () => {
    expect(driveCast).toContain("doc.drivePublishedId ? null : await ensureFolder()");
    expect(driveCast).toContain("doc.drivePublishedId ?? null");
  });

  it("records the file id and persists it, so republishing updates the same file", () => {
    expect(driveCast).toContain("doc.drivePublishedId = res.fileId;");
    expect(driveCast).toContain("autosave()");
  });

  it("reports the playable viewer link and offers Open in Drive for the manual sharing step (spec §8)", () => {
    expect(driveCast).toContain("setStatusAction(");
    expect(driveCast).toContain("#gdrive=${res.fileId}");
    expect(driveCast).toContain("link-sharing is on");
    expect(driveCast).toContain('"Open in Drive"');
    expect(driveCast).toContain("https://drive.google.com/file/d/${res.fileId}/view");
    // The same two notes the GitHub publish appends — one prepared copy, one
    // set of facts about what went into it.
    expect(driveCast).toContain("${lastEmbedNote}${lastBakeNote}");
  });

  it("guards on Google being configured and on there being something to publish", () => {
    expect(driveCast).toContain("googleConfigured()");
    expect(driveCast).toContain("itemsOf(doc.playlist).length === 0");
    expect(driveCast).toContain("shareBtn.disabled = true;");
  });
});

describe("drivePublishedId — the persisted publish target", () => {
  it("is a distinct field from driveFileId, and the doc comment says so", () => {
    expect(main).toMatch(/drivePublishedId\?: string;/);
    // Both live on Doc; a reader must be able to tell Save's working file from
    // Publish's published copy without reading either call site.
    const docType = main.slice(main.indexOf("interface Doc {"), main.indexOf("let doc: Doc = initialDoc();"));
    expect(docType).toMatch(/drivePublishedId/);
    expect(docType).toMatch(/driveFileId/);
    expect(docType).toMatch(/distinct from `driveFileId`/);
  });

  it("round-trips through autosave and docFromSaved, like publishedAs", () => {
    const autosave = main.slice(main.indexOf("function autosave(): void {"), main.indexOf("Parse + validate playlist text"));
    expect(autosave).toContain("drivePublishedId: doc.drivePublishedId,");
    const from = main.slice(main.indexOf("function docFromSaved(saved: SavedDrawing): Doc {"), main.indexOf("function initialDoc(): Doc {"));
    // BOTH return paths — the playlist one and the single-spec fallback.
    expect(from.match(/drivePublishedId: saved\.drivePublishedId/g)).toHaveLength(2);
  });

  it("is stored on the library row", () => {
    const saved = store.slice(store.indexOf("export interface SavedDrawing {"), store.indexOf("export function isMultiPart"));
    expect(saved).toMatch(/drivePublishedId\?: string;/);
  });
});

describe("the Drive panel", () => {
  it("is a destination row after link, labelled for what it is", () => {
    expect(share).toMatch(/\{ id: "drive", label: "Google Drive", action: "Publish"/);
    expect(share).toMatch(/id: "drive"[^\n]*courses: false/);
    const dests = share.slice(share.indexOf("const DESTS: DestRow[] = ["), share.indexOf("/** One destination as Share's rail offers it"));
    expect(dests.indexOf('id: "drive"')).toBeGreaterThan(dests.indexOf('id: "link"'));
    expect(dests.indexOf('id: "drive"')).toBeLessThan(dests.indexOf('id: "youtube"'));
  });

  it("says what a Drive publish IS — a file to share from Drive, not a link the app hands out", () => {
    expect(share).toContain(
      "A finished file, not a link — share it from Drive with whoever should have it; they open it in drawcast, or the link below plays once link-sharing is on.",
    );
  });

  it("names the file with fileSafe, not slugify — it is a filename, not a URL", () => {
    const panel = share.slice(share.indexOf("// ---- Drive panel"), share.indexOf("// ---- Video file panel"));
    expect(panel).toContain("fileSafe(");
    expect(panel).not.toContain("slugify(");
  });

  it("hands publishDrive the shared choices plus the name", () => {
    expect(share).toMatch(/publishDrive:\s*\(choices:\s*\{\s*bake:\s*boolean;\s*embedImages:\s*boolean;\s*name\?:\s*string\s*\}\)\s*=>\s*Promise<void>/);
  });

  it("gets its two embed rows from the SAME builder as the link panel — never a second copy", () => {
    expect(share).toContain("function buildEmbedChoices(");
    // Declaration + the two instantiations.
    expect(share.match(/buildEmbedChoices\(/g)).toHaveLength(3);
    // The tell for a copy-paste: the labels exist exactly once in the file.
    expect(share.match(/"Embed narration"/g)).toHaveLength(1);
    expect(share.match(/the published file speaks; viewers need no key/g)).toHaveLength(1);
  });

  it("has a panel and an action button of its own in the modal shell", () => {
    expect(share).toMatch(/const panels: Record<ShareTo, HTMLElement> = \{[^}]*drive: drivePanel/);
    expect(share).toMatch(/const actionBtns: Record<ShareTo, HTMLButtonElement> = \{[^}]*drive: driveGo/);
    expect(share).toMatch(/share-panel-host"\s*\},[^)]*drivePanel/);
  });
});

describe("ShareTo", () => {
  it("names drive", () => {
    expect(store).toMatch(/export type ShareTo = [^;]*"drive"/);
    expect(store).toMatch(/return v === [^\n]*"drive"/);
  });
});
