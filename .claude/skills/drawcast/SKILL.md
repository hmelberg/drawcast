---
name: drawcast
description: Author a drawcast locally, the way the app would but with eyes — write the spec to the app's own prompt, render its frames, look, fix, repeat — then open it in the player. Use when Hans asks to make, draw or write a drawcast (or "a figure/cast explaining X") here in Claude Code rather than in the app.
---

# Author a drawcast locally

You write the spec yourself, to the SAME prompt, templates and checks the app
uses (scripts/cast.mjs loads the app's own code), but unlike the app's single
API call you can look at the result and fix it until it is right. In the
prompt lab (docs/prompt-lab on branch prompt-lab) figures made this way
scored higher than API ones, mostly because the look-and-fix step always
landed. The finished cast opens in the app's player.

## Setup (once per session)

- Work in the main checkout (or a worktree if Hans says so). `npm ci` if
  node_modules is missing.
- Dev server, in the background: `npm run dev -- --port 5199 --strictPort`
  (skip if `curl -s localhost:5199` already answers). Frames and the player
  need it.

## The loop

1. **Read the prompt the app would send.**
   `node scripts/cast.mjs prompt "<request>"` writes `dev-casts/_prompt.md`:
   the compiler prompt with the schema, the template index, the few-shots,
   the exemplars picked for this request, and the shortlisted templates in
   full at the end. Read ALL of it the first time in a session — the rules,
   the verbs and the schema are what the renderer understands. For another
   template's parameters: `node scripts/cast.mjs template <id>`.
2. **Plan before writing** (a few lines, for yourself): the question in
   everyday words, the one insight, the concrete example with numbers, the
   figure — one main figure, drawn large, a template when one fits — and the
   beats.
3. **Write the spec** to `dev-casts/<slug>.json` as `{"request": …, "spec": …}`.
4. **Check it:** `node scripts/cast.mjs check dev-casts/<slug>.json`. Fix
   every INVALID and every `[error]`; warnings are for step 5's eyes.
5. **Look at it:** `node scripts/cast.mjs frames dev-casts/<slug>.json` →
   tiles in `dev-casts/frames-<slug>/`, one frame per spoken line (drawn
   mid-gesture where the line highlights, focuses, points or flows), plus the
   browser's lint per frame. VIEW EVERY TILE. Judge as a viewer, with
   `src/llm/prompts/look-v1.md` as the checklist: legibility, one large main
   figure, sync of words and picture, emphasis that lands, calm.
6. **Fix and repeat 4–5** until nothing important is left (usually 2–3
   rounds). Fix causes, not symptoms: a crowded page wants fewer or shorter
   things, not nudged coordinates.
7. **Fresh eyes (for anything that matters):** hand the tiles and
   `look-v1.md` to a subagent that has not seen the spec, and ask for its
   problem list. Fix what is real.
8. **Show it:** `node scripts/cast.mjs open dev-casts/<slug>.json` prints the
   player URL; open it (`open <url>`). Mute when you play it yourself.

## What good looks like (the house taste, short)

- The first spoken line says what question the drawcast answers, while the
  first ink goes down (it may ride the axes); then why it matters.
- One insight; mechanism, not just result; a concrete example with numbers;
  12–17 short sentences for the ear.
- **Words on the canvas are cues:** a word or three ("Survives", "Dies");
  the voice carries the sentence.
- One main figure, drawn large; at most two supporting pieces.
- Something happens while each line is spoken; emphasis only where the
  meaning is; calm, few colours, each one role.
- A closing quiz that checks the insight, not recall.
- Only facts, numbers and people you are sure of.

## When it is done

- Tell Hans the URL and one line on what the figure shows.
- Offer, don't do: adding it to `src/examples.json` (then
  `npx vitest run tests/examples.test.ts` must stay green — examples must lint
  with no warning at all), or saving it elsewhere.
- Anything the engine or a template could not do — a missing option, a bug —
  is worth a line to Hans: it is a fix for the app too.
