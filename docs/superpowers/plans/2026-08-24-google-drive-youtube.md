# Google Drive + YouTube Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user save and open drawcast specs on their own Google Drive, and upload the exported video straight to their own YouTube channel.

**Architecture:** Browser-only OAuth via Google Identity Services — an access token is held in memory, scoped per capability and requested lazily by the action that needs it. Three small modules under `src/google/` (auth, drive, youtube) do the work; `main.ts` only wires buttons. Nothing touches a server: `netlify/functions/keys.mts` vends *our* keys, and this feature touches *the user's* account, which must never pass through it.

**Tech Stack:** TypeScript, Vite, vitest (`npx vitest run`), Google Identity Services (`accounts.google.com/gsi/client`), Google Picker (`apis.google.com/js/api.js`), Drive v3 and YouTube Data v3 REST.

**Spec:** `docs/superpowers/specs/2026-08-24-google-drive-youtube-design.md` — read §0 first; it records why the YouTube button ships behind a warning, and why `drive` / `drive.readonly` must never be requested.

## Global Constraints

- Branch: `revise-and-history`. Do not merge to `main` and do not push; Hans decides both.
- **Only two OAuth scopes may ever appear in this codebase:** `https://www.googleapis.com/auth/drive.file` and `https://www.googleapis.com/auth/youtube.upload`. `drive` and `drive.readonly` are *restricted* scopes that trigger a paid annual security assessment — never request them.
- **Access tokens live in memory only.** Never write a token to `localStorage`, `sessionStorage`, a cookie, or the URL.
- Env vars are `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_PICKER_KEY`, read via `import.meta.env` exactly as `store.ts:152,161` reads the existing keys. When either is missing, the Google buttons are **hidden**, not disabled-and-broken.
- Tests are `tests/*.test.ts`, vitest, run from the repo root. Modules under `src/google/` must expose their logic as pure functions so tests need no network and no DOM.
- Full suite green before each commit: `npx vitest run` (693 tests at plan time). Type check: `npx tsc --noEmit`.
- Do not modify `src/store.ts`, `src/history.ts`, or `src/llm/`.

---

### Task 1: Prove the browser can read the resumable `Location` header

A manual gate for Hans — it needs a real Google account and takes about three minutes. **No drawcast code is involved**, so it can run at any point before Task 6; it does not block Tasks 2–5.

Spec §8 established by probe that CORS itself works on both upload endpoints. The one unsettled question is whether `Location` — which carries the resumable session URI — is exposed to browser JavaScript. If it is not, Task 6 switches to `uploadType=multipart` and loses progress and resume.

**Files:** none.

**Interfaces:**
- Consumes: nothing.
- Produces: a yes/no answer that selects Task 6's upload strategy.

- [ ] **Step 1: Get a throwaway access token**

Open https://developers.google.com/oauthplayground/, and in Step 1 paste this scope into the "Input your own scopes" box:

```
https://www.googleapis.com/auth/youtube.upload
```

Authorize, then in Step 2 press "Exchange authorization code for tokens" and copy the **access token**. It expires in an hour and grants nothing but uploads — no drawcast credential is used or needed.

- [ ] **Step 2: Run the check from a real drawcast origin**

Open https://hmelberg.github.io/drawcast/, open DevTools → Console, paste this with `PASTE_TOKEN_HERE` replaced:

```js
const r = await fetch(
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer PASTE_TOKEN_HERE",
      "Content-Type": "application/json",
      "X-Upload-Content-Type": "video/webm",
      "X-Upload-Content-Length": "1024",
    },
    body: JSON.stringify({ snippet: { title: "drawcast probe" }, status: { privacyStatus: "private" } }),
  },
);
console.log("status:", r.status);
console.log("Location:", r.headers.get("Location"));
```

The request only *opens* a session — it uploads no bytes and creates no video.

- [ ] **Step 3: Record the answer**

- `status: 200` **and** a non-null `Location` → resumable works. Task 6 proceeds as written.
- `status: 200` but `Location: null` → the header is not exposed. **Task 6 must use the multipart fallback in its Step 6 note instead**, and the spec's §9 gains "no upload progress, no resume".
- Anything else (401/403) → the token expired or the scope was wrong; redo Step 1.

---

### Task 2: `src/google/auth.ts` — the lazy sign-in gate

**Files:**
- Create: `src/google/auth.ts`
- Test: `tests/google-auth.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DRIVE_SCOPE`, `YOUTUBE_SCOPE`, `type Scope`, `clientId()`, `pickerKey()`, `googleConfigured()`, `pickerConfigured()`, `requireScope(scope)`, `currentUser()`, `signOut()`, and — for tests only — `makeTokenStore(now)` with `get`/`put`/`clear`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/google-auth.test.ts
import { describe, expect, test } from "vitest";
import { DRIVE_SCOPE, YOUTUBE_SCOPE, makeTokenStore } from "../src/google/auth";

describe("token store", () => {
  test("returns a token that is still comfortably valid", () => {
    let now = 1_000_000;
    const s = makeTokenStore(() => now);
    s.put(DRIVE_SCOPE, "tok-a", 3600);
    expect(s.get(DRIVE_SCOPE)).toBe("tok-a");
  });

  test("a Drive grant does NOT satisfy a YouTube request", () => {
    let now = 1_000_000;
    const s = makeTokenStore(() => now);
    s.put(DRIVE_SCOPE, "tok-a", 3600);
    expect(s.get(YOUTUBE_SCOPE)).toBeNull();
  });

  test("drops a token inside the 60s safety margin, so a long upload cannot start on one about to expire", () => {
    let now = 1_000_000;
    const s = makeTokenStore(() => now);
    s.put(DRIVE_SCOPE, "tok-a", 3600);
    now += (3600 - 61) * 1000;
    expect(s.get(DRIVE_SCOPE)).toBe("tok-a"); // 61s left — still usable
    now += 2000;
    expect(s.get(DRIVE_SCOPE)).toBeNull(); // 59s left — inside the margin
  });

  test("clear() forgets every scope", () => {
    const s = makeTokenStore(() => 0);
    s.put(DRIVE_SCOPE, "tok-a", 3600);
    s.put(YOUTUBE_SCOPE, "tok-b", 3600);
    s.clear();
    expect(s.get(DRIVE_SCOPE)).toBeNull();
    expect(s.get(YOUTUBE_SCOPE)).toBeNull();
  });

  test("the only scopes this codebase knows are the two non-restricted ones", () => {
    // drive / drive.readonly are RESTRICTED scopes: requesting either triggers a
    // paid annual security assessment. This test is the tripwire.
    expect(DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
    expect(YOUTUBE_SCOPE).toBe("https://www.googleapis.com/auth/youtube.upload");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/google-auth.test.ts`
Expected: FAIL — `Failed to resolve import "../src/google/auth"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/google/auth.ts
// Browser-only Google sign-in. Tokens are held in memory and NEVER persisted:
// an access token against someone's YouTube channel is an XSS exfiltration
// target, and localStorage is readable by any script on the origin. The cost is
// that a session lapses after ~1h and is then re-acquired silently while the
// user's Google session is live.
//
// Scopes are requested incrementally, by the action that needs them, so a user
// who only saves specs never sees a consent screen mentioning video uploads.

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export type Scope = typeof DRIVE_SCOPE | typeof YOUTUBE_SCOPE;

/** Seconds of headroom: a token this close to expiry must not start a long upload. */
const EXPIRY_MARGIN_S = 60;

export interface TokenStore {
  get(scope: Scope): string | null;
  put(scope: Scope, token: string, expiresInSeconds: number): void;
  clear(): void;
}

/** Exported for tests; production uses the module-level instance below. */
export function makeTokenStore(now: () => number = Date.now): TokenStore {
  const grants = new Map<Scope, { token: string; expiresAt: number }>();
  return {
    get(scope) {
      const g = grants.get(scope);
      if (!g) return null;
      if (g.expiresAt - EXPIRY_MARGIN_S * 1000 <= now()) {
        grants.delete(scope);
        return null;
      }
      return g.token;
    },
    put(scope, token, expiresInSeconds) {
      grants.set(scope, { token, expiresAt: now() + expiresInSeconds * 1000 });
    },
    clear() {
      grants.clear();
    },
  };
}

const store = makeTokenStore();
let user: { email: string } | null = null;

export function clientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";
}
export function pickerKey(): string {
  return (import.meta.env.VITE_GOOGLE_PICKER_KEY as string | undefined) ?? "";
}

/**
 * Sign-in is possible. This is the gate for EVERYTHING except Drive "Open":
 * Drive Save and YouTube upload need only the client id.
 */
export function googleConfigured(): boolean {
  return clientId() !== "";
}

/**
 * The file chooser additionally needs its own developer key, so "Open" can be
 * unavailable while the rest of the feature works. Gating YouTube on this key
 * would hide a button that has nothing to do with the Picker.
 */
export function pickerConfigured(): boolean {
  return clientId() !== "" && pickerKey() !== "";
}

export function currentUser(): { email: string } | null {
  return user;
}

export function signOut(): void {
  store.clear();
  user = null;
}

/** Loaded on first use only — a user who never signs in pays nothing at boot. */
let gsiReady: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  gsiReady ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("could not load Google sign-in"));
    document.head.appendChild(s);
  });
  return gsiReady;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

/**
 * The lazy sign-in gate — mirrors requireKey() in main.ts:1495. Resolves with a
 * token, or null when the user declines or sign-in is unavailable. A decline is
 * a normal outcome the caller reports via setStatus, never an exception.
 */
export async function requireScope(scope: Scope): Promise<string | null> {
  const cached = store.get(scope);
  if (cached) return cached;
  if (!googleConfigured()) return null;
  await loadGsi();

  return new Promise<string | null>((resolve) => {
    const google = (window as unknown as { google: any }).google;
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope,
      callback: (res: TokenResponse) => {
        if (!res.access_token) return resolve(null);
        store.put(scope, res.access_token, res.expires_in ?? 3600);
        void fetchEmail(res.access_token);
        resolve(res.access_token);
      },
      error_callback: () => resolve(null),
    });
    // "" lets Google skip the prompt when this scope was already granted in a
    // live session — the silent re-acquire that replaces a stored refresh token.
    client.requestAccessToken({ prompt: "" });
  });
}

/** Best-effort identity for the sidebar row. A failure here must not fail the action. */
async function fetchEmail(token: string): Promise<void> {
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return;
    const j = (await r.json()) as { email?: string };
    if (j.email) user = { email: j.email };
  } catch {
    /* the sidebar just shows "Signed in" without an address */
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/google-auth.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Full suite, type check, commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/google/auth.ts tests/google-auth.test.ts
git commit -m "Add the lazy Google sign-in gate, with tokens held in memory only"
```

---

### Task 3: `src/google/drive.ts` — save and open a spec

**Files:**
- Create: `src/google/drive.ts`
- Test: `tests/google-drive.test.ts`

**Interfaces:**
- Consumes: `DRIVE_SCOPE`, `requireScope`, `pickerKey` from `./auth`.
- Produces: `multipartBody(metadata, content, boundary)`, `saveSpec(text, name, fileId)`, `openSpec()`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/google-drive.test.ts
import { describe, expect, test } from "vitest";
import { multipartBody } from "../src/google/drive";

describe("multipartBody", () => {
  test("carries the metadata part, the content part, and a closing boundary", () => {
    const body = multipartBody({ name: "supply.yaml", mimeType: "text/yaml" }, "title: A line\n", "BOUND");
    expect(body).toContain("--BOUND\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n");
    expect(body).toContain('"name":"supply.yaml"');
    expect(body).toContain("--BOUND\r\nContent-Type: text/yaml\r\n\r\ntitle: A line\n");
    expect(body.endsWith("\r\n--BOUND--")).toBe(true);
  });

  test("spec text containing the boundary word is still delimited correctly", () => {
    // The boundary is random per call, but a spec could legitimately contain any
    // word. Guard that the CLOSING delimiter is the last thing in the body.
    const body = multipartBody({ name: "x.yaml", mimeType: "text/yaml" }, "text: BOUND is a word\n", "BOUND");
    expect(body.lastIndexOf("--BOUND--")).toBe(body.length - "--BOUND--".length);
  });

  test("a spec with no trailing newline still closes cleanly", () => {
    const body = multipartBody({ name: "x.yaml", mimeType: "text/yaml" }, "title: X", "B");
    expect(body.endsWith("\r\n--B--")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/google-drive.test.ts`
Expected: FAIL — `Failed to resolve import "../src/google/drive"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/google/drive.ts
// Drive save/open under the drive.file scope, which reaches ONLY files this app
// created or the user explicitly picked. That narrowness is the point: `drive`
// and `drive.readonly` are restricted scopes requiring a paid annual security
// assessment, and this app must never ask for them.

import { DRIVE_SCOPE, pickerKey, requireScope } from "./auth";

export interface DriveMeta {
  name: string;
  mimeType: string;
}

/** Assemble a Drive multipart upload body: metadata part, then content part. */
export function multipartBody(metadata: DriveMeta, content: string, boundary: string): string {
  return (
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${metadata.mimeType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`
  );
}

/**
 * Create the file, or update the one we created before. Passing the previous
 * fileId is what stops a second Save from littering Drive with copies.
 */
export async function saveSpec(text: string, name: string, fileId: string | null): Promise<{ fileId: string } | null> {
  const token = await requireScope(DRIVE_SCOPE);
  if (!token) return null;

  if (fileId) {
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/yaml" },
      body: text,
    });
    if (!r.ok) throw new Error(`Drive update failed (${r.status}): ${await r.text()}`);
    return { fileId };
  }

  const boundary = `drawcast-${crypto.randomUUID()}`;
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipartBody({ name, mimeType: "text/yaml" }, text, boundary),
  });
  if (!r.ok) throw new Error(`Drive save failed (${r.status}): ${await r.text()}`);
  const j = (await r.json()) as { id: string };
  return { fileId: j.id };
}

/** Loaded on first use only. */
let pickerReady: Promise<void> | null = null;
function loadPicker(): Promise<void> {
  pickerReady ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onload = () => (window as unknown as { gapi: any }).gapi.load("picker", { callback: () => resolve() });
    s.onerror = () => reject(new Error("could not load the Google file picker"));
    document.head.appendChild(s);
  });
  return pickerReady;
}

/**
 * Google's own chooser. Picking a file is what grants access to it under
 * drive.file — nothing else in the user's Drive is reachable.
 * Resolves null when the user cancels.
 */
export async function openSpec(): Promise<{ name: string; text: string } | null> {
  const token = await requireScope(DRIVE_SCOPE);
  if (!token) return null;
  await loadPicker();
  const google = (window as unknown as { google: any }).google;

  const picked = await new Promise<{ id: string; name: string } | null>((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes("text/yaml,text/x-yaml,application/json,text/plain")
      .setMode(google.picker.DocsViewMode.LIST);
    new google.picker.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(pickerKey())
      .addView(view)
      .setTitle("Open a drawcast spec")
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) resolve({ id: data.docs[0].id, name: data.docs[0].name });
        else if (data.action === google.picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
  if (!picked) return null;

  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${picked.id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Drive open failed (${r.status}): ${await r.text()}`);
  return { name: picked.name, text: await r.text() };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/google-drive.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Full suite, type check, commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/google/drive.ts tests/google-drive.test.ts
git commit -m "Save and open specs on Drive, scoped to files the user picks"
```

---

### Task 4: Wire the Drive buttons and the sidebar account row

After this task Drive works end to end. Everything from here is YouTube.

**Files:**
- Modify: `src/main.ts` — `Doc` (line 127), spec pane bar (~line 726), `sidebar-tools` (~line 757), `setDoc`
- Test: manual gate (no CSS change expected — see Step 6)

**Interfaces:**
- Consumes: `googleConfigured`, `pickerConfigured`, `currentUser`, `signOut`, `requireScope`, `DRIVE_SCOPE` from `./google/auth`; `saveSpec`, `openSpec` from `./google/drive`.
- Produces: `Doc.driveFileId: string | null`, `refreshAccountRow()`.

- [ ] **Step 1: Add `driveFileId` to `Doc`**

In `src/main.ts` line 127:

```ts
interface Doc {
  /** The library entry this document belongs to; null until the first change (copy-on-write). */
  id: string | null;
  /** The Drive file this document was saved to this session; null otherwise. In memory only. */
  driveFileId: string | null;
  title: string;
  prompt?: string;
  playlist: Playlist;
}
```

`npx tsc --noEmit` will now flag every `Doc` construction site. Every one gets `driveFileId: null` **except** the `rerenderBtn` handler and `showVersion`, which must carry `doc.driveFileId` forward the same way they already carry `doc.id` — otherwise re-rendering an edited spec would create a second Drive file on the next Save.

- [ ] **Step 2: Add the buttons**

Beside the existing `exportBtn`/`importBtn` declarations (~line 501):

```ts
const driveOpenBtn = h("button", { class: "small", title: "Open a spec from Google Drive" }, "☁ Open");
const driveSaveBtn = h("button", { class: "small", title: "Save this spec to Google Drive" }, "☁ Save");
```

Add both to the spec pane bar (~line 726), after `importInput`. Hide them when unconfigured — the same "a capability without its credential does not advertise itself" rule the spec states in §6:

```ts
// Open needs the Picker's own developer key; Save does not.
driveOpenBtn.hidden = !pickerConfigured();
driveSaveBtn.hidden = !googleConfigured();
```

- [ ] **Step 3: Wire Save**

```ts
driveSaveBtn.addEventListener("click", () => void saveToDrive());
async function saveToDrive(): Promise<void> {
  const base = doc.title.replace(/[^\wæøå -]+/gi, "").trim() || "drawcast";
  driveSaveBtn.disabled = true;
  try {
    setStatus("Saving to Drive…");
    const res = await saveSpec(specArea.value, `${base}.yaml`, doc.driveFileId);
    if (!res) {
      setStatus("Drive sign-in was cancelled — nothing was saved.", "error");
      return;
    }
    doc.driveFileId = res.fileId;
    refreshAccountRow();
    setStatus(`Saved "${base}.yaml" to your Google Drive.`, "ok");
  } catch (err) {
    setStatus(`Drive save failed: ${(err as Error).message}`, "error");
  } finally {
    driveSaveBtn.disabled = false;
  }
}
```

Note it saves `specArea.value`, not a re-serialised `doc.playlist` — so un-rendered hand-edits are saved as seen, matching how Revise already treats the textarea as the source of truth.

- [ ] **Step 4: Wire Open**

```ts
driveOpenBtn.addEventListener("click", () => void openFromDrive());
async function openFromDrive(): Promise<void> {
  driveOpenBtn.disabled = true;
  try {
    const picked = await openSpec();
    if (!picked) return; // cancelled, or sign-in declined — say nothing
    const playlist = readPlaylistText(picked.text);
    if (!playlist) return; // readPlaylistText already reported why
    setDoc({
      id: null, // copy-on-write: opening creates no library entry until you change it
      driveFileId: null, // a NEW Save should not overwrite the file you opened
      title: docTitleOf(playlist, picked.name.replace(/\.(ya?ml|json)$/i, "")),
      prompt: "",
      playlist,
    }, `Opened "${picked.name}" from Drive.`);
    refreshAccountRow();
  } catch (err) {
    setStatus(`Drive open failed: ${(err as Error).message}`, "error");
  } finally {
    driveOpenBtn.disabled = false;
  }
}
```

`driveFileId: null` on open is deliberate: opening someone's shared spec and pressing Save must create *your* copy, not overwrite theirs.

- [ ] **Step 5: Add the sidebar account row**

Inside the `sidebar-tools` block (~line 757), before `⚙ Settings`, following the same IIFE pattern the neighbouring rows use:

```ts
(() => {
  const b = h("button", { class: "sidebar-row" }, "☁ Sign in with Google");
  accountRow = b;
  b.addEventListener("click", () => void toggleAccount());
  b.hidden = !googleConfigured();
  return b;
})(),
```

with, near `refreshLibrary`:

```ts
let accountRow: HTMLButtonElement | null = null;

function refreshAccountRow(): void {
  if (!accountRow) return;
  const u = currentUser();
  accountRow.textContent = u ? `☁ ${u.email} — sign out` : "☁ Sign in with Google";
  accountRow.hidden = !googleConfigured();
}

async function toggleAccount(): Promise<void> {
  if (currentUser()) {
    signOut();
    setStatus("Signed out of Google.", "ok");
  } else {
    const token = await requireScope(DRIVE_SCOPE);
    setStatus(token ? "Signed in to Google." : "Google sign-in was cancelled.", token ? "ok" : "error");
  }
  refreshAccountRow();
}
```

Call `refreshAccountRow()` once at startup, next to the existing `refreshLibrary()` call.

- [ ] **Step 6: No CSS is needed — confirm and move on**

`.sidebar-row` (`styles.css:344`) declares no `display`, and the global
`[hidden] { display: none !important; }` (`styles.css:27`) already wins for
every element hidden by attribute. Add **no** CSS in this task. Confirm both
facts still hold and note it in your report; if either has changed, add the
narrowest rule that restores hiding and say what changed.

- [ ] **Step 7: Verify by hand**

```bash
npm run dev
```

Without `VITE_GOOGLE_CLIENT_ID` set, expected: **no** ☁ buttons anywhere, no console errors, everything else works exactly as before. That is the whole automated-ish check available until Hans supplies credentials; the signed-in path is on his smoke list.

- [ ] **Step 8: Full suite, type check, commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/main.ts
git commit -m "Wire Drive open/save and the sidebar account row"
```

---

### Task 5: Split `runVideoExport` so both buttons can use the Blob

Pure refactor, no behaviour change. Doing it alone keeps Task 7's diff about YouTube.

**Files:**
- Modify: `src/main.ts:2506-2543` (`runVideoExport`)
- Test: manual gate (existing export must still work)

**Interfaces:**
- Consumes: `exportVideo`, `exportSequence`, `downloadBlob` (all already imported).
- Produces: `renderVideoBlob(): Promise<Blob | null>`.

- [ ] **Step 1: Extract the render-and-encode half**

`runVideoExport` currently checks the TTS key, opens the dialog, renders, encodes, **and** downloads. Split it so the render-and-encode half returns the Blob and each caller decides what to do with it:

```ts
/**
 * Render + encode the current drawcast to a WebM, with the export dialog open
 * for progress. Returns null when the key is missing, the user cancelled, or
 * the export failed — in every one of those cases the status line already says
 * why, so callers just return.
 */
async function renderVideoBlob(): Promise<Blob | null> {
  const ttsKey = getTtsKey();
  if (!ttsKey) {
    setStatus("Video export needs a Google Cloud Text-to-Speech API key — add it in Settings.", "error");
    openSettings();
    return null;
  }
  const controller = new AbortController();
  exportAbort = controller;
  exportStage.replaceChildren();
  exportCloseBtn.textContent = "Cancel";
  exportStatus.textContent = "Preparing…";
  exportDialog.showModal();
  exportVideoBtn.disabled = true;
  try {
    return await exportVideo(
      exportSequence(doc.playlist),
      { ttsKey, style: settings.style, rate: settings.rate },
      { onStatus: (t) => (exportStatus.textContent = t), canvas: exportCanvas, workbench: exportStage, signal: controller.signal },
    );
  } catch (err) {
    if (!controller.signal.aborted) {
      exportStatus.textContent = `Export failed: ${(err as Error).message}`;
      exportCloseBtn.textContent = "Close";
    }
    return null;
  } finally {
    exportStage.replaceChildren();
    exportVideoBtn.disabled = false;
  }
}
```

- [ ] **Step 2: Rewrite the download caller on top of it**

```ts
exportVideoBtn.addEventListener("click", () => void runVideoExport());
async function runVideoExport(): Promise<void> {
  const blob = await renderVideoBlob();
  if (!blob) return;
  const base = doc.title.replace(/[^\wæøå -]+/gi, "").trim() || "drawcast";
  downloadBlob(`${base}.webm`, blob);
  exportStatus.textContent = "Done — the narrated WebM was downloaded.";
  exportCloseBtn.textContent = "Close";
}
```

The old success message ended "YouTube accepts WebM uploads directly (Studio → Create → Upload)". Drop that clause: Task 7 replaces that manual round trip with a button, and leaving the instruction would send users the long way round.

- [ ] **Step 3: Verify by hand**

```bash
npm run dev
```

With a TTS key set, press `⬇ Export video`: the dialog opens, progress runs, a `.webm` downloads, the status reads "Done — the narrated WebM was downloaded." Press Cancel mid-export: it aborts with no download and no error toast. Without a TTS key: Settings opens and the status explains why.

- [ ] **Step 4: Full suite, type check, commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/main.ts
git commit -m "Split the video export so the encoded Blob has more than one caller"
```

---

### Task 6: `src/google/youtube.ts` — chunked resumable upload

**Files:**
- Create: `src/google/youtube.ts`
- Test: `tests/google-youtube.test.ts`

**Interfaces:**
- Consumes: `YOUTUBE_SCOPE`, `requireScope` from `./auth`.
- Produces: `CHUNK_SIZE`, `chunkRanges(total, chunkSize)`, `contentRange(start, endExclusive, total)`, `uploadVideo(blob, meta, hooks)`, `type UploadMeta`.

**Before starting:** check Task 1's answer. If `Location` was **not** readable, implement the multipart fallback described in Step 6 instead of the resumable flow, and say so in your report.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/google-youtube.test.ts
import { describe, expect, test } from "vitest";
import { chunkRanges, contentRange } from "../src/google/youtube";

describe("chunkRanges", () => {
  test("a file smaller than one chunk is a single range covering all of it", () => {
    expect(chunkRanges(100, 1000)).toEqual([{ start: 0, end: 100 }]);
  });

  test("a file exactly one chunk long is ONE range, not two", () => {
    expect(chunkRanges(1000, 1000)).toEqual([{ start: 0, end: 1000 }]);
  });

  test("one byte over a chunk produces a second, one-byte range", () => {
    expect(chunkRanges(1001, 1000)).toEqual([
      { start: 0, end: 1000 },
      { start: 1000, end: 1001 },
    ]);
  });

  test("three chunks with a partial tail", () => {
    expect(chunkRanges(2500, 1000)).toEqual([
      { start: 0, end: 1000 },
      { start: 1000, end: 2000 },
      { start: 2000, end: 2500 },
    ]);
  });

  test("an empty blob yields no ranges rather than a zero-length request", () => {
    expect(chunkRanges(0, 1000)).toEqual([]);
  });
});

describe("contentRange", () => {
  test("is inclusive of the last byte, as the HTTP header requires", () => {
    // end is EXCLUSIVE in our ranges but INCLUSIVE in the header — off by one
    // here means every upload fails on the first chunk.
    expect(contentRange(0, 1000, 2500)).toBe("bytes 0-999/2500");
    expect(contentRange(2000, 2500, 2500)).toBe("bytes 2000-2499/2500");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/google-youtube.test.ts`
Expected: FAIL — `Failed to resolve import "../src/google/youtube"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/google/youtube.ts
// Resumable upload to the user's own channel. Chunking is not an optimisation:
// fetch() exposes no upload-progress event, so a single PUT of a 50 MB blob
// would show a frozen bar for the entire upload. Per-chunk PUTs give a progress
// tick each time one lands, and make a mid-upload failure resumable.

import { YOUTUBE_SCOPE, requireScope } from "./auth";

export const CHUNK_SIZE = 8 * 1024 * 1024;

export interface UploadMeta {
  title: string;
  description: string;
  privacyStatus: "private" | "unlisted" | "public";
}

/** Half-open ranges [start, end). An empty blob yields none. */
export function chunkRanges(total: number, chunkSize: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let start = 0; start < total; start += chunkSize) {
    out.push({ start, end: Math.min(start + chunkSize, total) });
  }
  return out;
}

/** `end` is exclusive here but inclusive in the header — hence end - 1. */
export function contentRange(start: number, endExclusive: number, total: number): string {
  return `bytes ${start}-${endExclusive - 1}/${total}`;
}

export async function uploadVideo(
  blob: Blob,
  meta: UploadMeta,
  hooks: { onProgress(fraction: number): void; signal: AbortSignal },
): Promise<{ videoId: string } | null> {
  const token = await requireScope(YOUTUBE_SCOPE);
  if (!token) return null;

  const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": blob.type || "video/webm",
      "X-Upload-Content-Length": String(blob.size),
    },
    body: JSON.stringify({
      snippet: { title: meta.title, description: meta.description },
      status: { privacyStatus: meta.privacyStatus },
    }),
    signal: hooks.signal,
  });
  if (!start.ok) throw new Error(`YouTube rejected the upload (${start.status}): ${await start.text()}`);

  const session = start.headers.get("Location");
  if (!session) {
    // Spec §8: the browser may not be permitted to read this header. If this
    // fires in practice, the fallback is uploadType=multipart.
    throw new Error("YouTube did not return a readable upload session URL");
  }

  const ranges = chunkRanges(blob.size, CHUNK_SIZE);
  for (const [i, r] of ranges.entries()) {
    const put = await fetch(session, {
      method: "PUT",
      headers: { "Content-Range": contentRange(r.start, r.end, blob.size) },
      body: blob.slice(r.start, r.end),
      signal: hooks.signal,
    });
    // 308 = "resume incomplete": the expected reply to every chunk but the last.
    if (put.status === 308) {
      hooks.onProgress((i + 1) / ranges.length);
      continue;
    }
    if (!put.ok) throw new Error(`Upload failed at chunk ${i + 1}/${ranges.length} (${put.status}): ${await put.text()}`);
    hooks.onProgress(1);
    const j = (await put.json()) as { id: string };
    return { videoId: j.id };
  }
  throw new Error("the upload ended without YouTube confirming the video");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/google-youtube.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Full suite, type check, commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/google/youtube.ts tests/google-youtube.test.ts
git commit -m "Upload a video to the user's channel in resumable chunks"
```

- [ ] **Step 6: Only if Task 1 found `Location` unreadable**

Replace the session-start and chunk loop with a single multipart request, keeping `uploadVideo`'s signature and calling `hooks.onProgress(1)` once on completion:

```ts
const boundary = `drawcast-${crypto.randomUUID()}`;
const body = new Blob([
  `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
  JSON.stringify({ snippet: { title: meta.title, description: meta.description }, status: { privacyStatus: meta.privacyStatus } }),
  `\r\n--${boundary}\r\nContent-Type: ${blob.type || "video/webm"}\r\n\r\n`,
  blob,
  `\r\n--${boundary}--`,
]);
const r = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
  body,
  signal: hooks.signal,
});
```

Keep `chunkRanges` and `contentRange` exported and tested either way — they cost nothing and the fallback is expected to be temporary. Note in your report that progress and resume are lost.

---

### Task 7: The upload button and its honest dialog

**Files:**
- Modify: `src/main.ts` — preview pane bar (line 739), export dialog area
- Modify: `src/styles.css`
- Test: manual gate

**Interfaces:**
- Consumes: `renderVideoBlob()` from Task 5; `uploadVideo`, `type UploadMeta` from `./google/youtube`; `googleConfigured` from `./google/auth` (NOT `pickerConfigured` — uploading has nothing to do with the file chooser).
- Produces: nothing later tasks use.

- [ ] **Step 1: Add the button**

Beside `exportVideoBtn` (~line 504):

```ts
const uploadYtBtn = h("button", { class: "small", title: "Upload the video to your YouTube channel" }, "▶ YouTube");
uploadYtBtn.hidden = !googleConfigured();
```

Add it to the preview pane bar (line 739) after `exportVideoBtn`.

- [ ] **Step 2: Build the dialog**

```ts
const ytTitle = h("input", { type: "text", class: "yt-field", "aria-label": "Video title" }) as HTMLInputElement;
const ytDesc = h("textarea", { class: "yt-field", rows: "3", "aria-label": "Video description" }) as HTMLTextAreaElement;
const ytPrivacy = h("select", { class: "yt-field", "aria-label": "Visibility" }) as HTMLSelectElement;
for (const [v, label] of [["private", "Private"], ["unlisted", "Unlisted"], ["public", "Public"]]) {
  ytPrivacy.appendChild(h("option", { value: v }, label));
}
const ytGo = h("button", { class: "primary" }, "Upload");
const ytStatus = h("div", { class: "hint" });
const ytDialog = h("dialog", { class: "yt-dialog" }) as HTMLDialogElement;
ytDialog.append(
  dialogHead(ytDialog, "▶ Upload to YouTube"),
  h("label", { class: "quiet-label" }, "Title ", ytTitle),
  h("label", { class: "quiet-label" }, "Description ", ytDesc),
  h("label", { class: "quiet-label" }, "Visibility ", ytPrivacy),
  h(
    "div",
    { class: "yt-warning" },
    "YouTube locks videos uploaded through its API to private until the app has passed YouTube's compliance audit, which drawcast has not yet. " +
      "Your video will arrive on your own channel, private, whatever you choose above.",
  ),
  h("div", { class: "row" }, ytGo),
  ytStatus,
);
app.appendChild(ytDialog);
```

The visibility select stays **enabled**: it is what the request actually sends, and it becomes truthful the day the audit clears with no code change.

- [ ] **Step 3: Wire it**

```ts
uploadYtBtn.addEventListener("click", () => {
  ytTitle.value = doc.title;
  ytDesc.value = "Made with drawcast.";
  ytPrivacy.value = "private";
  ytStatus.textContent = "";
  ytGo.disabled = false;
  ytDialog.showModal();
});

ytGo.addEventListener("click", () => void runYoutubeUpload());
async function runYoutubeUpload(): Promise<void> {
  const meta: UploadMeta = {
    title: ytTitle.value.trim() || doc.title,
    description: ytDesc.value,
    privacyStatus: ytPrivacy.value as UploadMeta["privacyStatus"],
  };
  ytGo.disabled = true;
  // Rendering reuses the export dialog for its own progress, so close ours
  // first — two modal <dialog>s at once leaves the second inert.
  ytDialog.close();
  const blob = await renderVideoBlob();
  if (!blob) return; // renderVideoBlob already reported why
  const controller = new AbortController();
  exportAbort = controller;
  try {
    exportStatus.textContent = "Uploading to YouTube…";
    const res = await uploadVideo(blob, meta, {
      onProgress: (f) => (exportStatus.textContent = `Uploading to YouTube… ${Math.round(f * 100)}%`),
      signal: controller.signal,
    });
    if (!res) {
      exportStatus.textContent = "YouTube sign-in was cancelled — nothing was uploaded.";
    } else {
      exportStatus.textContent = `Uploaded (private): https://youtu.be/${res.videoId}`;
    }
  } catch (err) {
    exportStatus.textContent = `Upload failed: ${(err as Error).message}`;
  } finally {
    exportCloseBtn.textContent = "Close";
  }
}
```

- [ ] **Step 4: Style the warning**

Append to `src/styles.css`, reusing `.lint-chip.warn`'s exact amber (line 388) rather than inventing a token — this stylesheet has only `--paper --surface --ink --muted --line --rust --steel --mustard --loss --ok`:

```css
.yt-dialog .yt-field { width: 100%; }
.yt-warning {
  margin: 10px 0;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 0.9em;
  color: #9c6b1f;
  border: 1px solid color-mix(in srgb, #9c6b1f 45%, var(--surface));
  background: color-mix(in srgb, #9c6b1f 10%, var(--surface));
}
```

- [ ] **Step 5: Update the help page**

`public/help.html` describes saving and exporting. Add one sentence to the export item naming the YouTube button and its private-until-audited caveat, and one to the spec-pane item naming ☁ Open / ☁ Save. Match the file's existing voice — read the surrounding items first. Two sentences, not a new section.

- [ ] **Step 6: Verify by hand**

Without credentials configured: no `▶ YouTube` button, no console errors. The signed-in path is on Hans's smoke list — a real upload needs a real channel.

- [ ] **Step 7: Full suite, type check, commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/main.ts src/styles.css public/help.html
git commit -m "Add Upload to YouTube, with the private-until-audited caveat stated up front"
```

---

## Hans's smoke checklist

Nothing below can be verified without real Google credentials, so it is his to run once `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_PICKER_KEY` are set and the origins are registered:

1. Press **☁ Save** while signed out → consent asks for Drive access **only**, never YouTube.
2. Press **☁ Save** twice → **one** file in Drive, updated, not two.
3. Press **☁ Open**, pick a spec → it loads; pressing ☁ Save then creates a *new* file rather than overwriting the one opened.
4. Press **▶ YouTube** → the warning is visible before the upload starts; the video lands on the channel; the status shows a `youtu.be` link.
5. The sidebar row shows the signed-in address, and sign-out returns it to "Sign in with Google".
6. With the env vars unset, no ☁ or ▶ buttons appear anywhere.

## Known limits, accepted

- Sign-in lapses after ~1 h, then re-acquires silently while the Google session is live.
- `driveFileId` is not persisted, so a Save after a page reload creates a new file instead of updating the previous one.
- Uploads arrive private until the compliance audit clears, and non-test users meet the unverified-app interstitial (spec §0).
- A large upload blocks the export dialog. It is cancellable, but there is no background queue.
