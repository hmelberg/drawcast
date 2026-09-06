# Anatomy Round 2, Part 2 — Exploration in the Drawer: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For an anatomy figure, the explore tray (⊕) gains a **Body** section: click a part on the figure to zoom into its region, breadcrumbs to come back, pills for layer / systems / names beside the existing detail slider; `explore: { anatomy: true }` is the authored beat.

**Architecture:** One pure module (`src/ui/body-model.ts`: which region a click zooms to, the breadcrumb path, a part's display name) tested against the real atlas; one DOM module (`src/ui/body-explore.ts`: the section, the pills, the click overlay) mounted by `tray.ts` through the same `overrides` → `repaint()` path the sliders use, so **Continue restores the lesson** exactly as it does for sliders. The schema, the plan step and `trayPlan` each gain one boolean.

**Tech Stack:** TypeScript, Vitest (node — the DOM module is exercised through its pure model and a smoke of its exported builder with the `h()` helper's stubs where the existing tray tests do so), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-06-anatomy-round-2-design.md` (Part 2).

## Global Constraints

- **Zooming is a preview, never a commit.** Every Body action writes into the tray's `overrides` and calls `repaint()`, which calls `previewParams(overrides, { revealNew: true })`. `clearPreview()` on Continue / close / Play empties `overrides`, so the authored figure returns untouched. No `hd.update`, no re-render.
- **`overrides` widens from `Record<string, number>` to `Record<string, unknown>`** — `focus` and `highlight` are string arrays, `layer` / `systems` / `names` strings. Sliders keep writing numbers.
- **Hit-testing is the click-ask's:** `logicalPoint(stage, e)` → `hitElement(boxes, p, 18, rings)` with boxes/rings from `hd.timeline.paintedLayout() ?? hd.layout` (the PAINTED layout — after a zoom the ids on screen are the focused view's).
- **The stage is frozen while the tray is open** (`freezeClick`, capture phase, `stopPropagation`). The Body overlay must be exempt the way buttons are: add `.cs-bodyexplore` to `freezeClick`'s allow-list.
- **Zoom target rule** (the pure model): a clicked part with geometry-bearing children (a region or group) zooms to itself; a leaf zooms to its nearest region-or-group ancestor unless that ancestor IS the current focus, in which case the leaf is highlighted and named. Focus is always ONE id (the array has one entry).
- **Breadcrumbs** are the ancestor chain from the root to the focus, prefixed by `Body`; each crumb re-focuses there; `Body` clears focus.
- Detail stays the existing slider; `layer` (superficial/deep), `systems` (organs/skeleton/both), `names` (en/nb/la) are pill rows.
- Ids, licence, budgets, lint rules: unchanged from parts 0–1. `npx vitest run` and `npx tsc --noEmit` before every commit; worktree `anatomy-3`; never `git add -A`.

---

## File Structure

**Created:**

| path | responsibility |
|---|---|
| `src/ui/body-model.ts` | pure: `focusTargetFor`, `breadcrumbFor`, `partLabel`, `SYSTEM_CHOICES` … |
| `src/ui/body-explore.ts` | DOM: `mountBodySection(...)` — breadcrumbs, pills, the click overlay |
| `tests/body-model.test.ts` | the rules against the real atlas |

**Modified:**

| path | change |
|---|---|
| `src/spec/schema.ts` | `explore.anatomy?: boolean` |
| `src/render/plan.ts` | explore step carries `anatomy?: boolean` |
| `src/ui/tray-model.ts` | `trayPlan` gains `bodyTemplate` / `anatomy` inputs and a `body` output |
| `src/ui/tray.ts` | overrides widened; Body section mounted; `.cs-bodyexplore` exempt; gate passes `anatomy` |
| `src/styles.css` | `.cs-bodyexplore`, `.cs-body-crumbs`, `.cs-body-crumb`, `.cs-body-pills` |
| `src/examples.json` | "Explore the body" |
| `tests/explore-command.test.ts`, `tests/tray-model.test.ts`, `tests/anatomy-template.test.ts` | the new boolean, the body rule, the example count (10) |
| `src/scenes/anatomy/README.md`, `ROADMAP.md` | the section exists; part 3 next |

---

## Task 1: The body model — where a click zooms, and the way back

**Files:**
- Create: `src/ui/body-model.ts`
- Test: `tests/body-model.test.ts`

**Interfaces:**
- Consumes: `AtlasPart` from `src/scenes/anatomy/types.ts`; the engine's `parts({systems, sex})` record (tests load it through `ensureEngines`)
- Produces:
  - `focusTargetFor(parts, clicked: string, currentFocus: string | null): { focus: string | null; highlight: string | null }`
  - `breadcrumbFor(parts, focus: string | null): string[]` — ids, root first, WITHOUT a "body" entry (the UI prepends Body)
  - `partLabel(parts, id, names: "en" | "nb" | "la"): string`
  - `BODY_LABEL: Record<"en" | "nb" | "la", string>` (`Body` / `Kropp` / `Corpus`)
  - `SYSTEM_CHOICES`, `LAYER_CHOICES`, `NAME_CHOICES`: `{ value, label: Record<lang, string> }[]` for the pill rows

- [ ] **Step 1: Write the failing test**

Create `tests/body-model.test.ts`:

```ts
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines } from "../src/scenes/engines";
import type { AnatomyEngine, AtlasPart } from "../src/scenes/anatomy/types";
import { focusTargetFor, breadcrumbFor, partLabel, BODY_LABEL, SYSTEM_CHOICES } from "../src/ui/body-model";

let parts: Record<string, AtlasPart>;
beforeAll(async () => {
  await ensureEngines(["anatomy"]);
  parts = (getLoadedEngines(["anatomy"]).anatomy as AnatomyEngine).parts({ systems: ["skeleton", "viscera"], sex: "neutral" });
});

describe("focusTargetFor", () => {
  test("a leaf clicked on the whole body zooms to its region or group", () => {
    expect(focusTargetFor(parts, "liver", null)).toEqual({ focus: "abdomen", highlight: null });
    expect(focusTargetFor(parts, "femur_left", null)).toEqual({ focus: "thigh_left", highlight: null });
    expect(focusTargetFor(parts, "carpals_left", null)).toEqual({ focus: "hand_left", highlight: null });
    expect(focusTargetFor(parts, "knee_left", null)).toEqual({ focus: "leg_left", highlight: null });
    expect(focusTargetFor(parts, "brain", null)).toEqual({ focus: "head", highlight: null });
  });

  test("a region clicked zooms to itself", () => {
    expect(focusTargetFor(parts, "hand_left", null)).toEqual({ focus: "hand_left", highlight: null });
    expect(focusTargetFor(parts, "rib_cage", null)).toEqual({ focus: "rib_cage", highlight: null });
  });

  test("inside the focused region a leaf is highlighted and named, not zoomed", () => {
    expect(focusTargetFor(parts, "liver", "abdomen")).toEqual({ focus: "abdomen", highlight: "liver" });
    expect(focusTargetFor(parts, "carpals_left", "hand_left")).toEqual({ focus: "hand_left", highlight: "carpals_left" });
  });

  test("inside a wide focus a leaf whose own region is narrower zooms one level further", () => {
    expect(focusTargetFor(parts, "femur_left", "leg_left")).toEqual({ focus: "thigh_left", highlight: null });
    expect(focusTargetFor(parts, "phalanges_foot_left", "leg_left")).toEqual({ focus: "foot_left", highlight: null });
  });

  test("the outline, the frame and unknown ids do nothing", () => {
    expect(focusTargetFor(parts, "body_outline", null)).toEqual({ focus: null, highlight: null });
    expect(focusTargetFor(parts, "frame", "abdomen")).toEqual({ focus: "abdomen", highlight: null });
    expect(focusTargetFor(parts, "nope", null)).toEqual({ focus: null, highlight: null });
  });
});

describe("breadcrumbFor", () => {
  test("is the ancestor chain, root first, ending at the focus", () => {
    expect(breadcrumbFor(parts, null)).toEqual([]);
    expect(breadcrumbFor(parts, "abdomen")).toEqual(["abdomen"]);
    expect(breadcrumbFor(parts, "thigh_left")).toEqual(["leg_left", "thigh_left"]);
    expect(breadcrumbFor(parts, "carpals_left")).toEqual(["arm_left", "hand_left", "carpals_left"]);
  });
});

describe("labels", () => {
  test("partLabel speaks the chosen language and falls back to English", () => {
    expect(partLabel(parts, "liver", "nb")).toBe("Lever");
    expect(partLabel(parts, "liver", "la")).toBe("Hepar");
    expect(partLabel(parts, "liver", "en")).toBe("Liver");
    expect(partLabel(parts, "not_a_part", "nb")).toBe("not_a_part");
    expect(BODY_LABEL.nb).toBe("Kropp");
  });

  test("the systems pills offer organs, skeleton and both", () => {
    expect(SYSTEM_CHOICES.map((c) => c.value)).toEqual([["viscera"], ["skeleton"], ["skeleton", "viscera"]]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/body-model.test.ts`
Expected: FAIL — cannot resolve `../src/ui/body-model`.

- [ ] **Step 3: Write the module**

Create `src/ui/body-model.ts`:

```ts
// The Body section's rules, DOM-free: where a click on the figure zooms to,
// the way back, and what a part is called. tray.ts and body-explore.ts render
// them; tests hold them against the real atlas.

import type { AtlasPart } from "../scenes/anatomy/types";

export type NameLang = "en" | "nb" | "la";

export const BODY_LABEL: Record<NameLang, string> = { en: "Body", nb: "Kropp", la: "Corpus" };

export interface Choice<T> {
  value: T;
  label: Record<NameLang, string>;
}

export const SYSTEM_CHOICES: Choice<("skeleton" | "viscera")[]>[] = [
  { value: ["viscera"], label: { en: "Organs", nb: "Organer", la: "Viscera" } },
  { value: ["skeleton"], label: { en: "Skeleton", nb: "Skjelett", la: "Skeleton" } },
  { value: ["skeleton", "viscera"], label: { en: "Both", nb: "Begge", la: "Ambo" } },
];
export const LAYER_CHOICES: Choice<"superficial" | "deep">[] = [
  { value: "superficial", label: { en: "In front", nb: "Foran", la: "Superficialis" } },
  { value: "deep", label: { en: "Behind", nb: "Bak", la: "Profundus" } },
];
export const NAME_CHOICES: Choice<NameLang>[] = [
  { value: "en", label: { en: "English", nb: "Engelsk", la: "Anglice" } },
  { value: "nb", label: { en: "Norwegian", nb: "Norsk", la: "Norvegice" } },
  { value: "la", label: { en: "Latin", nb: "Latin", la: "Latine" } },
];

const hasGeo = (parts: Record<string, AtlasPart>, id: string): boolean => (parts[id]?.rings.length ?? 0) > 0 && parts[id].kind !== "outline";
const childrenOf = (parts: Record<string, AtlasPart>, id: string): string[] => Object.keys(parts).filter((c) => parts[c].parent === id);
/** A part whose children carry geometry: a region (a hull) or a group (no geometry of its own). */
const isContainer = (parts: Record<string, AtlasPart>, id: string): boolean =>
  (parts[id]?.kind === "region" || parts[id]?.kind === "group") && childrenOf(parts, id).some((c) => hasGeo(parts, c));

/** The nearest ancestor that is a region or a group, or null at the root. */
function containerAbove(parts: Record<string, AtlasPart>, id: string): string | null {
  let cur = parts[id]?.parent ?? null;
  while (cur) {
    if (isContainer(parts, cur)) return cur;
    cur = parts[cur]?.parent ?? null;
  }
  return null;
}

/**
 * Where a click lands the viewer. A container (region, group) is entered.
 * A leaf goes to its nearest container — unless the viewer is already
 * there, in which case the leaf is picked out and named instead. The
 * outline, the frame and unknown ids change nothing.
 */
export function focusTargetFor(parts: Record<string, AtlasPart>, clicked: string, currentFocus: string | null): { focus: string | null; highlight: string | null } {
  const p = parts[clicked];
  if (!p || p.kind === "outline" || p.kind === "group" && !isContainer(parts, clicked)) return { focus: currentFocus, highlight: null };
  if (isContainer(parts, clicked)) return { focus: clicked, highlight: null };
  const above = containerAbove(parts, clicked);
  if (above === null) return { focus: currentFocus, highlight: null };
  if (above === currentFocus) return { focus: currentFocus, highlight: clicked };
  return { focus: above, highlight: null };
}

/** Ancestors root-first, ending at `focus`; empty for the whole body. */
export function breadcrumbFor(parts: Record<string, AtlasPart>, focus: string | null): string[] {
  const out: string[] = [];
  let cur: string | null = focus;
  while (cur && parts[cur]) {
    out.unshift(cur);
    cur = parts[cur].parent;
  }
  return out;
}

export function partLabel(parts: Record<string, AtlasPart>, id: string, names: NameLang): string {
  const n = parts[id]?.name;
  return n ? (n[names] ?? n.en) : id;
}
```

Note on `focusTargetFor`'s first line: an unknown id, the outline, or a bare group with no geometry-bearing children keeps the current focus with no highlight — `frame` is not a part at all, so it takes that path too.

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx vitest run tests/body-model.test.ts && npx tsc --noEmit`
Expected: PASS. If `knee_left → leg_left` fails because `leg_left` has no geometry-bearing child at the top level (its children are regions with hulls, which DO have geometry), check `isContainer`; if `brain → head` fails, `head`'s children are `skull` (region) and `brain` — both geometry-bearing, so it should pass.

```bash
git add src/ui/body-model.ts tests/body-model.test.ts
git commit -m "Body model: where a click on the figure zooms to, and the way back"
```

---

## Task 2: The boolean — schema, plan step, tray plan

**Files:**
- Modify: `src/spec/schema.ts` (explore properties, ~line 349), `src/render/plan.ts` (step type line 23, planning ~line 245), `src/ui/tray-model.ts` (`trayPlan`)
- Test: `tests/explore-command.test.ts`, `tests/tray-model.test.ts`

**Interfaces:**
- Produces: `explore.anatomy?: boolean` in the spec; `{ kind: "explore"; …; anatomy?: boolean }` in the plan; `trayPlan({ …, bodyTemplate?: boolean, anatomy?: boolean }) → { …, body: boolean }`

- [ ] **Step 1: Write the failing tests**

Append to `tests/explore-command.test.ts` inside `describe("explore validation and planning")`:

```ts
  test("explore.anatomy is a boolean invitation to the body section", () => {
    expect(validateSpec(spec([{ draw: ["a"] }, { explore: { anatomy: true } }])).ok).toBe(true);
    expect(validateSpec(spec([{ explore: { anatomy: "yes" } }])).ok).toBe(false);
    const plan = planCommands([{ explore: { anatomy: true }, speak: "Look around." }], []);
    const s = plan.steps[0];
    expect(s.kind).toBe("explore");
    if (s.kind !== "explore") return;
    expect(s.anatomy).toBe(true);
  });
```

Append to `tests/tray-model.test.ts`:

```ts
describe("trayPlan — the body section", () => {
  test("an anatomy figure shows the body section whenever the viewer opens the tray", () => {
    expect(trayPlan({ sliderPaths: ["detail"], codeIds: [], bodyTemplate: true }).body).toBe(true);
    expect(trayPlan({ sliderPaths: ["detail"], codeIds: [] }).body).toBe(false);
  });
  test("a gated beat shows the body when it asks for it, or when it names nothing else", () => {
    expect(trayPlan({ sliderPaths: ["detail"], codeIds: [], bodyTemplate: true, gated: true, anatomy: true }).body).toBe(true);
    expect(trayPlan({ sliderPaths: ["detail"], codeIds: [], bodyTemplate: true, gated: true }).body).toBe(true);
    expect(trayPlan({ sliderPaths: ["detail"], codeIds: [], bodyTemplate: true, gated: true, params: ["detail"] }).body).toBe(false);
    expect(trayPlan({ sliderPaths: ["detail"], codeIds: [], bodyTemplate: false, gated: true, anatomy: true }).body).toBe(false);
  });
  test("a body gate keeps the detail slider beside the section, and no activity pills", () => {
    const p = trayPlan({ sliderPaths: ["detail"], codeIds: [], bodyTemplate: true, gated: true, anatomy: true });
    expect(p.sliders).toEqual(["detail"]);
    expect(p.activities).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/explore-command.test.ts tests/tray-model.test.ts`
Expected: FAIL — `anatomy: true` is rejected (`additionalProperties: false`), `s.anatomy` undefined, `body` undefined.

- [ ] **Step 3: Implement**

In `src/spec/schema.ts`, inside `explore.properties` after `game`:

```ts
        anatomy: {
          type: "boolean",
          description:
            "On an anatomy figure: open the Body section of the explore tray — click a part to zoom into its region, breadcrumbs back, pills for layer, systems and names — and wait for Continue. The authored 'look around the body yourself' moment. App only; movies skip the beat.",
        },
```

In the explore validation near line 859 (where `params` is checked), add: `if (cmd.explore.anatomy !== undefined && typeof cmd.explore.anatomy !== "boolean") errors.push("explore.anatomy must be true or false");` — follow the file's own error-pushing idiom there.

In `src/render/plan.ts`: the step union becomes `| { kind: "explore"; params?: string[]; code?: string; game?: string; anatomy?: boolean }`, and the planning branch gains `...(cmd.explore.anatomy !== undefined ? { anatomy: cmd.explore.anatomy } : {}),`.

In `src/ui/tray-model.ts`: `TrayPlan` gains `/** The anatomy Body section: click-to-zoom, breadcrumbs, layer/systems/names. */ body: boolean;`; `trayPlan`'s input gains `bodyTemplate?: boolean; anatomy?: boolean;`; the gated branch becomes:

```ts
  if (gated) {
    const scripts = code !== undefined && codeIds.includes(code) ? [{ id: code, expanded: true }] : [];
    // A body beat: asked for by name, or an unnamed gate on an anatomy figure
    // (the body IS what there is to explore). Naming params or code instead
    // asks for those.
    const body = bodyTemplate && (anatomy === true || (params === undefined && code === undefined));
    const wantsSliders = params !== undefined || (scripts.length === 0 && !body) || body;
    const sliders = !wantsSliders ? [] : params ? sliderPaths.filter((p) => params.includes(p)) : sliderPaths;
    return { activities: false, sliders, scripts, body };
  }
  …
  return { activities: true, sliders: sliderPaths, scripts: …, body: bodyTemplate };
```

with `const { …, bodyTemplate = false, anatomy } = input;`.

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx vitest run tests/explore-command.test.ts tests/tray-model.test.ts && npx tsc --noEmit`
Expected: PASS. `tsc` will point at `tray.ts`'s `trayPlan(...)` call if the new required output breaks a destructuring — it does not (the call reads fields, it does not destructure exhaustively).

```bash
git add src/spec/schema.ts src/render/plan.ts src/ui/tray-model.ts tests/explore-command.test.ts tests/tray-model.test.ts
git commit -m "explore.anatomy: the authored invitation to the Body section, through schema, plan and tray plan"
```

---

## Task 3: The Body section and the click overlay

**Files:**
- Create: `src/ui/body-explore.ts`
- Modify: `src/ui/tray.ts` (overrides type; `freezeClick` allow-list; mount in `open()`; gate passes `anatomy`), `src/styles.css`

**Interfaces:**
- Consumes: Task 1's model; `h`, `logicalPoint` from `src/ui/dom`; `elementBBoxes`, `elementRings` from `src/layout/layout`; `makeBrowserMeasure` from `src/render/svg-backend`; `hitElement` from `src/ui/hit`; `getLoadedEngines` from `src/scenes/engines`; `hd.timeline.paintedLayout()`
- Produces: `mountBodySection(opts: { hd: RenderHandle; stage: HTMLElement | null; overrides: Record<string, unknown>; repaint(): void }) → { el: HTMLElement; destroy(): void }`

- [ ] **Step 1: Write the module**

Create `src/ui/body-explore.ts`:

```ts
// The Body section of the explore tray: click a part on the figure to zoom
// into its region, breadcrumbs back to the whole body, pills for layer,
// systems and names. Everything it does is a PREVIEW through the tray's own
// overrides → repaint path, so Continue restores the lesson exactly as it
// does after a slider drag. The zoom rule and the labels live in body-model.

import type { RenderHandle } from "../render";
import { elementBBoxes, elementRings } from "../layout/layout";
import { makeBrowserMeasure } from "../render/svg-backend";
import { getLoadedEngines } from "../scenes/engines";
import type { AnatomyEngine, AtlasPart } from "../scenes/anatomy/types";
import { h, logicalPoint } from "./dom";
import { hitElement } from "./hit";
import { BODY_LABEL, LAYER_CHOICES, NAME_CHOICES, SYSTEM_CHOICES, breadcrumbFor, focusTargetFor, partLabel, type Choice, type NameLang } from "./body-model";

export interface BodySection {
  el: HTMLElement;
  destroy(): void;
}

export function mountBodySection(opts: { hd: RenderHandle; stage: HTMLElement | null; overrides: Record<string, unknown>; repaint(): void }): BodySection {
  const { hd, stage, overrides, repaint } = opts;
  const authored = (hd.spec.params ?? {}) as Record<string, unknown>;
  /** The figure's params as previewed right now: authored, then the viewer's. */
  const current = (): Record<string, unknown> => ({ ...authored, ...overrides });
  const lang = (): NameLang => {
    const n = current().names;
    return n === "nb" || n === "la" ? n : "en";
  };
  const sex = (): "neutral" | "female" | "male" => {
    const s = current().sex;
    return s === "female" || s === "male" ? s : "neutral";
  };
  // Every part of both systems: the click may land on a bone while organs are
  // shown, and the breadcrumbs name groups that draw nothing.
  const parts = (): Record<string, AtlasPart> => (getLoadedEngines(["anatomy"]).anatomy as AnatomyEngine).parts({ systems: ["skeleton", "viscera"], sex: sex() });
  const focusNow = (): string | null => {
    const f = current().focus;
    return Array.isArray(f) && typeof f[0] === "string" ? f[0] : null;
  };

  const el = h("div", { class: "cs-tray-body" });
  const crumbs = h("div", { class: "cs-body-crumbs" });
  const named = h("span", { class: "cs-body-named" });
  const pills = h("div", { class: "cs-body-pills" });
  el.appendChild(h("div", { class: "cs-tray-hint" }, "Click a part of the body to zoom in; click again to name it."));
  el.appendChild(crumbs);
  el.appendChild(named);
  el.appendChild(pills);

  const setFocus = (focus: string | null, highlight: string | null): void => {
    if (focus) overrides.focus = [focus];
    else delete overrides.focus;
    if (highlight) overrides.highlight = [highlight];
    else delete overrides.highlight;
    repaint();
    render();
  };

  const pillRow = <T,>(title: string, choices: Choice<T>[], selected: (v: T) => boolean, pick: (v: T) => void): HTMLElement => {
    const row = h("div", { class: "cs-tray-row cs-body-pillrow" });
    row.appendChild(h("span", { class: "cs-tray-label" }, title));
    for (const c of choices) {
      const b = h("button", { class: `cs-cardgate-pill cs-tray-pill${selected(c.value) ? " selected" : ""}` }, c.label[lang()]);
      b.addEventListener("click", () => { pick(c.value); repaint(); render(); });
      row.appendChild(b);
    }
    return row;
  };

  const render = (): void => {
    const P = parts();
    const L = lang();
    const focus = focusNow();
    crumbs.replaceChildren();
    const chain = breadcrumbFor(P, focus);
    const crumb = (label: string, target: string | null, last: boolean): void => {
      const b = h("button", { class: `cs-body-crumb${last ? " current" : ""}` }, label);
      b.addEventListener("click", () => setFocus(target, null));
      crumbs.appendChild(b);
      if (!last) crumbs.appendChild(h("span", { class: "cs-body-sep" }, "›"));
    };
    crumb(BODY_LABEL[L], null, chain.length === 0);
    chain.forEach((id, i) => crumb(partLabel(P, id, L), id, i === chain.length - 1));
    const hl = current().highlight;
    named.textContent = Array.isArray(hl) && typeof hl[0] === "string" ? partLabel(P, hl[0], L) : "";

    pills.replaceChildren();
    const systemsNow = Array.isArray(current().systems) && (current().systems as string[]).length > 0 ? (current().systems as string[]) : ["viscera"];
    const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
    pills.appendChild(pillRow(L === "nb" ? "Vis" : L === "la" ? "Systema" : "Show", SYSTEM_CHOICES, (v) => same(v, systemsNow), (v) => { overrides.systems = v; }));
    const layerNow = current().layer === "deep" ? "deep" : "superficial";
    pills.appendChild(pillRow(L === "nb" ? "Lag" : L === "la" ? "Stratum" : "Layer", LAYER_CHOICES, (v) => v === layerNow, (v) => { overrides.layer = v; }));
    pills.appendChild(pillRow(L === "nb" ? "Navn" : L === "la" ? "Nomina" : "Names", NAME_CHOICES, (v) => v === L, (v) => { overrides.names = v; }));
  };

  // The click overlay: a layer over the stage, exempt from the tray's freeze,
  // that resolves a click to a part with the click-ask's own hit-testing —
  // against the PAINTED layout, so after a zoom the ids are the zoomed view's.
  let overlay: HTMLElement | null = null;
  if (stage) {
    overlay = h("div", { class: "cs-bodyexplore" });
    overlay.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = logicalPoint(stage, e);
      if (!p) return;
      const layout = hd.timeline.paintedLayout() ?? hd.layout;
      const id = hitElement(elementBBoxes(layout, makeBrowserMeasure()), p, 18, elementRings(layout));
      if (id === null) return;
      const next = focusTargetFor(parts(), id, focusNow());
      setFocus(next.focus, next.highlight);
    });
    stage.appendChild(overlay);
  }

  render();
  return {
    el,
    destroy() {
      overlay?.remove();
      overlay = null;
    },
  };
}
```

- [ ] **Step 2: Wire it into the tray**

In `src/ui/tray.ts`:

a. `const overrides: Record<string, number> = {};` → `const overrides: Record<string, unknown> = {};` (line ~121). `tsc` will name any site that assumed numbers — the slider handler assigns numbers into it, which still type-checks.

b. `freezeClick`: `if (e.target instanceof Element && (e.target.closest("button") || e.target.closest(".cs-codeedit") || e.target.closest(".cs-bodyexplore"))) return;`

c. Import: `import { mountBodySection, type BodySection } from "./body-explore";` and keep a handle: `let bodySection: BodySection | null = null;` next to `gateResolve`.

d. In `open(opts)`, `opts` gains `anatomy?: boolean`; the `trayPlan(...)` call gains `bodyTemplate: hd.spec.template === "anatomy", anatomy: opts.anatomy`. After the activity pills and BEFORE the games loop:

```ts
    bodySection?.destroy();
    bodySection = null;
    if (plan.body) {
      bodySection = mountBodySection({ hd, stage, overrides, repaint });
      tray.appendChild(bodySection.el);
    }
```

e. In `close()`: `bodySection?.destroy(); bodySection = null;` before `thawStage()`.

f. The gate: `open({ filter: step.params, gated: true, code: step.code, anatomy: step.anatomy });`

g. The `⊕` appears only when the figure offers something (`liveSliders … return;` at line ~99). Anatomy has the `detail` slider, so it does; add `hd.spec.template === "anatomy"` to that condition anyway so a spec that pins `detail` still gets the Body section.

- [ ] **Step 3: Styles**

Append to `src/styles.css` after the `.cs-tray-row` rules:

```css
/* The anatomy Body section: click-to-zoom overlay, breadcrumbs, pill rows. */
.cs-bodyexplore { position: absolute; inset: 0; z-index: 4; cursor: zoom-in; }
.cs-tray-body { display: flex; flex-direction: column; gap: 6px; padding: 4px 0; }
.cs-body-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.cs-body-crumb { background: none; border: 0; padding: 2px 4px; font: inherit; color: var(--ink); cursor: pointer; text-decoration: underline dotted; }
.cs-body-crumb.current { text-decoration: none; font-weight: 600; cursor: default; }
.cs-body-sep { opacity: 0.6; }
.cs-body-named { min-height: 1.2em; font-style: italic; opacity: 0.85; }
.cs-body-pills { display: flex; flex-direction: column; gap: 4px; }
.cs-body-pillrow .cs-tray-pill.selected { background: var(--ink); color: var(--paper, #faf6ec); }
```

If `--paper` is not a variable in `styles.css`, use the literal `#faf6ec` (the figure ground) only.

- [ ] **Step 4: Typecheck, full suite, commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean and green — nothing here has node tests beyond the model (Task 1) and the plan rule (Task 2); the DOM module compiles against the real types, which is what `tsc` checks.

```bash
git add src/ui/body-explore.ts src/ui/tray.ts src/styles.css
git commit -m "The Body section: click a part to zoom into its region, breadcrumbs back, pills for layer, systems and names"
```

---

## Task 4: The example, the docs, the merge

**Files:**
- Modify: `src/examples.json`, `tests/anatomy-template.test.ts` (count 10), `src/scenes/anatomy/README.md`, `ROADMAP.md`

- [ ] **Step 1: Count test → 10, then the example**

`"drawcast ships nine anatomy examples"` → `ten` / `toBe(10)`. Append to `src/examples.json`:

```json
{
  "request": "Let me explore the body myself.",
  "packs": ["anatomy"],
  "spec": {
    "title": "Explore the body",
    "template": "anatomy",
    "params": { "systems": ["viscera"], "detail": 2, "labels": "none" },
    "commands": [
      { "draw": ["body_outline", "brain", "trachea", "lung_right", "lung_left", "heart", "liver", "stomach", "spleen", "pancreas", "kidney_right", "kidney_left", "small_intestine", "large_intestine", "bladder"], "speak": "The organs, seen from the front. Nothing is named yet." },
      { "explore": { "anatomy": true }, "speak": "Click anything you are curious about to zoom in, click again to see its name, and use the crumbs to come back. Press Continue when you are done." },
      { "quiz": { "question": "Which organ did you find tucked behind the stomach, across the back of the belly?", "choices": ["The pancreas", "The bladder", "The trachea"], "correct": 1, "right": "The pancreas — behind the stomach, its head in the curve of the duodenum." } }
    ]
  }
}
```

Run: `npx vitest run tests/examples.test.ts tests/molecule3d.test.ts tests/anatomy-template.test.ts` — PASS. (`lintCommands` sees ink before the explore beat's narration, and an `explore` with `speak` is a normal beat.)

- [ ] **Step 2: Docs**

`src/scenes/anatomy/README.md`: a short section "Exploring in the app" — the ⊕ tray's Body section, what a click does, that `explore: { anatomy: true }` is the authored beat, and that all of it is a preview Continue undoes. `ROADMAP.md`: mark part 2 shipped in the anatomy block; part 3 next.

- [ ] **Step 3: Full suite, build, commit, merge, push**

Run: `npx vitest run && npx tsc --noEmit && npm run build`

```bash
git add src/examples.json tests/anatomy-template.test.ts src/scenes/anatomy/README.md ROADMAP.md
git commit -m "Explore the body: the authored beat, and the docs"
```

Then from the main checkout: `git checkout main && git pull --ff-only && git merge --no-ff worktree-anatomy-3 && npm install && npx vitest run && git push origin main && git ls-remote origin refs/heads/main`, remove the worktree and branch, and tell Hans what to try: open ⊕ on any anatomy figure, click the liver, click it again, click Body, switch Behind, switch Norsk, then Continue.

---

## Self-Review

**Spec coverage (Part 2).** Click-to-zoom with the region rule → Tasks 1 and 3. Breadcrumbs → Tasks 1 and 3. Controls layer/systems/names + the existing detail slider → Task 3 (pills) and Task 2 (the body gate keeps sliders). Preview through `previewParams`/`repaint`, Continue restores → Task 3 (overrides). `explore: { anatomy: true }` through schema, plan, tray → Task 2, gate wiring in Task 3. Body section without the flag whenever the template is anatomy → Task 2's `bodyTemplate`. Example → Task 4. Tests: the focus rule and breadcrumbs are pure and tested (Task 1); the plan rule is tested (Task 2); the DOM module compiles.

**Type consistency.** `focusTargetFor(parts, clicked, currentFocus)` returns `{ focus, highlight }` in Task 1 and is consumed exactly so in Task 3. `trayPlan` output `body` (Task 2) is read as `plan.body` in Task 3. `overrides: Record<string, unknown>` (Task 3) is what `mountBodySection` receives and what `repaint()` passes to `previewParams`, whose parameter is already `Record<string, unknown>`.

**Soft spots:**

1. **`freezeClick` runs in the capture phase on the stage** and stops propagation before a child overlay sees the event; the allow-list exemption is the one line that makes the overlay work. If clicks still do nothing, that line is the first place to look.
2. **The overlay sits above the figure while the tray is open**, so the click-ask gate (`.cs-figgate`, z-index 5) must stay above it (z-index 4) — an ask never runs while the tray is open anyway (the tray parks the run), but the ordering is deliberate.
3. **`hd.spec.template === "anatomy"`** is the only way the tray knows the figure has a body. A future template family that wants the section would generalise this to a manifest flag.
4. **Highlight uses the template's `highlight` param**, so a highlighted part gets accent ink and, under `labels: focus` (the default), its name — which is the "click again to name it" behaviour with no extra code.
