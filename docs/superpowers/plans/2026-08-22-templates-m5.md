# Templates M5 Implementation Plan — external packs, biology, carried seams

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Packs can live outside the app — a `drawcast-templates` GitHub repo with an `index.json` feeds a "Browse extra packs" list, arbitrary URLs load with an explicit risk confirmation, remote packs cache in localStorage — plus the biology pack in-repo, and the two seams M4's final review carried: authoring-side engine support and prompt-cache-stable catalogs.

**Architecture:** Remote packs reuse the ENTIRE M3 pack machinery — a remote pack is just YAML text arriving by `fetch` instead of a code-split import; `registerPack`'s all-or-nothing/never-clobber discipline applies unchanged. New `src/scenes/remote-packs.ts` owns: the official index URL, `fetchRemotePack(url)`, localStorage caching (`drawcast.remotePacks.v1`: `{url, yaml, ts, enabled}`), and staleness-tolerant startup (cached YAML registers offline; refresh is explicit). Trust model: packs from the official index load on toggle like built-ins; a custom URL requires a typed confirmation naming the run-their-code risk. The catalog's request-variable hot-set entries move out of the cached prefix: `catalogText` splits into a stable part (index + core/priority/forced full entries — preference-stable) and a variable part (keyword-shortlist full entries) that `generateSpec` appends to the UNCACHED suffix block, restoring per-request cache hits in the ≥10-ready regime. Authoring gains engines: `TEMPLATE_DOC_API_SCHEMA` gets the `engines` property, `author-v1.md` a short section naming `KNOWN_ENGINES` and the `SmilesEngine` contract.

**Tech Stack:** gh CLI (authenticated as hmelberg — verified), raw.githubusercontent.com (CORS `*`), existing pack/registry machinery, vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-templates-design.md` §5 (external tier), §5a (cache note), §6 (authoring), non-goals note on import confirmation. M4 final-review carried items are IN SCOPE here by controller ruling.

## Global Constraints

- No new npm dependencies; NEVER create or commit a package-lock.json (untracked one exists — leave it).
- Gate before every commit: `npx tsc && npx vitest run` (final task adds `npm run build`).
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Remote pack registration goes through `registerPack` — never a parallel path. A remote pack id colliding with PACK_DEFS ids or any registered template id is rejected by the existing discipline.
- Custom-URL loads MUST be gated by an explicit confirmation that says plainly: the pack's templates contain JavaScript that will run in your browser.
- Startup must never fetch the network for remote packs: enabled remote packs register from the localStorage cache only; fetch happens on add/refresh actions.
- The catalog split must keep the BELOW-threshold path byte-identical (again), and in the two-level regime the PREFIX must be byte-stable for a fixed preference set (no request-dependent content before the cache split).
- Deterministic layout bodies; y-up 1000×750; frozen-surface iteration rule for pack YAML.

## File Structure

- Create `src/scenes/packs/biology.yaml` — membrane_bilayer, dna_helix, phylo_tree (uses kit.parseNewick).
- Modify `src/scenes/packs.ts` — biology PACK_DEFS entry.
- Create `src/scenes/remote-packs.ts` — cache store + fetch + register + official index fetch.
- Modify `src/scenes/catalog.ts` — `catalogText` returns `{ stable, variable }` (new export `catalogParts(opts)`; keep `catalogText` as the joined convenience for tests/authoring).
- Modify `src/llm/compile.ts` — suffix carries the variable part.
- Modify `src/llm/author.ts` + `src/llm/prompts/author-v1.md` — engines in schema + prompt.
- Modify `src/main.ts`, `src/styles.css` — remote-pack UI in the Template packs panel.
- External: `hmelberg/drawcast-templates` repo (gh) with README, `index.json`, `packs/showcase.yaml`.
- Tests: `tests/remote-packs.test.ts`, `tests/catalog-split.test.ts`, extend `tests/packs.test.ts` (biology), extend `tests/author.test.ts` (engines authoring), extend `tests/generate-loop.test.ts` (suffix placement).

---

### Task 1: Biology pack

**Files:** Create `src/scenes/packs/biology.yaml`; modify `src/scenes/packs.ts`; extend `tests/packs.test.ts`.

**Interfaces:** kit only (no engines). Produces pack `biology` with templates `membrane_bilayer`, `dna_helix`, `phylo_tree`.

- [ ] **Step 1: Write the pack YAML** (bodies authored here; iterate geometry/labels, frozen ids/params/examples):

**`membrane_bilayer`**: params `width_units` (4–12 lipids per leaflet, default 8), `proteins` (array of `channel|pump|receptor`, default [channel]), `transports` (array of `{species, mode: diffusion|active, direction: in|out}`), `labels` (bool). Two rows of lipids: head = small circle (stroke w/ circle shapeHint r≈11), two wavy tails (kit.wave rotated? tails as 2 short sine polylines pointing inward) — heads outward (top row heads up at y≈470, bottom row heads down at y≈290), tails meeting in the middle. Proteins: channel = two parallel vertical rounded bars spanning the bilayer with a gap (drawn as two closed rounded-rect-ish polylines), pump = ellipse spanning bilayer, receptor = channel-like with a forked top (Y shape). Space proteins evenly among the lipid columns (proteins replace lipid slots). Transports: vertical arrows through a channel/gap (diffusion = single arrow, color guide; active = thicker accent arrow + small "ATP" text near it), labeled with species. Element ids: `lipids` (group), `protein_<i>`, `transport_<i>`, `label_*`. Examples: plain bilayer with channel + "Show diffusion of O₂ through a membrane channel" with transports.

**`dna_helix`**: params `turns` (1–4, default 2), `show_base_pairs` (bool, default true), `labels` (bool). Two phase-shifted sine ribbons (kit.wave, amplitude ≈70, wavelength = 760/turns, one shifted half a wavelength) drawn as thicker strokes (colors demand/supply), rungs = vertical segments connecting the strands at regular intervals ONLY where the strands are far apart (|y1−y2| > 40 — classic helix look with rungs vanishing at crossings), grouped as `rungs`. Optional labels "Sugar-phosphate backbone" (label on a strand) and "Base pair" (label pointing at one rung). Ids: `strand_a`, `strand_b`, `rungs`, `label_backbone`, `label_basepair`. Examples: "Draw a DNA double helix" and 3-turn without labels.

**`phylo_tree`**: params `newick` (string, default `"((Human,Chimp),(Mouse,Rat),Chicken);"`), `title`. Parse via `kit.parseNewick`; layout = rectangular cladogram: leaves evenly spaced on y within [180, 620] at x=760, internal nodes at x proportional to depth (root x=140; ignore branch lengths in v1 — depth-proportional), right-angle connectors (parent to child: horizontal then vertical polylines — draw as one elbow polyline per child), leaf names as exact-position kit.text (anchor "start") at x=775. Ids: `edges` (group), `leaf_<i>` texts, `tree_title` label. Examples: default; "(Dog,(Cat,(Lion,Tiger)));" titled Felids.

- [ ] **Step 2: PACK_DEFS entry** (mirror physics/chemistry).

- [ ] **Step 3: Tests** (extend packs.test.ts, mirror the chemistry block): registration order [membrane_bilayer, dna_helix, phylo_tree]; every example lint-clean + deterministic + in-bounds (the standard loop); phylo-specific: `((A,B),C);` yields 3 leaf texts and edges group; dna-specific: rungs group exists and every rung's two points are ≥40 apart in y... (assert via flattenDrawables on the rungs group children); bilayer-specific: `proteins: []` still renders (pure bilayer), transports arrow present when declared.

- [ ] **Step 4: Iterate until green; gate; commit** (`feat: biology pack — membrane_bilayer, dna_helix, phylo_tree`).

---

### Task 2: Catalog cache split + authoring engines (carried seams)

**Files:** Modify `src/scenes/catalog.ts`, `src/llm/compile.ts`, `src/llm/author.ts`, `src/llm/prompts/author-v1.md`; create `tests/catalog-split.test.ts`; extend `tests/author.test.ts`, `tests/generate-loop.test.ts`.

**Interfaces:**
- catalog.ts produces: `export function catalogParts(opts?: CatalogOpts): { stable: string; variable: string }` — below threshold or when `forced`: today's exact `catalogText` output as `stable`, `variable: ""` (byte-identity preserved). Above threshold: `stable` = complete index + full entries for core∪priority (preference-stable) + stub lines + pack-availability lines + escalation prose; `variable` = full entries for keyword-shortlist ids NOT already in the stable hot set, prefixed by one line: `Additional likely-relevant template definitions for THIS request:`. `catalogText(opts)` = `stable + (variable ? "\n\n" + variable : "")` (unchanged external behavior for authoring/BUILTIN_IDS uses).
- compile.ts: `assembleSystemPrompt` unchanged (uses joined `catalogText`); `generateSpec` uses `catalogParts`: `{{CATALOG}}` in the PREFIX gets `stable`; `variable` is appended to the SUFFIX text (after exemplars substitution: `suffix = blocks.suffix + (variable ? "\n\n" + variable : "")`). The escalation rebuild keeps using forced-mode `catalogParts` (all-stable).
- author.ts: `TEMPLATE_DOC_API_SCHEMA` gains `engines: { type: "array", items: { type: "string", enum: ["smilesdrawer"] } }` (closed enum — structured-output safe); author-v1.md gains a short "## Engines" section after the kit source: name KNOWN_ENGINES, the declaration (`"engines": ["smilesdrawer"]`), the body contract (`engines.smilesdrawer.layoutSmiles(smiles)` → NormalizedMolecule shape spelled out in prose), and the rule "declare an engine ONLY when the figure needs molecular layout from SMILES; otherwise omit the field".

- [ ] **Step 1: Tests first** — `tests/catalog-split.test.ts`: below threshold `catalogParts().variable === ""` and `stable === catalogText()`; above threshold (register fakes like catalog.test.ts): prefix-stability — `catalogParts({request: "A"}).stable === catalogParts({request: "B"}).stable` while joined outputs differ; variable contains a shortlisted fake's full entry NOT present in stable; forced → all-stable. generate-loop.test.ts addition: capture the `system` blocks in a mocked two-level run — assert the cache_control block does NOT contain the shortlisted entry while the non-cached block does. author.test.ts additions: schema has the engines enum; a doc with engines:["smilesdrawer"] passes processAuthorDoc when the engine is pre-loaded (ensureEngines in the test) and its yaml round-trips with the engines field intact.

- [ ] **Step 2: Implement; full suite; gate; commit** (`feat: cache-stable catalog split + authoring-side engine support`).

---

### Task 3: Remote packs — module, cache, UI, official repo

**Files:** Create `src/scenes/remote-packs.ts`, `tests/remote-packs.test.ts`; modify `src/store.ts` (KEYS + RemotePackEntry trio), `src/main.ts`, `src/styles.css`; create the external repo via gh.

**Interfaces:**
- store.ts: `export interface RemotePackEntry { url: string; yaml: string; ts: string; enabled: boolean }`, `loadRemotePacks()`, `saveRemotePack(e)` (upsert by url), `deleteRemotePack(url)` — KEYS `remotePacks: "drawcast.remotePacks.v1"`.
- remote-packs.ts:
  - `export const OFFICIAL_INDEX_URL = "https://raw.githubusercontent.com/hmelberg/drawcast-templates/main/index.json"`
  - `export interface RemoteIndexEntry { id: string; title: string; description: string; url: string }`
  - `export async function fetchOfficialIndex(): Promise<RemoteIndexEntry[]>` (validated shape; throws on malformed)
  - `export async function fetchRemotePackYaml(url: string): Promise<string>` (https-only check; size cap 500_000 chars; throws otherwise)
  - `export function registerRemotePackYaml(url: string, yaml: string): { ok: boolean; id?: string; errors: string[] }` — parses via `parsePack`, then `registerPack(remoteIdFor(url, parsedId), yaml)`? NO — simpler and honest: `registerPack(parsed.pack.id, yaml)` with the pack's own id; the existing discipline rejects collisions. Returns registerPack's result plus the id.
  - `export function registerCachedRemotePacksAtStartup(): { url: string; ok: boolean; errors: string[] }[]` — for each enabled RemotePackEntry, register its CACHED yaml (no network).
  - `export function unregisterRemotePack(url: string): void` — looks up its cached pack id (parse the cached yaml header cheaply or store id in the entry — ADD `id: string` to RemotePackEntry, set on save) and `unregisterPack(id)`.
- main.ts panel additions (in the Template packs details panel, below the built-in rows):
  - "Extra packs" subsection: a "Browse official packs…" button → fetches the index → renders rows (title + description + Add button); Add → confirm ONLY IF not from official index — official entries skip confirm → `fetchRemotePackYaml` → `registerRemotePackYaml` → on ok `saveRemotePack({url, id, yaml, ts, enabled: true})` → refresh pickers/panel; status on failure.
  - "Add pack from URL…" button → prompt-like input row (h input + Load button) → `confirm()` native dialog with the plain-risk text: `This pack's templates contain JavaScript that will run in your browser when drawing. Only load packs from sources you trust. Load "<url>"?` → same flow.
  - Loaded remote rows: title/id + Enabled checkbox (toggles entry.enabled + register/unregister from CACHE) + Refresh (re-fetch → re-register → update cache; on fetch failure keep cache, setStatus) + Remove (unregister + deleteRemotePack).
  - Startup: `registerCachedRemotePacksAtStartup()` next to the other registrations (console.warn failures; enabled set untouched on failure — cached registration failures are deterministic, so per M3's ruling dropping WOULD be allowed, but keep-and-warn is chosen for symmetry with the retriable rule; document in code comment).
- The external repo (gh, working dir OUTSIDE drawcast — use the scratchpad):
  ```bash
  cd <scratchpad> && mkdir drawcast-templates && cd drawcast-templates && git init -b main
  # README.md: what this repo is, pack format pointer, how to add a pack (PR), the index.json contract
  # index.json: [{ "id": "showcase", "title": "Showcase", "description": "Two small demo templates — a Venn diagram and a number line.", "url": "https://raw.githubusercontent.com/hmelberg/drawcast-templates/main/packs/showcase.yaml" }]
  # packs/showcase.yaml: pack header + venn_diagram (two overlapping kit.ellipse circles, three exact-position region texts from params sets:{a,b,both}, labels) + number_line (axis with arrowheads, tick marks + numbers from params min/max/step, optional highlight points as accent dots)
  git add -A && git commit -m "showcase pack + index" && gh repo create hmelberg/drawcast-templates --public --source=. --push
  ```
  VALIDATE showcase.yaml BEFORE pushing: copy it temporarily into the drawcast repo test space or write a quick vitest that reads it by absolute path via node fs and runs parsePack + example renders (a permanent test in drawcast CANNOT depend on the network or on a path outside the repo — make it a THROWAWAY validation run, delete after; the permanent remote-packs tests use inline fixture YAML).
- tests/remote-packs.test.ts (all offline; localStorage stub like my-templates tests; fetch stubbed with vi.stubGlobal): store trio round-trip; registerRemotePackYaml happy path with a small inline pack fixture (2-template YAML string) + collision rejection (a fixture whose pack id is "physics" → registerPack refuses? — physics isn't registered in this test file unless registered; instead fixture colliding template id with supply_demand → whole-pack rollback per M3 discipline); registerCachedRemotePacksAtStartup registers enabled-only from cache without any fetch call (assert fetch stub NOT called); fetchRemotePackYaml rejects http:// URLs and >500k payloads (stub fetch responses); fetchOfficialIndex validates shape (good array passes; missing url field throws).

- [ ] Steps: tests → implement module+store → UI wiring → repo creation+push → validate showcase → gate → commit (`feat: remote packs — official index, URL loading with confirm, localStorage cache`).

---

### Task 4: Final verification + push

- [ ] `npx tsc && npx vitest run && npm run build` green; focused suites (packs, remote-packs, catalog-split, author, generate-loop) green.
- [ ] Verify the external repo is live: `gh repo view hmelberg/drawcast-templates --json url` and `curl -sI https://raw.githubusercontent.com/hmelberg/drawcast-templates/main/index.json | head -1` (expect 200; raw CDN may lag a minute — retry once).
- [ ] `git push` (drawcast). Smoke notes: enable Biology → "Draw a DNA double helix"; Browse official packs → add Showcase → "use the venn_diagram template for sets A and B"; add-by-URL path shows the confirm.

---

## Self-Review Notes

- **Spec coverage:** §5 external tier (T3: index, URL+confirm, cache; startup-no-network by constraint); biology pack (T1); §6 authoring-engines carried seam + §5a cache-stability carried seam (T2). The confirm-dialog posture matches the spec's written v1 stance (official = trusted, custom URL = warned).
- **Trust/UX ruling:** official-index packs skip the confirm (they are Hans's own repo — same trust tier as built-ins); custom URLs always confirm. Startup never fetches (cached YAML only) — a compromised CDN can't inject code into an offline-started session that never re-fetched.
- **Type consistency:** RemotePackEntry carries `id` (set at save) so unregister needs no re-parse; registerRemotePackYaml returns registerPack's shape + id; catalogParts/catalogText relationship pinned by test.
- **Placeholder scan:** T1/T3 bodies are specified to the same fidelity as M3/M4 pack tasks (frozen surfaces + authorized iteration); all test intents carry concrete assertions.
- **Known risks:** raw.githubusercontent CDN propagation lag (T4 retries once); native `confirm()` is deliberately chosen over a custom dialog (smallest honest gate; the M2 author dialog pattern exists if a reviewer insists).
