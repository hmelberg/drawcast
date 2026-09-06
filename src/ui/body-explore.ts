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

const ROW_TITLES: Record<"show" | "layer" | "names", Record<NameLang, string>> = {
  show: { en: "Show", nb: "Vis", la: "Systema" },
  layer: { en: "Layer", nb: "Lag", la: "Stratum" },
  names: { en: "Names", nb: "Navn", la: "Nomina" },
};
const HINT: Record<NameLang, string> = {
  en: "Click a part of the body to zoom in; click again to name it.",
  nb: "Klikk på en del av kroppen for å zoome inn; klikk igjen for å se navnet.",
  la: "Partem corporis preme ut propius videas; iterum preme ut nomen videas.",
};

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
  const hint = h("div", { class: "cs-tray-hint" });
  const crumbs = h("div", { class: "cs-body-crumbs" });
  const named = h("span", { class: "cs-body-named" });
  const pills = h("div", { class: "cs-body-pills" });
  el.appendChild(hint);
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
      b.addEventListener("click", () => {
        pick(c.value);
        repaint();
        render();
      });
      row.appendChild(b);
    }
    return row;
  };

  const render = (): void => {
    const P = parts();
    const L = lang();
    const focus = focusNow();
    hint.textContent = HINT[L];
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
    const same = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
    pills.appendChild(pillRow(ROW_TITLES.show[L], SYSTEM_CHOICES, (v) => same(v, systemsNow), (v) => { overrides.systems = v; }));
    const layerNow = current().layer === "deep" ? "deep" : "superficial";
    pills.appendChild(pillRow(ROW_TITLES.layer[L], LAYER_CHOICES, (v) => v === layerNow, (v) => { overrides.layer = v; }));
    pills.appendChild(pillRow(ROW_TITLES.names[L], NAME_CHOICES, (v) => v === L, (v) => { overrides.names = v; }));
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
