# Pointing into pictures — delivery 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `image` can be a full-colour screenshot from a URL, cropped by `view`, carrying hand-written named `regions`; `point`, `highlight` (new `box` effect), `focus` (a spotlight inside the picture) and `camera` aim at those regions, at picture fractions, or at the picture's named spots.

**Architecture:** One pure module (`src/spec/places.ts`) parses the place syntax (`md:name`, `md@[x,y,w,h]`, `md@[x,y]`, `md@top`) and maps picture fractions (top-left origin, of the WHOLE picture) to canvas boxes (y-up) through the shown picture's rectangle and its `view`. Layout records each picture's `view`/`regions`; the planner resolves a place string wherever it already takes an id (highlight/focus targets, `camera.on`) or a ref (`point.at.ref`, `camera.center.ref`) — so no command type changes shape. The resolver gains a `url` path that keeps colour and resolution for `look: "screen"`, falling back to a linked (not embedded) picture when the host refuses pixel reads.

**Tech Stack:** TypeScript, Vite, vitest (`npx vitest run <file>`), ajv JSON Schema (`src/spec/schema.ts`), SVG backend (`src/render/svg-backend.ts`), tests' mini-DOM (`tests/helpers/mini-dom.ts`).

**Spec:** `docs/superpowers/specs/2026-09-30-picture-regions-design.md` — this plan is its §11 delivery 1 (§3, §4, §5, the camera half of §7). Movement (§6), mapping (§8), text recognition and the picker are later plans.

## Global Constraints

- Picture fractions are `[x, y, w, h]` / `[x, y]` measured **from the top-left, y down, as fractions of the WHOLE picture** (never of `view`). The canvas is 1000 × 750, **y up**; the flip happens only in `fractionBox`.
- Region names match `^[A-Za-z_][\w-]*$` and are English ids (`command_line`).
- Element ids must not contain `:` or `@` (reserved for places). No existing example uses either (checked 2026-09-30).
- `look: "screen"` = full colour, no tint, longest side capped at **2400 px** (`SCREEN_DIM`). The default look of `image` is unchanged (240 px styled grey).
- Nothing about an ordinary (non-picture) id target may change behaviour: every existing test must still pass.
- The system prompt and schema sizes are a ratchet (`tests/prompt-size.test.ts`): re-pin both constants to the new measured sizes with a dated note in that file's own style — never loosen by more than was measured.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work in the worktree `.claude/worktrees/picture-regions` (branch `picture-regions`); another process is committing on main — never touch the main checkout.

## Review Focus

1. **A region name that does not exist** (`md:comand_line`, a typo) — expect a validation error naming the picture's actual regions, and at play time a plan warning, never a crash or a highlight at (0, 0). Pinned in Task 3 (schema) and Task 6 (plan).
2. **A place on something that is not a picture** (`eq:top_term` on a `math` element) — expect "is not a picture", not a silent id lookup. Pinned in Task 3 and Task 6.
3. **A region partly outside `view`** — the box is still computed from the whole picture and may extend past the shown image; expect the highlight to be drawn where the math says (clipping is not attempted), and validation to flag a region entirely outside the view. Pinned in Task 3.
4. **A host that refuses pixel reads (microdata.no)** — expect the picture shown linked, full size, with regions working; embed counts it as not embedded. Pinned in Task 4.
5. **A picture that has moved** (`move` on the image before the highlight) — the region box follows the owner's offset. Pinned in Task 6.

---

## File Structure

- Create `src/spec/places.ts` — place syntax, fraction→canvas math, picture validation errors. Pure; imported by schema, layout and plan.
- Modify `src/spec/trace.ts` — `lnk1:` linked-picture encoding, `decodePicture`.
- Modify `src/spec/types.ts` — `look`, `view`, `regions` on `SpecElement`; `"box"` in `HighlightEffect`.
- Modify `src/spec/schema.ts` — the three element properties, `box` in the highlight enum, image needs `of` or `url`, call `pictureErrors`.
- Modify `src/render/portrait.ts` — `faithfulDataUri`, `SCREEN_DIM`, `measureNatural`.
- Modify `src/render/image.ts` — the `url` path.
- Modify `src/ui/insert.ts` — `unembeddedImages` counts linked pictures.
- Modify `src/layout/model.ts` — `ImageDrawable.view`.
- Modify `src/layout/tier2.ts` — `imageDrawable`: `decodePicture`, `view`, default screen width, `ctx.pictures`.
- Modify `src/layout/layout.ts` — `LayoutResult.pictures`, carried from the tier-2 context.
- Modify `src/render/svg-backend.ts` — cropped image drawing, the `box` effect, `setSpotlight`/`endSpotlight`.
- Modify `src/render/backend.ts` — optional `setSpotlight`/`endSpotlight` on `BackendEffects`.
- Modify `src/render/plan.ts` — `pictureOf` option, `placeNow`, the four verbs, `focus` step `spots`.
- Modify `src/render/player.ts` — play `spots`.
- Modify `src/render/index.ts` — `planOptionsFor` supplies `pictureOf`.
- Modify `src/spec/script/parse.ts` — ids may be places.
- Modify `src/llm/prompts/compiler-v1.md`, `tests/prompt-size.test.ts`.
- Tests: `tests/picture-places.test.ts`, `tests/picture-trace.test.ts`, `tests/picture-schema.test.ts`, `tests/picture-resolve.test.ts`, `tests/picture-layout.test.ts`, `tests/picture-plan.test.ts`, `tests/picture-backend.test.ts`, `tests/picture-script.test.ts`.

---

### Task 1: Place syntax and picture fractions

**Files:**
- Create: `src/spec/places.ts`
- Test: `tests/picture-places.test.ts`

**Interfaces:**
- Produces:
  - `type Rect4 = [number, number, number, number]`
  - `type Place = {kind:"region"; owner; name} | {kind:"anchor"; owner; anchor} | {kind:"point"; owner; at:[number,number]} | {kind:"box"; owner; box: Rect4}`
  - `parsePlace(s: string): Place | null` — null when `s` is not place syntax (a plain id).
  - `interface PictureFrame { rect: BBox; view: Rect4 }` — `rect` is the shown picture on the canvas (y-up).
  - `fractionBox(f: PictureFrame, r: Rect4): BBox`, `fractionPoint(f: PictureFrame, p: [number, number]): Pt`
  - `FULL_VIEW4: Rect4 = [0, 0, 1, 1]`, `isRect4(v: unknown): v is Rect4`

- [ ] **Step 1: Write the failing test**

```ts
// tests/picture-places.test.ts
import { describe, expect, test } from "vitest";
import { FULL_VIEW4, fractionBox, fractionPoint, isRect4, parsePlace } from "../src/spec/places";

describe("parsePlace", () => {
  test("a region, an anchor, a point and a box", () => {
    expect(parsePlace("md:command_line")).toEqual({ kind: "region", owner: "md", name: "command_line" });
    expect(parsePlace("md@top_right")).toEqual({ kind: "anchor", owner: "md", anchor: "top_right" });
    expect(parsePlace("md@[0.6, 0.1]")).toEqual({ kind: "point", owner: "md", at: [0.6, 0.1] });
    expect(parsePlace("md@[0.2,0.9,0.8,0.1]")).toEqual({ kind: "box", owner: "md", box: [0.2, 0.9, 0.8, 0.1] });
  });
  test("a plain id, and malformed places, are not places", () => {
    expect(parsePlace("md")).toBeNull();
    expect(parsePlace("label_md")).toBeNull();
    expect(parsePlace("md@[0.1]")).toBeNull();
    expect(parsePlace("md@[a, b]")).toBeNull();
    expect(parsePlace("md:")).toBeNull();
    expect(parsePlace(":x")).toBeNull();
  });
});

describe("fractionBox", () => {
  // A 400 × 200 picture whose top-left corner is at canvas (100, 500) — y up,
  // so it spans y 300..500.
  const frame = { rect: { x: 100, y: 300, w: 400, h: 200 }, view: FULL_VIEW4 };
  test("top-left origin, y down, onto a y-up canvas", () => {
    expect(fractionBox(frame, [0, 0, 1, 1])).toEqual({ x: 100, y: 300, w: 400, h: 200 });
    // The top-left quarter: x 100..300, and the TOP half is y 400..500.
    expect(fractionBox(frame, [0, 0, 0.5, 0.5])).toEqual({ x: 100, y: 400, w: 200, h: 100 });
    expect(fractionPoint(frame, [1, 1])).toEqual([500, 300]);
  });
  test("fractions are of the WHOLE picture, shown through view", () => {
    // Only the right half is shown, stretched over the same rect.
    const half = { rect: frame.rect, view: [0.5, 0, 0.5, 1] as [number, number, number, number] };
    expect(fractionBox(half, [0.5, 0, 0.5, 1])).toEqual({ x: 100, y: 300, w: 400, h: 200 });
    expect(fractionBox(half, [0.75, 0, 0.25, 0.5])).toEqual({ x: 300, y: 400, w: 200, h: 100 });
  });
  test("isRect4", () => {
    expect(isRect4([0, 0, 1, 1])).toBe(true);
    expect(isRect4([0, 0, 1])).toBe(false);
    expect(isRect4([0, 0, "1", 1])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/picture-places.test.ts`
Expected: FAIL — cannot resolve `../src/spec/places`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/spec/places.ts
// Places on a picture (spec 2026-09-30-picture-regions §4): `md:name` (a
// named region), `md@top` (a named spot), `md@[x, y]` (a point) and
// `md@[x, y, w, h]` (a box). Picture fractions are measured from the
// TOP-LEFT, y down, as fractions of the WHOLE picture — the way a screenshot
// is read, and how source.ts's PhotoRects are born — never of `view`, so
// changing what is shown never moves a region. The canvas is y-up; the flip
// happens here and nowhere else.
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";

export type Rect4 = [number, number, number, number];

export type Place =
  | { kind: "region"; owner: string; name: string }
  | { kind: "anchor"; owner: string; anchor: string }
  | { kind: "point"; owner: string; at: [number, number] }
  | { kind: "box"; owner: string; box: Rect4 };

export const FULL_VIEW4: Rect4 = [0, 0, 1, 1];

const ID = "[A-Za-z_][\\w-]*";
const REGION_RE = new RegExp(`^(${ID}):(${ID})$`);
const AT_RE = new RegExp(`^(${ID})@(.+)$`);

/** The place `s` names, or null when `s` is a plain id (or not a well-formed place). */
export function parsePlace(s: string): Place | null {
  const t = s.trim();
  const r = REGION_RE.exec(t);
  if (r) return { kind: "region", owner: r[1], name: r[2] };
  const a = AT_RE.exec(t);
  if (!a) return null;
  const rest = a[2].trim();
  if (/^[A-Za-z_]\w*$/.test(rest)) return { kind: "anchor", owner: a[1], anchor: rest };
  const inner = /^\[(.*)\]$/.exec(rest)?.[1];
  if (inner === undefined) return null;
  const nums = inner.split(",").map((x) => (x.trim() === "" ? NaN : Number(x)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (nums.length === 2) return { kind: "point", owner: a[1], at: [nums[0], nums[1]] };
  if (nums.length === 4) return { kind: "box", owner: a[1], box: nums as Rect4 };
  return null;
}

export function isRect4(v: unknown): v is Rect4 {
  return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** The shown picture on the canvas (logical, y-up) and which part of the whole picture it shows. */
export interface PictureFrame {
  rect: BBox;
  view: Rect4;
}

/** A box in whole-picture fractions (top-left origin) → a canvas box (y-up). */
export function fractionBox(f: PictureFrame, r: Rect4): BBox {
  const [vx, vy, vw, vh] = f.view;
  const sx = f.rect.w / vw;
  const sy = f.rect.h / vh;
  const x = f.rect.x + (r[0] - vx) * sx;
  const top = f.rect.y + f.rect.h - (r[1] - vy) * sy;
  const h = r[3] * sy;
  return { x, y: top - h, w: r[2] * sx, h };
}

export function fractionPoint(f: PictureFrame, p: [number, number]): Pt {
  const b = fractionBox(f, [p[0], p[1], 0, 0]);
  return [b.x, b.y];
}
```

If `BBox` or `Pt` live elsewhere, fix the two import paths: `grep -n "export interface BBox\|export type Pt" src/layout/*.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/picture-places.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/spec/places.ts tests/picture-places.test.ts
git commit -m "Picture places: md:name / md@top / md@[x,y] / md@[x,y,w,h], whole-picture fractions onto the y-up canvas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A linked picture in `strokes`

**Files:**
- Modify: `src/spec/trace.ts` (after `decodePhoto`, ~line 86)
- Test: `tests/picture-trace.test.ts`

**Interfaces:**
- Produces:
  - `encodeLinkedPhoto(aspect: number, url: string): string` → `lnk1:<2-char aspect>:<url>`
  - `decodePicture(s: string): { aspect: number; href: string; linked: boolean } | null` — accepts `img1:` (via `decodePhoto`, `linked:false`) and `lnk1:` with an `https:` URL (`linked:true`).
  - `isLinkedPhoto(s: string | undefined): boolean`

Why: a host that refuses CORS (microdata.no answers without `Access-Control-Allow-Origin`) can still be SHOWN by an `<image href>`; only its pixels cannot be read. Layout is synchronous and needs the aspect, so the resolver stores aspect + URL. `decodePhoto` stays strict (data URIs only) so nothing that means "embedded" changes.

- [ ] **Step 1: Write the failing test**

```ts
// tests/picture-trace.test.ts
import { describe, expect, test } from "vitest";
import { decodePhoto, decodePicture, encodeLinkedPhoto, encodePhoto, isLinkedPhoto } from "../src/spec/trace";

describe("linked pictures", () => {
  const url = "https://microdata.no/manual/assets/images/image79.png";
  test("round-trip, aspect to 3 decimals", () => {
    const s = encodeLinkedPhoto(1041 / 1920, url);
    expect(s.startsWith("lnk1:")).toBe(true);
    const d = decodePicture(s)!;
    expect(d.href).toBe(url);
    expect(d.linked).toBe(true);
    expect(d.aspect).toBeCloseTo(1041 / 1920, 2);
    expect(isLinkedPhoto(s)).toBe(true);
  });
  test("an embedded photo decodes through decodePicture unchanged", () => {
    const s = encodePhoto(0.5, "data:image/png;base64,AAAA");
    expect(decodePicture(s)).toEqual({ ...decodePhoto(s)!, linked: false });
    expect(isLinkedPhoto(s)).toBe(false);
  });
  test("decodePhoto still refuses a link; decodePicture refuses non-https", () => {
    expect(decodePhoto(encodeLinkedPhoto(0.5, url))).toBeNull();
    expect(decodePicture(encodeLinkedPhoto(0.5, "javascript:alert(1)"))).toBeNull();
    expect(decodePicture(encodeLinkedPhoto(0.5, "http://x.org/a.png"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/picture-trace.test.ts`
Expected: FAIL — `encodeLinkedPhoto` is not exported.

- [ ] **Step 3: Write minimal implementation** — append after `decodePhoto` in `src/spec/trace.ts`, reusing the file's own `enc12`/`dec12` and the aspect convention `encodePhoto` uses (`enc12(Math.min(8, a) * 500)`, decoded `Math.max(0.05, raw / 500)` — copy exactly what `encodePhoto`/`decodePhoto` do):

```ts
/**
 * A LINKED picture (spec 2026-09-30-picture-regions §3): shown from its own
 * https URL because the host refuses pixel reads, so it could not be
 * embedded. `lnk1:<2-char aspect>:<url>` — the aspect because layout is
 * synchronous and must size the picture before it loads.
 */
export function encodeLinkedPhoto(aspect: number, url: string): string {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return `lnk1:${enc12(Math.min(8, a) * 500)}:${url}`;
}

export function isLinkedPhoto(s: string | undefined): boolean {
  return typeof s === "string" && s.startsWith("lnk1:");
}

/** An embedded photo (img1) or a linked one (lnk1, https only). */
export function decodePicture(s: string): { aspect: number; href: string; linked: boolean } | null {
  if (typeof s !== "string") return null;
  if (s.startsWith("lnk1:")) {
    const aspect = Math.max(0.05, dec12(s.slice(5, 7)) / 500);
    const href = s.slice(8);
    if (s[7] !== ":" || !href.startsWith("https://")) return null;
    return { aspect, href, linked: true };
  }
  const p = decodePhoto(s);
  return p ? { ...p, linked: false } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/picture-trace.test.ts tests/portrait-trace.test.ts tests/source-element.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spec/trace.ts tests/picture-trace.test.ts
git commit -m "Trace: lnk1 — a picture shown from its https URL when the host refuses pixel reads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Schema, types and validation

**Files:**
- Modify: `src/spec/types.ts` (`SpecElement` near `url` ~line 315; `HighlightEffect` line 423)
- Modify: `src/spec/schema.ts` (element props near `url` 376–380; highlight enum ~845; image rule 1957–1962; `semanticErrors` 1465)
- Modify: `src/spec/places.ts` (add `pictureErrors`)
- Test: `tests/picture-schema.test.ts`

**Interfaces:**
- Consumes: `parsePlace`, `isRect4`, `Rect4` (Task 1).
- Produces:
  - `SpecElement.look?: "screen"`, `SpecElement.view?: Rect4`, `SpecElement.regions?: Record<string, Rect4>`
  - `HighlightEffect` gains `"box"`.
  - `pictureErrors(spec: Spec): string[]` in `src/spec/places.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/picture-schema.test.ts
import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";

const md = {
  id: "md", type: "image", url: "https://microdata.no/a.png", look: "screen",
  view: [0, 0.069, 1, 0.931],
  regions: { datasets: [0, 0.069, 0.2, 0.466], command_line: [0.2, 0.97, 0.8, 0.03] },
};
const errorsOf = (spec: object) => {
  const r = validateSpec(spec) as { ok?: boolean; errors?: string[] };
  return (r.errors ?? []).join("\n");
};

describe("picture fields", () => {
  test("a url screenshot with view and regions is valid, and places in commands resolve", () => {
    const spec = {
      elements: [md],
      commands: [
        { draw: ["md"] },
        { highlight: { target: ["md:datasets"], effect: "box" } },
        { focus: { target: "md:command_line" } },
        { point: { at: { ref: "md:command_line" }, gesture: "underline" } },
        { camera: { on: ["md@[0.2, 0.9, 0.8, 0.1]"] } },
        { camera: { center: { ref: "md@top" } } },
      ],
    };
    expect(errorsOf(spec)).toBe("");
  });
  test("image needs of or url", () => {
    expect(errorsOf({ elements: [{ id: "p", type: "image" }], commands: [] })).toMatch(/image needs of or url/);
  });
  test("a region name that does not exist names the ones that do", () => {
    const spec = { elements: [md], commands: [{ draw: ["md"] }, { highlight: { target: "md:comand_line" } }] };
    expect(errorsOf(spec)).toMatch(/md has no region "comand_line" — it has: datasets, command_line/);
  });
  test("a place on something that is not an image", () => {
    const spec = { elements: [md, { id: "t", type: "text", text: "hi", x: 1, y: 1 }], commands: [{ highlight: { target: "t:x" } }] };
    expect(errorsOf(spec)).toMatch(/"t:x": t is not an image/);
  });
  test("bad region boxes, bad view, a region outside the view, reserved characters in ids", () => {
    const bad = { ...md, view: [0, 0, 1.5, 1], regions: { a: [0, 0, 2, 0.1], "b c": [0, 0, 0.1, 0.1] } };
    const e = errorsOf({ elements: [bad], commands: [] });
    expect(e).toMatch(/md: view must be \[x, y, w, h\] inside 0\.\.1/);
    expect(e).toMatch(/md: region "a" must be \[x, y, w, h\] inside 0\.\.1/);
    expect(e).toMatch(/md: region name "b c"/);
    const outside = { ...md, view: [0, 0, 0.5, 0.5], regions: { far: [0.8, 0.8, 0.1, 0.1] } };
    expect(errorsOf({ elements: [outside], commands: [] })).toMatch(/md: region "far" lies outside its view/);
    expect(errorsOf({ elements: [{ ...md, id: "m:d" }], commands: [] })).toMatch(/id "m:d" may not contain ":" or "@"/);
  });
  test("box is a highlight effect", () => {
    const spec = { elements: [{ id: "t", type: "text", text: "hi", x: 1, y: 1 }], commands: [{ highlight: { target: "t", effect: "box" } }] };
    expect(errorsOf(spec)).toBe("");
  });
});
```

Before running: open `validateSpec` (schema.ts ~2040) and check what it returns. If the error list is under a different name than `errors`, adjust `errorsOf` to match (e.g. `r.errors` vs `r.error`). Keep the assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/picture-schema.test.ts`
Expected: FAIL — ajv rejects `look`/`view`/`regions` as additional properties, and `box` is not in the enum.

- [ ] **Step 3: Write the implementation**

(a) `src/spec/types.ts` — `import type { Rect4 } from "./places";` at the top. After the `url?` field:

```ts
  /** image: "screen" — the faithful look for screenshots, diagrams and paintings: full colour, no tint, native resolution (≤ 2400 px). Default: the styled small photo. */
  look?: "screen";
  /** image: the part of the picture shown, [x, y, w, h] as fractions from the top-left (default the whole picture). */
  view?: Rect4;
  /** image: named boxes on the picture, [x, y, w, h] as fractions of the WHOLE picture from the top-left — targets as "<id>:<name>". */
  regions?: Record<string, Rect4>;
```

Line 423: `export type HighlightEffect = "pulse" | "circle" | "glow" | "underline" | "box";`

(b) `src/spec/schema.ts`, element properties next to `url` (376–380). Extend the `url` description to say "image: a direct picture URL". Add:

```ts
    look: { type: "string", enum: ["screen"], description: "image: \"screen\" keeps colour and resolution — screenshots, diagrams, paintings you point into." },
    view: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4, description: "image: the part shown, [x, y, w, h] fractions from the top-left." },
    regions: {
      type: "object",
      additionalProperties: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
      description: "image: named parts, name → [x, y, w, h] fractions of the whole picture from the top-left. Target one as \"<id>:<name>\"; any spot as \"<id>@[x, y, w, h]\" or \"<id>@[x, y]\".",
    },
```

Highlight `effect` (~845): enum `["glow", "circle", "underline", "pulse", "box"]`, and append to its description: `box = a box drawn round the target (the default on a picture place).`

Image rule (1957–1962) — split `image` off `icon`/`inset`:

```ts
    case "image":
      if ((typeof el.of !== "string" || el.of.trim() === "") && (typeof el.url !== "string" || el.url.trim() === "") && !el.strokes) {
        errs.push(`element "${el.id}": image needs of or url`);
      }
      break;
    case "icon":
    case "inset":
      if (typeof el.of !== "string" || el.of.trim() === "") {
        errs.push(`element "${el.id}": ${el.type} needs of`);
      }
      break;
```

Inside `semanticErrors` (1465), next to the other spec-wide checks: `errors.push(...pictureErrors(spec));` and import it from `./places`.

(c) `src/spec/places.ts` — append:

```ts
import type { Spec } from "./types";

const NAME_RE = /^[A-Za-z_][\w-]*$/;
const inUnit = (r: Rect4) => r.every((n) => n >= -1e-9) && r[0] + r[2] <= 1 + 1e-9 && r[1] + r[3] <= 1 + 1e-9;

/** Every place string a command aims at: highlight/focus targets, camera.on, point.at.ref, camera.center.ref. */
function placesInCommands(commands: unknown): string[] {
  const out: string[] = [];
  const list = (v: unknown) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const c = v as Record<string, any>;
    if (c.highlight) out.push(...list(c.highlight.target));
    if (c.focus) out.push(...list(c.focus.target));
    if (c.camera) out.push(...list(c.camera.on), ...list(c.camera.center?.ref));
    if (c.point) out.push(...list(c.point.at?.ref));
    for (const x of Object.values(c)) if (x && typeof x === "object") walk(x);
  };
  walk(commands);
  return [...new Set(out)].filter((s) => parsePlace(s) !== null);
}

/** Picture fields and the places commands aim at (spec 2026-09-30-picture-regions §3–§4). */
export function pictureErrors(spec: Spec): string[] {
  const errs: string[] = [];
  const els = spec.elements ?? [];
  for (const el of els) {
    if (/[:@]/.test(el.id)) errs.push(`element id "${el.id}" may not contain ":" or "@" (reserved for picture places)`);
    if (el.type !== "image") continue;
    const view = el.view ?? FULL_VIEW4;
    if (el.view !== undefined && (!isRect4(el.view) || !inUnit(el.view) || el.view[2] <= 0 || el.view[3] <= 0)) {
      errs.push(`${el.id}: view must be [x, y, w, h] inside 0..1 with w, h > 0`);
    }
    for (const [name, r] of Object.entries(el.regions ?? {})) {
      if (!NAME_RE.test(name)) errs.push(`${el.id}: region name "${name}" must be a word (letters, digits, _ or -)`);
      if (!isRect4(r) || !inUnit(r)) {
        errs.push(`${el.id}: region "${name}" must be [x, y, w, h] inside 0..1`);
        continue;
      }
      const overlaps = r[0] < view[0] + view[2] && r[0] + r[2] > view[0] && r[1] < view[1] + view[3] && r[1] + r[3] > view[1];
      if (!overlaps) errs.push(`${el.id}: region "${name}" lies outside its view`);
    }
  }
  const byId = new Map(els.map((e) => [e.id, e]));
  for (const s of placesInCommands(spec.commands)) {
    const p = parsePlace(s)!;
    const owner = byId.get(p.owner);
    if (!owner || owner.type !== "image") {
      errs.push(`"${s}": ${p.owner} is not an image`);
      continue;
    }
    if (p.kind === "region" && !(owner.regions && p.name in owner.regions)) {
      const names = Object.keys(owner.regions ?? {});
      errs.push(`"${s}": ${p.owner} has no region "${p.name}" — it has: ${names.length > 0 ? names.join(", ") : "none"}`);
    }
  }
  return errs;
}
```

Wording check: the tests expect `md has no region "comand_line" — it has: datasets, command_line`, which the message above contains after its `"md:comand_line": ` prefix, and `"t:x": t is not an image`.

Check whether a playlist's `commands` live under `spec.commands` (they do in `validateSpec`'s tests; confirm with `grep -n "spec.commands" src/spec/schema.ts | head -3`).

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/picture-schema.test.ts tests/image-resolve.test.ts tests/image-layout.test.ts`
Expected: PASS. Then run the whole suite, `npx vitest run 2>&1 | tail -15`. The expected failure is `tests/prompt-size.test.ts` (the schema grew). Re-pin it in Task 9, not here; note the new size.

- [ ] **Step 5: Commit**

```bash
git add src/spec/types.ts src/spec/schema.ts src/spec/places.ts tests/picture-schema.test.ts
git commit -m "Schema: image look/view/regions, highlight effect box, image needs of or url; picture places validated against the picture's regions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Resolve a picture from its URL

**Files:**
- Modify: `src/render/portrait.ts` (near `LOOK_DIM` line 82 and `styledPhotoDataUri` 130–148)
- Modify: `src/render/image.ts` (deps 66–77, key 86–90, loop 106–166)
- Modify: `src/ui/insert.ts:281-286` (`unembeddedImages`)
- Test: `tests/picture-resolve.test.ts`

**Interfaces:**
- Consumes: `encodeLinkedPhoto`, `isLinkedPhoto` (Task 2); `SpecElement.look` (Task 3).
- Produces:
  - `SCREEN_DIM = 2400` and `faithfulDataUri(r: Raster): string` (PNG, colour untouched), `measureNatural(url: string): Promise<{ width: number; height: number }>` in portrait.ts.
  - `ImageDeps` gains `encodeScreen: (r: Raster) => string` and `measure: (url: string) => Promise<{ width: number; height: number }>`.
  - Resolution for an image with `url`: `el.strokes = img1:` (the pixels could be read) or `lnk1:` (they could not). `el.credit` is kept as authored.

- [ ] **Step 1: Write the failing test**

```ts
// tests/picture-resolve.test.ts
import { describe, expect, test } from "vitest";
import { resolveImages } from "../src/render/image";
import { decodePicture } from "../src/spec/trace";
import { unembeddedImages } from "../src/ui/insert";

const raster = (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), naturalWidth: w, naturalHeight: h });
const base = {
  fetch: (async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch,
  encode: () => "data:image/jpeg;base64,GREY",
  encodeScreen: () => "data:image/png;base64,COLOUR",
  measure: async () => ({ width: 1920, height: 1041 }),
};

describe("an image from its url", () => {
  test("look screen: full colour at SCREEN_DIM, credit kept", async () => {
    const dims: number[] = [];
    const spec = { elements: [{ id: "md", type: "image", url: "https://example.org/shot.png", look: "screen", credit: "Sikt" }] };
    const deps = { ...base, loadRaster: async (_u: string, d: number) => (dims.push(d), raster(1920, 1041)) };
    const [r] = await resolveImages(spec as never, deps as never);
    expect(r.ok).toBe(true);
    const el = spec.elements[0] as { strokes?: string; credit?: string };
    const pic = decodePicture(el.strokes!)!;
    expect(pic).toMatchObject({ href: "data:image/png;base64,COLOUR", linked: false });
    expect(pic.aspect).toBeCloseTo(1041 / 1920, 2);
    expect(dims).toEqual([2400]);
    expect(el.credit).toBe("Sikt");
  });
  test("without look: the styled small photo, as for Commons", async () => {
    const dims: number[] = [];
    const spec = { elements: [{ id: "p", type: "image", url: "https://example.org/pic.jpg" }] };
    await resolveImages(spec as never, { ...base, loadRaster: async (_u: string, d: number) => (dims.push(d), raster(240, 120)) } as never);
    expect(decodePicture((spec.elements[0] as { strokes: string }).strokes)!.href).toBe("data:image/jpeg;base64,GREY");
    expect(dims).toEqual([240]);
  });
  test("a host that refuses pixel reads: shown linked, at its natural aspect", async () => {
    const spec = { elements: [{ id: "md", type: "image", url: "https://microdata.no/shot.png", look: "screen" }] };
    const deps = { ...base, loadRaster: async () => { throw new Error("tainted canvas"); } };
    const [r] = await resolveImages(spec as never, deps as never);
    expect(r.ok).toBe(true);
    const pic = decodePicture((spec.elements[0] as { strokes: string }).strokes)!;
    expect(pic).toMatchObject({ href: "https://microdata.no/shot.png", linked: true });
    expect(pic.aspect).toBeCloseTo(1041 / 1920, 2);
  });
  test("a linked picture counts as not embedded", () => {
    const playlist = { items: [{ spec: { elements: [{ id: "md", type: "image", url: "https://x.org/a.png", strokes: "lnk1:AA:https://x.org/a.png" }] } }] };
    expect(unembeddedImages(playlist as never)).toBe(1);
  });
});
```

Check the `Playlist` shape `unembeddedImages` walks (`itemsOf` in insert.ts). If it isn't `{ items: [{ spec }] }`, build the fixture the way `tests/portrait-insert.test.ts` does.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/picture-resolve.test.ts`
Expected: FAIL — the url image gets "image has no description or readable strokes".

- [ ] **Step 3: Write the implementation**

(a) `src/render/portrait.ts`, next to `LOOK_DIM`:

```ts
/** Longest side of a `look: "screen"` picture: a screenshot must survive a 4× zoom (spec 2026-09-30-picture-regions §3). */
export const SCREEN_DIM = 2400;
```

Next to `styledPhotoDataUri`, following its canvas creation exactly (same `document.createElement("canvas")` and `putImageData`), but with no pixel changes and PNG output:

```ts
/** The faithful look: the raster's own colours, lossless — screenshots, diagrams, paintings. */
export function faithfulDataUri(r: Raster): string {
  const c = document.createElement("canvas");
  c.width = r.width;
  c.height = r.height;
  const ctx = c.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  return c.toDataURL("image/png");
}

/** A picture's natural size WITHOUT reading its pixels (no crossOrigin, so a CORS-refusing host still answers). */
export function measureNatural(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(`picture did not load: ${url}`));
    img.src = url;
  });
}
```

(b) `src/render/image.ts`:
- `ImageDeps` gains `encodeScreen: (raster: Raster) => string;` and `measure: (url: string) => Promise<{ width: number; height: number }>;`. `defaultDeps()` adds `encodeScreen: faithfulDataUri, measure: measureNatural`. Import `faithfulDataUri`, `measureNatural`, `SCREEN_DIM` from `./portrait` and `encodeLinkedPhoto`, `isLinkedPhoto` from `../spec/trace`.
- Bump `IMAGE_VERSION` to 2.
- The cache key (86–90) now also covers url images, still keyed on `of` for Commons:

```ts
export function imageCacheKey(el: SpecElement): string | null {
  if (el.type !== "image" || (el.strokes && !isLinkedPhoto(el.strokes))) return null;
  if (el.url) return `i${IMAGE_VERSION}|url|${el.look ?? "photo"}|${el.url.trim()}`;
  if (!el.of) return null;
  return `i${IMAGE_VERSION}|${el.of.trim().toLowerCase()}`;
}
```

(Keep the function's existing name if it is not `imageCacheKey`.)

- In the loop, the "already resolved" check (110–114) must NOT count a linked picture as resolved, so a later embed can try again:

```ts
      const inline = inlineStrokes(spec, el);
      if (inline && decodePhoto(inline)) { out.push({ id: el.id, ok: true }); continue; }
```

(`decodePhoto` refuses `lnk1:`, so a linked one falls through to the url path.)
- Before the Commons branch, on a cache miss:

```ts
        if (el.url) {
          const url = el.url.trim();
          let strokes: string;
          try {
            const screen = el.look === "screen";
            const raster = await deps.loadRaster(url, screen ? SCREEN_DIM : LOOK_DIM.photo);
            strokes = encodePhoto(raster.height / raster.width, screen ? deps.encodeScreen(raster) : deps.encode(raster));
          } catch {
            // The host refuses pixel reads (no CORS header) — still SHOWN, by link.
            const n = await deps.measure(url);
            strokes = encodeLinkedPhoto(n.height / n.width, url);
          }
          const value = JSON.stringify({ strokes, source: url });
          await cachePut(key, value);
          el.strokes = strokes;
          el.source = url;
          out.push({ id: el.id, ok: true });
          continue;
        }
```

Match the loop's real control flow: where the cached value is read back and applied, apply `strokes`/`source` the same way. Never overwrite an authored `credit` on the url path. If the loop is not a `for … of` with `continue`, restructure the branch to fit. The test's contract is what counts.

(c) `src/ui/insert.ts` `unembeddedImages`: replace `!e.strokes` with `(!e.strokes || isLinkedPhoto(e.strokes))`, importing `isLinkedPhoto` from `../spec/trace`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/picture-resolve.test.ts tests/image-resolve.test.ts tests/render-resolve.test.ts tests/publish-embed.test.ts tests/portrait-insert.test.ts`
Expected: PASS. If `image-resolve.test.ts` builds its own `deps` without `encodeScreen`/`measure`, that is fine: Commons images never call them.

- [ ] **Step 5: Commit**

```bash
git add src/render/portrait.ts src/render/image.ts src/ui/insert.ts tests/picture-resolve.test.ts
git commit -m "Image from a url: look screen keeps colour at 2400 px; a CORS-refusing host is shown linked at its natural aspect

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Layout and drawing of a screen picture

**Files:**
- Modify: `src/layout/model.ts:201-211` (`ImageDrawable`)
- Modify: `src/layout/tier2.ts:1968-2023` (`imageDrawable`) and the tier-2 `Ctx` type (search `interface Ctx` in tier2.ts; `namedAnchors` is declared there)
- Modify: `src/layout/layout.ts` (`LayoutResult` ~line 44; where `namedAnchors` is copied from the tier-2 context into the result)
- Modify: `src/render/svg-backend.ts:504-515`
- Test: `tests/picture-layout.test.ts`

**Interfaces:**
- Consumes: `decodePicture` (Task 2), `FULL_VIEW4`, `Rect4` (Task 1).
- Produces:
  - `ImageDrawable.view?: Rect4` — the part of the picture drawn into `pos/w/h`.
  - `LayoutResult.pictures?: Record<string, { view: Rect4; regions: Record<string, Rect4> }>`, set for every drawn image that has `look: "screen"`, `view` or `regions`.
  - The shown picture's canvas rect is the drawable `${id}__img`: centre `pos`, size `w × h`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/picture-layout.test.ts
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { encodePhoto, encodeLinkedPhoto } from "../src/spec/trace";
import { heuristicMeasure } from "../src/layout/measure";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";
import { rendererFor } from "../src/render/svg-backend";

const shot = encodePhoto(0.5, "data:image/png;base64,AAAA"); // 2:1 picture
const img = (r: ReturnType<typeof layoutSpec>, id = "md") => flattenDrawables(r.drawables).find((d) => d.id === `${id}__img`) as any;

describe("screen picture layout", () => {
  test("look screen defaults to 900 wide; view crops and sets the shown aspect", () => {
    const r = layoutSpec({ elements: [{ id: "md", type: "image", url: "https://x.org/a.png", look: "screen", strokes: shot, view: [0, 0, 1, 0.5] }], commands: [{ draw: ["md"] }] } as never);
    const d = img(r);
    expect(d.w).toBe(900);
    // Whole picture 900 × 450; the top half of it shown → 900 × 225.
    expect(d.h).toBeCloseTo(225, 5);
    expect(d.view).toEqual([0, 0, 1, 0.5]);
    expect(r.pictures?.md).toEqual({ view: [0, 0, 1, 0.5], regions: {} });
  });
  test("regions are carried to the layout result; an ordinary image carries none", () => {
    const regions = { top: [0, 0, 1, 0.5] };
    const r = layoutSpec({
      elements: [
        { id: "md", type: "image", url: "https://x.org/a.png", look: "screen", strokes: shot, regions },
        { id: "p", type: "image", of: "Bicycle pump", strokes: shot },
      ],
      commands: [{ draw: ["md", "p"] }],
    } as never);
    expect(r.pictures?.md).toEqual({ view: [0, 0, 1, 1], regions });
    expect(r.pictures?.p).toBeUndefined();
    expect(img(r, "p").w).toBe(220);
  });
  test("a linked picture lays out like an embedded one", () => {
    const r = layoutSpec({ elements: [{ id: "md", type: "image", url: "https://x.org/a.png", look: "screen", strokes: encodeLinkedPhoto(0.5, "https://x.org/a.png") }], commands: [{ draw: ["md"] }] } as never);
    expect(img(r)).toMatchObject({ kind: "image", href: "https://x.org/a.png", w: 900 });
  });
  test("the svg draws a cropped picture through a nested viewBox", async () => {
    const { restore, doc } = installMiniDom();
    try {
      const spec = { elements: [{ id: "md", type: "image", url: "https://x.org/a.png", look: "screen", strokes: shot, view: [0.5, 0, 0.5, 1] }], commands: [{ draw: ["md"] }] };
      const layout = layoutSpec(spec as never, heuristicMeasure);
      const container = new FakeNode("div", doc as never);
      await rendererFor("clean").mount(layout, spec as never, container as never);
      const all: FakeNode[] = [];
      const walk = (n: FakeNode) => { all.push(n); n.children.forEach(walk); };
      walk(container);
      const nested = all.find((n) => n.tagName === "svg" && n.getAttribute("viewBox") === "500 0 500 1000");
      expect(nested).toBeDefined();
      expect(nested!.children[0].getAttribute("width")).toBe("1000");
    } finally {
      restore();
    }
  });
});
```

Check how `FakeNode` exposes its tag name (`tagName`, `nodeName` or `tag`) in `tests/helpers/mini-dom.ts` and use that property.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/picture-layout.test.ts`
Expected: FAIL — `w` is 220 and `pictures` is undefined.

- [ ] **Step 3: Write the implementation**

(a) `src/layout/model.ts`, `ImageDrawable`: add

```ts
  /** The part of the picture drawn into pos/w/h, [x, y, w, h] fractions from the top-left (default the whole). */
  view?: [number, number, number, number];
```

(b) `src/layout/tier2.ts`:
- In the `Ctx` interface, add `pictures: Record<string, { view: Rect4; regions: Record<string, Rect4> }>;` and initialise it to `{}` wherever `namedAnchors: {}` is initialised (search `namedAnchors: {}`).
- In `imageDrawable`, replace the decode and the sizing:

```ts
  const photo = el.strokes ? decodePicture(el.strokes) : null;
  if (!photo) {
    ctx.warnings.push(`no image found for "${el.of ?? el.url ?? el.id}"`);
    return null;
  }
  const screen = el.look === "screen";
  const view = isRect4(el.view) && el.view[2] > 0 && el.view[3] > 0 ? el.view : FULL_VIEW4;
  const w = el.width ?? (screen ? 900 : 220);
  // The shown part's aspect: the whole picture's, times how much taller than wide the view is.
  const h = w * photo.aspect * (view[3] / view[2]);
```

In the `__img` child, add `...(view !== FULL_VIEW4 ? { view } : {}),`. After `ctx.namedAnchors[el.id] = …`:

```ts
  if (screen || el.view !== undefined || el.regions !== undefined) {
    ctx.pictures[el.id] = { view, regions: el.regions ?? {} };
  }
```

Import `decodePicture` from `../spec/trace`, and `FULL_VIEW4`, `isRect4`, `Rect4` from `../spec/places`.

(c) `src/layout/layout.ts`: add to `LayoutResult`:

```ts
  /** Pictures you can point into (spec 2026-09-30-picture-regions): per image id, the part shown and its named regions. The shown rect is the `<id>__img` drawable. */
  pictures?: Record<string, { view: [number, number, number, number]; regions: Record<string, [number, number, number, number]> }>;
```

Where the result object copies `namedAnchors` from the tier-2 context, copy `pictures` the same way, only when non-empty: `...(Object.keys(ctx.pictures).length > 0 ? { pictures: ctx.pictures } : {})`. Also check `withMinted` in `src/render/index.ts` (and any other function that rebuilds a `LayoutResult` from parts) spreads the rest of the layout so `pictures` survives. Grep `namedAnchors:` in `src/layout` and `src/render` to find every such copy.

(d) `src/render/svg-backend.ts:504-515`: when `d.view` is set, draw the picture into a nested `<svg>` whose viewBox selects the view:

```ts
  if (d.kind === "image") {
    const img = document.createElementNS(SVG_NS, "image");
    img.setAttribute("href", d.href);
    img.setAttribute("preserveAspectRatio", "none");
    if (d.style.opacity < 1) img.setAttribute("opacity", String(d.style.opacity));
    const x = d.pos[0] - d.w / 2;
    const y = toSvgY(d.pos[1] + d.h / 2);
    if (d.view) {
      // The whole picture in a 1000 × 1000 unit space; the viewBox picks the
      // shown part and stretches it over the drawable's box.
      const [vx, vy, vw, vh] = d.view;
      const box = document.createElementNS(SVG_NS, "svg");
      box.setAttribute("x", String(x));
      box.setAttribute("y", String(y));
      box.setAttribute("width", String(d.w));
      box.setAttribute("height", String(d.h));
      box.setAttribute("viewBox", `${vx * 1000} ${vy * 1000} ${vw * 1000} ${vh * 1000}`);
      box.setAttribute("preserveAspectRatio", "none");
      img.setAttribute("x", "0");
      img.setAttribute("y", "0");
      img.setAttribute("width", "1000");
      img.setAttribute("height", "1000");
      box.appendChild(img);
      g.appendChild(box);
      return g;
    }
    img.setAttribute("x", String(x));
    img.setAttribute("y", String(y));
    img.setAttribute("width", String(d.w));
    img.setAttribute("height", String(d.h));
    g.appendChild(img);
    return g;
  }
```

(The 1000 × 1000 square is stretched non-uniformly both ways. That's right, since `preserveAspectRatio="none"` holds at both levels and the shown aspect was computed in layout.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/picture-layout.test.ts tests/image-layout.test.ts tests/portrait-element.test.ts tests/source-element.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/layout/model.ts src/layout/tier2.ts src/layout/layout.ts src/render/svg-backend.ts src/render/index.ts tests/picture-layout.test.ts
git commit -m "Layout: a screen picture is 900 wide, cropped by view (a nested viewBox), and reports its view and regions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The planner aims at places

**Files:**
- Modify: `src/render/plan.ts`: `PlanOptions` (273), the helper block after `resolvePoint` (~760), highlight (~1170), focus (~1188), point (~1231), camera (~1822), the focus plan-step type (~95; search `kind: "focus"` in the `PlanStep` union)
- Modify: `src/render/index.ts` `planOptionsFor` (131): supply `pictureOf`, and add `"pictureOf"` to its `Pick<…>` list
- Test: `tests/picture-plan.test.ts`

**Interfaces:**
- Consumes: `parsePlace`, `fractionBox`, `fractionPoint`, `PictureFrame`, `Rect4` (Task 1); `LayoutResult.pictures`, the `<id>__img` drawable (Task 5).
- Produces:
  - `PlanOptions.pictureOf?: (id: string) => { frame: PictureFrame; regions: Record<string, Rect4> } | null`
  - Focus plan step gains `spots?: { frame: BBox; holes: BBox[] }[]`: the picture's current rect and the lit boxes on it.
  - A highlight step's `boxes` is keyed by the place string itself (e.g. `"md:datasets"`), and `ids` contains that string. Default effect `"box"` when every target is a place; `glow`/`pulse` on a place becomes `"box"`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/picture-plan.test.ts
import { describe, expect, test } from "vitest";
import { planCommands } from "../src/render/plan";
import { FULL_VIEW4 } from "../src/spec/places";

// A picture shown at x 100..500, y 300..500 (y up); regions in top-left fractions.
const rect = { x: 100, y: 300, w: 400, h: 200 };
const regions = { left: [0, 0, 0.5, 1] as [number, number, number, number], bottom: [0, 0.9, 1, 0.1] as [number, number, number, number] };
const opts = {
  bboxOf: (id: string) => (id === "md" ? rect : id === "t" ? { x: 0, y: 0, w: 10, h: 10 } : null),
  pictureOf: (id: string) => (id === "md" ? { frame: { rect, view: FULL_VIEW4 }, regions } : null),
};
const plan = (commands: object[]) => planCommands(commands as never, ["md", "t"], opts as never);
const stepOf = (p: ReturnType<typeof plan>, kind: string) => p.steps.find((s: any) => s.kind === kind) as any;

describe("places in the planner", () => {
  test("highlight a region: a box step on the region's canvas box", () => {
    const p = plan([{ draw: ["md"] }, { highlight: { target: "md:left" } }]);
    const s = stepOf(p, "highlight");
    expect(s.effect).toBe("box");
    expect(s.ids).toEqual(["md:left"]);
    expect(s.boxes["md:left"]).toEqual({ x: 100, y: 300, w: 200, h: 200 });
    expect(p.warnings).toEqual([]);
  });
  test("highlight with part naming a region is the same as the region", () => {
    const s = stepOf(plan([{ draw: ["md"] }, { highlight: { target: "md", part: "bottom" } }]), "highlight");
    expect(s.ids).toEqual(["md:bottom"]);
    expect(s.boxes["md:bottom"].y).toBeCloseTo(300, 5);
    expect(s.boxes["md:bottom"].h).toBeCloseTo(20, 5);
    expect(s.part).toBeUndefined();
  });
  test("glow on a place becomes box; an ordinary id keeps glow", () => {
    expect(stepOf(plan([{ draw: ["md"] }, { highlight: { target: "md@[0,0,0.5,0.5]", effect: "glow" } }]), "highlight").effect).toBe("box");
    expect(stepOf(plan([{ draw: ["md", "t"] }, { highlight: { target: "t" } }]), "highlight").effect).toBe("glow");
  });
  test("point at a region, at a region's anchor, at a fraction", () => {
    let s = stepOf(plan([{ draw: ["md"] }, { point: { at: { ref: "md:left" } } }]), "point");
    expect([s.x, s.y]).toEqual([200, 400]);
    expect(s.box).toEqual({ x: 100, y: 300, w: 200, h: 200 });
    s = stepOf(plan([{ draw: ["md"] }, { point: { at: { ref: "md:left", anchor: "top" } } }]), "point");
    expect([s.x, s.y]).toEqual([200, 500]);
    s = stepOf(plan([{ draw: ["md"] }, { point: { at: { ref: "md@[0.6, 0.1]" } } }]), "point");
    expect(s.x).toBeCloseTo(340, 5);
    expect(s.y).toBeCloseTo(480, 5);
    s = stepOf(plan([{ draw: ["md"] }, { point: { at: { ref: "md@top" } } }]), "point");
    expect([s.x, s.y]).toEqual([300, 500]);
  });
  test("camera on a region frames its box", () => {
    const p = plan([{ draw: ["md"] }, { camera: { on: ["md:left"] } }]);
    const s = stepOf(p, "camera");
    // The framed box is centred on the region (the fit lifts it a little: compare x only).
    expect(s.box.x + s.box.w / 2).toBeCloseTo(200, 0);
  });
  test("focus on a region: the picture stays lit, one spot with the region as its hole", () => {
    const s = stepOf(plan([{ draw: ["md", "t"] }, { focus: { target: "md:left" } }]), "focus");
    expect(s.ids).toContain("md");
    expect(s.ids).not.toContain("t");
    expect(s.spots).toEqual([{ frame: rect, holes: [{ x: 100, y: 300, w: 200, h: 200 }] }]);
  });
  test("a moved picture: the region follows it", () => {
    const s = stepOf(plan([{ draw: ["md"] }, { move: { target: "md", by: [50, -20] } }, { highlight: { target: "md:left" } }]), "highlight");
    expect(s.boxes["md:left"]).toEqual({ x: 150, y: 280, w: 200, h: 200 });
  });
  test("a missing region and a non-picture owner warn and skip", () => {
    const p = plan([{ draw: ["md", "t"] }, { highlight: { target: "md:nope" } }, { point: { at: { ref: "t:x" } } }]);
    expect(p.steps.some((s: any) => s.kind === "highlight" || s.kind === "point")).toBe(false);
    expect(p.warnings.join("\n")).toMatch(/md has no region "nope" — it has: left, bottom/);
    expect(p.warnings.join("\n")).toMatch(/"t" is not a picture/);
  });
  test("a place on a picture not yet drawn is skipped with a warning", () => {
    const p = plan([{ highlight: { target: "md:left" } }]);
    expect(p.steps.some((s: any) => s.kind === "highlight")).toBe(false);
    expect(p.warnings.join("\n")).toMatch(/"md:left" is not visible/);
  });
});
```

Check how `move` records offsets in this planner (a `move` with `by` and no duration may still animate). If the moved-picture test needs `duration: 0`, or the plan's step list names things differently, adjust the fixture, not the assertion's meaning.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/picture-plan.test.ts`
Expected: FAIL — unknown id "md:left" warnings, no steps.

- [ ] **Step 3: Write the implementation**

(a) `PlanOptions` (273), add:

```ts
  /** A picture you can point into (spec 2026-09-30-picture-regions): its shown rect and view, and its named regions. Null for anything else. */
  pictureOf?: (id: string) => { frame: PictureFrame; regions: Record<string, Rect4> } | null;
```

Import `parsePlace`, `fractionBox`, `fractionPoint`, `PictureFrame` and `Rect4` from `../spec/places`.

(b) Right after `resolvePoint` (~760):

```ts
  /**
   * A picture place (`md:name`, `md@[x, y, w, h]`, `md@[x, y]`, `md@top`)
   * where it stands NOW — the picture's rect moved by its owner's offset —
   * or null when `s` is not place syntax (a plain id: the caller carries on
   * as before). "skip" when it names a place that cannot be aimed at; the
   * warning says why. A place on a picture not yet drawn is skipped for the
   * gestures that need it on screen (`mustShow`).
   */
  type PlaceNow = { owner: string; kind: "region" | "box" | "point" | "anchor"; box: BBox; point: Pt; frame: BBox };
  const placeNow = (s: string, verb: string, mustShow: boolean): PlaceNow | "skip" | null => {
    const p = parsePlace(s);
    if (!p) return null;
    const pic = opts.pictureOf?.(p.owner) ?? null;
    if (!pic) {
      warnings.push(`${verb}: "${p.owner}" is not a picture (in "${s}")`);
      return "skip";
    }
    if (!visibleSet.has(p.owner)) {
      warnings.push(`${verb} target "${s}" is not visible at that point${mustShow ? " (skipped)" : ""}`);
      if (mustShow) return "skip";
    }
    const [dx, dy] = offsets[p.owner] ?? [0, 0];
    const shift = (b: BBox): BBox => ({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });
    const frame = shift(pic.frame.rect);
    let box: BBox;
    if (p.kind === "region") {
      const r = pic.regions[p.name];
      if (!r) {
        const names = Object.keys(pic.regions);
        warnings.push(`${verb}: ${p.owner} has no region "${p.name}" — it has: ${names.length > 0 ? names.join(", ") : "none"}`);
        return "skip";
      }
      box = shift(fractionBox(pic.frame, r));
    } else if (p.kind === "box") box = shift(fractionBox(pic.frame, p.box));
    else if (p.kind === "point") {
      const [x, y] = fractionPoint(pic.frame, p.at);
      box = { x: x + dx, y: y + dy, w: 0, h: 0 };
    } else box = frame;
    let point: Pt = [box.x + box.w / 2, box.y + box.h / 2];
    if (p.kind === "anchor") {
      if (!isUniversalAnchor(p.anchor)) warnings.push(`${verb}: a picture has no anchor "${p.anchor}" — using center`);
      point = boxAnchor(frame, isUniversalAnchor(p.anchor) ? p.anchor : "center");
    }
    return { owner: p.owner, kind: p.kind, box, point, frame };
  };
```

(`offsets`, `visibleSet`, `warnings`, `boxAnchor` and `isUniversalAnchor` are already in scope here: `currentBox` and `anchorOriginal` use them.)

(c) Highlight (~1170), replace the head of the branch up to `pushStep`:

```ts
    } else if (cmd.highlight !== undefined) {
      let raw = typeof cmd.highlight.target === "string" ? [cmd.highlight.target] : cmd.highlight.target ?? [];
      let part = cmd.highlight.part;
      // `{target: md, part: bottom}` on a picture names its region.
      if (part !== undefined && raw.some((t) => opts.pictureOf?.(t)?.regions[part!])) {
        raw = raw.map((t) => (opts.pictureOf?.(t)?.regions[part!] ? `${t}:${part}` : t));
        part = undefined;
      }
      const places: Record<string, BBox> = {};
      const plain: string[] = [];
      for (const t of raw) {
        const pl = placeNow(t, "highlight", true);
        if (pl === null) plain.push(t);
        else if (pl !== "skip") {
          if (pl.kind === "point" || pl.kind === "anchor") warnings.push(`highlight: "${t}" is a point, not a box — use point, or a box "${pl.owner}@[x, y, w, h]"`);
          else places[t] = pl.box;
        }
      }
      const ids = [...visibleTargets(plain, "highlight"), ...Object.keys(places)];
      if (ids.length === 0) continue;
      const boxes: Record<string, BBox> = { ...places };
      for (const id of ids) {
        if (id in places) continue;
        const box = bboxOf(id); // layout box; the player adds the live offset
        if (box) boxes[id] = box;
      }
      const anyPlace = Object.keys(places).length > 0;
      const asked = cmd.highlight.effect;
      const effect = anyPlace && (asked === undefined || asked === "glow" || asked === "pulse") ? "box" : asked ?? "glow";
      pushStep({
        kind: "highlight",
        ids,
        boxes,
        effect,
        seconds: cmd.highlight.duration ?? 1.5,
        color: cmd.highlight.color,
        ...(part ? { part } : {}),
        ...(cmd.highlight.duration === undefined && currentNarration !== undefined ? { untilNarrationEnd: true } : {}),
      });
```

Note: the player adds `before.offsets[id]` to each box. For a place key there is no offset entry, so the box computed here (already moved) is used as is. That's correct.

(d) Focus (~1188): before `visibleTargets`, split places off the same way:

```ts
      const rawF = typeof cmd.focus.target === "string" ? [cmd.focus.target] : cmd.focus.target ?? [];
      const spotsBy = new Map<string, { frame: BBox; holes: BBox[] }>();
      const plainF: string[] = [];
      for (const t of rawF) {
        const pl = placeNow(t, "focus", true);
        if (pl === null) plainF.push(t);
        else if (pl !== "skip") {
          const s = spotsBy.get(pl.owner) ?? { frame: pl.frame, holes: [] };
          s.holes.push(pl.kind === "point" || pl.kind === "anchor" ? { x: pl.point[0] - 30, y: pl.point[1] - 30, w: 60, h: 60 } : pl.box);
          spotsBy.set(pl.owner, s);
        }
      }
      const ids = [...visibleTargets(plainF, "focus"), ...[...spotsBy.keys()].filter((o) => !plainF.includes(o))];
      if (ids.length === 0) continue;
```

Then the existing `kept` logic runs unchanged on `ids` (so the picture's caption stays lit with it). In `pushStep`, add `...(spotsBy.size > 0 ? { spots: [...spotsBy.values()] } : {}),`. Add `spots?: { frame: BBox; holes: BBox[] }[];` to the focus step type.

(e) Point (~1231): at the top of the branch, after `const at = cmd.point.at;`:

```ts
      if (at?.ref !== undefined) {
        const pl = placeNow(at.ref, "point", false);
        if (pl === "skip") continue;
        if (pl !== null) {
          const areal = pl.kind === "region" || pl.kind === "box";
          const [px, py] = areal && at.anchor !== undefined ? boxAnchor(pl.box, at.anchor) : pl.point;
          pushStep({ kind: "point", x: px, y: py, box: areal ? pl.box : undefined, refId: pl.owner, gesture: cmd.point.gesture ?? "tap", seconds: cmd.point.duration ?? 2 });
          continue;
        }
      }
```

(f) Camera `on` loop (~1830), first thing inside `for (const id of on)`:

```ts
            const pl = placeNow(id, "camera", false);
            if (pl === "skip") continue;
            if (pl !== null) {
              boxes.push(pl.kind === "region" || pl.kind === "box" ? pl.box : { x: pl.point[0] - 60, y: pl.point[1] - 45, w: 120, h: 90 });
              continue;
            }
```

Camera `center` (the `else if (center?.ref !== undefined)` branch), first:

```ts
        } else if (center?.ref !== undefined && parsePlace(center.ref) !== null) {
          const pl = placeNow(center.ref, "camera", false);
          if (pl !== "skip" && pl !== null) {
            target = pl.kind === "region" || pl.kind === "box" ? pl.box : null;
            [cx, cy] = pl.kind !== "anchor" && center.anchor !== undefined && target ? boxAnchor(target, center.anchor) : pl.point;
          }
```

Insert this as a new `else if` before the existing `center?.ref` branch, so plain ids are unchanged.

(g) `src/render/index.ts` `planOptionsFor`: add `"pictureOf"` to the `Pick<…>` list and to the returned object:

```ts
    pictureOf: (id) => {
      const meta = layout.pictures?.[id];
      if (!meta) return null;
      const d = leafDrawables(drawablesForId(layout.drawables, id)).find((x) => x.kind === "image" && x.id === `${id}__img`);
      if (!d || d.kind !== "image") return null;
      return { frame: { rect: { x: d.pos[0] - d.w / 2, y: d.pos[1] - d.h / 2, w: d.w, h: d.h }, view: meta.view }, regions: meta.regions };
    },
```

(`leafDrawables` and `drawablesForId` are already imported there. `leafPointsOf` uses them.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/picture-plan.test.ts tests/plan.test.ts tests/focus-zoom.test.ts tests/focus-followers.test.ts tests/camera-view.test.ts tests/group-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/plan.ts src/render/index.ts tests/picture-plan.test.ts
git commit -m "Plan: highlight, focus, point and camera aim at picture places — regions, fractions, spots — following the picture when it moves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Drawing the box and the spotlight

**Files:**
- Modify: `src/render/backend.ts:79-89` (`BackendEffects`)
- Modify: `src/render/svg-backend.ts`: a `boxMarkPath` helper after `underlinePath` (~1357); the `circle`/`underline` branch in `setHighlight` (~1527); `setSpotlight`/`endSpotlight` next to `setFocus` (~1728)
- Modify: `src/render/player.ts:1703-1727` (focus)
- Test: `tests/picture-backend.test.ts`

**Interfaces:**
- Consumes: the focus step's `spots` (Task 6); the highlight effect `"box"` (Task 3).
- Produces:
  - `BackendEffects.setSpotlight?(spots: { frame: BBox; holes: BBox[] }[], alpha: number): void` and `endSpotlight?(): void`. `alpha` is the same focus alpha (1 = no dim, `FOCUS_DIM` = full dim).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/picture-backend.test.ts
import { describe, expect, test } from "vitest";
import { rendererFor } from "../src/render/svg-backend";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { BackendEffects } from "../src/render/backend";
import { FOCUS_DIM } from "../src/render/backend";
import { FULL_VIEW4 } from "../src/spec/places";

const SPEC = { elements: [{ id: "t", type: "text", text: "Hi", x: 500, y: 375 }], commands: [{ draw: ["t"] }] };

async function mounted() {
  const { restore, doc } = installMiniDom();
  const layout = layoutSpec(SPEC as never, heuristicMeasure);
  const container = new FakeNode("div", doc as never);
  const r = await rendererFor("clean").mount(layout, SPEC as never, container as never);
  for (const el of r.elements.values()) el.finish();
  const svg = container.children[0];
  return { restore, effects: r.effects!, overlay: svg.children[svg.children.length - 1] };
}

describe("the box effect", () => {
  test("a box with no leaves draws a mark round the given box, at the level's opacity", async () => {
    const { restore, effects, overlay } = await mounted();
    try {
      effects.setHighlight(["md:left"], "box", 0.5, { x: 100, y: 300, w: 200, h: 200 });
      expect(overlay.children.length).toBe(1);
      expect(Number(overlay.children[0].style.opacity)).toBeCloseTo(0.5, 3);
      effects.endHighlight(["md:left"]);
      expect(overlay.children.length).toBe(0);
    } finally {
      restore();
    }
  });
});

describe("the spotlight", () => {
  test("setSpotlight draws one even-odd wash per picture; endSpotlight removes it", async () => {
    const { restore, effects, overlay } = await mounted();
    try {
      effects.setSpotlight!([{ frame: { x: 100, y: 300, w: 400, h: 200 }, holes: [{ x: 100, y: 300, w: 200, h: 200 }] }], FOCUS_DIM);
      const wash = overlay.children.find((n) => n.getAttribute("fill-rule") === "evenodd");
      expect(wash).toBeDefined();
      expect(Number(wash!.getAttribute("fill-opacity"))).toBeCloseTo(1 - FOCUS_DIM, 3);
      effects.endSpotlight!();
      expect(overlay.children.find((n) => n.getAttribute("fill-rule") === "evenodd")).toBeUndefined();
    } finally {
      restore();
    }
  });

  test("the player plays a focus step's spots and always ends them", async () => {
    const spots: number[] = [];
    let ended = false;
    const effects: BackendEffects = {
      setHighlight: () => undefined,
      endHighlight: () => undefined,
      setFocus: () => undefined,
      endFocus: () => undefined,
      setSpotlight: (_s, a) => spots.push(a),
      endSpotlight: () => (ended = true),
      setPointer: () => undefined,
      setCamera: () => undefined,
    };
    const rect = { x: 100, y: 300, w: 400, h: 200 };
    const plan = planCommands([{ draw: ["md"] }, { focus: { target: "md:left", duration: 0.5 } }] as never, ["md"], {
      bboxOf: () => rect,
      pictureOf: () => ({ frame: { rect, view: FULL_VIEW4 }, regions: { left: [0, 0, 0.5, 1] } }),
    } as never);
    const stub = (id: string) => ({ id, durationMs: 10, finish: () => undefined, hide: () => undefined, setProgress: () => undefined }) as never;
    const player = new Player(plan, new Map([["md", stub("md")]]), new SpeechManager(), null, { mode: "narrated", effects });
    const frames: ((now: number) => void)[] = [];
    player.raf = (cb) => frames.push(cb);
    const done = player.play();
    const flush = () => new Promise((r) => setTimeout(r, 10));
    await flush();
    let now = performance.now();
    for (let guard = 0; player.state === "playing" && guard < 60; guard++) {
      now += 120;
      for (const cb of frames.splice(0)) cb(now);
      await flush();
    }
    await done;
    expect(spots.length).toBeGreaterThan(0);
    expect(Math.min(...spots)).toBeCloseTo(FOCUS_DIM, 2);
    expect(ended).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/picture-backend.test.ts`
Expected: FAIL. The box effect draws nothing (it falls into the glow branch with no leaves), and `setSpotlight` is undefined.

- [ ] **Step 3: Write the implementation**

(a) `src/render/backend.ts`, after `endFocus?`:

```ts
  /**
   * The spotlight inside a picture (spec 2026-09-30-picture-regions §5): a
   * wash over each picture's frame with its holes left clear, at the focus
   * verb's alpha (1 = none, FOCUS_DIM = full). Optional, like setFocus.
   */
  setSpotlight?(spots: { frame: BBox; holes: BBox[] }[], alpha: number): void;
  /** Remove the spotlight (abort/scrub safety). */
  endSpotlight?(): void;
```

(b) `src/render/svg-backend.ts`. After `underlinePath`:

```ts
/** A box drawn round a region — highlight `box`: the pen line and a faint marker wash inside it. */
function boxMarkPath(box: SvgBox, color: string, rc: RoughSVG | null): SVGGElement {
  const pad = 6;
  const x = box.x - pad;
  const y = box.y - pad;
  const w = box.w + 2 * pad;
  const h = box.h + 2 * pad;
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.style.pointerEvents = "none";
  const wash = document.createElementNS(SVG_NS, "rect");
  for (const [k, v] of [["x", x], ["y", y], ["width", w], ["height", h], ["rx", 6]] as const) wash.setAttribute(k, String(v));
  wash.setAttribute("fill", MARKER_COLOR);
  wash.setAttribute("fill-opacity", "0.16");
  wash.setAttribute("stroke", "none");
  g.appendChild(wash);
  if (rc) {
    g.appendChild(rc.rectangle(x, y, w, h, { stroke: color, strokeWidth: 3, roughness: 1, bowing: 0.6, fill: undefined, seed: 9 }));
  } else {
    g.appendChild(plainPath(`M${x} ${y} H${x + w} V${y + h} H${x} Z`, { color, strokeWidth: 3 }));
  }
  return g;
}
```

In `setHighlight`, widen the first branch to `if (effect === "circle" || effect === "underline" || effect === "box") {`, and choose the mark:

```ts
            const mark =
              effect === "circle" ? ellipseRingPath(around, pen, rc, narrowed) : effect === "box" ? boxMarkPath(around, pen, rc) : underlinePath(around, pen, rc);
```

For the write-on, `box` behaves like `circle` (written by the level): `writeOn(p as SVGPathElement, effect === "underline" ? st.penPaths : st.ringPaths)`.

Next to `setFocus`/`endFocus`:

```ts
    setSpotlight(spots: { frame: BBox; holes: BBox[] }[], alpha: number): void {
      const dim = Math.max(0, Math.min(1, 1 - alpha));
      for (const n of spotlightNodes) n.remove();
      spotlightNodes.length = 0;
      for (const s of spots) {
        const rectD = (b: BBox) => {
          const v = svgBoxOf(b);
          return `M${v.x} ${v.y} H${v.x + v.w} V${v.y + v.h} H${v.x} Z`;
        };
        const p = document.createElementNS(SVG_NS, "path") as SVGPathElement;
        p.setAttribute("d", [rectD(s.frame), ...s.holes.map(rectD)].join(" "));
        p.setAttribute("fill-rule", "evenodd");
        p.setAttribute("fill", PAPER_WASH);
        p.setAttribute("fill-opacity", String(dim));
        p.style.pointerEvents = "none";
        overlay.appendChild(p);
        spotlightNodes.push(p);
      }
    },

    endSpotlight(): void {
      for (const n of spotlightNodes) n.remove();
      spotlightNodes.length = 0;
    },
```

Declare `const spotlightNodes: SVGPathElement[] = [];` beside `active` (the highlight map) in the same closure. For `PAPER_WASH`, use the colour the backend paints the page with, so the dim reads as "fading toward the paper", the same as `setFocus`'s opacity. Find it with `grep -n "cs-paper\|PAPER\|paper" src/render/svg-backend.ts src/layout/canvas.ts src/styles.css | head`. If the page colour is only in CSS, use the `INK`-module paper constant if one exists, else `"#fbf8f1"`, and note it in the commit. If `FakeNode` has no `remove()`, use `overlay.removeChild(n)`.

(c) `src/render/player.ts` focus case (1703–1727):

```ts
      case "focus": {
        const effects = this.effects;
        if (!effects?.setFocus) return;
        const keep = new Set(step.ids);
        const dimIds = before.visible.filter((id) => !keep.has(id));
        const spots = step.spots ?? [];
        if (dimIds.length === 0 && spots.length === 0) return;
        const RAMP = 280;
        const alphaAt = (t: number) => 1 - (1 - FOCUS_DIM) * t;
        const paint = (a: number) => {
          if (dimIds.length > 0) effects.setFocus!(dimIds, a);
          if (spots.length > 0) effects.setSpotlight?.(spots, a);
        };
        try {
          await this.progress(RAMP, signal, (t) => paint(alphaAt(t)));
          if (signal.aborted) return;
          if (step.untilNarrationEnd && this.narrationVoice) {
            await this.narrationVoice;
          } else {
            await this.waitScaled(Math.max(0, step.seconds * 1000 - 2 * RAMP), signal);
          }
          if (signal.aborted) return;
          await this.progress(RAMP, signal, (t) => paint(alphaAt(1 - t)));
        } finally {
          effects.endFocus?.(dimIds);
          if (spots.length > 0) effects.endSpotlight?.();
        }
        return;
      }
```

Also search the player and the exporter (`grep -rn "endFocus" src`) for scrub, seek and abort paths that call `endFocus`, and add `endSpotlight?.()` beside each one.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/picture-backend.test.ts tests/highlight-emphasis.test.ts tests/highlight-part.test.ts tests/focus-zoom.test.ts tests/focus-dim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/backend.ts src/render/svg-backend.ts src/render/player.ts tests/picture-backend.test.ts
git commit -m "Backend: highlight box (a pen box with a marker wash) and the spotlight inside a picture; the player plays focus spots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Places in the script format

**Files:**
- Modify: `src/spec/script/parse.ts:90` (`isBareId`)
- Modify: `src/spec/script/values.ts:42` (`BARE_RE`), only if the round-trip test shows places printed quoted or split
- Test: `tests/picture-script.test.ts`

**Interfaces:**
- Consumes: the place syntax (Task 1).
- Produces: `highlight md:datasets`, `focus md:results md:command_line`, `camera on md:filter` and `point at {ref: md:command_line}` (or however object args are written in the script format) parse to the same commands as the YAML, and print back unchanged.

- [ ] **Step 1: Write the failing test.** First open `tests/script-roundtrip.test.ts` and `tests/script-parse.test.ts` to copy how a script is parsed (the function name and its return shape) and printed. Then:

```ts
// tests/picture-script.test.ts
import { describe, expect, test } from "vitest";
// Use the same imports script-roundtrip.test.ts uses, e.g.:
import { parseScript } from "../src/spec/script/parse";
import { printScript } from "../src/spec/script/print";

describe("picture places in the script format", () => {
  const spec = {
    elements: [{ id: "md", type: "image", url: "https://x.org/a.png", look: "screen", regions: { datasets: [0, 0, 0.2, 0.5], results: [0.2, 0, 0.8, 0.9] } }],
    commands: [
      { draw: ["md"] },
      { highlight: { target: ["md:datasets"] } },
      { focus: { target: ["md:results", "md@[0.2, 0.9, 0.8, 0.1]"] } },
      { camera: { on: ["md:results"] } },
      { point: { at: { ref: "md:datasets" }, gesture: "underline" } },
    ],
  };
  test("a spec with places prints and parses back to itself", () => {
    const text = printScript(spec as never);
    expect(text).toContain("md:datasets");
    const back = parseScript(text);
    expect(back.spec?.commands ?? back.commands).toEqual(spec.commands);
  });
  test("a hand-written highlight line with a place", () => {
    const back = parseScript(`highlight md:datasets\n`);
    expect(JSON.stringify(back)).toContain(`"target":["md:datasets"]`);
  });
});
```

Adjust the imports, the call shapes and the result access to the real API. The assertions (round-trip equality; a place is one target) are the contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/picture-script.test.ts`
Expected: FAIL — `md:datasets` ends the id run.

- [ ] **Step 3: Write the implementation.** `src/spec/script/parse.ts:90`:

```ts
// An id, or a picture place on one (spec 2026-09-30-picture-regions §4): md:name, md@top, md@[x, y(, w, h)].
const isBareId = (t: string): boolean => /^[A-Za-z_][\w-]*$/.test(t) || parsePlace(t) !== null;
```

Import `parsePlace` from `../places`. If printing quotes or splits a place, widen `BARE_RE` in `values.ts:42` to accept `parsePlace(t) !== null` the same way.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/picture-script.test.ts tests/script-parse.test.ts tests/script-roundtrip.test.ts tests/script-values.test.ts tests/script-print.test.ts tests/script-lines.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spec/script tests/picture-script.test.ts
git commit -m "Script format: an id may be a picture place (md:name, md@top, md@[…])

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Teach the compiler, update the spec, and check it in the browser

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md`: freehand rule 7 (the `image` line, ~line 28) and the `## Verbs` bullets for highlight/point/focus/camera (~80–85)
- Modify: `tests/prompt-size.test.ts` (re-pin both constants with a dated note)
- Modify: `docs/superpowers/specs/2026-09-30-picture-regions-design.md` §4 (the `point.at` form) and the status line
- Create: `docs/examples/2026-09-30-picture-regions-microdata.yaml`, the spec's §9.1 cast (both pictures, the regions, the script, without the §6 movement-only notes)

- [ ] **Step 1: The prompt.** Replace rule 7's example with two short forms, keeping the rest of the rule:

```
7. **At most ONE `image` per figure** … `{"id": "photo", "type": "image", "of": "<Wikimedia Commons title>"}` … A picture the user GAVE (a URL) to be explained part by part — a screenshot, a diagram, a painting — is `{"id": "shot", "type": "image", "url": "<url>", "look": "screen", "regions": {"search": [x, y, w, h], …}}` (fractions of the picture from its top-left; short English names), and every gesture aims at `"shot:search"`, or at `"shot@[x, y, w, h]"` for an unnamed part.
```

In the verb bullets, add one clause each: highlight — ``` `box` draws a box round it (the default on a picture place)```; point — ```on a picture, `{"ref": "shot:search"}` ```; focus — ```on a picture, dims all of it but the place```; camera — ````"on": ["shot:search"]` zooms to a region```. One clause each, no new paragraph.

- [ ] **Step 2: Re-pin.** Run `npx vitest run tests/prompt-size.test.ts`, read the measured sizes from the failures, set `BASELINE_SCHEMA_CHARS` and `BASELINE_SYSTEM_CHARS` to them exactly, and add a note above the constants in the file's own style:

```
// Re-pinned 2026-09-30 for picture regions (delivery 1): three image
// properties (`look`, `view`, `regions`), `box` in the highlight enum, and
// `url` documented for image grew the schema by +<measured> chars (it is
// embedded verbatim in the system prompt); the prompt gained the url/regions
// sentence on freehand rule 7 and one clause on each of highlight, point,
// focus and camera (+<measured>).
```

- [ ] **Step 3: The spec.** In §4, replace the string-shorthand paragraph with: "In `point.at` and `camera.center` a place goes in `ref` — `{ref: "md:command_line"}`, `{ref: "md:command_line", anchor: "left"}`, `{ref: "md@[0.6, 0.1]"}` — so no command changes shape. Targets that take ids (`highlight`, `focus`, `camera.on`) take the place strings directly." Change the status line to `draft for review · delivery 1 built 2026-09-30 — see plan docs/superpowers/plans/2026-09-30-picture-regions-delivery-1.md`.

- [ ] **Step 4: The example cast.** Write `docs/examples/2026-09-30-picture-regions-microdata.yaml` from spec §9.1: both elements with their regions, and the script with the multi-stop highlight replaced by six single-target highlights, since a list of stops that travels is delivery 2. Run `npx vitest run 2>&1 | tail -15` and expect everything to pass. Then load the cast in the app to check that it validates.

- [ ] **Step 5: See it.** The branch dev server runs at http://localhost:5210/ (restart it with `npx vite --port 5210 --strictPort` from the worktree if it's down). Open the example cast. **Mute before playing** (the player's mute and the WebAudio tones; see memory drawcast-run-muted). Check:
  - The microdata screenshot shows in colour, crisp, without the browser bar.
  - Each highlight box sits on its panel.
  - The spotlight dims the picture outside the results area.
  - The camera zooms onto the filter field and the command line.
  - The pointer underlines the command line.
  - The toolbar strip (`tools`, cropped by `view`) shows only the buttons.

  Take a screenshot of each of the four gestures into the scratchpad. If a box is visibly off, the example's numbers are wrong, not the code: correct them in the example and in spec §9.1.

- [ ] **Step 6: Commit**

```bash
git add src/llm/prompts/compiler-v1.md tests/prompt-size.test.ts docs/superpowers/specs/2026-09-30-picture-regions-design.md docs/examples/2026-09-30-picture-regions-microdata.yaml
git commit -m "Picture regions delivery 1: the compiler learns url/look/regions and places; prompt re-pinned; microdata example cast

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Not in this plan (the spec's later deliveries)

- §6 movement: carry-over between steps, a list of stops that travels, `tour`, `lift`.
- §7 scrolling (the camera world for tall pictures, the window) and raising the zoom limit above 8× / the fit cap of 4× for pictures.
- §8 mapping (`regions: auto`, `detail`/`kinds`/`find`, the cache, the drop-unused step, the Netlify fetch for CORS-refusing hosts).
- Text recognition, the Find parts picker, Insert image offering "keep it as a screenshot", overlays and clickable regions.
