# Picture mapping (delivery 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A picture's named parts are found by a vision-model call while authoring — for a picture URL in a request, for `regions: auto` in a revised document, and for `regions: auto` written in the editor — cached per picture, handed to the compiler as names, and written into the spec as boxes (only the used ones after a compile; all of them for the editor path). A Netlify fetch helper lets the browser embed pictures from hosts that refuse CORS.

**Architecture:** Pure logic in `src/llm/picture-map.ts` (schema forms, request URL extraction, the mapping prompt and reply sanitiser, cache key, the compiler note, filling used regions). The model call in the same module (`mapPicture`, via `callForJson` with an image block — URL source for https pictures, base64 for data URIs). The compile pipeline gets an injected `cfg.mapPictures` pre-step (like `route`/`fetchSeed`), appends the note to the treatment and compiler user turns, and fills regions before `validateSpec` inside the loop. Revise and the editor's draw path call the same resolver. The fetch helper is a new Netlify function plus a fallback in `render/image.ts`.

**Tech Stack:** TypeScript, vitest, Anthropic SDK in the browser (`src/llm/client.ts`), Netlify Functions v2 (`netlify/functions/*.mts`), IndexedDB picture cache (`src/render/portrait.ts` cacheGet/cachePut).

**Spec:** `docs/superpowers/specs/2026-09-30-picture-regions-design.md` §8 (mapping), §14 (how it runs — binding).

## Global Constraints

- Mapping only while authoring. Nothing under `src/render/` may call a model or read the API key.
- `regions` accepts: a map `name → [x,y,w,h]` (unchanged); the string `"auto"`; or `{auto: {detail?: "few"|"some"|"many", kinds?: ("areas"|"controls"|"text")[], find?: string[]}}` (also `{auto: true}`). Defaults: detail `some`, kinds all three.
- Detail caps: few ≤ 8, some ≤ 25, many ≤ 80 regions.
- Region names: English, `^[a-z][a-z0-9_]*$` (snake_case), ≤ 32 chars, unique (dedupe with `_2`, `_3`).
- Boxes: fractions of the whole picture, top-left origin, clamped to 0..1 with x+w ≤ 1, y+h ≤ 1, rounded to 3 decimals; a box with w or h < 0.004 is dropped.
- Model for mapping: `planningModelFor(settings.model)` (Sonnet on Opus/Sonnet; Haiku raised to Sonnet). `maxTokens` 4000. No `effort` on Haiku (not used anyway).
- Cache key: `m1|<picture key>|<detail>|<sorted kinds>|<sorted find>` where picture key = the https URL, or for a data URI the fingerprint `data:<length>:<first 64>:<last 64>`.
- The fetch helper: https only; reject hosts that are IP literals in private/loopback/link-local/CGNAT/unique-local ranges and names resolving to them; content-type must start with `image/`; ≤ 8 MB (stream-count and abort); 8 s timeout; per-IP limit 300/hour via `netlify/lib/rate-limit.mts`; CORS allow-list `https://drawcast.app`, `https://hmelberg.github.io`, `http://localhost:5173`, `http://localhost:8888` (+ `Vary: Origin`); `Cache-Control: public, max-age=86400`.
- Plain behaviour unchanged: a request without a picture URL and a document without `regions: auto` make no new calls.
- Commits end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work only in `.claude/worktrees/picture-mapping` (branch `picture-mapping`).

## Review Focus

1. **The model returns junk** (names with spaces, boxes outside 0..1, duplicates, too many, not-JSON) — the sanitiser must yield a clean map or an empty one, never throw into the compile. Task 1.
2. **Mapping fails** (no key, network, refusal, 400 on an unreachable URL) — the compile goes on without the note, with one warning; the editor path shows a status line and leaves `regions: auto` in place. Tasks 2–3.
3. **The compiler names a part that is not in the map** — the fill leaves it out, validation reports the real names, the repair round fixes it. Task 3.
4. **SSRF through the fetch helper** — IP literals, localhost, `.internal` names, DNS that resolves to 10.x/127.x/169.254.x/::1, redirects to such hosts, non-images, huge bodies. Task 4.
5. **A `regions: auto` document played by a viewer** — layout treats it as no regions with one warning; nothing calls a model. Task 1.

---

## File Structure

- Create `src/llm/picture-map.ts` — pure: `RegionsAuto` parsing, `picturesInRequest`, `MAP_SCHEMA`, `mapSystemPrompt`, `mapUserContent`, `sanitizeMap`, `mapCacheKey`, `mapNote`, `fillUsedRegions`, `autoImages`; and the call `mapPicture` + `mapPictures`.
- Modify `src/spec/types.ts`, `src/spec/schema.ts` (regions forms), `src/spec/places.ts` (pictureErrors tolerates auto), `src/layout/tier2.ts` (auto → no regions + warning).
- Modify `src/llm/compile.ts` (pre-step, note, fill in loop), `src/llm/revise.ts` (pre-step), `src/main.ts` (wire `mapPictures` at the generate call sites and the revise call; editor draw path), `src/compiler.ts` (host embed: pass through if it builds cfg), `src/llm/multi.ts` (pass through cfg), `src/llm/prompts/compiler-v1.md` (rule 7), `tests/prompt-size.test.ts`.
- Create `netlify/functions/picture.mts`, `netlify/lib/public-host.mts`; modify `src/render/image.ts` (proxy fallback before linking).
- Tests: `tests/picture-map.test.ts`, `tests/picture-map-call.test.ts`, `tests/picture-map-pipeline.test.ts`, `tests/picture-endpoint.test.ts`, `tests/public-host.test.ts`, additions to `tests/picture-resolve.test.ts`, `tests/picture-schema.test.ts`, `tests/picture-layout.test.ts`.

---

### Task 1: The pure mapping logic and the `regions: auto` forms

**Files:** create `src/llm/picture-map.ts` (pure part); modify `src/spec/types.ts`, `src/spec/schema.ts`, `src/spec/places.ts`, `src/layout/tier2.ts`; tests `tests/picture-map.test.ts`, additions to `tests/picture-schema.test.ts`, `tests/picture-layout.test.ts`.

**Interfaces — Produces (src/llm/picture-map.ts):**

```ts
export type MapDetail = "few" | "some" | "many";
export type MapKind = "areas" | "controls" | "text";
export interface MapOptions { detail: MapDetail; kinds: MapKind[]; find: string[] }
export interface MappedRegion { name: string; box: Rect4; kind: "area" | "control" | "text"; label?: string }
export interface PictureMap { regions: MappedRegion[]; notFound: string[] }
/** The auto request on an image, normalised; null when regions is a plain map or absent. */
export function autoOptions(regions: unknown): MapOptions | null;
/** https picture URLs in a request text (png, jpe?g, webp, gif, svg — by extension, or any URL under /images/ or /assets/), at most 3, de-duplicated, in order. */
export function picturesInRequest(text: string): string[];
export const MAP_SCHEMA: object; // JSON schema: {regions: [{name, box:[4 numbers], kind, label?}], not_found: [string]}
export function mapSystemPrompt(): string;
export function mapUserText(opts: MapOptions): string;
/** Clean a raw reply: names snake_case/unique/≤32, boxes clamped+rounded, tiny boxes dropped, kinds filtered to opts.kinds, capped by detail. Never throws; bad input → {regions: [], notFound: []}. */
export function sanitizeMap(raw: unknown, opts: MapOptions): PictureMap;
export function mapCacheKey(picture: string, opts: MapOptions): string;
/** The compiler's note: one line per picture, then one per part "  name — kind — "label"", then "  not found: …". */
export function mapNote(entries: { url: string; map: PictureMap }[]): string;
/** For every image whose url (or whose own regions:auto) has a map: set regions to the boxes of the names the commands use (keeping any hand-written boxes); returns the names used that the map does not have. Mutates spec. */
export function fillUsedRegions(spec: Spec, maps: Map<string, PictureMap>): { missing: string[] };
/** Every image element with regions:auto, with its picture key (url or data: fingerprint) and options. */
export function autoImages(spec: Spec): { id: string; picture: string; opts: MapOptions }[];
```

Schema: `regions` becomes `anyOf: [the existing map, {const: "auto"}, {type: "object", properties: {auto: {anyOf: [{const: true}, {type: object, properties: {detail: enum, kinds: array enum, find: array string}, additionalProperties: false}]}}, required: ["auto"], additionalProperties: false}]`. Types accordingly (`regions?: Record<string, Rect4> | "auto" | { auto: true | Partial<…> }`). `pictureErrors`: when an image's regions is auto, skip its per-region checks, and a place naming a region on it is NOT an error (the fill happens later) — but in layout/plan it resolves to nothing (warning below). Layout (tier2 imageDrawable → ctx.pictures): auto → `regions: {}` plus one warning `"<id>: regions: auto has not been mapped yet — open the drawcast in the app with a key to map it"`.

`mapSystemPrompt()` text (verbatim):

```
You map a picture for a teacher who will point at its parts while explaining it. Return the parts a newcomer would be shown, as named boxes.
- Boxes are [x, y, w, h] as FRACTIONS of the whole picture, measured from the TOP-LEFT corner: x and w of the width, y and h of the height. Be precise: the box should hug the part.
- Names are short English snake_case ids (command_line, search_field, mirror), unique, describing the part — not its colour or position.
- kind: "area" for a panel, section or region of a scene; "control" for a button, field, menu, tab or icon; "text" for a block of visible words.
- label: the visible text on or in the part, verbatim, when it has any.
- Never invent a part you cannot see. When asked to find something that is not in the picture, put the request in not_found instead.
```

`mapUserText(opts)`: `"Detail: <detail> (<cap> parts at most). Kinds: <kinds>." + (find.length ? " Find exactly these, and nothing else: <find joined by '; '>. Quoted phrases are visible text." : "")`.

- [ ] **Step 1: failing tests** `tests/picture-map.test.ts`:
  - `autoOptions`: `"auto"` → {some, all kinds, []}; `{auto: true}` same; `{auto: {detail: "few", kinds: ["areas"], find: ["search button"]}}` → as given; a plain map → null; `undefined` → null.
  - `picturesInRequest`: finds `https://microdata.no/manual/assets/images/image79-3a6b.png` and `https://upload.wikimedia.org/…/3840px-X.jpg` in running text, ignores `http://` and non-image links, dedupes, caps at 3.
  - `sanitizeMap`: names "Command Line!" → `command_line`; duplicate names → `_2`; box `[-0.1, 0.5, 1.3, 0.6]` → `[0, 0.5, 1, 0.5]`; `[0.2, 0.2, 0.001, 0.3]` dropped; kind "control" filtered out when kinds = ["areas"]; 30 regions with detail few → 8; `null`, `"x"`, `{regions: 5}` → empty map; not_found strings kept (trimmed, ≤ 10).
  - `mapCacheKey`: same picture + options in a different order → same key; a data URI → uses the fingerprint, never the whole string.
  - `mapNote`: contains each name, kind, quoted label, and "not found: search button".
  - `fillUsedRegions`: a spec with image `md` (url U, `regions: "auto"`) and commands highlighting `md:command_line` and `md:nope`; map for U has `command_line`, `results` → md.regions = {command_line: box} only; returns missing ["nope"]; an image with hand regions `{extra: [...]}` keeps `extra`.
  - `autoImages`: returns the md entry with its options; ignores images with a plain map.
  - `tests/picture-schema.test.ts`: `regions: "auto"`, `{auto: true}`, `{auto: {detail: "many"}}` validate; `{auto: {detail: "huge"}}` fails; a highlight on `md:anything` with `regions: auto` has no picture error.
  - `tests/picture-layout.test.ts`: an image with `regions: "auto"` lays out with `pictures.md.regions` = {} and the "not been mapped yet" warning.
- [ ] **Step 2: run** → FAIL. **Step 3: implement.** **Step 4: run** those files + `tests/picture-plan.test.ts tests/picture-marks-plan.test.ts` → PASS; full suite (prompt-size may fail: schema grew — note it; Task 3 re-pins).
- [ ] **Step 5: commit** "Picture map: regions: auto (and its detail/kinds/find form), the mapping prompt, a sanitiser that never throws, the cache key, the compiler's note, and filling only the used regions".

---

### Task 2: The mapping call and its cache

**Files:** `src/llm/picture-map.ts` (call part); tests `tests/picture-map-call.test.ts`.

**Interfaces — Produces:**

```ts
export interface MapDeps {
  client: Anthropic; model: string; signal?: AbortSignal;
  cacheGet?: (k: string) => Promise<string | null>; cachePut?: (k: string, v: string) => Promise<void>;
}
/** Map one picture. picture = https URL or data: URI. Cached. Throws only on abort; other failures → null. */
export function mapPicture(picture: string, opts: MapOptions, deps: MapDeps): Promise<PictureMap | null>;
/** Map several (sequentially), returning url → map for the ones that succeeded, plus warnings for the ones that failed. */
export function mapPictures(items: { picture: string; opts: MapOptions }[], deps: MapDeps): Promise<{ maps: Map<string, PictureMap>; warnings: string[] }>;
```

The message: `[{role: "user", content: [imageBlock, {type: "text", text: mapUserText(opts)}]}]` where imageBlock = `{type: "image", source: {type: "url", url}}` for https, or `{type: "image", source: {type: "base64", media_type, data}}` parsed from a data URI (png/jpeg/webp/gif only; else null). Call `callForJson(client, model, [{type: "text", text: mapSystemPrompt()}], messages, MAP_SCHEMA, {maxTokens: 4000, signal})` (match `callForJson`'s real signature — read src/llm/client.ts). Parse with `sanitizeMap`. Cache the JSON of the sanitised map under `mapCacheKey`; a cached empty map is NOT stored (retry next time). Default cache = `cacheGet`/`cachePut` from `src/render/portrait.ts` — importing a pure cache helper from render is fine; the constraint is only that render never calls a model.

- [ ] **Step 1: failing tests** (mock `callForJson` as in `tests/look-pass.test.ts`): url picture → the message's image block has `source.type === "url"`; data URI → base64 block with the right media type; the reply is sanitised; a second call with the same picture/options hits the injected cache (callForJson called once); callForJson rejecting (non-abort) → null and nothing cached; an abort rejects; `mapPictures` returns maps for successes and a warning naming the failed URL.
- [ ] **Step 2–4:** run → FAIL → implement → PASS.
- [ ] **Step 5: commit** "Picture map: one vision call per picture (by URL, or base64 for an embedded picture), cached per picture and options; failures degrade to no map".

---

### Task 3: Wiring — compile, revise, editor, prompt

**Files:** `src/llm/compile.ts`, `src/llm/revise.ts`, `src/llm/multi.ts`, `src/main.ts`, `src/compiler.ts`, `src/llm/prompts/compiler-v1.md`, `tests/prompt-size.test.ts`; tests `tests/picture-map-pipeline.test.ts`.

**Compile** (`generateSpec`, compile.ts): add `mapPictures?: (request: string, signal?: AbortSignal) => Promise<{ maps: Map<string, PictureMap>; note: string; warnings: string[] } | null>` to `GenerateConfig`. After the router/seed (~:527) and before the treatment (~:560): `const mapped = cfg.mapPictures ? await cfg.mapPictures(request, signal).catch(() => null) : null`. Append `mapped.note` to the treatment user text and to `userContent` (~:611). Push `mapped.warnings` into the result's warnings. Inside the loop, right after a reply is parsed and BEFORE `validateSpec`, call `fillUsedRegions(spec, mapped.maps)` when `mapped` is set (the pictures are matched by the image element's `url`; also set `regions` for an image whose url is in the map even when the compiler wrote `regions: "auto"` or nothing).

**The injected implementation** lives in picture-map.ts: `makeMapPictures(deps: MapDeps): GenerateConfig["mapPictures"]` → `picturesInRequest(request)` (none → null), `mapPictures(...)` with default options, `mapNote(...)`.

**Wire in main.ts** at the `generateSpec` call sites (single, author-and-redraw, multi, course — the ones that build a cfg with `route`/`fetchSeed`; follow `fetchSeed`'s wiring), with `client` and `model = planningModelFor(settings.model)`; `src/llm/multi.ts` and `src/compiler.ts` pass `mapPictures` through when they forward cfg.

**Revise** (`reviseDocument`): add `cfg.mapAuto?: (doc) => Promise<…>`: before the call, for every item's `autoImages(spec)`, map, then add a note to the revise user message ("these pictures have been mapped — use these names; write regions: auto as it is, the app fills the boxes") and, after the reply is parsed and before its validation, `fillUsedRegions` on each item. Wire in main.ts's revise call.

**Editor draw path** (main.ts): when the user draws/runs the current document and it has `autoImages` and a key is available: map each (status line "Finding the parts of <id>…"), write ALL found regions (sorted by name) into that image's `regions` in the document text (use the existing document-update path the Embed dialog uses — round-trip the playlist and set the editor text), then draw. Failures: status line naming the picture; the doc keeps `regions: auto`. Not-found items: status line "not found in <id>: …". Find the draw handler by following the Embed dialog's `readPlaylist` / write-back helpers in src/ui/insert.ts.

**Prompt** rule 7: replace "only for boxes the user GAVE — you cannot see the picture" with "the app maps a picture URL in the request for you: use the part names it lists (write `regions: "auto"` on the image; the boxes are filled in); without a list, only boxes the user gave". Re-pin prompt-size with a dated note.

- [ ] **Step 1: failing tests** `tests/picture-map-pipeline.test.ts` (mock client as in look-pass tests; stub prompt variant): a request with a picture URL and an injected `mapPictures` returning a map with `command_line` → the compiler's user turn contains the note; the compiler's reply highlights `md:command_line` on an image with that url and `regions: "auto"` → the final spec's md.regions = {command_line: box}; a reply naming `md:nope` → the first validation reports the real names and the repair round's fixed reply is accepted; `mapPictures` rejecting → generation completes, a warning is reported, no note; a request with no picture URL → `makeMapPictures` returns null without calling the model. Revise: a document with `regions: "auto"` → the revise message carries the note and the result has filled regions.
- [ ] **Step 2–4:** run → FAIL → implement → PASS; full suite green (prompt-size re-pinned); tsc clean.
- [ ] **Step 5: commit(s)** "Mapping in the pipeline: a picture URL in a request is mapped before the storyline; the compiler writes against part names and only the used boxes are filled" / "Mapping on revise and in the editor: regions: auto is resolved while authoring" / "Prompt: the compiler uses the app's part names".

---

### Task 4: The fetch helper and embedding CORS-refusing pictures

**Files:** create `netlify/lib/public-host.mts`, `netlify/functions/picture.mts`; modify `src/render/image.ts`; tests `tests/public-host.test.ts`, `tests/picture-endpoint.test.ts`, additions to `tests/picture-resolve.test.ts`.

**public-host.mts:** `isPublicAddress(ip: string): boolean` (IPv4: reject 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, 192.0.0/24, 198.18/15, 224/4 and above; IPv6: reject ::, ::1, fc00::/7, fe80::/10, ::ffff:<private v4>), and `checkPublicHost(hostname, lookup = dns.promises.lookup): Promise<boolean>` (reject IP literals that are not public, names `localhost`, `*.localhost`, `*.local`, `*.internal`; resolve all addresses with `{all: true}` and require every one public).

**picture.mts:** v2 handler `handlePictureRequest(req, deps)` + default export (follow name.mts's structure and tests). GET only; `?url=`; must parse as https URL; `checkPublicHost`; per-IP limit (`checkFailureBudget` pattern from rate-limit.mts with id `picture:${ip}`, 300/hour — count every request); `fetch(url, {redirect: "manual", signal: AbortSignal.timeout(8000)})` and follow at most 3 redirects manually, re-checking each Location with the same https + public-host rules; require `content-type` starting with `image/`; read the body with a running byte count and abort past 8 MB (413); respond with the bytes, the upstream content-type, `Cache-Control: public, max-age=86400`, CORS allow-list + `Vary: Origin`. Errors: JSON `{error}` with 400 (bad url), 403 (not public), 415 (not an image), 413, 429 (+ Retry-After), 502 (upstream). 

**image.ts:** in the url path, when `loadRaster` fails (the CORS case), try the proxy before linking: for each endpoint in `PICTURE_ENDPOINTS = ["/.netlify/functions/picture", "https://drawcast.app/.netlify/functions/picture"]`, `loadRaster(\`${endpoint}?url=${encodeURIComponent(url)}\`, dim)`; the first success is embedded (same budget logic as a direct read); `el.source` stays the ORIGINAL url; only if every endpoint fails → lnk1 as today. Make the endpoint list injectable in `ImageDeps` for tests.

- [ ] **Step 1: failing tests** — public-host: 10.1.2.3, 127.0.0.1, 169.254.169.254, 192.168.0.1, 100.64.0.1, ::1, fe80::1, ::ffff:10.0.0.1 not public; 8.8.8.8, 2606:4700::1111 public; `checkPublicHost("localhost")`, `("metadata.internal")` false; a name whose stubbed lookup returns [8.8.8.8, 10.0.0.1] false; one returning [93.184.216.34] true. Endpoint (injected fetch + lookup + rate store): http url 400; private host 403; non-image 415; 9 MB stream 413; redirect to 127.0.0.1 403; a good png → 200 with bytes, content-type, cache and CORS headers for an allowed origin and none for a foreign origin; 301 rate → 429. Resolve: `loadRaster` fails on the direct URL and succeeds on the proxied one → strokes are img1 and `source` is the original URL; all fail → lnk1.
- [ ] **Step 2–4:** run → FAIL → implement → PASS; full suite; tsc.
- [ ] **Step 5: commit** "Fetch helper: a public-hosts-only, image-only, size- and rate-limited picture proxy, and embedding a CORS-refusing picture through it before falling back to a link".

---

### Task 5 (controller): Check

Render the microdata example on the frames page (the picture should now EMBED through the proxy only when served by netlify dev or production — under plain vite the drawcast.app endpoint is tried, which does not have the function until deployed; note this). If an API key is available to the controller, run one real `mapPicture` on the microdata screenshot and on the Arnolfini from a node script and compare the boxes with the hand-measured ones in the examples; otherwise report that the live check needs Hans's key.
