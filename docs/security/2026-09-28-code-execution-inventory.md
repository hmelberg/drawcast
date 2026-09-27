# Code execution inventory (2026-09-28)

Every path by which code that is not part of the bundle can run in a drawcast
page, what it can reach, and how it is handled after this review. Risk is rated
for the **main origin** (drawcast.app), where localStorage holds the BYOK
Anthropic key (`src/llm/client.ts`), the drawcast account token
(`src/account.ts`), the GitHub token, the Google TTS key and Google OAuth
access tokens (`src/google/auth.ts`, in memory/session).

Ratings: **Critical** — a stranger can run code in someone else's browser
silently. **High** — needs one plausible click. **Medium** — needs the victim
to act deliberately, or needs a third party to be compromised. **Low** —
contained, or already gated.

The shared-link viewer (`#gh=`, `#gdoc=`, `#gdrive=`, `#anvil=`, `#<name>`,
and `NAME.drawcast.app`, which 302s to `drawcast.app/#name`) runs on the same
origin as the editor: `src/entry.ts` routes by hash inside one page. So
everything below that reaches "the page" reaches the secrets, whichever mode
the page booted in.

## 1. Template documents (JS `layout` / `widget` / `lint` bodies)

`src/scenes/compile.ts` compiles both bodies with `new Function` and calls
them in the page. The only guard is on the *shape* of what they return.

| Path | Where the doc comes from | Before | After |
|---|---|---|---|
| Cast-carried templates (`spec.templates`) | Any cast: a shared link, a published cast, an uploaded file, a Drive file, a course lecture. `publish/embed.ts withAuthoredTemplates` adds the author's My templates to every published copy. Registered on sight in `viewer.ts`, `render/index.ts render()`, `scenes/engines.ts ensureEnginesForSpecs` | **Critical** — open a link, the author's JS runs, reads `localStorage`, `fetch`es it anywhere | **Low** — `registerCastTemplates` refuses a body this browser does not trust (§ Trust rule); the viewer and the editor ask first |
| My templates | Authored here (AI), or imported from a file (`main.ts` myTplImportInput, already behind a `confirm()`) | Medium (import) | Medium → unchanged gate on import; trusted once registered |
| AI-authored templates (`llm/author.ts`, `llm/on-demand.ts`) | This browser's own AI session | Low (prompt injection through fetched seed text is the residual) | Low — trusted as the user's own |
| Remote packs, official index | `raw.githubusercontent.com/hmelberg/drawcast-templates` | Low (owner's repo) | Low |
| Remote packs, custom URL | Any URL the user pastes (`scenes/remote-packs.ts`) | Medium — `confirm()` gate | Medium — unchanged; CSP now also restricts where it can be fetched from |
| Bundled templates and packs | The build | none | none |

## 2. Code elements (`type: code`)

Dispatched by `src/code/run.ts` to one runtime module per language. Every
runtime runs **without isolation from the page** except R (a Worker) and BASIC
(a pure interpreter). Scripts auto-run in the resolve pass
(`render/code.ts resolveCode`) whenever an element has no baked
`code_result` that covers what the figure asks for; they also run from the
tray (Run, `ask` Check) and from the player's controls sweep
(`render/sweep-run.ts`).

| Language | Runtime | Where it runs | What the script can reach | Before | After |
|---|---|---|---|---|---|
| `python` | pyodide from cdn.jsdelivr.net (`code/pyodide.ts`) | **main thread** | `import js` → `js.window`, `js.localStorage`, `js.fetch`: everything | **Critical** (any cast without a covering stamp; a stamp can be made not to cover by adding a `{id.path}` token) | **Low** — gated |
| `micropython` | pyscript MicroPython wasm (`code/micropython.ts`) | **main thread** | `import js` → the page | **Critical** | **Low** — gated |
| `brython` | Brython from jsdelivr (`code/brython.ts`) | **main thread** | `from browser import window` → the page | **Critical** | **Low** — gated |
| `microdata` | the m2py emulator on the same pyodide (`code/microdata.ts`) | main thread | The script is microdata commands interpreted by m2py, not Python; no known escape, but the interpreter is 10k lines of Python running with `js` importable | Medium | **Low** — gated like Python |
| `r` | webR from webr.r-wasm.org (`code/webr.ts`) | **Worker** (webR's PostMessage channel) | No DOM, no localStorage; but `webr::eval_js` runs JS in the worker, which has `fetch` / `importScripts` | High (network from the worker; no secrets directly) | **Low** — gated; CSP limits the worker's fetch too |
| `basic` | drawcast's own interpreter (`code/basic.ts`) | main thread | Nothing: no eval, no DOM, no timers | Low | Low — exempt from the gate by design |
| C64 `game` | vc64web.github.io in an iframe (`code/c64.ts`), archive.org embeds | cross-origin iframe | Its own origin only | Low | Low |

Execution paths that are **not** gated because the code is by construction the
user's own: the LLM compile loop's execution check (`llm/compile.ts
codeRunner`, `code/check.ts`) runs the script the user's AI just wrote.

## 3. Ways a stranger's document reaches the page

All of these end in the sinks above, so the gate covers them without each
needing its own check; the ones that show a document also ask up front.

| Path | Code | Handling after |
|---|---|---|
| Shared link viewer: `#gh=`, `#gdoc=`, `#gdrive=`, `#anvil=`, `#name`, `NAME.drawcast.app` (`viewer.ts`) | whole cast | asks before registering anything (`gateSpecs` in `runViewer`); declined → drawn without it, "Run its code…" to reconsider |
| Upload a file (`main.ts importInput`), open from Drive (`openSpec`), history restore, library entries | whole cast | `present()` asks before rendering; declined → status line with "Run it…" |
| Course import from **your own** GitHub repo (Settings → Publishing) | lectures | trusted (your repository) |
| `?open=` / `?course=` | dev server only (`import.meta.env.DEV`) | trusted (local author) |
| Playlist files (multi-doc YAML) | every item | gated per item's programs, asked once for the whole playlist |
| Embeddable engine (`engine.ts`, `<drawcast-figure>`) | host-supplied | trust policy "all": it runs in the **host's** origin with the host's own content; no drawcast secret is there |
| Dev frames harness (`frames.html`, `scripts/cast.mjs`) | local files | trust policy "all" (dev only, not in the build) |

## 4. Other script and markup sinks checked

| Sink | Finding | Risk |
|---|---|---|
| `innerHTML` | one use, `viewer.ts loaderSvg`, constant markup | none |
| `DOMParser` (`ui/dom.ts svgFromMarkup`) | constant brand markup | none |
| `eval(` | only inside Python/R source strings | n/a |
| `import(` with a URL | webR and MicroPython loaders, constant pinned CDN URLs | supply chain (below) |
| `new Worker` | `export/keepalive.ts` (constant source), pdf.js worker (bundled) | none |
| `srcdoc`, `dangerouslySetInnerHTML` | not used | none |
| Links in specs (`link:`, sources, info cards) | schema requires `http(s)://`; opened as `<a target=_blank rel=noopener>` or framed in `ui/media-modal.ts`. A `javascript:` URL that slipped past validation is now also blocked by CSP (no `'unsafe-inline'`) | Low |
| Third-party scripts in the page origin | pyodide, Brython, MicroPython, webR, plotly (CDNs, version-pinned, no SRI); Google GSI and gapi (on sign-in / picker); giscus `client.js` (viewer comments) | Medium (supply chain): each could read localStorage. Mitigated for viewers by step 2 (the viewer origin holds no secrets) |
| pdf.js (source PDFs) | 6.2.x, past the 2024 font-eval CVE | Low |
| MathJax TeX from specs | rendered to SVG paths | Low |

## Trust rule (step 1)

Implemented in `src/security/code-trust.ts`. Trust belongs to the exact bytes
of a program — a SHA-256 of a template's `layout`+`widget`+`lint` (every field `compile.ts` compiles; a test fails if a new one is added without joining the key), or of a script's
language+code — never to a claim in the document.

**Trusted:**
1. bundled templates/packs (never pass through the gate) and bundled examples
   (marked at startup, for the page only);
2. **yours:** output of this browser's AI session (generate: all of it;
   revise: what it added, and what it changed of *trusted* code); what you
   type in the editor (an edit inherits the trust of what it replaced,
   something with no predecessor is yours); your My templates (so a cast that
   carries a copy of one runs it, in the viewer too); lectures loaded from
   your own GitHub repository; and, once, on first run of this version,
   everything already in your library;
3. **approved:** programs you chose "Run it" for. Persisted in localStorage
   (`drawcast.trustedCode`, capped at 3000 keys), so the same cast never asks
   twice; any change to the code asks again.

"Own" is therefore *this browser*, not the signed-in account: an account
signal would have to be checked against the server for every cast, and the
account token is exactly what the gate protects. The cost: your own cast
opened in another browser asks once.

**Everything else is untrusted.** The sinks refuse it on their own —
`registerCastTemplates` (template not compiled; the cast draws freehand, as for
an unknown template), `resolveCode` (script not run; its baked `code_result`
stands, or a "Not run" panel), the tray (asks for that script), the sweep
runner (holds the previous frame). The page asks once before the first render
with an in-app modal (`src/ui/code-consent.ts`); "Show without it" (the
default, also ✕/Esc/click-outside) is remembered for the tab
(sessionStorage). Node, tests, the embeddable engine and the dev harness run
under policy `"all"`.

## CSP (step 1)

`netlify.toml` `[[headers]] for = "/*"`; the directive list and the reason for
each host is in the comment there; `tests/csp.test.ts` pins it. The key
choices: `script-src` has no `'unsafe-inline'` and no wildcard (only
`'self'`, `'unsafe-eval'` for template bodies, `'wasm-unsafe-eval'`, and six
named CDNs); `connect-src` is an explicit list of ~40 hosts the app calls;
`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
`frame-ancestors 'self'`. `img-src` and `frame-src` stay `https:` (images,
sources and PDFs may come from anywhere) — a GET to an image or frame URL
remains a low-bandwidth exfiltration channel CSP cannot close here, as does
top-level navigation, which CSP does not govern at all. The gate is the
control; the CSP is the net under it.

`node scripts/csp-headers.mjs serve dist` serves a production build with
exactly the headers netlify.toml sets.

## Verified in a browser (production build, CSP on, muted)

Headless Chromium, `--mute-audio`, `speechSynthesis.speak` and `AudioContext`
stubbed, against `npm run build` served by `scripts/csp-headers.mjs`.
`securitypolicyviolation` events and console "Refused to" lines collected:
**zero violations** across all of:

- app boot, editor and player modes; examples: a built-in template
  (supply_demand), a pack template, math/MathJax (QALY), music, plot3d, a
  space/sky figure (Finding Mars, How big is Jupiter?); after merging main,
  the round's new built-ins too — motion_graphs, titration_curve,
  maxwell_boltzmann, plot3d (surface), equation_plot (presets) — which render
  without a prompt (built-ins never pass through the gate);
- 3D: the molecule viewer (3Dmol) and the anatomy body (mesh pack);
- code elements actually executing (no baked result): Python with numpy +
  matplotlib (pyodide + packages from jsdelivr), R with a plot (webR worker),
  Brython, MicroPython — typed into the editor, so trusted without a prompt;
- the tray, the Publish dialog (not published), Settings;
- lazy third-party scripts: Google GSI client, gapi (Drive picker), plotly;
- the share viewer on a real GitHub cast (`#gh=hmelberg/dcast/...`);
- the gate: an uploaded cast with a template and a Python script → prompt;
  "Show without it" → freehand, baked output, status "Run it…"; "Run it" →
  the template draws. The same cast through the viewer (`#gh=`, network
  stubbed) → prompt, degraded page, "Run its code…".

**Not verified offline** (need credentials, a deployed site or a live
account): the Google sign-in popup and token exchange, Drive picker UI,
YouTube upload, Anthropic API calls (no key), Google TTS, publishing to
GitHub/Drive/the drawcast server, giscus comments on a live published cast,
webR package installs from repo.r-wasm.org and micropip installs from PyPI
(hosts are allowed; not exercised), the Netlify functions under their real
origin (localhost → drawcast.app/.netlify/functions/views is CORS-refused,
which is expected and not a CSP report).

## Open risks

- **Same origin for viewer and editor.** Until step 2 is configured, a
  viewer who clicks "Run it" on a stranger's cast gives that code the key and
  token. Step 2 moves other people's casts to an origin with nothing in it.
- Third-party runtime scripts (no SRI; version-pinned URLs on public CDNs).
- `'unsafe-eval'` must stay while templates compile with `new Function`.
- Image/frame/navigation exfiltration channels (above).
- The course runner replays stored lectures and re-stores them as its own
  output; a lecture that was imported untrusted and then regenerated through
  the runner becomes trusted. Rare; noted.
- Prompt injection: text the AI reads (Wikipedia seeds, a pasted document)
  could steer it into writing a hostile template or script, which is trusted
  as the user's own.
