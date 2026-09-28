# Links between drawcasts — implementation plan

> For agentic workers: executed natively (Hans: "Implement"). Steps are TDD:
> failing test → minimal code → green → next.

**Goal:** a `link` element (text or card) that opens another drawcast, a
generated course end page built from it, and best-effort thumbnails.

**Architecture:** one pure resolver (`src/links/resolve.ts`) turns `to` +
the document's base into what to open; the ensure phase
(`render/link.ts`, beside resolveSources/resolveImages) fills a card's
picture and title before layout; layout draws the ink (`layout/tier2.ts`);
a click host (`ui/link-host.ts`) hit-tests visible links and opens them.

**Spec:** docs/superpowers/specs/2026-09-28-drawcast-links-design.md

## Global constraints
- Never throw, never fail a publish or a render over a link or a thumbnail.
- Picture order on a card: `image` → target thumbnail → fallback card.
- `open: auto` = here once finished, tab otherwise; `window` = media modal.
- No prompt changes this round.

## Decisions made while planning (refining the spec)
- **Course neighbours are named `lecture:N`**, resolved against the course
  (course.md's status lines give N → file / drawing id). The end page is
  generated before later lectures have files, so `./file.yaml` is not known
  then; `lecture:N` works in the app, in dev and on GitHub (the viewer reads
  `course.md` beside the lecture). `./relative.yaml` stays for authors.
- **Clicks are hit-tested** on the stage (logicalPoint + the link's box),
  like info cards, instead of an HTML `<a>` overlay tracking the camera:
  modified clicks still open a new tab (`window.open`). Simpler, camera-proof.
- **Pictures are embedded as data URIs** in the ensure phase (like source
  and image elements), so layout stays synchronous and the video export
  shows them when they could be fetched; a failed fetch is the fallback card.
- **The legacy "Next ▸" pill** is kept, and stands down when the last item
  has a `link` element. Publish keeps writing `meta.next` (old viewers).
- The end page carries `end_page: true` on its spec; the poster skips it and
  a legacy Next card (`nx_title`).

## Review focus
1. A link whose target never loads (offline, 404, CORS) must still draw and
   still click through.
2. A click on a link while playing must not also toggle play/pause.
3. A relative `to` in a pasted/unsaved cast: drawn, not clickable, no throw.
4. The poster of a course lecture must never be its end page.
5. `lecture:N` past the course's end or on an unbuilt lecture: not clickable.

## Tasks

### Task 1 — resolver (`src/links/resolve.ts`, `src/links/base.ts`)
- `parseTarget(to): Target | null` — forms: player link (`#gh=`, `#gdrive=`),
  `owner/repo/path.yaml`, github.com blob, raw.githubusercontent, Drive
  `/file/d/<id>` or `gdrive:<id>`, `lecture:N`, relative `./` `../` or bare
  `name.yaml`.
- `type LinkBase = {kind:"gh",owner,repo,path} | {kind:"dev",path} |
  {kind:"course",courseId,lectures:{file?:string,drawingId?:string}[], dir?: LinkBase} | null`
- `resolveLink(to, base, viewerBase) → Resolved | null` where
  `Resolved = { href?: string; drawingId?: string; posterUrl?: string; docUrl?: string }`
  (`href` for the viewer/dev, `drawingId` for an app lecture, `posterUrl` the
  target's `<name>.png`, `docUrl` a fetchable YAML for its title/poster).
- `base.ts`: `setLinkBase(b)`, `linkBase()`; course tables for `lecture:N`
  via `setCourseLectures`.
- Tests: `tests/links-resolve.test.ts` — every form, relative with `../`,
  no base → null, lecture:N in/out of range, dev base → `?open=` href.

### Task 2 — element (types, schema, layout, lint)
- `ElementType` += `"link"`; fields `to`, `title`, `image`, `look`, `open`,
  `size`; resolved fields reuse `strokes` (picture) and `resolved_title`.
- `layout/tier2.ts` `linkDrawables`: card = frame + picture child (decoded
  `strokes`) or fallback (title, play mark) + caption; text = text +
  underline; group with nominal `box`, anchors.
- Lint (`src/lint/lint.ts`): `link-target` warning when `parseTarget` is null.
- Tests: `tests/link-element.test.ts` — schema accepts/rejects, layout ids and
  box per look/size, lint warning.

### Task 3 — ensure phase (`src/render/link.ts`)
- `resolveLinks(spec, deps)`: per link, title (fetch `docUrl`, meta.title)
  when absent; for a card, picture from `image`, else `posterUrl`, else the
  target YAML's `poster:`; rasterize with the image pipeline; every miss is
  left unset. Wired into `render/resolve.ts` deps and `render/index.ts`.
- Tests: fake fetch/raster — order image → poster → none; no throw.

### Task 4 — click host (`src/ui/link-host.ts`)
- Attach in `ui/controls.ts` beside `attachInfoCards`. Hit-test visible
  link boxes (`sceneAt(plan, position).visible`), `cs-link-hover` cursor,
  capture-phase click that stops propagation, `registerControlRegion`.
- `open`: pure `openModeFor(open, state)`; here → navigate (href, or the
  app's openDrawing hook), tab → `window.open`, window → `openMediaModal`
  after pausing. Modified click → tab.
- Base set: viewer (gh), dev `?open=`, app `openDrawing` of a course lecture.
- Tests: `openModeFor`; `linkAt` hit-test pure helper.

### Task 5 — course end page
- `makeEndPage({prev?, next?, self})` in `playlist/playlist.ts`: cards for
  `lecture:N-1` / `lecture:N+1`, a text "Watch again" (`lecture:N`,
  `open: here`), narration "Next: <title>", `end_page: true`.
- `course/run.ts` `lecturePlaylist` uses it instead of `makeNextCard`.
- `session.ts` `showNextLink` stands down when the last item has a link.
- Tests: end page per position; lecturePlaylist ends on it.

### Task 6 — thumbnails
- Poster = last content item (skip `end_page`, skip `nx_title` cards).
- Course publish writes `<file>.png` beside each lecture via an injected
  `poster(yaml)` (null-safe). Drive: best-effort upload + `poster:` if the
  Drive client offers an upload; otherwise skipped and reported.
- Tests: poster item choice; course publish commits without posters when
  the hook returns null.
