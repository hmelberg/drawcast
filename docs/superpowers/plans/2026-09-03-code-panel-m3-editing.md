# Code panel M3 — editing while paused: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `explore: { code: "<id>" }` opens a code editor for that element; Run executes the viewer's script in the element's runtime through the same facade and re-lays out the panel, its output and any template it feeds, in place; Continue restores the lesson. Movies, embeds and bare players skip the beat like every explore.

**Architecture:** The editor is a section of the existing explore tray (the sliders' home under the control bar), not an overlay on the SVG — one gate, one Continue, no coordinate mapping, and the figure above changes as the viewer runs code. Run calls `runCode` with the element's language and the token paths the resolver used, stamps the envelope on a cloned element list, re-substitutes tokens into the AUTHORED params (the handle now keeps the pre-resolution spec), and previews through a new `Player.previewSpec(patch)` that reaches the reprojector's `frame` with an elements override. Continue settles as the sliders do.

**Tech Stack:** TypeScript, vitest; the facade and runtimes as they are.

**Spec:** `docs/superpowers/specs/2026-09-03-code-panel-screen-editing-design.md` §7 (with the tray-placement deviation recorded in the ledger).

## Global Constraints

- Core edits: types/schema (`explore.code`), `render/plan.ts` (the step carries `code`), `render/player.ts` (`Reprojector.frame` elements override, `previewSpec`), `render/index.ts` (`layoutFor` elements override, `handle.authored`), `ui/tray.ts` (the editor section), `styles.css`, prompt, one example.
- Viewer edits never persist into the document; every path back (Continue, close, Play, scrub) runs `settleParams`.
- No new verbs; `explore` keeps `params`.

---

### Task 1: The verb and the player seam

- `SpecElement`-side: none. `Command.explore` gains `code?: string` (types, schema description: "Id of a code element to open in the editor instead of the sliders — the viewer edits or replaces the script, presses Run, and sees the output and any template it feeds change; Continue restores the lesson").
- `plan.ts`: the explore step carries `code`.
- `player.ts`: `Reprojector.frame(params, visible, offsets, revealNew?, elements?)`; `previewSpec(patch: { elements?: SpecElement[]; params?: Record<string, unknown> })` — like `previewParams`, with `revealNew: true` and `geometryDirty = true`.
- `render/index.ts`: `layoutFor(params, cache, elements?)` lays out `{ ...spec, params: withOverrides(spec.params, params), elements }` uncached when elements are given; the reprojector passes them through; `handle.authored` is the spec as passed to `render` (before resolution) so the tray can re-substitute tokens.
- Tests (`tests/code-panel.test.ts`): the schema accepts `explore: { code }`; the plan step carries it.

### Task 2: The tray's editor

`attachParamsTray` also attaches when the spec has a visible code element. `open({ code })` builds, instead of the sliders: a hint row, a `<textarea class="cs-tray-code">` prefilled with the element's script, a status line, and the actions row with Run and Continue. Run: `runCode({ language, code, paths })` → `previewSpec({ elements: hd.spec.elements with {code, code_result}, params: substituteDataTokens(hd.authored.params, lookup).params })` (params only when a token names the element) → status "ran" or the envelope's error (the panel draws its own error pane). Continue/close/Play: `settleParams()` as today. Styles: the textarea in the mono font, full width, 6–12 rows.

### Task 3: Prompt, example, smoke, ledger, push

- Prompt clause on the code bullet: `{"explore": {"code": "sim"}}` right after the output beat invites the viewer to edit the script and run it (app only; movies skip it).
- Example "Change the rate yourself": Brython, `show: left`, compound growth, tokens into `bar_chart`, an `explore: { code }` beat last.
- Smoke: open the gate, edit the script, Run (Brython and R once each), see the panel and chart update, an error envelope, Continue restoring; the beat skipped with no gate.
