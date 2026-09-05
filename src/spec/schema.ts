// The JSON Schema for the drawing spec. It serves three roles at once:
// 1. output constraint for the LLM (structured outputs),
// 2. ajv validation before rendering (Loop 1.1),
// 3. prompt documentation (embedded verbatim in the compiler prompt).
// Keep it flat and free of oneOf/anyOf so structured-output decoding accepts it;
// per-type requirements are enforced by the semantic checks below and fed back
// to the LLM in the repair round.

import AjvModule, { type ValidateFunction } from "ajv";
import type { Command, Spec, SpecElement } from "./types";
import { RESERVED_VARS } from "./answers";
import { C64_PROGRAMS } from "../code/c64-catalogue";
import { LANGUAGES, isLanguage } from "../code/languages";
import { notationBeats } from "./notation";
import { parseABC } from "./abc";
import { DATA_TOKEN_RE, MALFORMED_TOKEN_RE, scanDataTokens } from "../code/tokens";

// ajv ships CJS; depending on the bundler/runtime the class is the module or its .default.
const AjvCtor = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as typeof AjvModule;

export const SPEC_VERSION = "1";

const styleSchema = {
  type: "object",
  description: "Optional visual style overrides.",
  properties: {
    color: { type: "string", description: "Stroke/text color, CSS color string." },
    fill: { type: "string", description: "Fill color for regions/shapes." },
    stroke_width: { type: "number" },
    dash: { type: "boolean", description: "Dashed stroke (guide lines etc.)." },
    roughness: { type: "number", description: "Hand-drawn sketchiness 0 (clean) to 3 (very rough)." },
    opacity: { type: "number" },
  },
  additionalProperties: false,
};

const drawSchema = {
  type: "object",
  description: "How this element animates when drawn.",
  properties: {
    mode: {
      type: "string",
      enum: ["sketch", "instant", "type"],
      description:
        "sketch = progressive handwriting-style drawing; instant = appears at once; type = characters appear at typing speed with a cursor (code lines only — on any other element it draws as sketch).",
    },
    duration: { type: "number", description: "Animation duration in seconds (sketch mode)." },
  },
  additionalProperties: false,
};

const endRefSchema = {
  type: "object",
  description: "Arrow/edge endpoint: set ref to an element id, OR x+y coordinates (domain coordinates if a domain is declared, else logical).",
  properties: {
    ref: { type: "string" },
    x: { type: "number" },
    y: { type: "number" },
  },
  additionalProperties: false,
};

const elementSchema = {
  type: "object",
  description:
    "One diagram element. The `type` decides which other properties apply. " +
    "Tier 2 (preferred): axes, curve, point, arrow, label, region, node, edge — you describe relations, the renderer computes geometry. " +
    "Tier 3 (escape hatch only): path, text, shape with explicit logical coordinates (1000×750, y-up, origin bottom-left).",
  properties: {
    id: { type: "string", description: "Unique id, referenced by commands and other elements." },
    type: {
      type: "string",
      enum: ["axes", "curve", "point", "arrow", "label", "region", "node", "edge", "annotation", "path", "text", "shape", "portrait", "source", "code"],
    },
    // axes
    x_label: { type: "string", description: "axes: horizontal axis label." },
    y_label: { type: "string", description: "axes: vertical axis label." },
    // curve
    direction: { type: "string", enum: ["increasing", "decreasing", "flat", "vertical"], description: "curve: qualitative slope." },
    curvature: { type: "string", enum: ["linear", "convex", "concave"], description: "curve: qualitative curvature." },
    steepness: { type: "string", enum: ["gentle", "medium", "steep"], description: "curve: qualitative steepness." },
    expr: { type: "string", description: "curve: explicit function of x over the domain, e.g. \"100 - 0.5*x\". Use instead of direction/curvature when you know the function." },
    x_from: { type: "number", description: "curve/region: start of the x interval (domain units). Defaults to the whole domain." },
    x_to: { type: "number", description: "curve/region: end of the x interval (domain units)." },
    // point
    at: {
      type: "object",
      description: "point: location, either x+y in domain units, or intersection_of two curve ids.",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        intersection_of: { type: "array", items: { type: "string" }, description: "Two curve ids (your own or a scene template's); the point is their intersection." },
      },
      additionalProperties: false,
    },
    guides: { type: "boolean", description: "point: draw dashed guide lines from the point to both axes." },
    // arrow / edge
    from: endRefSchema,
    to: endRefSchema,
    curved: { type: "boolean", description: "arrow/edge: bow the line slightly." },
    // label
    text: { type: "string", description: "label/text/node: the text content." },
    attach_to: { type: "string", description: "label: id of the element this label belongs to. The renderer places it (collision-avoiding)." },
    side: {
      type: "string",
      enum: ["above", "below", "left", "right", "above-left", "above-right", "below-left", "below-right"],
      description: "label: preferred side relative to the attached element. The collision solver may move it.",
    },
    link: {
      type: "array",
      items: { type: "string" },
      maxItems: 4,
      description:
        "Resource links for this element (a paper, a video, a book) — shown on its info card in the live player; the video export ignores them. Full https URLs, COPIED VERBATIM from the user's request — NEVER invent, guess, or construct a URL (a fabricated DOI or video id looks exactly like a real one). The kind is auto-detected: YouTube plays embedded, Wikipedia shows a summary, .pdf opens a document view, anything else a new tab. On a label, the link also reaches the element it attach_to's.",
    },
    // region
    between: {
      type: "array",
      items: { type: "string" },
      description:
        "region: two curve ids — your own curves OR a scene template's (e.g. demand_curve/supply_curve/ceiling_line in supply_demand, curve_<id> in qaly_profiles); the region is shaded between them (use x_from/x_to to limit; 0–100 axis units when no domain is declared).",
    },
    // annotation
    target: { type: "string", description: "annotation: id of the element to mark (declare the annotation AFTER its target)." },
    kind: {
      type: "string",
      enum: ["box", "circle", "strike", "cross"],
      description:
        "annotation: a PERMANENT mark — box or circle the conclusion, strike or cross out a rejected option. Default: box for text targets, circle otherwise. (Temporary attention = the highlight verb with glow, or point; area emphasis = region shading.)",
    },
    // node / shape
    shape: {
      type: "string",
      enum: ["decision", "chance", "terminal", "rect", "circle", "triangle", "person"],
      description: "node/shape: decision=square, chance=circle, terminal=triangle (health-economics conventions); person = stick figure.",
    },
    // tier-3 raw
    points: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, description: "path: polyline points in logical coordinates (y-up)." },
    closed: { type: "boolean", description: "path: close the polyline." },
    x: { type: "number", description: "text/shape: logical x (y-up canvas)." },
    y: { type: "number", description: "text/shape: logical y (y-up canvas)." },
    width: { type: "number", description: "shape rect / portrait / source / code: width in logical units (a source defaults to 200 for a cover, 260 for a page; a code panel to 880)." },
    height: { type: "number", description: "shape rect: height in logical units." },
    radius: { type: "number", description: "shape circle: radius in logical units." },
    font_size: { type: "number", description: "text: font size in logical units (≥ 14; default 26)." },
    // portrait / source
    of: {
      type: "string",
      description:
        "portrait: the person's name, e.g. \"John Maynard Keynes\" — the app resolves it to their Wikipedia portrait and traces it into sketch strokes, and draws this name as a centered caption with the photo automatically (do NOT add a separate label element for the name). Use a portrait SPARINGLY, only when the person or history genuinely serves the topic; place it small (width ~150-200) off to a side with x/y. NEVER invent an image url; only copy a url the user's request explicitly provided. " +
        "source: the WORK'S TITLE, e.g. \"The Wealth of Nations\" — the PREFERRED reference, because the app verifies it against Wikipedia, so a wrong title fails visibly (a wrong doi/isbn resolves to the wrong work in silence). It is also drawn as the caption under the picture, so never add a label element for it.",
    },
    url: {
      type: "string",
      description:
        "portrait/source: direct image, .pdf, or YOUTUBE url — ONLY when the user's request supplied one (copy it verbatim; never invent). On a source, a YouTube url draws the video's still, framed with a hand-drawn play mark, and clicking it plays the video embedded — use it when the video IS a thing the figure points at, and note that its title becomes the caption automatically.",
    },
    strokes: { type: "string", description: "portrait/source: embedded traced strokes (machine-written; copy VERBATIM if present, never edit or regenerate)." },
    source: { type: "string", description: "portrait/source: provenance/attribution (machine-written; copy verbatim)." },
    doi: {
      type: "string",
      description:
        "source: DOI of a paper, e.g. \"10.48550/arXiv.1706.03762\" — resolved to its open-access PDF. COPY IT from the user's request; NEVER invent or reconstruct a DOI: a wrong-but-real DOI silently shows the wrong paper.",
    },
    isbn: { type: "string", description: "source: ISBN of a book — resolved to its Open Library cover. Copy it from the user's request; never invent one." },
    archive: {
      type: "string",
      description: "source: Internet Archive scan id (the id in an archive.org/details/… URL) — a public-domain scan, any page. Copy it from the user's request; never invent one.",
    },
    page: {
      type: "number",
      description:
        "source: which page to show — the 1-based page of a PDF, or (with archive) the scan's LEAF index, which usually differs from the printed page number by however much front matter the book has. Only meaningful on a doi/pdf/archive source.",
    },
    quote: {
      type: "string",
      description:
        "source: the passage ON that page to sweep with a highlighter, in drawcast's own ink, timed to the narration (draw \"<id>_quote\" as its own beat). Must be VERBATIM text the user supplied or that certainly appears on that page — a paraphrase simply will not highlight. Needs page, and a PDF source (doi or a .pdf url).",
    },
    cameo: {
      type: "boolean",
      description:
        "portrait: cameo presentation — centered, larger and frameless with a fast fade, made to APPEAR on the beat that first names the person and be ERASED a beat or two later. Omit x/y/width in cameo mode unless you need them. Off = the small framed corner fixture.",
    },
    reveal: {
      type: "string",
      enum: ["develop", "iris", "wipe", "drift", "fade"],
      description:
        "portrait/source: how a photo or page enters — and, played backwards by erase, exits. wipe = top-down like a print emerging (the default; omit unless you want another), develop = darkroom blur-to-sharp, iris = circle opening from the center, drift = slightly large settling into place, fade = plain opacity.",
    },
    // code
    language: {
      type: "string",
      enum: [...LANGUAGES],
      description:
        "code: the runtime that executes the script. brython = the light tier (loads in about a second): CPython syntax and standard library, plus pandas, plotly.express, numpy, matplotlib, scipy.stats, statsmodels and seaborn emulations — the default for a script that needs no heavy numerics. python = full CPython via pyodide (real numpy/scipy/matplotlib, PyPI on demand; tens of megabytes). r = R via webR (base or tidyverse; library() auto-installs; every top-level expression prints as at the console; a trailing data frame draws as a table, a base plot or a printed ggplot as a figure). micropython = the minimal tier (half a megabyte, boots in milliseconds; pandas and plotly.express emulations, a partial standard library) — only when the request asks for it. basic = Commodore 64 BASIC V2, drawcast's own small interpreter: PRINT, variables, GOTO/GOSUB, IF/THEN, FOR/NEXT, POKE/PEEK to the screen, colour RAM, border (53280) and background (53281); the run leaves a 40 × 25 C64 screen that is DRAWN on the panel — pair it with frame: \"c64\". No arrays, DATA, INPUT, SYS or sound in this first cut.",
    },
    code: {
      type: "string",
      description:
        "code: the script, one newline-separated string. It EXECUTES for real in the viewer's browser at figure-preparation time, so keep it short (≤ ~14 lines), deterministic (SEED any randomness), print() exactly the numbers the narration mentions, and end with at most ONE plot — matplotlib, or plotly express left in a variable (fig = px.bar(...)); packages auto-install (numpy/pandas/matplotlib ship with the runtime; pure-Python PyPI packages like plotly install on demand). Each line becomes a drawable `<id>_line_1` … `<id>_line_N` and the whole output panel is `<id>_out` — reveal lines with draw on their own narration beats, then draw the output. A script can also FEED a template: any params value written as \"{<this id>.<variable>}\" is replaced by that variable after the run (lists, numbers, dicts, a DataFrame as {columns, rows}); with show: \"none\" the element draws nothing and only supplies data.",
    },
    show: {
      type: "string",
      enum: ["output", "left", "right", "above", "below", "code", "none"],
      description:
        "code: where the CODE sits relative to its output — output (just the result; the default), left / right (code pane on that side, 55 % of the width; give the element width ≥ 700), above / below (code pane stacked over or under the output at full width — pair with lines on a long script), code (the script alone), none (draws NOTHING — the script only feeds template params through \"{id.var}\" tokens).",
    },
    lines: {
      type: "number",
      description:
        "code: show the script through a window this many lines tall (≥ 3); stepping past the window scrolls it, as an editor does. Use with above/below, or whenever a script runs long.",
    },
    frame: {
      type: "string",
      enum: ["panel", "window", "screen", "laptop", "crt", "c64", "none"],
      description:
        "code: chrome drawn around the panel — none (bare paper, no frame at all; THE DEFAULT), screen (the code and its output on a computer display: one rounded shell with a chin, no stand), crt (an old tube monitor: chunky shell, bulging glass, little buttons on the chin, on a short foot), c64 (that tube monitor standing on a home-computer keyboard, the 1982 desk), laptop (the flat display over a keyboard), window (a title bar with three dots), panel (just a light frame). Ask for the screen when the story is that this happened on a computer, and pair it with draw: {mode: \"type\"} so the code is typed onto it.",
    },
    figures: {
      type: "number",
      description:
        "code: how many separate figures the script produces (2 or more; omit for none or one). Each plt.figure() stage becomes its own drawable `<id>_fig_1` … `<id>_fig_K`, ALL SHARING ONE FRAME — drawing the next replaces the previous, so a parameter change or a chart built stage by stage plays as narrated beats. Keep xlim/ylim FIXED across stages so the swap reads as the chart itself changing.",
    },
    chart: {
      type: "string",
      enum: ["seaborn", "xkcd", "plain"],
      description:
        "code: how a matplotlib chart LOOKS — seaborn (THE DEFAULT: a calm grid, the figure's own ink and series colours on the drawing's paper), xkcd (matplotlib's hand-drawn wobble, which suits a sketched lecture), plain (matplotlib's own defaults). Only `language: \"python\"` has a real matplotlib to style; the light tiers draw their charts through an emulation and ignore it.",
    },
    game: {
      type: "string",
      description:
        `code: a Commodore 64 program on the machine — pair it with frame: "c64" (or "crt"). Write a KEY from drawcast's own catalogue — ${C64_PROGRAMS.map((p) => `${p.key} (${p.note})`).join("; ")} — or an https URL to a .prg/.d64/.t64 ONLY when the user's request supplied one; never invent a URL. The screen shows the machine's blue boot screen with a play mark on it; while the app is paused a click on the mark starts the program in a real C64 emulator over the figure, sound and joystick included, and the ⊕ tray lets the viewer pick another program from the same catalogue. App only: a movie shows the drawn screen.`,
    },
    marks: {
      type: "array",
      items: {
        oneOf: [
          { type: "string" },
          {
            type: "object",
            properties: {
              text: { type: "string" },
              kind: { type: "string", enum: ["mark", "strike", "underline"] },
            },
            required: ["text"],
            additionalProperties: false,
          },
        ],
      },
      description:
        "code: pen passes over the script, each its OWN beat `<id>_mark_1`, `<id>_mark_2`, … drawn in the order written — so a line of narration can say \"and this is where the seed goes in\" while the marker travels across exactly that phrase. Each item is a VERBATIM piece of a drawn line: a whole line, or just the part you are talking about (`\"rng.default_rng(7)\"`). A plain string is the yellow highlighter; `{\"text\": \"...\", \"kind\": \"strike\"}` crosses it out and `\"underline\"` underlines it. The text must sit on ONE line as one piece (a wrapped line is two rows on screen); the first occurrence wins, so write more of the line when a short phrase repeats. Draw them like any other id: {\"draw\": [\"sim_mark_1\"], \"speak\": \"…\"} — and erase to take the pen off again.",
    },
    code_result: {
      type: "string",
      description: "code: machine-written execution result (copy VERBATIM if present; never write, edit, or invent it).",
    },
    style: styleSchema,
    draw: drawSchema,
  },
  required: ["id", "type"],
  additionalProperties: false,
};

const idListSchema = (description: string) => ({
  type: "array",
  items: { type: "string" },
  description,
});

const commandSchema = {
  type: "object",
  description:
    "One playback command: ONE action verb (draw / pause / wait / quiz / ask / label / if / explore / show / hide / erase / clear / highlight / point / move / camera / animate), optionally WITH speak to narrate it — voice and action start together and the command ends when BOTH finish. Or speak alone (a rare standalone line, e.g. the closing synthesis). " +
    "Commands run strictly in sequence; each completes before the next begins (except a standalone speak with blocking:false).",
  properties: {
    speak: {
      type: "string",
      description:
        "Narration sentence, spoken aloud and shown as a caption. Alongside an action verb it narrates that action simultaneously (the preferred style: {\"draw\": [\"supply\"], \"speak\": \"This is the supply curve.\"}). Alone, it is a standalone narration line.",
    },
    blocking: {
      type: "boolean",
      description: "With speak: false starts the narration and immediately continues to the next command — use it to talk while pointing, highlighting, or drawing.",
    },
    voice: {
      type: "string",
      enum: ["a", "b"],
      description: 'With speak in a dialogue: which speaker reads this line — "a" (the lead/teacher, the default) or "b" (the second voice).',
    },
    delivery: {
      type: "string",
      enum: ["soft", "grave", "brisk"],
      description:
        "With speak: named delivery nudge — soft = confiding lean-in (slightly slower, lower, quieter); grave = slow and weighty for the key reveal; brisk = lightly quicker for recaps. Mark only the few lines where the meaning warrants it.",
    },
    draw: idListSchema("Element ids to draw. Listed elements animate one after another unless parallel is true."),
    parallel: { type: "boolean", description: "With draw/erase: animate the listed elements simultaneously." },
    pause: { type: "number", description: "Pause for this many seconds." },
    wait: {
      type: "string",
      enum: ["click"],
      description: "Wait until the viewer clicks before continuing — a reveal gate ('study this… now click') or an act boundary. Auto-resolved in video export.",
    },
    quiz: {
      type: "object",
      description:
        "Pose a multiple-choice question. The question is spoken and captioned; in the app the viewer answers on buttons (required: true means it cannot be skipped); in video export it auto-reveals after a beat and never waits. correct is 1-BASED.",
      properties: {
        question: { type: "string", description: "The question, spoken aloud and shown as the caption." },
        intro: {
          type: "string",
          description:
            "Optional spoken introduction ('Time for a quick check!'), prepended to the question line. Introduce a quiz HERE, never in a separate speak command — viewers can skip questions, and a skipped question must take its introduction with it.",
        },
        choices: { type: "array", items: { type: "string" }, description: "2-4 short answer options, a few words each." },
        correct: { type: "number", description: "1-based index of the correct choice." },
        right: {
          type: "string",
          description:
            "One sentence stating the answer and the reason. Spoken on a correct answer, AND as the reveal after a wrong answer or in a movie — so no praise words ('The price rises — more buyers compete'), never ('Exactly!').",
        },
        wrong: { type: "string", description: "Spoken on a wrong answer, before the correct one is revealed. One sentence." },
        required: { type: "boolean", description: "App only: the question cannot be skipped without answering. Movies never wait." },
        right_goto: { type: "string", description: "Jump to this label on a correct VIEWER answer. Movies always play straight through." },
        wrong_goto: { type: "string", description: "Jump to this label on a wrong VIEWER answer — typically back to the explanation, so the viewer re-watches and the question comes again. Movies always play straight through." },
      },
      required: ["question", "choices", "correct"],
      additionalProperties: false,
    },
    if: {
      type: "object",
      description:
        "Conditional jump on a STORED ask answer: exactly one comparison (numeric gt/lt/gte/lte or string eq/ne) and a goto label. Fires only for live viewers — movies and skip-questions playback fall straight through. A backward jump must cross a quiz/ask so every loop has a human gate.",
      properties: {
        var: { type: "string", description: "An earlier ask's store name." },
        gt: { type: "number" },
        lt: { type: "number" },
        gte: { type: "number" },
        lte: { type: "number" },
        eq: { type: "string", description: "Equal (trimmed, case-insensitive)." },
        ne: { type: "string", description: "Not equal (trimmed, case-insensitive)." },
        goto: { type: "string", description: "Label to jump to when the comparison holds." },
      },
      required: ["var", "goto"],
      additionalProperties: false,
    },
    explore: {
      type: "object",
      description:
        "Open the explore tray (the \u2295 sliders) and wait for the viewer to press Continue \u2014 the authored 'now try numbers yourself' moment, placed right after a personalized reveal. params restricts which sliders show; code opens a code editor instead. App only: movies and skip-questions playback drop the whole beat, its narration included, so never put content the movie needs in its speak.",
      properties: {
        params: { type: "array", items: { type: "string" }, description: "Slider param paths to show (default: all)." },
        code: {
          type: "string",
          description:
            "Id of a code element to open in the editor instead of the sliders: the viewer edits or replaces the script, presses Run, and sees the output pane and any template it feeds change; Continue restores the lesson. Place it right after the output beat.",
        },
        game: {
          type: "string",
          description:
            "Id of a code element that carries a `game`: the beat that hands the viewer the joystick — the emulator opens over the figure and the lesson waits until they close it. App only; movies skip the beat.",
        },
      },
      additionalProperties: false,
    },
    label: {
      type: "string",
      description: "A named position in the storyboard (snake_case), the target of quiz/ask right_goto/wrong_goto. Zero duration.",
    },
    ask: {
      type: "object",
      description:
        "Pose a question answered by TYPING. Check mode (answer set): the typed reply is judged, with optional retry and reveal. Collect mode (store set): the reply is saved and later speak lines may use {store_name} — e.g. 'Nice to meet you, {name}'. At least one of answer/store is required; default is REQUIRED with store (the movie types it). In video export the card types its answer by itself and never waits.",
      properties: {
        question: { type: "string", description: "The question, spoken aloud and shown as the caption." },
        intro: {
          type: "string",
          description:
            "Optional spoken introduction, prepended to the question line. Introduce an ask HERE, never in a separate speak command — viewers can skip questions, and a skipped question must take its introduction with it.",
        },
        answer: { type: "string", description: "Check mode: the correct answer. Compared trimmed and case-insensitively." },
        right: {
          type: "string",
          description: "One sentence stating the answer and the reason — spoken on a correct answer and as the reveal; no praise words.",
        },
        wrong: { type: "string", description: "Spoken on a wrong attempt. One sentence. Check mode only." },
        reveal: { type: "boolean", description: "Check mode: speak the correct answer after a final wrong attempt (default true)." },
        retry: { type: "boolean", description: "Check mode: clear the field and ask again after a wrong attempt (default false). App only." },
        store: { type: "string", description: "Save the typed reply under this snake_case name; use {name} in later speak lines." },
        default: { type: "string", description: "Stand-in the movie types and skip/silent use. REQUIRED with store." },
        required: { type: "boolean", description: "App only: cannot be skipped without answering. Movies never wait." },
        widget: {
          type: "string",
          enum: ["click", "piano", "chess", "code"],
          description:
            "Answer device instead of typing: click = click the named element on the figure (answer = its id); piano = press a key on the drawn keyboard (answer = the note, e.g. C4); chess = click two squares (answer = the move, e.g. e2e4); code = WRITE A SCRIPT on a code panel (implied by `code`, so you rarely write this one). Requires answer. In movies the laser pointer demonstrates.",
        },
        code: {
          type: "string",
          description:
            "Ask the viewer to WRITE CODE: the id of a code element they type into — normally an empty or stubbed panel (`code: \"\"` or one comment line, `show: \"left\"`, `frame: \"screen\"`) drawn on an earlier beat. The panel's own editor opens on it, the viewer runs their script and presses Check, and what `expect` reads is compared with `answer`. Everything else about an ask still applies: right/wrong lines, retry, required, store, right_goto/wrong_goto. Movies and embeds skip the question, so the `right` line must state the answer for a viewer who never types.",
        },
        expect: {
          type: "string",
          description:
            "With `code`: what the viewer's run has to say — \"stdout\" (what it printed; THE DEFAULT — pair it with a question that says what to print), \"figure\" (answer \"1\" when the script must draw a plot), or a VARIABLE the script leaves behind (\"total\", \"df.mean\" for a DataFrame column's mean — the same paths the {id.var} data bridge harvests). Numbers compare as numbers, so 45, 45.0 and 4.5e1 are one answer — but ask for a value the script can hit exactly (an integer, or a rounded number the question names).",
        },
        right_goto: { type: "string", description: "Jump to this label on a correct VIEWER answer. Movies always play straight through." },
        wrong_goto: { type: "string", description: "Jump to this label on a wrong VIEWER answer — typically back to the explanation, so the viewer re-watches and the question comes again. Movies always play straight through." },
      },
      required: ["question"],
      additionalProperties: false,
    },
    show: idListSchema("Element ids to make visible instantly (inverse of hide; no animation)."),
    hide: idListSchema("Element ids to make invisible instantly. Hidden elements still exist and can be shown again."),
    erase: idListSchema("Element ids to remove with a reverse hand-drawn (un-sketch) animation, then keep hidden."),
    clear: {
      type: "object",
      description: "Hide everything currently visible. Use {} to clear all, or keep to leave some ids on screen.",
      properties: {
        keep: idListSchema("Ids to leave visible (e.g. the axes)."),
      },
      additionalProperties: false,
    },
    highlight: {
      type: "object",
      description:
        "Temporarily emphasize visible elements, then return to normal. With a paired speak and no duration, the effect PULSES FOR AS LONG AS THE SENTENCE — the way to talk about one specific element (a curve, an equilibrium) while it glows.",
      properties: {
        target: idListSchema("Element ids to emphasize."),
        effect: { type: "string", enum: ["pulse", "circle", "glow"], description: "pulse = throb (default); circle = hand-drawn ring around them; glow = soft halo (red unless color is set)." },
        duration: { type: "number", description: "Seconds. Omit with a paired speak to let the effect last the whole sentence (default 1.5 otherwise)." },
        color: { type: "string", description: "Emphasis color, CSS color string." },
      },
      required: ["target"],
      additionalProperties: false,
    },
    focus: {
      type: "object",
      description:
        "The inverse spotlight: dim every OTHER visible element while the targets stay at full strength — the way a hand on a whiteboard says 'ignore the rest'. With a paired speak and no duration, the focus HOLDS FOR THE WHOLE SENTENCE. Use it to walk a dense figure region by region.",
      properties: {
        target: idListSchema("Element ids that stay lit; everything else dims."),
        duration: { type: "number", description: "Seconds. Omit with a paired speak to hold for the sentence (default 2 otherwise)." },
      },
      required: ["target"],
      additionalProperties: false,
    },
    point: {
      type: "object",
      description: "A laser pointer travels to the target and gestures at it, then disappears. Combine with speak blocking:false to talk while pointing.",
      properties: {
        at: endRefSchema,
        gesture: { type: "string", enum: ["tap", "circle", "underline"], description: "tap = dip at the spot (default); circle = trace a ring around it; underline = sweep beneath it." },
        duration: { type: "number", description: "Seconds (default 2)." },
      },
      required: ["at"],
      additionalProperties: false,
    },
    move: {
      type: "object",
      description:
        "Translate elements by a delta or along a path of offsets. Moves ONLY the listed elements — attached labels, intersection points, or regions do NOT follow; move them explicitly or redraw derived elements.",
      properties: {
        target: idListSchema("Element ids to move together."),
        by: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "[dx, dy] delta — domain units when a domain is declared, else logical units." },
        path: {
          type: "array",
          items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
          description: "Waypoint offsets from the element's starting position (same units as by); the last waypoint is the final offset. Use instead of by for curved or multi-leg motion.",
        },
        duration: { type: "number", description: "Seconds (default 1)." },
        easing: { type: "string", enum: ["linear", "ease-in", "ease-out", "ease-in-out"], description: "Velocity profile (default ease-in-out)." },
      },
      required: ["target"],
      additionalProperties: false,
    },
    camera: {
      type: "object",
      description: "Zoom/pan the view. Set reset:true to return to the full canvas.",
      properties: {
        center: endRefSchema,
        zoom: { type: "number", description: "Magnification: 1 = whole canvas, 2 = 2× (default 2 when centering)." },
        reset: { type: "boolean", description: "Return to the full canvas." },
        duration: { type: "number", description: "Seconds (default 1.2)." },
      },
      additionalProperties: false,
    },
    animate: {
      type: "object",
      additionalProperties: true,
      description:
        "Smoothly animate NUMERIC template params to these target values while the paired speak lands. Keys are dot paths into params (e.g. {\"demand_shift.amount\": 25} or {\"azimuth\": 240}); the whole figure re-computes every frame, so intersections, guides, and regions move honestly. Always write the STARTING value explicitly in params (e.g. demand_shift: {amount: 0}). Only for template specs. A data template's stage param is the canonical target ({\"stage\": 1}); array entries address as values.2.",
    },
    duration: { type: "number", description: "With animate: seconds the animation takes (default 2)." },
    easing: {
      type: "string",
      enum: ["linear", "ease-in", "ease-out", "ease-in-out"],
      description: "With animate: velocity profile over the whole tween (default: today's smoothstep). A long race (many seconds) reads better as \"linear\" — constant speed — than the default's ease in/out, which blurs the middle and crawls at the ends.",
    },
    play: {
      description:
        'Play synthesized notes while the paired speak lands (or on their own). Either ONE notation string — space-separated notes "C4:q E4:q G4:h" (pitch letter + optional #/b + octave 1-7, duration w/h/q/e/s = 4/2/1/½/¼ beats, chords joined with + as in C4+E4+G4:h, R for a rest) — up to four parallel voices [{"notes": "...", "instrument": "piano"}] that start together (melody over bass) — or a whole tune as {"abc": "K:C\\nC D E F|…"} in ABC notation. ONLY for figures genuinely about sound or music.',
      oneOf: [
        { type: "string" },
        {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              notes: { type: "string", description: "Notation string for this voice." },
              instrument: { type: "string", enum: ["tone", "piano", "organ", "pluck", "bell"] },
            },
            required: ["notes"],
            additionalProperties: false,
          },
        },
        {
          type: "object",
          properties: {
            abc: {
              type: "string",
              description: "A whole tune in ABC notation (K:/M:/L:/Q: headers, then the music; V: voices become parallel channels). Tempo comes from Q: unless the command sets tempo.",
            },
          },
          required: ["abc"],
          additionalProperties: false,
        },
      ],
    },
    tempo: { type: "number", description: "With play: beats per minute, 30-300 (default 100)." },
    instrument: {
      type: "string",
      enum: ["tone", "piano", "organ", "pluck", "bell"],
      description: "With play: the synthesized instrument (default tone; array voices can override per voice).",
    },
    reveal: idListSchema(
      "With play: element ids revealed IN TIME with the notes and KEPT — id k appears exactly when the k-th sounding note of the first voice starts and stays visible (staff notes accumulating as the tune plays).",
    ),
    press: idListSchema(
      "With play: element ids PRESSED in time with the notes — id k appears when the k-th sounding note starts and DISAPPEARS when it ends, like a piano key going down and back up. Combine with reveal (e.g. reveal staff notes, press piano keys).",
    ),
  },
  additionalProperties: false,
};

export const specSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "ConceptSketchSpec",
  type: "object",
  description:
    "A drawing spec. Coordinate world: logical canvas 1000×750, Cartesian, y-up, origin bottom-left. " +
    "Prefer a scene template (set template+params, see the scene catalog). Otherwise compose tier-2 elements. " +
    "Commands interleave narration (speak) with drawing (draw) for a gradually built, narrated figure.",
  properties: {
    title: { type: "string", description: "Short title of the figure." },
    zoom_from: {
      type: "string",
      description:
        "Playlist items only: the semantic-zoom entrance. Before this item begins, the PREVIOUS figure zooms into this element id (an id of the PREVIOUS item's scene) and fades there — so the new figure feels like the inside of the old one (heart → cell, bins → bell curve). Replaces the chapter card at that junction.",
    },
    level: { type: "string", enum: ["basic", "advanced"], description: "Difficulty of the explanation, when the request states one. Shown as a badge; omit if unspecified." },
    voice: {
      type: "string",
      enum: ["male", "female"],
      description: 'Narrator voice. Usually stamped from the #male/#female tags — omit unless the request states it. In dialogue this is speaker "a"; speaker "b" gets the contrasting voice.',
    },
    template: { type: "string", description: "Scene template name from the catalog. Omit when composing elements directly." },
    params: {
      type: "object",
      description:
        'Scene template parameters, per the catalog\'s parameter schema. A value may be a "{codeId.variable}" token naming a code element\'s script variable (or "{codeId.df.column}" for a DataFrame column) — the app substitutes the harvested value before drawing.',
      additionalProperties: true,
    },
    domain: {
      type: "object",
      description: "Domain coordinate ranges for quantitative diagrams, e.g. {\"x\": [0, 1000], \"y\": [0, 50]} for quantity/price. Curve exprs and point coordinates are in these units.",
      properties: {
        x: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
        y: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
      },
      additionalProperties: false,
    },
    elements: { type: "array", items: elementSchema, description: "Tier-2/3 elements (also allowed alongside a template, for annotations)." },
    commands: {
      type: "array",
      items: commandSchema,
      description:
        "The playback sequence: narration (speak), drawing (draw/pause), and gesture verbs (highlight/point/move/show/hide/erase/clear/camera/animate). " +
        "Elements not mentioned in any draw/show/hide/erase command are drawn at the end automatically.",
    },
  },
  required: ["commands"],
  additionalProperties: false,
} as const;

/**
 * What a SAVED document may carry beyond what the model writes.
 *
 * specSchema above is the authoring contract — it goes to the API as the
 * structured-output constraint (apiSchema in llm/compile.ts), and its
 * `additionalProperties: false` is what makes it one. These fields are stamped
 * afterwards by tooling: the translator writes `lang` and `text_map`, the
 * subtitle authoring writes `subtitles`. The model is never asked for them.
 *
 * They were in the Spec type and in nothing else, so validateSpec — which
 * validates against the authoring schema — refused every document that carried
 * one. A translated drawcast could not be reopened in the app ("Spec invalid:
 * (root) must NOT have additional properties") and the standalone viewer threw
 * it out. Hence two schemas: the model sees the narrower one, the validator
 * uses this.
 */
/** The global text block: CSS names, CSS keyword values (layout/text-style.ts). */
const TEXT_FIELDS = {
  text: {
    type: "object",
    description: "Global text defaults. font_size: base size in logical units (default 26; every size scales by it). font_family: cursive (handwriting, the default) | sans-serif | monospace. font_weight: normal | bold.",
    properties: {
      font_size: { type: "number", minimum: 16, maximum: 48 },
      font_family: { type: "string", enum: ["cursive", "sans-serif", "monospace"] },
      font_weight: { type: "string", enum: ["normal", "bold"] },
    },
    additionalProperties: false,
  },
} as const;

const TRANSLATION_FIELDS = {
  lang: {
    type: "string",
    description: 'BCP-47 primary tag for the language the text is written in ("en", "nb"). Picks the narrator voice.',
  },
  text_map: {
    type: "object",
    description: "Drawn text a scene template computes for itself, and its replacement. Applied during layout.",
    additionalProperties: { type: "string" },
  },
  subtitles: {
    type: "object",
    description: "Subtitle tracks: language code → (source caption line → translated line). What the CC menu offers.",
    additionalProperties: { type: "object", additionalProperties: { type: "string" } },
  },
} as const;

/** The authoring schema plus the fields tooling stamps. What validateSpec checks. */
export const documentSchema = {
  ...specSchema,
  properties: { ...specSchema.properties, ...TRANSLATION_FIELDS, ...TEXT_FIELDS },
} as const;

const ajv = new AjvCtor({ allErrors: true, strict: false });
let structural: ValidateFunction | null = null;

/**
 * The wire schema keeps id lists as arrays (structured-output-friendly), but the
 * brief's spec examples also allow a bare string. Normalize before validating.
 */
export function normalizeSpec(spec: unknown): unknown {
  if (typeof spec !== "object" || spec === null) return spec;
  const clone = JSON.parse(JSON.stringify(spec)) as { commands?: Command[]; elements?: SpecElement[] };
  const toList = (v: string[] | string | undefined): string[] | undefined => (typeof v === "string" ? [v] : v);
  // Malformed input flows through here before validation — guard shapes.
  for (const el of Array.isArray(clone.elements) ? clone.elements : []) {
    if (el && typeof el === "object" && el.link !== undefined) el.link = toList(el.link);
  }
  for (const cmd of clone.commands ?? []) {
    if (!cmd) continue;
    // YAML-friendly spelling: `pause: click` means the wait verb.
    if ((cmd.pause as unknown) === "click") {
      delete cmd.pause;
      cmd.wait = "click";
    }
    if (cmd.draw !== undefined) cmd.draw = toList(cmd.draw);
    if (cmd.show !== undefined) cmd.show = toList(cmd.show);
    if (cmd.hide !== undefined) cmd.hide = toList(cmd.hide);
    if (cmd.erase !== undefined) cmd.erase = toList(cmd.erase);
    if (cmd.clear?.keep !== undefined) cmd.clear.keep = toList(cmd.clear.keep);
    if (cmd.highlight) cmd.highlight.target = toList(cmd.highlight.target)!;
    if (cmd.focus) cmd.focus.target = toList(cmd.focus.target)!;
    if (cmd.move) cmd.move.target = toList(cmd.move.target)!;
    if (cmd.press !== undefined) cmd.press = toList(cmd.press);
    if (cmd.reveal !== undefined) cmd.reveal = toList(cmd.reveal);
  }
  return clone;
}

function structuralErrors(spec: unknown): string[] {
  structural ??= ajv.compile(documentSchema as object);
  if (structural(spec)) return [];
  return (structural.errors ?? []).map(
    (e) => `${e.instancePath || "(root)"} ${e.message ?? "invalid"}${e.params ? " " + JSON.stringify(e.params) : ""}`,
  );
}

/**
 * The one valid nothing: ＋ New drawcast's blank page (Hans 2026-09-02 —
 * "when I click new, start with an empty spec"). EDITOR gates accept it
 * (ui/save-gate.ts); the generation pipeline never does — a model returning
 * an empty spec is a failed generation that must trigger a repair round,
 * not silently ship a blank drawcast.
 */
export function isBlankSpec(spec: Spec): boolean {
  return !spec.template && (spec.elements?.length ?? 0) === 0 && (spec.commands?.length ?? 0) === 0;
}

function semanticErrors(spec: Spec): string[] {
  const errors: string[] = [];

  if (!spec.template && !(spec.elements && spec.elements.length > 0)) {
    errors.push("spec has neither a template nor any elements — nothing to draw");
  }

  const ACTION_VERBS = ["draw", "pause", "wait", "quiz", "ask", "label", "if", "explore", "show", "hide", "erase", "clear", "highlight", "focus", "point", "move", "camera", "animate", "play"] as const;
  // Labels first (gotos may point forward): collect + check duplicates/names.
  const labels = new Set<string>();
  for (const [i, cmd] of (spec.commands ?? []).entries()) {
    if (cmd.label === undefined) continue;
    if (typeof cmd.label !== "string" || !/^[a-z][a-z0-9_]*$/i.test(cmd.label)) {
      errors.push(`commands[${i}]: label must be a simple snake_case name`);
    } else if (labels.has(cmd.label)) {
      errors.push(`commands[${i}]: duplicate label "${cmd.label}"`);
    } else {
      labels.add(cmd.label);
    }
  }
  /** Stores seen so far in command order — animate var tokens must reference an EARLIER ask. */
  const storedVars = new Set<string>();
  const checkGoto = (i: number, verb: string, field: string, target: string | undefined): void => {
    if (target === undefined) return;
    if (!labels.has(target)) errors.push(`commands[${i}]: ${verb}.${field} targets unknown label "${target}"`);
  };
  // if commands: one comparison, a known target, and — for backward jumps —
  // a question between target and if, so every loop has a human gate.
  const labelIndex = new Map<string, number>();
  for (const [i, cmd] of (spec.commands ?? []).entries()) {
    if (typeof cmd.label === "string") labelIndex.set(cmd.label, i);
  }
  for (const [i, cmd] of (spec.commands ?? []).entries()) {
    if (cmd.if === undefined) continue;
    const f = cmd.if;
    const comparisons = [f.gt, f.lt, f.gte, f.lte, f.eq, f.ne].filter((v) => v !== undefined).length;
    if (comparisons !== 1) errors.push(`commands[${i}]: if needs exactly ONE comparison of gt/lt/gte/lte/eq/ne (got ${comparisons})`);
    if (typeof f.var !== "string" || !/^[a-z][a-z0-9_]*$/i.test(f.var)) errors.push(`commands[${i}]: if.var must be a simple store name`);
    checkGoto(i, "if", "goto", f.goto);
    const target = labelIndex.get(f.goto);
    if (target !== undefined && target < i) {
      const cmds = spec.commands ?? [];
      let gated = false;
      for (let k = target + 1; k < i; k++) {
        if ((cmds[k] as Command).quiz !== undefined || (cmds[k] as Command).ask !== undefined) gated = true;
      }
      if (!gated) errors.push(`commands[${i}]: a backward if-jump to "${f.goto}" must cross a quiz/ask — otherwise the loop has no human gate`);
    }
  }
  for (const [i, cmd] of (spec.commands ?? []).entries()) {
    const actions = ACTION_VERBS.filter((k) => (cmd as Command)[k] !== undefined);
    // One action verb per command; speak may stand alone OR accompany the
    // action (voice and animation then start together and both must finish).
    if (actions.length > 1) {
      errors.push(`commands[${i}] must set at most one action verb of ${ACTION_VERBS.join("/")} (got: ${actions.join(", ")})`);
      continue;
    }
    if (actions.length === 0 && cmd.speak === undefined) {
      errors.push(`commands[${i}] must set a verb: speak, or one of ${ACTION_VERBS.join("/")}`);
      continue;
    }
    const verb: string = actions.length > 0 ? actions[0] : "speak";
    if (cmd.blocking !== undefined && (verb !== "speak" || cmd.speak === undefined)) {
      errors.push(`commands[${i}]: blocking only applies to a standalone speak (a speak paired with an action always joins both)`);
    }
    if ((cmd.voice !== undefined || cmd.delivery !== undefined) && cmd.speak === undefined) {
      errors.push(`commands[${i}]: voice and delivery only apply to a command with speak`);
    }
    if (cmd.parallel !== undefined && verb !== "draw" && verb !== "erase") errors.push(`commands[${i}]: parallel only applies to draw/erase`);
    if (verb === "move" && !cmd.move!.by && !(cmd.move!.path && cmd.move!.path.length > 0)) {
      errors.push(`commands[${i}]: move needs by ([dx, dy]) or a non-empty path`);
    }
    if (verb === "point") {
      const at = cmd.point!.at;
      if (!at || (at.ref === undefined && (at.x === undefined || at.y === undefined))) {
        errors.push(`commands[${i}]: point.at needs ref (an element id) or x+y coordinates`);
      }
    }
    if (verb === "camera" && !cmd.camera!.reset && cmd.camera!.center === undefined && cmd.camera!.zoom === undefined) {
      errors.push(`commands[${i}]: camera needs center, zoom, or reset:true`);
    }
    if (verb === "animate") {
      const entries = Object.entries(cmd.animate!);
      if (entries.length === 0) errors.push(`commands[${i}]: animate needs at least one param target`);
      for (const [k, v] of entries) {
        if (typeof v === "string" && /^\{[a-z][a-z0-9_]*\}$/i.test(v)) {
          const name = v.slice(1, -1).toLowerCase();
          if (!storedVars.has(name)) {
            errors.push(`commands[${i}]: animate "${k}" references {${name}} but no earlier ask stores it (the movie's fallback comes from that ask's default)`);
          }
        } else if (typeof v !== "number" || !Number.isFinite(v)) {
          errors.push(`commands[${i}]: animate "${k}" must be a finite number or a "{var}" token`);
        }
      }
    }
    if (cmd.duration !== undefined && verb !== "animate") {
      errors.push(`commands[${i}]: duration only applies to animate (other verbs carry their own duration fields)`);
    }
    if (cmd.easing !== undefined && verb !== "animate") {
      errors.push(`commands[${i}]: easing only applies to animate (move carries its own nested easing field)`);
    }
    if ((cmd.tempo !== undefined || cmd.instrument !== undefined || cmd.press !== undefined || cmd.reveal !== undefined) && verb !== "play") {
      errors.push(`commands[${i}]: tempo, instrument, press and reveal only apply to a play command`);
    }
    if (verb === "quiz" && cmd.quiz) {
      const a = cmd.quiz;
      if (typeof a.question !== "string" || a.question.trim().length === 0) {
        errors.push(`commands[${i}]: quiz.question must be a non-empty string`);
      }
      if (!Array.isArray(a.choices) || a.choices.length < 2 || a.choices.length > 4 || a.choices.some((c) => typeof c !== "string" || c.trim().length === 0)) {
        errors.push(`commands[${i}]: quiz.choices must be 2-4 non-empty strings`);
      } else if (!Number.isInteger(a.correct) || a.correct < 1 || a.correct > a.choices.length) {
        errors.push(`commands[${i}]: quiz.correct must be a 1-based index into choices (1..${a.choices.length})`);
      }
      checkGoto(i, "quiz", "right_goto", a.right_goto);
      checkGoto(i, "quiz", "wrong_goto", a.wrong_goto);
    }
    if (verb === "ask" && cmd.ask) {
      const a = cmd.ask;
      if (typeof a.question !== "string" || a.question.trim().length === 0) {
        errors.push(`commands[${i}]: ask.question must be a non-empty string`);
      }
      if (a.answer === undefined && a.store === undefined) {
        errors.push(`commands[${i}]: ask needs answer (check mode), store (collect mode), or both`);
      }
      if (a.answer !== undefined && (typeof a.answer !== "string" || a.answer.trim().length === 0)) {
        errors.push(`commands[${i}]: ask.answer must be a non-empty string`);
      }
      if (a.store !== undefined && !/^[a-z][a-z0-9_]*$/i.test(a.store)) {
        errors.push(`commands[${i}]: ask.store must be a simple name (letters, digits, underscores; starts with a letter)`);
      }
      if (a.store !== undefined && (RESERVED_VARS as readonly string[]).includes(a.store.toLowerCase())) {
        errors.push(`commands[${i}]: ask.store may not claim the reserved name "${a.store}" — the player maintains it automatically`);
      }
      if (a.store !== undefined && a.default === undefined) {
        errors.push(`commands[${i}]: ask.default is required with store — the movie types it and skip falls back to it`);
      }
      if (a.answer === undefined && (a.retry !== undefined || a.reveal !== undefined || a.wrong !== undefined || a.right !== undefined || a.right_goto !== undefined || a.wrong_goto !== undefined)) {
        errors.push(`commands[${i}]: ask.retry, reveal, right, wrong and gotos only apply in check mode (with answer)`);
      }
      if (a.widget !== undefined && a.answer === undefined) {
        errors.push(`commands[${i}]: ask.widget requires answer (the element id / note / move the click must match)`);
      }
      if (a.retry === true && a.wrong_goto !== undefined) {
        errors.push(`commands[${i}]: ask.retry and wrong_goto are mutually exclusive — retry re-asks in place, wrong_goto jumps away`);
      }
      checkGoto(i, "ask", "right_goto", a.right_goto);
      checkGoto(i, "ask", "wrong_goto", a.wrong_goto);
      if (typeof a.store === "string") storedVars.add(a.store.toLowerCase());
    }
    if (verb === "explore" && cmd.explore !== undefined) {
      if (cmd.explore.params !== undefined && (!Array.isArray(cmd.explore.params) || cmd.explore.params.some((x) => typeof x !== "string"))) {
        errors.push(`commands[${i}]: explore.params must be an array of param paths`);
      }
    }
    if (verb === "play") {
      const p = cmd.play!;
      const voices = typeof p === "string" ? [{ notes: p }] : Array.isArray(p) ? p : parseABC(p.abc).voices;
      if (!voices.some((v) => notationBeats(v.notes) > 0)) {
        errors.push(`commands[${i}]: play has no readable notes — notation is space-separated "C4:q E4:q G4+C5:h" (pitch+octave, optional :w/h/q/e/s duration, R for rests), or a tune in {abc: "..."}`);
      }
      if (cmd.tempo !== undefined && (typeof cmd.tempo !== "number" || cmd.tempo < 30 || cmd.tempo > 300)) {
        errors.push(`commands[${i}]: tempo must be a number between 30 and 300 bpm`);
      }
    }
  }

  const seen = new Set<string>();
  for (const el of spec.elements ?? []) {
    if (seen.has(el.id)) errors.push(`duplicate element id "${el.id}"`);
    seen.add(el.id);
    errors.push(...elementErrors(el));
  }

  // Data tokens ("{sim.y}") must name a CODE element of this drawcast. A
  // brace+dot string that fails the grammar is a typo worth naming; anything
  // else with braces is prose.
  const codeIds = new Set((spec.elements ?? []).filter((e) => e.type === "code").map((e) => e.id));
  const allIds = new Set((spec.elements ?? []).map((e) => e.id));
  for (const t of scanDataTokens(spec.params)) {
    const where = `params.${t.at.join(".")}`;
    if (codeIds.has(t.codeId)) continue;
    if (allIds.has(t.codeId)) errors.push(`${where}: "{${t.codeId}.${t.path}}" — "${t.codeId}" is not a code element (only a code element's variables can feed params)`);
    else errors.push(`${where}: "{${t.codeId}.${t.path}}" references "${t.codeId}", which is not a code element in this drawcast`);
  }
  const walkMalformed = (v: unknown, at: string): void => {
    if (typeof v === "string") {
      if (MALFORMED_TOKEN_RE.test(v) && !DATA_TOKEN_RE.test(v)) errors.push(`${at}: "${v}" looks like a data token but is malformed — use "{codeId.variable}" (letters, digits, underscores, dots)`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walkMalformed(x, `${at}.${i}`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walkMalformed(x, `${at}.${k}`);
  };
  walkMalformed(spec.params, "params");

  return errors;
}

function elementErrors(el: SpecElement): string[] {
  const errs: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) errs.push(`element "${el.id}" (${el.type}): ${msg}`);
  };
  if (Array.isArray(el.link)) {
    for (const l of el.link) {
      need(/^https?:\/\//i.test(l), `link "${l}" must be a full http(s) URL`);
    }
  }
  switch (el.type) {
    case "curve":
      need(!!el.expr || !!el.direction, "needs either expr or a qualitative direction");
      break;
    case "portrait":
      need(!!el.of || !!el.url || !!el.strokes, "needs of (a person's name), url, or embedded strokes");
      break;
    case "source":
      need(
        !!el.of || !!el.doi || !!el.isbn || !!el.archive || !!el.url || !!el.strokes,
        "needs one reference: of (the work's title), doi, isbn, archive, or url",
      );
      break;
    case "label":
      need(!!el.text, "needs text");
      need(!!el.attach_to, "needs attach_to (id of the element it labels)");
      break;
    case "region":
      need(Array.isArray(el.between) && el.between.length === 2, "needs between: [curveId, curveId]");
      break;
    case "annotation":
      need(!!el.target, "needs target (id of the element it marks)");
      break;
    case "point":
      need(!!el.at, "needs at ({x,y} or {intersection_of})");
      break;
    case "arrow":
    case "edge":
      need(!!el.from && !!el.to, "needs from and to");
      break;
    case "path":
      need(Array.isArray(el.points) && el.points.length >= 2, "needs points (≥ 2)");
      break;
    case "text":
      need(!!el.text, "needs text");
      need(typeof el.x === "number" && typeof el.y === "number", "needs x and y (logical coordinates)");
      break;
    case "shape":
      need(!!el.shape, "needs shape");
      break;
    case "code":
      // A machine with a program on it and nothing to run (`game`, no code) is
      // whole as it is: the layout draws its boot screen. Anything with a
      // script needs a runtime to run it in.
      const machineOnly = el.game !== undefined && (typeof el.code !== "string" || el.code.trim() === "");
      if (!machineOnly) {
        need(isLanguage(el.language), `needs language: ${LANGUAGES.map((l) => `"${l}"`).join(" | ")}`);
        need(typeof el.code === "string" && el.code.trim() !== "", "needs code (the script)");
      }
      if (el.figures !== undefined) {
        need(Number.isInteger(el.figures) && el.figures >= 2, "figures must be an integer >= 2 (omit it for none or one figure)");
      }
      if (el.lines !== undefined) {
        need(Number.isInteger(el.lines) && el.lines >= 3, "lines must be an integer >= 3 (omit it to show the whole script)");
      }
      break;
    default:
      break;
  }
  return errs;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateSpec(spec: unknown): ValidationResult {
  const normalized = normalizeSpec(spec);
  const sErrors = structuralErrors(normalized);
  if (sErrors.length > 0) return { ok: false, errors: sErrors };
  const errors = semanticErrors(normalized as Spec);
  return { ok: errors.length === 0, errors };
}
