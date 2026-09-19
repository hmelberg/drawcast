# Script Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A drawcast can be written and read as a script — column 0 is the voice, indented lines are the machine — and that script is what the editor shows for every cast, including the ones the model wrote.

**Architecture:** Five small modules under `src/spec/script/`, split so each can be held in mind at once: a dumb line scanner, a value grammar shared by both directions (so parse and print cannot drift), a parser, a printer, and a façade. They plug into the four functions every text path in the app already goes through — `parseSpecText`/`formatSpec` (`src/spec/text.ts`) and `parsePlaylistText`/`formatPlaylist` (`src/playlist/playlist.ts`). The acceptance gate is a round-trip over the whole bundled corpus.

**Tech Stack:** TypeScript, vitest (`npx vitest run <file>`), js-yaml (for the escape-hatch fences only), ajv.

**Spec:** `docs/superpowers/specs/2026-09-19-script-dsl-design.md` — this plan implements §3-§6 and §8-§10 (phase 2, "Core"). §7 (places) shipped 2026-09-19. Sugar (§6's aliases and shorthands) is phase 3 and explicitly NOT in this plan.

## Global Constraints

- **The deploy gate is `npm test && npm run build`.** Netlify runs both; vitest does NOT typecheck. In the last round `tsc` caught a narrowing error that 8617 green tests did not.
- **The round-trip contract is the acceptance criterion**: `parse(print(spec))` deep-equals `spec` for every bundled example and every scene pack, and `print(parse(print(spec)))` is byte-identical to `print(spec)`.
- **No sugar in this phase.** No `box`/`circle` aliases, no `->`, no colour words, no connector labels, no quiz `*`/`+` lists, no `A:`/`B:` shorthand beyond what the round trip needs. Heads are the spec's own type and verb names. The one exception is `dot`, which is not sugar but a disambiguation: `point` is both an element type and the laser verb, and the verb wins (§5 of this plan).
- **Element and command field names are the spec's own**, including dotted paths (`style.color`, `draw.mode`, `at.gap`).
- **Line numbers in every error.** A parse error names the line and the fix.
- **Commit after every task.** Work on branch `round/script`. Merge to main and push in the last task.

## File Structure

| File | Responsibility |
|---|---|
| `src/spec/script/lines.ts` | **new** — the scanner: text → typed lines with indent and line number. Knows nothing of specs. |
| `src/spec/script/values.ts` | **new** — the value grammar, both ways: tokenizing a direction's arguments, reading a token into a value, writing a value back to a token, and flattening/unflattening dotted paths. Shared by parser and printer so they cannot drift. |
| `src/spec/script/parse.ts` | **new** — lines → `{ meta, pages }`. Beats, directions, fences, settings. |
| `src/spec/script/print.ts` | **new** — `{ meta, pages }` → text. Beat grouping, declare-at-first-mention, the props block. |
| `src/spec/script/index.ts` | **new** — the façade: `parseScript`, `printScript`, `parseScriptPages`, `printScriptPages`, `looksLikeScript`. |
| `src/spec/text.ts` | `SpecFormat` gains `"script"`; detection and routing. |
| `src/playlist/playlist.ts` | pages instead of `---` documents when the text is a script. |
| `src/main.ts`, `src/ui/insert.ts`, `src/llm/revise.ts`, `src/llm/hoist.ts`, `src/course/load.ts` | the editor's format. |
| `tests/script-lines.test.ts`, `script-values.test.ts`, `script-parse.test.ts`, `script-print.test.ts`, `script-roundtrip.test.ts`, `script-format.test.ts` | **new** |

## The grammar this plan implements

```
# Cast title                      the document's title
## Page title                     starts a new playlist item
lang: nb                          a setting (key must be in SETTING_KEYS)
@spor                             a goto label, attached to the next beat
// a comment
A spoken line at column 0.        opens a beat
    node hush "Husholdninger" x 220 y 375     an element: declared AND drawn here
    point at.ref hush                          a verb
        duration 2                             deeper: more of the line above
    ```python p show below                     a fenced element (code)
    import numpy as np
    ```
(blank line)                      ends the beat
```

Three structural rules the parser enforces:

1. **A beat is a spoken line plus the directions indented under it**, ending at a blank line or the next column-0 line.
2. **One direction is one command** — except that **consecutive element declarations collapse into a single `draw` command** at the position of the first. Measured: no command in the corpus carries more than one verb, and no `draw` mixes first-drawn ids with already-drawn ones (0 of 507), so a beat's declarations reconstruct its `draw` exactly.
3. **The spoken line rides on the beat's first command.**

---

### Task 1: The line scanner

**Files:**
- Create: `src/spec/script/lines.ts`
- Test: `tests/script-lines.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
```ts
export type ScriptLine =
  | { kind: "blank"; line: number }
  | { kind: "comment"; line: number }
  | { kind: "heading"; line: number; depth: 1 | 2; text: string }
  | { kind: "setting"; line: number; key: string; rest: string }
  | { kind: "goto"; line: number; name: string }
  | { kind: "speech"; line: number; text: string; voice?: "a" | "b" }
  | { kind: "direction"; line: number; indent: number; head: string; rest: string }
  | { kind: "fence"; line: number; indent: number; info: string; body: string };
export const SETTING_KEYS: readonly string[];
export function scanLines(text: string): ScriptLine[];
```

- [ ] **Step 1: Write the failing test**

Create `tests/script-lines.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { scanLines } from "../src/spec/script/lines";

describe("the line scanner", () => {
  test("column 0 prose is speech, indented lines are directions", () => {
    const ls = scanLines("Hei der.\n    node a x 10\n");
    expect(ls.map((l) => l.kind)).toEqual(["speech", "direction"]);
    expect(ls[0]).toMatchObject({ kind: "speech", line: 1, text: "Hei der." });
    expect(ls[1]).toMatchObject({ kind: "direction", line: 2, indent: 4, head: "node", rest: "a x 10" });
  });

  test("a deeper indent is still a direction — the parser decides what it attaches to", () => {
    const ls = scanLines("Hei.\n    move a\n        duration 2\n");
    expect((ls[1] as { indent: number }).indent).toBe(4);
    expect((ls[2] as { indent: number }).indent).toBe(8);
  });

  test("headings, settings, gotos, comments and blanks are their own kinds", () => {
    const ls = scanLines("# Tittel\n## Side\nlang: nb\n@spor\n// noe\n\n");
    expect(ls.map((l) => l.kind)).toEqual(["heading", "heading", "setting", "goto", "comment", "blank"]);
    expect(ls[0]).toMatchObject({ depth: 1, text: "Tittel" });
    expect(ls[1]).toMatchObject({ depth: 2, text: "Side" });
    expect(ls[2]).toMatchObject({ key: "lang", rest: "nb" });
    expect(ls[3]).toMatchObject({ name: "spor" });
  });

  test("a colon line whose key is not a setting is speech, not a setting", () => {
    const ls = scanLines("Kort sagt: pengene sirkulerer.\n");
    expect(ls[0].kind).toBe("speech");
  });

  test("a dialogue prefix sets the voice and is stripped from the text", () => {
    const ls = scanLines("A: Hvorfor?\nB: Fordi.\n");
    expect(ls[0]).toMatchObject({ kind: "speech", text: "Hvorfor?", voice: "a" });
    expect(ls[1]).toMatchObject({ kind: "speech", text: "Fordi.", voice: "b" });
  });

  test("a fence swallows its body verbatim and dedents it by its own indent", () => {
    const ls = scanLines('Se her.\n    ```python p show below\n    import numpy\n      x = 1\n    ```\n');
    expect(ls[1]).toMatchObject({ kind: "fence", indent: 4, info: "python p show below" });
    expect((ls[1] as { body: string }).body).toBe("import numpy\n  x = 1");
  });

  test("a tab indents one level, four spaces", () => {
    const ls = scanLines("Hei.\n\tnode a\n");
    expect((ls[1] as { indent: number }).indent).toBe(4);
  });

  test("line numbers survive a fence", () => {
    const ls = scanLines("Hei.\n    ```python p\n    x = 1\n    ```\nEtterpå.\n");
    expect(ls[2]).toMatchObject({ kind: "speech", line: 5, text: "Etterpå." });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/script-lines.test.ts`
Expected: FAIL — "Failed to resolve import ../src/spec/script/lines".

- [ ] **Step 3: Write the scanner**

Create `src/spec/script/lines.ts`:

```ts
// The scanner: a drawcast script's text, one typed line at a time. It knows
// the SHAPE of a line — voice or machine, heading or setting — and nothing
// about specs, elements or verbs. Indentation is the whole grammar: column 0
// is the voice, anything indented is a stage direction, and a deeper indent
// belongs to the direction above it (which the parser resolves, not this).
export type ScriptLine =
  | { kind: "blank"; line: number }
  | { kind: "comment"; line: number }
  | { kind: "heading"; line: number; depth: 1 | 2; text: string }
  | { kind: "setting"; line: number; key: string; rest: string }
  | { kind: "goto"; line: number; name: string }
  | { kind: "speech"; line: number; text: string; voice?: "a" | "b" }
  | { kind: "direction"; line: number; indent: number; head: string; rest: string }
  | { kind: "fence"; line: number; indent: number; info: string; body: string };

/**
 * The closed set of column-0 `key: value` lines. Closed on purpose: a spoken
 * line may perfectly well begin "Kort sagt:", and the only thing that keeps
 * that from being read as a setting is that `Kort sagt` is not in this list.
 */
export const SETTING_KEYS = [
  // page
  "lang", "voice", "level", "record", "canvas", "domain", "vars", "text", "zoom_from", "use", "with", "chapter",
  // playlist (before the first page)
  "subtitle", "advance", "gap", "transitions", "next", "enroll", "prompt", "comments", "views",
] as const;

const SETTING_RE = new RegExp(`^(${SETTING_KEYS.join("|")}):(?:\\s+(.*))?$`);
const HEADING_RE = /^(#{1,2})\s+(.*)$/;
const GOTO_RE = /^@([A-Za-z_][\w-]*)\s*$/;
const DIALOGUE_RE = /^([AB]):\s+(.*)$/;
const FENCE_RE = /^```(.*)$/;

const TAB_WIDTH = 4;
const expand = (s: string): string => s.replace(/\t/g, " ".repeat(TAB_WIDTH));

export function scanLines(text: string): ScriptLine[] {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const out: ScriptLine[] = [];
  for (let i = 0; i < raw.length; i++) {
    const line = i + 1;
    const src = expand(raw[i]);
    const body = src.trim();
    if (body === "") {
      // A trailing newline is not a blank line of its own.
      if (i < raw.length - 1 || raw[i] !== "") out.push({ kind: "blank", line });
      continue;
    }
    const indent = src.length - src.trimStart().length;
    if (indent > 0) {
      const fence = FENCE_RE.exec(body);
      if (fence) {
        const info = fence[1].trim();
        const lines: string[] = [];
        let j = i + 1;
        for (; j < raw.length; j++) {
          const candidate = expand(raw[j]);
          if (FENCE_RE.test(candidate.trim())) break;
          lines.push(candidate.slice(indent));
        }
        out.push({ kind: "fence", line, indent, info, body: lines.join("\n") });
        i = j; // skip the closing fence
        continue;
      }
      const space = body.indexOf(" ");
      out.push({
        kind: "direction",
        line,
        indent,
        head: space === -1 ? body : body.slice(0, space),
        rest: space === -1 ? "" : body.slice(space + 1).trim(),
      });
      continue;
    }
    if (body.startsWith("//")) { out.push({ kind: "comment", line }); continue; }
    const heading = HEADING_RE.exec(body);
    if (heading) { out.push({ kind: "heading", line, depth: heading[1].length as 1 | 2, text: heading[2].trim() }); continue; }
    const goto = GOTO_RE.exec(body);
    if (goto) { out.push({ kind: "goto", line, name: goto[1] }); continue; }
    const setting = SETTING_RE.exec(body);
    if (setting) { out.push({ kind: "setting", line, key: setting[1], rest: (setting[2] ?? "").trim() }); continue; }
    const dialogue = DIALOGUE_RE.exec(body);
    if (dialogue) { out.push({ kind: "speech", line, text: dialogue[2].trim(), voice: dialogue[1].toLowerCase() as "a" | "b" }); continue; }
    out.push({ kind: "speech", line, text: body });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/script-lines.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/spec/script/lines.ts tests/script-lines.test.ts
git commit -m "Script: the line scanner — indentation is the whole grammar"
```

---

### Task 2: The value grammar

**Files:**
- Create: `src/spec/script/values.ts`
- Test: `tests/script-values.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
```ts
export function splitTokens(rest: string): string[];
export function parseValue(token: string): unknown;
export function formatValue(v: unknown): string;
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void;
export function fieldLines(key: string, value: unknown): { path: string; token: string }[];
```

`fieldLines` is the printer's half and `setPath` the parser's: an object whose leaves are all scalars becomes one dotted line per leaf; anything else (an array, an empty object, a mixed structure) becomes one inline-JSON line. The empty-object case is the one that would silently vanish if flattening were applied blindly — `params: {supply: {}}` exists in the corpus.

- [ ] **Step 1: Write the failing test**

Create `tests/script-values.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { fieldLines, formatValue, parseValue, setPath, splitTokens } from "../src/spec/script/values";

describe("tokenizing a direction's arguments", () => {
  test("splits on spaces but keeps quoted strings whole", () => {
    expect(splitTokens('a "to ord" 30')).toEqual(["a", '"to ord"', "30"]);
  });
  test("keeps bracketed JSON whole, spaces and all", () => {
    expect(splitTokens('points [[0, 0], [10, 5]] closed true')).toEqual(["points", "[[0, 0], [10, 5]]", "closed", "true"]);
  });
  test("keeps braced JSON whole", () => {
    expect(splitTokens('at {"ref": "a", "side": "above"}')).toEqual(["at", '{"ref": "a", "side": "above"}']);
  });
  test("an escaped quote does not end the string", () => {
    expect(splitTokens('text "han sa \\"hei\\"" x 1')).toEqual(['text', '"han sa \\"hei\\""', "x", "1"]);
  });
});

describe("reading and writing a value", () => {
  test("numbers, booleans and bare words", () => {
    expect(parseValue("30")).toBe(30);
    expect(parseValue("-1.5")).toBe(-1.5);
    expect(parseValue("true")).toBe(true);
    expect(parseValue("rect")).toBe("rect");
  });
  test("a quoted string keeps its spaces and loses its quotes", () => {
    expect(parseValue('"Lønn og inntekt"')).toBe("Lønn og inntekt");
  });
  test("a quoted number stays a string", () => {
    expect(parseValue('"30"')).toBe("30");
  });
  test("inline JSON", () => {
    expect(parseValue('[[0, 0], [10, 5]]')).toEqual([[0, 0], [10, 5]]);
    expect(parseValue('{"a": 1}')).toEqual({ a: 1 });
  });
  test("every value survives a round trip through formatValue", () => {
    for (const v of [30, -1.5, true, false, "rect", "to ord", "30", "true", "", [[0, 0]], { a: 1 }, {}, []]) {
      expect(parseValue(formatValue(v))).toEqual(v);
    }
  });
  test("a string that would read as something else is quoted", () => {
    expect(formatValue("30")).toBe('"30"');
    expect(formatValue("true")).toBe('"true"');
    expect(formatValue("")).toBe('""');
  });
});

describe("dotted paths", () => {
  test("an all-scalar object flattens to one line per leaf", () => {
    expect(fieldLines("style", { color: "#2f6b8f", stroke_width: 3 })).toEqual([
      { path: "style.color", token: '"#2f6b8f"' },
      { path: "style.stroke_width", token: "3" },
    ]);
  });
  test("an empty object is written whole, not flattened away", () => {
    expect(fieldLines("params", { supply: {} })).toEqual([{ path: "params", token: '{"supply":{}}' }]);
  });
  test("an array is written whole", () => {
    expect(fieldLines("points", [[0, 0], [10, 5]])).toEqual([{ path: "points", token: "[[0,0],[10,5]]" }]);
  });
  test("a scalar is one line", () => {
    expect(fieldLines("x", 220)).toEqual([{ path: "x", token: "220" }]);
  });
  test("setPath rebuilds what fieldLines took apart", () => {
    const target: Record<string, unknown> = {};
    for (const { path, token } of fieldLines("style", { color: "red", dash: true })) setPath(target, path, parseValue(token));
    expect(target).toEqual({ style: { color: "red", dash: true } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/script-values.test.ts`
Expected: FAIL — the module does not resolve.

- [ ] **Step 3: Write the module**

Create `src/spec/script/values.ts`:

```ts
// The value grammar, both directions. Parser and printer share it so they
// cannot drift: every test in tests/script-values.test.ts that reads a token
// also writes it back.

/** Split a direction's arguments on spaces, keeping "strings", [arrays] and {objects} whole. */
export function splitTokens(rest: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = false;
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (quote) {
      cur += c;
      if (c === "\\" && i + 1 < rest.length) { cur += rest[++i]; continue; }
      if (c === '"') quote = false;
      continue;
    }
    if (c === '"') { quote = true; cur += c; continue; }
    if (c === "[" || c === "{") { depth++; cur += c; continue; }
    if (c === "]" || c === "}") { depth--; cur += c; continue; }
    if (c === " " && depth === 0) { if (cur !== "") out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur !== "") out.push(cur);
  return out;
}

const NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A token as a value: quoted string, number, boolean, inline JSON, else a bare word. */
export function parseValue(token: string): unknown {
  if (token.startsWith('"')) return JSON.parse(token) as string;
  if (token === "true") return true;
  if (token === "false") return false;
  if (token === "null") return null;
  if (NUMBER_RE.test(token)) return Number(token);
  if (token.startsWith("[") || token.startsWith("{")) return JSON.parse(token) as unknown;
  return token;
}

const BARE_RE = /^[^\s"[{][^\s]*$/;

/** A value as a token — quoted whenever a bare word would read back as something else. */
export function formatValue(v: unknown): string {
  if (typeof v === "number" || typeof v === "boolean" || v === null) return JSON.stringify(v);
  if (typeof v === "string") {
    const bare = BARE_RE.test(v) && parseValue(v) === v;
    return bare ? v : JSON.stringify(v);
  }
  return JSON.stringify(v);
}

const isScalar = (v: unknown): boolean => v === null || ["string", "number", "boolean"].includes(typeof v);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** True when every leaf of `v` is a scalar AND it has at least one — the only
 *  shape that can be flattened to dotted lines and put back together again. */
function flattenable(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v);
  if (keys.length === 0) return false;
  return keys.every((k) => isScalar(v[k]) || flattenable(v[k]));
}

/** One printed line per scalar leaf, or one whole-value line for anything else. */
export function fieldLines(key: string, value: unknown): { path: string; token: string }[] {
  if (isScalar(value)) return [{ path: key, token: formatValue(value) }];
  if (!flattenable(value)) return [{ path: key, token: formatValue(value) }];
  const out: { path: string; token: string }[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out.push(...fieldLines(`${key}.${k}`, v));
  return out;
}

/** Write `value` at a dotted path, minting the objects on the way. */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(node[part])) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/script-values.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/spec/script/values.ts tests/script-values.test.ts
git commit -m "Script: the value grammar, shared by parser and printer so they cannot drift"
```

---

### Task 3: The parser — beats, directions, elements and commands

**Files:**
- Create: `src/spec/script/parse.ts`
- Test: `tests/script-parse.test.ts`

**Interfaces:**
- Consumes: `scanLines`/`ScriptLine` (Task 1), `splitTokens`/`parseValue`/`setPath` (Task 2), `ElementType` and `Command` from `src/spec/types.ts`.
- Produces:
```ts
export interface ScriptPage { spec: Spec }
export interface ParsedScript { meta: Record<string, unknown>; pages: ScriptPage[] }
export function parseScriptPages(text: string): ParsedScript;
export class ScriptError extends Error { line: number }
```

Head resolution, in order: `dot` → the `point` element type; a `Command` key other than `label` → that verb; an `ElementType` → an element declaration; otherwise a `ScriptError` naming the line.

- [ ] **Step 1: Write the failing test**

Create `tests/script-parse.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseScriptPages } from "../src/spec/script/parse";

const one = (text: string) => parseScriptPages(text).pages[0].spec;

describe("beats", () => {
  test("a spoken line with declarations becomes one draw command carrying the line", () => {
    const spec = one('To slags aktører.\n    node hush "Husholdninger" x 220 y 375\n    node bedr "Bedrifter" x 780 y 375\n');
    expect(spec.elements).toEqual([
      { id: "hush", type: "node", text: "Husholdninger", x: 220, y: 375 },
      { id: "bedr", type: "node", text: "Bedrifter", x: 780, y: 375 },
    ]);
    expect(spec.commands).toEqual([{ speak: "To slags aktører.", draw: ["hush", "bedr"] }]);
  });

  test("a verb after declarations is its own command, and the speech stays on the first", () => {
    const spec = one('Se her.\n    node a x 1 y 2\n    point at.ref a\n');
    expect(spec.commands).toEqual([
      { speak: "Se her.", draw: ["a"] },
      { point: { at: { ref: "a" } } },
    ]);
  });

  test("a blank line ends the beat", () => {
    const spec = one("Først.\n    node a x 1 y 2\n\n    camera zoom 2\n");
    expect(spec.commands).toEqual([
      { speak: "Først.", draw: ["a"] },
      { camera: { zoom: 2 } },
    ]);
  });

  test("two spoken lines in a row are two beats", () => {
    const spec = one("Først.\nSå.\n    camera reset true\n");
    expect(spec.commands).toEqual([{ speak: "Først." }, { speak: "Så.", camera: { reset: true } }]);
  });

  test("directions with no spoken line above them are a silent beat", () => {
    const spec = one("    camera zoom 2\n");
    expect(spec.commands).toEqual([{ camera: { zoom: 2 } }]);
  });

  test("a deeper indent continues the direction above it", () => {
    const spec = one("Flytt.\n    move target a\n        by [10, 0]\n        duration 2\n");
    expect(spec.commands).toEqual([{ speak: "Flytt.", move: { target: "a", by: [10, 0], duration: 2 } }]);
  });

  test("a dialogue line carries its voice", () => {
    const spec = one("B: Fordi.\n    camera zoom 2\n");
    expect(spec.commands).toEqual([{ speak: "Fordi.", voice: "b", camera: { zoom: 2 } }]);
  });

  test("@label attaches to the first command of the next beat", () => {
    const spec = one("@spor\nHva nå?\n    camera zoom 2\n");
    expect(spec.commands).toEqual([{ label: "spor", speak: "Hva nå?", camera: { zoom: 2 } }]);
  });
});

describe("directions", () => {
  test("dot declares a point element and point is the laser verb", () => {
    const spec = one("Se.\n    dot p x 3 on wave\n    point at.ref p gesture tap\n");
    expect(spec.elements).toEqual([{ id: "p", type: "point", x: 3, on: "wave" }]);
    expect(spec.commands[1]).toEqual({ point: { at: { ref: "p" }, gesture: "tap" } });
  });

  test("a quoted string after the id is the element's text", () => {
    const spec = one('Hei.\n    label l "Lønn" attach_to arr side below\n');
    expect(spec.elements).toEqual([{ id: "l", type: "label", text: "Lønn", attach_to: "arr", side: "below" }]);
  });

  test("dotted keys rebuild nested objects", () => {
    const spec = one('Hei.\n    arrow a from.ref x to.ref y style.color "#2f6b8f" style.stroke_width 3\n');
    expect(spec.elements![0]).toEqual({
      id: "a", type: "arrow", from: { ref: "x" }, to: { ref: "y" }, style: { color: "#2f6b8f", stroke_width: 3 },
    });
  });

  test("a list verb takes bare ids until a known key", () => {
    const spec = one("Hei.\n    draw a b c parallel true\n");
    expect(spec.commands).toEqual([{ speak: "Hei.", draw: ["a", "b", "c"], parallel: true }]);
  });

  test("a verb whose argument is a bare id fills its target", () => {
    const spec = one("Hei.\n    highlight a b effect glow\n");
    expect(spec.commands).toEqual([{ speak: "Hei.", highlight: { target: ["a", "b"], effect: "glow" } }]);
  });

  test("an unknown head names the line and suggests nothing it cannot back up", () => {
    expect(() => one("Hei.\n    bx a x 1\n")).toThrow(/line 2/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/script-parse.test.ts`
Expected: FAIL — the module does not resolve.

- [ ] **Step 3: Write the parser**

Create `src/spec/script/parse.ts`. The shape of the implementation:

```ts
// lines → { meta, pages }. The three structural rules live here: a beat is a
// spoken line plus what is indented under it; one direction is one command,
// except that consecutive element declarations collapse into the single
// `draw` they describe; the spoken line rides on the beat's first command.
import { scanLines, type ScriptLine } from "./lines";
import { parseValue, setPath, splitTokens } from "./values";
import type { Command, Spec, SpecElement } from "../types";

export class ScriptError extends Error {
  constructor(message: string, readonly line: number) {
    super(`line ${line}: ${message}`);
    this.name = "ScriptError";
  }
}

export interface ScriptPage { spec: Spec }
export interface ParsedScript { meta: Record<string, unknown>; pages: ScriptPage[] }

/** Every element type the spec knows, as heads. `point` is NOT among them:
 *  the word is the laser verb, and the element is declared as `dot`. */
const ELEMENT_HEADS = new Set<string>([
  "axes", "curve", "arrow", "label", "region", "node", "edge", "annotation", "path", "text", "shape",
  "portrait", "source", "code", "sector", "arc", "polygon", "pieces", "angle", "measure", "ellipse",
  "line", "group", "math", "image", "icon", "inset",
]);

/** Verbs whose argument list is bare ids: the command field IS a list. */
const LIST_VERBS = new Set(["draw", "show", "hide", "erase", "reveal", "press"]);
/** Verbs whose first bare ids fill `target` inside an object. */
const TARGET_VERBS = new Set(["highlight", "focus", "move", "arrange", "fade", "flip", "morph", "keep"]);
/** Verbs whose whole argument set is an object with no positional part. */
const OBJECT_VERBS = new Set(["point", "copy", "flow", "camera", "card", "clear", "quiz", "ask", "run", "explore", "if"]);
/** Verbs that take one scalar. */
const SCALAR_VERBS = new Set(["pause", "wait", "parallel", "blocking", "voice", "delivery", "duration", "easing", "tempo", "instrument", "animate", "play", "ghost", "trail"]);

function keyValues(tokens: string[], into: Record<string, unknown>, line: number): void {
  for (let i = 0; i < tokens.length; i += 2) {
    const path = tokens[i];
    if (i + 1 >= tokens.length) throw new ScriptError(`"${path}" has no value`, line);
    setPath(into, path, parseValue(tokens[i + 1]));
  }
}

const isBareId = (t: string): boolean => /^[A-Za-z_][\w-]*$/.test(t) && !t.includes(".");
```

with `parseDirection(head, rest, line)` returning either `{ element: SpecElement }` or `{ command: Command }`:

```ts
function parseDirection(head: string, rest: string, line: number): { element?: SpecElement; command?: Command } {
  const tokens = splitTokens(rest);
  const type = head === "dot" ? "point" : head;
  if (ELEMENT_HEADS.has(type) || type === "point") {
    const el: Record<string, unknown> = {};
    let i = 0;
    if (tokens[0] !== undefined && isBareId(tokens[0])) el.id = tokens[i++];
    if (tokens[i] !== undefined && tokens[i].startsWith('"')) el.text = parseValue(tokens[i++]);
    keyValues(tokens.slice(i), el, line);
    if (typeof el.id !== "string") throw new ScriptError(`a ${head} needs an id`, line);
    return { element: { ...el, type } as unknown as SpecElement };
  }
  // The id run: bare words up to the first known field name. The same run
  // serves every verb that takes ids; only where it LANDS differs.
  const idRun = (from: number): { ids: string[]; next: number } => {
    const ids: string[] = [];
    let i = from;
    while (tokens[i] !== undefined && isBareId(tokens[i]) && !KNOWN_KEYS.has(tokens[i])) ids.push(tokens[i++]);
    return { ids, next: i };
  };
  if (LIST_VERBS.has(head)) {
    const { ids, next } = idRun(0);
    const cmd: Record<string, unknown> = { [head]: ids };
    keyValues(tokens.slice(next), cmd, line);
    return { command: cmd as Command };
  }
  if (TARGET_VERBS.has(head)) {
    const { ids, next } = idRun(0);
    const args: Record<string, unknown> = {};
    if (ids.length > 0) args.target = ids;
    keyValues(tokens.slice(next), args, line);
    return { command: { [head]: args } as Command };
  }
  if (OBJECT_VERBS.has(head)) {
    const args: Record<string, unknown> = {};
    keyValues(tokens, args, line);
    return { command: { [head]: args } as Command };
  }
  if (SCALAR_VERBS.has(head)) {
    // `wait` and `parallel` stand alone; the rest take exactly one value.
    if (tokens.length === 0) return { command: { [head]: head === "wait" ? "click" : true } as Command };
    if (tokens.length === 1) return { command: { [head]: parseValue(tokens[0]) } as Command };
    const args: Record<string, unknown> = {};
    keyValues(tokens, args, line);
    return { command: { [head]: args } as Command };
  }
  throw new ScriptError(`"${head}" is not a kind of thing or a verb`, line);
}
```

`KNOWN_KEYS` is the union of the `Command` field names and the element field names — it is what stops an id run at the first `key value` pair. Build it once, from the schema's own property lists (`src/spec/schema.ts` exports `apiSchema()`; read `properties` off the element and command sub-schemas) so it cannot fall behind a new field.

Then `parseScriptPages` walks the lines: headings open pages, settings write page or playlist meta (`use:` → `template`, `with:` → `params`), gotos hold a label for the next beat, speech opens a beat, directions accumulate, blanks close beats.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/script-parse.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/spec/script/parse.ts tests/script-parse.test.ts
git commit -m "Script: the parser — beats, directions, elements and commands"
```

---

### Task 4: The parser — settings, pages and fences

**Files:**
- Modify: `src/spec/script/parse.ts`
- Test: `tests/script-parse.test.ts` (extend)

**Interfaces:**
- Consumes: Task 3.
- Produces: `parseScriptPages` handles `#`/`##`, every key in `SETTING_KEYS`, and the three fence kinds.

- [ ] **Step 1: Write the failing test**

Append to `tests/script-parse.test.ts`:

```ts
describe("settings, pages and fences", () => {
  test("# titles a single page, ## opens pages", () => {
    const doc = parseScriptPages("# Kretsløpet\n\nHei.\n    camera zoom 2\n");
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].spec.title).toBe("Kretsløpet");
  });

  test("## pages carry their own titles and the # title is the playlist's", () => {
    const doc = parseScriptPages("# Serien\n\n## Første\nHei.\n\n## Andre\nDa.\n");
    expect(doc.meta.title).toBe("Serien");
    expect(doc.pages.map((p) => p.spec.title)).toEqual(["Første", "Andre"]);
  });

  test("settings land on the page, and use/with are template and params", () => {
    const spec = parseScriptPages('## Smitte\nlang: nb\nuse: sir_model\nwith: {"beta": 0.3}\nvars: {"f": 1}\nHei.\n').pages[0].spec;
    expect(spec).toMatchObject({ lang: "nb", template: "sir_model", params: { beta: 0.3 }, vars: { f: 1 } });
  });

  test("a language fence is a code element, drawn in its beat", () => {
    const spec = parseScriptPages('Se.\n    ```python p show below lines 5\n    import numpy as np\n    x = 1\n    ```\n').pages[0].spec;
    expect(spec.elements).toEqual([
      { id: "p", type: "code", language: "python", show: "below", lines: 5, code: "import numpy as np\nx = 1" },
    ]);
    expect(spec.commands).toEqual([{ speak: "Se.", draw: ["p"] }]);
  });

  test("a yaml fence is the escape hatch: its elements land verbatim", () => {
    const spec = parseScriptPages("Se.\n    ```yaml\n    - id: odd\n      type: pieces\n      of: sectors\n      n: 8\n      radius: 50\n    ```\n").pages[0].spec;
    expect(spec.elements).toEqual([{ id: "odd", type: "pieces", of: "sectors", n: 8, radius: 50 }]);
  });

  test("an assets fence restores the machine payloads", () => {
    const spec = parseScriptPages("Hei.\n    camera zoom 2\n\n```assets\nfoto: AAAB\n```\n").pages[0].spec;
    expect(spec.assets).toEqual({ foto: "AAAB" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/script-parse.test.ts`
Expected: FAIL on the six new tests.

- [ ] **Step 3: Implement**

In `src/spec/script/parse.ts`:

- `heading.depth === 1` sets `meta.title` when the document has any `##`, and the single page's `spec.title` otherwise (decide after the scan: collect headings first, then assign).
- `setting` writes to the page under construction, or to `meta` before the first page: `use` → `template`, `with` → `params`, `chapter` → a chapter entry in `meta.chapters` keyed by the index of the page that follows; everything else keeps its own name. Values go through `parseValue` on the whole `rest`, so `domain: {"x": [0, 100]}` is inline JSON and `lang: nb` is a bare word.
- A fence whose `info` starts with a known language (`isLanguage` from `src/code/languages.ts`) is a `code` element: the language is the first word, the id and the key/values are the rest of the info string (same `parseDirection` argument grammar), and the body is `code`. It declares and draws like any element.
- A fence whose info is `yaml` is `load`ed with js-yaml (`CORE_SCHEMA`, as `src/spec/text.ts` does); an array becomes elements appended in place, an object is merged into the page's spec.
- A fence whose info is `assets` is `load`ed the same way into `spec.assets`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/script-parse.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add src/spec/script/parse.ts tests/script-parse.test.ts
git commit -m "Script: settings, pages and the three fences"
```

---

### Task 5: The printer — beats, declarations and the props block

**Files:**
- Create: `src/spec/script/print.ts`
- Test: `tests/script-print.test.ts`

**Interfaces:**
- Consumes: `fieldLines`/`formatValue` (Task 2), the head tables from Task 3 (export them from `parse.ts` so there is one list, not two).
- Produces:
```ts
export function printScriptPages(meta: Record<string, unknown>, pages: { spec: Spec }[]): string;
```

The printer's rules, in order:

1. Walk `commands`. A command carrying `draw` whose ids are all elements being declared here prints as one declaration line per id; every other command prints as one direction line.
2. An element is declared at its **first mention** — but only while that keeps `elements` in its own array order. An element that would have to move backwards goes in the page's props block, as does one never mentioned at all (6% of the corpus).
3. The props block is the page's first beat: declarations at indent 4 under no spoken line, each carrying `hidden` if it is not drawn anywhere.
4. `speak` prints as the beat's column-0 line; `voice: "b"` prints as a `B:` prefix; `label` prints as `@name` above the beat.

- [ ] **Step 1: Write the failing test**

Create `tests/script-print.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { printScriptPages } from "../src/spec/script/print";
import { parseScriptPages } from "../src/spec/script/parse";
import type { Spec } from "../src/spec/types";

const print = (spec: Spec) => printScriptPages({}, [{ spec }]);

describe("printing beats", () => {
  test("a draw of freshly declared elements prints as declarations under the line", () => {
    const spec: Spec = {
      elements: [
        { id: "hush", type: "node", text: "Husholdninger", x: 220, y: 375 },
        { id: "bedr", type: "node", text: "Bedrifter", x: 780, y: 375 },
      ],
      commands: [{ draw: ["hush", "bedr"], speak: "To slags aktører." }],
    };
    expect(print(spec)).toBe(
      'To slags aktører.\n    node hush "Husholdninger" x 220 y 375\n    node bedr "Bedrifter" x 780 y 375\n',
    );
  });

  test("a verb command prints as one direction line", () => {
    const spec: Spec = { commands: [{ camera: { zoom: 2 }, speak: "Nærmere." }] };
    expect(print(spec)).toBe("Nærmere.\n    camera zoom 2\n");
  });

  test("consecutive commands are separate beats, one blank line apart", () => {
    const spec: Spec = { commands: [{ speak: "Først." }, { camera: { zoom: 2 } }] };
    expect(print(spec)).toBe("Først.\n\n    camera zoom 2\n");
  });

  test("an element that is never drawn goes in the props block, marked hidden", () => {
    const spec: Spec = {
      elements: [{ id: "feed", type: "code", language: "python", code: "x = 1", show: "none" }],
      commands: [{ speak: "Hei." }],
    };
    expect(print(spec)).toContain("hidden");
  });

  test("an element out of first-mention order goes in the props block, not inline", () => {
    const spec: Spec = {
      elements: [
        { id: "second", type: "shape", shape: "rect", x: 1, y: 2 },
        { id: "first", type: "shape", shape: "rect", x: 3, y: 4 },
      ],
      commands: [{ draw: ["first"] }, { draw: ["second"] }],
    };
    const text = print(spec);
    expect(parseScriptPages(text).pages[0].spec.elements!.map((e) => e.id)).toEqual(["second", "first"]);
  });

  test("voice b prints as a dialogue prefix and a label as @name", () => {
    const spec: Spec = { commands: [{ speak: "Fordi.", voice: "b", label: "spor", camera: { zoom: 2 } }] };
    expect(print(spec)).toBe("@spor\nB: Fordi.\n    camera zoom 2\n");
  });

  test("printing is stable: printing what was parsed from a print changes nothing", () => {
    const spec: Spec = {
      elements: [{ id: "a", type: "shape", shape: "rect", x: 1, y: 2, style: { color: "red" } }],
      commands: [{ draw: ["a"], speak: "Hei." }, { highlight: { target: ["a"], effect: "glow" } }],
    };
    const once = print(spec);
    expect(print(parseScriptPages(once).pages[0].spec)).toBe(once);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/script-print.test.ts`
Expected: FAIL — the module does not resolve.

- [ ] **Step 3: Write the printer**

Create `src/spec/script/print.ts` implementing the four rules above. The element-order guard:

```ts
/**
 * Which elements may be declared inline, and where. An element is declared at
 * its first mention — but `elements` order is not provably inert (drawing
 * order, label collision), so it is preserved: walking the array, an element
 * whose first mention comes BEFORE one already placed would reorder the
 * array, and goes to the props block instead. Measured: 92 of 121 corpus
 * specs (76%) need no props block at all.
 */
function homes(spec: Spec, firstMention: Map<string, number>): { inline: Map<number, string[]>; props: string[] } {
  const inline = new Map<number, string[]>();
  const props: string[] = [];
  let lastBeat = -1;
  for (const el of spec.elements ?? []) {
    const beat = firstMention.get(el.id);
    if (beat === undefined || beat < lastBeat) { props.push(el.id); continue; }
    lastBeat = beat;
    inline.set(beat, [...(inline.get(beat) ?? []), el.id]);
  }
  return { inline, props };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/script-print.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/spec/script/print.ts tests/script-print.test.ts
git commit -m "Script: the printer — declare at first mention, props block when the order says otherwise"
```

---

### Task 6: The printer — settings, pages, fences and payloads

**Files:**
- Modify: `src/spec/script/print.ts`
- Test: `tests/script-print.test.ts` (extend)

**Interfaces:**
- Consumes: Task 5.
- Produces: every top-level spec field has a printed form — settings for the readable ones, an `assets`/`yaml` fence for the machine-written ones (`assets`, `subtitles`, `text_map`, `templates`), and `##` per page.

- [ ] **Step 1: Write the failing test**

Append to `tests/script-print.test.ts`:

```ts
describe("printing settings, pages and payloads", () => {
  test("page settings print above the first beat, in a fixed order", () => {
    const spec: Spec = { title: "Smitte", lang: "nb", template: "sir_model", params: { beta: 0.3 }, commands: [{ speak: "Hei." }] };
    expect(print(spec)).toBe('# Smitte\nlang: nb\nuse: sir_model\nwith: {"beta":0.3}\n\nHei.\n');
  });

  test("several pages print as ## sections under one # title", () => {
    const text = printScriptPages({ title: "Serien" }, [
      { spec: { title: "Første", commands: [{ speak: "Hei." }] } },
      { spec: { title: "Andre", commands: [{ speak: "Da." }] } },
    ]);
    expect(text).toBe("# Serien\n\n## Første\nHei.\n\n## Andre\nDa.\n");
  });

  test("a code element prints as a fence in its beat", () => {
    const spec: Spec = {
      elements: [{ id: "p", type: "code", language: "python", show: "below", lines: 5, code: "import numpy as np\nx = 1" }],
      commands: [{ draw: ["p"], speak: "Se." }],
    };
    expect(print(spec)).toBe("Se.\n    ```python p show below lines 5\n    import numpy as np\n    x = 1\n    ```\n");
  });

  test("machine payloads print last, in an assets fence", () => {
    const spec: Spec = { assets: { foto: "AAAB" }, commands: [{ speak: "Hei." }] };
    expect(print(spec)).toBe("Hei.\n\n```assets\nfoto: AAAB\n```\n");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/script-print.test.ts`
Expected: FAIL on the four new tests.

- [ ] **Step 3: Implement**

In `src/spec/script/print.ts`:

```ts
/** The order settings print in — fixed, so a reprint never reshuffles the
 *  head of a file. `template`/`params` print under their spoken names. */
const SETTING_ORDER: [keyof Spec, string][] = [
  ["lang", "lang"], ["voice", "voice"], ["level", "level"], ["record", "record"],
  ["canvas", "canvas"], ["domain", "domain"], ["vars", "vars"], ["text", "text"],
  ["zoom_from", "zoom_from"], ["template", "use"], ["params", "with"],
];

/** Written by machines, read by nobody: they print last, so the readable part
 *  of the file stays on top — the rule `specForDump` (src/spec/assets.ts)
 *  already applies to YAML. */
const PAYLOAD_KEYS = ["assets", "subtitles", "text_map", "templates"] as const;

function printSettings(spec: Spec): string[] {
  const out: string[] = [];
  for (const [field, name] of SETTING_ORDER) {
    const v = spec[field];
    if (v !== undefined) out.push(`${name}: ${formatValue(v)}`);
  }
  return out;
}

function printPayloads(spec: Spec): string[] {
  const out: string[] = [];
  for (const key of PAYLOAD_KEYS) {
    const v = (spec as Record<string, unknown>)[key];
    if (v === undefined) continue;
    out.push("```" + (key === "assets" ? "assets" : "yaml"), dump(key === "assets" ? v : { [key]: v }, { lineWidth: -1, noRefs: true }).trimEnd(), "```");
  }
  return out;
}
```

A `code` element prints as a fence rather than a direction line: the info string is the language, then the id, then its other fields through the same `fieldLines` grammar, and the body is `code` indented to the fence's own indent.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/script-print.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/spec/script/print.ts tests/script-print.test.ts
git commit -m "Script: settings, pages, code fences and the machine payloads"
```

---

### Task 7: The corpus round-trip gate

**Files:**
- Create: `tests/script-roundtrip.test.ts`
- Modify: whatever it finds — expect real work in `parse.ts` and `print.ts`

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: the guarantee the whole format rests on.

This is the task that decides whether the format is correct. Everything before it is scaffolding.

- [ ] **Step 1: Write the gate**

Create `tests/script-roundtrip.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import bundledExamples from "../src/examples.json";
import { parseScriptPages } from "../src/spec/script/parse";
import { printScriptPages } from "../src/spec/script/print";
import { normalizeSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const specs = (bundledExamples as { spec?: Spec }[]).filter((e) => e.spec).map((e) => e.spec!);

describe("the round trip over the bundled corpus", () => {
  test("every example survives print → parse unchanged", () => {
    const broken: string[] = [];
    for (const spec of specs) {
      const text = printScriptPages({}, [{ spec }]);
      let back: Spec | null = null;
      try {
        back = parseScriptPages(text).pages[0].spec;
      } catch (err) {
        broken.push(`${spec.title ?? "(untitled)"}: ${(err as Error).message}`);
        continue;
      }
      if (JSON.stringify(normalizeSpec(back)) !== JSON.stringify(normalizeSpec(spec))) {
        broken.push(`${spec.title ?? "(untitled)"}: differs after the round trip`);
      }
    }
    expect(broken).toEqual([]);
  });

  test("printing is stable across a second pass", () => {
    const unstable: string[] = [];
    for (const spec of specs) {
      const once = printScriptPages({}, [{ spec }]);
      const twice = printScriptPages({}, [{ spec: parseScriptPages(once).pages[0].spec }]);
      if (once !== twice) unstable.push(spec.title ?? "(untitled)");
    }
    expect(unstable).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and read the failures as a work list**

Run: `npx vitest run tests/script-roundtrip.test.ts`
Expected: FAIL, with a list of example titles. Each entry is a real gap — an unhandled field shape, a verb whose argument grammar is wrong, a value that does not survive `formatValue`. Fix them one at a time in `parse.ts`/`print.ts`, re-running after each. Do NOT relax the comparison to make it pass: `normalizeSpec` on both sides is the only normalization allowed, and it is there because the parser legitimately produces the normalized spelling of `at`, target lists and `pause: click`.

- [ ] **Step 3: Extend the gate to the scene packs**

Add to the same file a second corpus — every `examples` entry in the registered packs — read the way `tests/examples.test.ts` reads them (`ensureEnabledPacks`, `PACK_DEFS`, `scenes[tid].manifest.examples`). Same two assertions.

- [ ] **Step 4: Run both gates**

Run: `npx vitest run tests/script-roundtrip.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/script-roundtrip.test.ts src/spec/script/
git commit -m "Script: the corpus round-trip gate, and what it found"
```

---

### Task 8: Detection and routing

**Files:**
- Create: `src/spec/script/index.ts`
- Modify: `src/spec/text.ts:10` (`SpecFormat`), `parseSpecText`, `formatSpec`; `src/playlist/playlist.ts:168,311`
- Test: `tests/script-format.test.ts`

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: `SpecFormat = "yaml" | "json" | "script"`; `parseSpecText` recognizes script; `formatSpec(spec, "script")`; `parsePlaylistText` reads `##` pages; `formatPlaylist(playlist, "script")`.

- [ ] **Step 1: Write the failing test**

Create `tests/script-format.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { formatSpec, parseSpecText } from "../src/spec/text";
import { formatPlaylist, parsePlaylistText, itemsOf } from "../src/playlist/playlist";

describe("format detection", () => {
  test("a YAML spec is still read as YAML", () => {
    const parsed = parseSpecText("elements:\n  - id: a\n    type: text\n    text: hei\n    x: 1\n    'y': 2\ncommands:\n  - draw: [a]\n");
    expect(parsed.format).toBe("yaml");
  });

  test("a spoken line with a colon does not make a script file read as YAML", () => {
    const parsed = parseSpecText("To slags aktører: husholdninger og bedrifter.\n    camera zoom 2\n");
    expect(parsed.format).toBe("script");
  });

  test("JSON is still JSON", () => {
    expect(parseSpecText('{"commands": [{"speak": "hei"}]}').format).toBe("json");
  });

  test("a script round-trips through formatSpec and parseSpecText", () => {
    const text = "# Tittel\n\nHei.\n    camera zoom 2\n";
    const spec = parseSpecText(text).value;
    expect(formatSpec(spec, "script")).toBe(text);
  });
});

describe("playlists in script", () => {
  test("## pages become playlist items", () => {
    const playlist = parsePlaylistText("# Serien\n\n## Første\nHei.\n\n## Andre\nDa.\n");
    expect(itemsOf(playlist)).toHaveLength(2);
  });

  test("formatPlaylist prints them back", () => {
    const text = "# Serien\n\n## Første\nHei.\n\n## Andre\nDa.\n";
    expect(formatPlaylist(parsePlaylistText(text), "script")).toBe(text);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/script-format.test.ts`
Expected: FAIL — `"script"` is not a `SpecFormat`.

- [ ] **Step 3: Implement detection**

In `src/spec/text.ts`, `SpecFormat` gains `"script"`, and `parseSpecText` gets one new step BEFORE the YAML reading:

```ts
/** The top-level keys a YAML or JSON spec document always has at least one of.
 *  A script document is prose, so it has none — which is the only reliable
 *  discriminator: a spoken line containing a colon ("To slags aktører:
 *  husholdninger") is itself valid YAML, so "try YAML first" would silently
 *  misread a script as a one-key mapping. */
const SPEC_KEYS = ["title", "elements", "commands", "template", "playlist", "params", "chapter", "audio"];
```

— read the text as YAML; if it parses to a mapping with at least one `SPEC_KEYS` key, it is YAML; otherwise try `parseScript`. Keep the existing JSON-first order, since JSON is unambiguous.

In `src/playlist/playlist.ts`, `parsePlaylistText` tries the script reading when the text is not a `---` stream and `looksLikeScript` says so, and `formatPlaylist(playlist, "script")` prints pages. `SavedDrawing` gains `format?: SpecFormat` so a stored document says what it is; the discriminator stays the fallback for everything already saved.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/script-format.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run every test that touches the two files**

Run: `npx vitest run tests/playlist.test.ts tests/spec-text.test.ts tests/examples.test.ts tests/course-load.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/spec/script/index.ts src/spec/text.ts src/playlist/playlist.ts tests/script-format.test.ts
git commit -m "Script: detection and routing through the four text functions"
```

---

### Task 9: The editor switch, the gate and the push

**Files:**
- Modify: `src/main.ts` (the `formatPlaylist(…, "yaml")` sites), `src/ui/insert.ts`, `src/llm/revise.ts:234,242`, `src/llm/hoist.ts:76`, `src/course/load.ts:129`
- Modify: `docs/superpowers/specs/2026-09-19-script-dsl-design.md` (status)

**Interfaces:**
- Consumes: Task 8.
- Produces: the editor shows script.

- [ ] **Step 1: Switch the editor's format**

Replace `"yaml"` with `"script"` at every `formatPlaylist`/`formatSpec` call that fills the editor textarea (`src/main.ts:836,2893,3613,4545,5509`) and at the round-trip sites in `revise.ts`, `hoist.ts` and `course/load.ts`. Leave the download/share formats alone: YAML and JSON stay as export options in `src/ui/share.ts`.

- [ ] **Step 2: Update the insert palette**

`src/ui/insert.ts` inserts YAML snippets into the editor. Rewrite each snippet in script. Run `npx vitest run tests/insert.test.ts` if it exists; otherwise add one asserting that every snippet parses with `parseScriptPages`.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS. Any test asserting on the editor's YAML text is now asserting the wrong thing — update it to the script form and say so in the commit.

- [ ] **Step 4: Run the build**

Run: `npm run build`
Expected: `tsc` clean, then a successful vite build.

- [ ] **Step 5: Update the spec's status**

Mark §3-§6 and §8-§10 implemented, and note that phase 3 (sugar) is the next round.

- [ ] **Step 6: Merge and push**

```bash
git add -A
git commit -m "Script: the editor's format"
git checkout main && git merge --no-ff round/script && git push origin main
```

- [ ] **Step 7: Verify the deploy, then report**

Check the Netlify deploy state is `ready` before saying live (site id `abb0e02f-a8f0-4779-8e32-39bb83668600`). Report what a cast now looks like in the editor, and that a hand-written script and an AI-written cast are now the same language.

---

## Self-Review

**Spec coverage:** §3 (the three rules) — Tasks 1, 3. §4 (settings) — Task 4. §5 (directions, ids, values, total coverage) — Tasks 2, 3. §6 (sugar) — deliberately excluded; phase 3. §8.1 (pages/titles) — Tasks 4, 6. §8.2 (dialogue, labels) — Tasks 3, 5. §8.3 (questions) — reached by the generic form in Task 3; the `*`/`+` choice lists are phase-3 sugar. §8.4 (fences) — Tasks 4, 6. §8.5 (beat modifiers) — Task 3's `SCALAR_VERBS`. §9 (round trip) — Task 7. §10 (where it lands, detection) — Task 8, and the editor in Task 9. §11 (errors and lint) — the `ScriptError` line numbers are in Task 3; the two lint *rules* are phase 3, as the spec's §12 says.

**Deliberate omissions, named so they are choices:** the `tex` fence (a single-line `tex` key round-trips, so it is sugar); id-from-quoted-text (sugar, and it would make the printer's id handling conditional); `A:` printing for an explicit `voice: "a"` (Task 5 prints it, Task 3 parses it — kept because dropping it would lose the field).

**The risk this plan carries:** Task 7 is where the work actually is, and its size is unknown until it runs. It is deliberately a single task with an open-ended fix loop rather than a set of invented sub-tasks, because inventing them would mean guessing which fields break — and the corpus answers that in one run. If it turns up something structural (a verb whose arguments cannot be expressed in the `key value` grammar), stop and re-open the design rather than bending the printer.

**Type consistency check:** `ScriptLine` (lines.ts) is consumed only by parse.ts. `fieldLines`/`setPath` (values.ts) are the only path between nested spec objects and dotted lines, used by print.ts and parse.ts respectively. `ELEMENT_HEADS`, `LIST_VERBS`, `TARGET_VERBS`, `OBJECT_VERBS` and `SCALAR_VERBS` are defined once in parse.ts and imported by print.ts — the printer must not carry a second copy, or a verb added to one will print in a form the other cannot read.
