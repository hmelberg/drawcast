# Design: Google sign-in, Drive open/save, and YouTube upload

*2026-08-24. Decisions made in brainstorming with Hans, after verifying the
YouTube upload premise against Google's own documentation (§0).*

## Goals

1. **Upload the exported video straight to the user's own YouTube channel**,
   replacing the current manual round trip — the export dialog literally ends by
   telling you to go to "Studio → Create → Upload" (`main.ts:2533`).
2. **Open and save specs on the user's Google Drive**, so a drawcast survives a
   browser change and can be handed to someone else.
3. **Sign-in happens when you need it**, triggered by the action, with an
   explicit account row in the sidebar as the second entry point.
4. **drawcast never sees anyone's Google data.** No tokens on our server, no
   videos through our bandwidth.

## Non-goals

- **Server-side sessions.** No refresh tokens, no token store, no client secret.
- **Reading arbitrary Drive files.** `drive.file` only — see §0.
- **Uploading anything but the exported WebM.** No thumbnails, playlists,
  captions, or channel management.
- **Waiting for Google's audit.** The YouTube button ships now behind a warning;
  see §0.
- **Offline/queued uploads.** A failed upload is retried by pressing the button
  again.

## 0. The two gates — verified, not assumed

Hans's premise was that an OAuth login lets users upload to YouTube. Half true,
and the half that isn't drives the design.

**True:** the user signs in with their own Google account and uploads to their
own channel. Our Cloud credential is only the app's identity.

**Gate 1 — uploads are locked private until the project is audited.** Every
video inserted via `videos.insert` from an API project created after
2020-07-28 is [restricted to private viewing](https://developers.google.com/youtube/v3/docs/videos/insert)
regardless of the `privacyStatus` sent, and the uploader is emailed about it.
Lifting it requires a **YouTube API Services compliance audit** — a separate
process from OAuth verification. Locked videos cannot be monetised.

**Gate 2 — `youtube.upload` is a *sensitive* scope**, so until the consent
screen passes [verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
the project is capped at 100 test users, each shown an
"Google hasn't verified this app" interstitial.

**Ruling:** ship the button anyway, behind a dialog that says both things
plainly (§4). Useful to Hans and testers today; the audit runs in parallel and
needs no rebuild when it clears.

**Drive is the opposite.** `drive.file` is **non-sensitive** —
[no verification required](https://developers.google.com/workspace/guides/configure-oauth-consent).
It grants access only to files this app creates or the user explicitly picks.
`drive` and `drive.readonly` are **restricted** and trigger a
[paid annual security assessment](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification);
**this project must never request them.**

## 1. Auth model

Browser-only, via Google Identity Services. `initTokenClient` returns an access
token; drawcast calls Drive and YouTube directly with `fetch`.

Rejected alternatives: a server-mediated auth-code flow means holding refresh
tokens for other people's YouTube channels in a store we would have to secure,
for the sole benefit of longer sessions. Proxying uploads through a Netlify
function would spend our bandwidth on other people's videos and exceed function
timeouts on a 50 MB WebM.

**Tokens live in memory only — never localStorage.** An access token against
someone's YouTube channel is an XSS exfiltration target, and localStorage is
readable by any script on the origin. Cost: a session lapses after ~1 h, then
re-acquires silently (`prompt: ""`) while the user's Google session is live.

**Scopes are incremental.** `drive.file` is requested the first time a Drive
button is used; `youtube.upload` the first time an upload is attempted. A user
who only saves specs never sees a consent screen mentioning video uploads, and
never meets the unverified-app interstitial — that warning attaches to the
sensitive scope alone.

Both Google scripts (`accounts.google.com/gsi/client`, `apis.google.com/js/api.js`
for the Picker) are **loaded lazily on first use**, following the same
lazy-capability pattern the domain packs and 3D engines already use. Boot cost
stays zero for users who never sign in.

## 2. `src/google/auth.ts`

```ts
export type Scope = "https://www.googleapis.com/auth/drive.file"
                  | "https://www.googleapis.com/auth/youtube.upload";

/** In-memory only. Keyed by scope: holding Drive access must not imply YouTube access. */
interface Grant { token: string; expiresAt: number }

/** The lazy sign-in gate. Resolves with a token, or null when the user declines. */
export function requireScope(scope: Scope): Promise<string | null>;

/** Signed-in identity for the sidebar row, or null. Cleared by signOut(). */
export function currentUser(): { email: string } | null;
export function signOut(): void;
```

`requireScope` mirrors `requireKey()` (`main.ts:1495`): callers do
`const token = await requireScope(...); if (!token) return;` and the gate handles
prompting. A declined consent is a normal outcome reported through `setStatus`,
not an exception.

Tokens are cached per scope with a 60-second safety margin before `expiresAt`, so
a long upload cannot start on a token that expires mid-flight.

## 3. `src/google/drive.ts`

```ts
export function saveSpec(text: string, name: string, fileId: string | null): Promise<{ fileId: string }>;
export function openSpec(): Promise<{ name: string; text: string } | null>;
```

**Save.** `fileId === null` → `POST /upload/drive/v3/files?uploadType=multipart`
with a metadata part and the spec text. Otherwise
`PATCH /upload/drive/v3/files/{fileId}?uploadType=media`. The returned id is held
on the in-memory `Doc` (§5), so a second Save updates the same file instead of
littering Drive with copies. Reloading the page forgets the id and the next Save
creates a new file — acceptable, and the alternative (persisting it) belongs
with the deferred history work.

**Open.** `gapi.load("picker")` → a `PickerBuilder` view filtered to
`text/yaml,application/json` plus `.yaml`/`.yml`/`.json`, then
`GET /drive/v3/files/{id}?alt=media` for the contents. Picking a file is what
grants access to it under `drive.file`; nothing else in Drive is reachable.

Returned text is fed through the **existing** `readPlaylistText` path, so a
malformed file fails exactly the way a bad paste already does — one error
status, document untouched. Drive is a transport, not a second parser.

## 4. `src/google/youtube.ts`

```ts
export interface UploadMeta { title: string; description: string; privacyStatus: "private" | "unlisted" | "public" }
export function uploadVideo(blob: Blob, meta: UploadMeta, hooks: { onProgress(fraction: number): void; signal: AbortSignal }): Promise<{ videoId: string }>;
```

**Resumable, chunked.** Session start:
`POST /upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` with
`X-Upload-Content-Length`, `X-Upload-Content-Type: video/webm` and the metadata
JSON; the response's `Location` header is the session URI. The blob is then sent
as sequential `PUT`s with `Content-Range`.

**Chunking is not incidental — it is how progress works at all.** `fetch()`
exposes no upload-progress event, so a single `PUT` of a 50 MB blob would show a
frozen bar for the whole upload. 8 MB chunks give a progress tick per chunk
through the same `onProgress`/`signal` hooks `exportVideo` already uses, and make
a mid-upload failure resumable rather than fatal.

**The dialog states both gates** before the first upload:

```
┌────────────────────────────────────────────────────┐
│ Upload to YouTube                                  │
│                                                    │
│ Title        [ Supply and demand, animated      ]  │
│ Description  [ Made with drawcast.              ]  │
│ Visibility   [ Private ▾ ]                         │
│                                                    │
│ ⚠ YouTube locks videos uploaded through its API    │
│   to private until the app passes YouTube's        │
│   compliance audit. drawcast has not yet. Your     │
│   video will arrive on your channel, private,      │
│   whatever you choose above.                       │
│                                                    │
│                          [ Cancel ]  [ Upload ]    │
└────────────────────────────────────────────────────┘
```

Title defaults to `doc.title`, description to a fixed line. The visibility
select stays enabled — it is what the request sends, and it becomes truthful the
day the audit clears, with no code change.

On success the status offers the `https://youtu.be/<id>` link.

## 5. UI placement

**Preview pane bar** (`main.ts:739`) — `▶ Upload to YouTube` after
`exportVideoBtn`. It reuses `exportVideo()`'s Blob directly rather than
downloading first; `runVideoExport` (`main.ts:2513`) is refactored so the
render-and-encode half returns a Blob and the two buttons choose what to do with
it. `exportVideoBtn`'s success text drops its now-obsolete "Studio → Create →
Upload" instruction.

**Spec pane bar** (`main.ts:726`) — `☁ Open` and `☁ Save` beside the existing
`⬇ ⬆`.

**Sidebar** — an account row at the bottom of `sidebar-tools`, reading
`Sign in with Google` or the signed-in email with a sign-out control. Matches
where askstat puts its account row.

`Doc` gains `driveFileId: string | null`, set by Save, carried by `setDoc` and
the re-render path exactly as `id` is, and reset to `null` whenever a different
document is loaded.

## 6. Configuration — outside the code

Prerequisites Hans must complete; none are code:

1. **Enable the Picker API** in the Cloud project (Drive and YouTube Data API
   are already on).
2. **Register every origin** as an authorized JavaScript origin:
   `https://hmelberg.github.io`, the Netlify/`drawcast.app` origin, and
   `http://localhost:5173`. Google matches these **exactly**; a missing origin
   fails sign-in silently on that deploy. **Open question at spec time:** the
   credential was described as being for `drawcast.app`, but the live Pages
   deploy serves from `hmelberg.github.io/drawcast`. This must be confirmed
   before implementation — it is the single most likely day-one failure.
3. **Set `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_PICKER_KEY`** in *both* build
   environments: the GitHub Actions workflow and Netlify. Both are public
   identifiers by design (the Picker key is origin-restricted), so bundling them
   is correct — unlike the Anthropic key, which is why that one is vended by a
   function.

When either variable is absent the Google buttons are **hidden**, not broken: a
capability whose credential is missing should not advertise itself. This keeps
a fork or a local checkout without the env vars looking clean rather than
looking broken.

## 7. Testing

Pure and node-testable, no network:

- `tests/google-auth.test.ts` — per-scope token cache; a Drive grant does not
  satisfy a YouTube request; expiry honours the 60 s margin; a declined consent
  resolves `null` rather than throwing.
- `tests/youtube-upload.test.ts` — chunk boundaries for sizes just under, equal
  to and just over the chunk size; `Content-Range` headers across a 3-chunk
  upload including the final partial chunk; metadata body shape; abort stops
  before the next chunk.
- `tests/drive.test.ts` — multipart body assembly for create; create-vs-update
  branch on `fileId`.

The network paths get a manual gate, as the video export already does.

## 8. Primary risk

**Browser CORS on the YouTube resumable endpoint.** Google APIs support CORS
broadly and this is the documented browser flow, but it has not been verified
from this origin. It is the one assumption that would invalidate §1: if the
upload endpoint rejects browser requests, the choice is a Netlify proxy (with
its bandwidth and timeout costs) or no upload at all.

**Mitigation: prove it before building anything else.** The first task is a
throwaway spike that starts a resumable session and sends one chunk from
`localhost:5173`. If it fails, the design returns for revision rather than the
plan continuing.

### Build order

The spike gates only YouTube, and Drive carries none of its risk — so the order
is deliberate rather than incidental:

1. **CORS spike** (throwaway). Answers whether §1 survives.
2. **`auth.ts` + Drive open/save.** Non-sensitive scope, no verification, no
   audit, no CORS question — this half is usable by everyone the day it ships,
   and it exercises the auth gate that YouTube then reuses.
3. **YouTube upload.** Builds on a proven auth module and a proven transport.

If the spike fails, steps 2 and 3 decouple cleanly: Drive still ships, and
YouTube returns to design with a Netlify-proxy option on the table.

## 9. Known limits, accepted

- Sign-in lapses after roughly an hour, then re-acquires silently. A user who
  has closed their Google session sees the consent popup again.
- The Drive file id is not persisted, so a save after a reload creates a new
  file rather than updating the previous one.
- Uploads arrive private until the audit clears (§0), and non-test users meet
  the unverified-app interstitial.
- A 50 MB upload on a slow connection blocks the dialog. It is cancellable, but
  there is no background queue.
