// The controls-group builder (design 2026-09-14 §2.6; extracted for the
// 2026-09-15 pane-controls round, spec §3.2 in
// docs/superpowers/specs/2026-09-14-pane-controls-design.md): one row per
// control, in authored order, plus a Run row when the script does not run
// itself. This is the EXACT DOM tray.ts always built inline — moved here so
// TWO hosts can mount it: the tray's own copy (under the control bar) and, a
// `pane: controls` panel's card (controls-card.ts, lying ON the drawn pane).
// Same group, same classes, same listeners either way.
//
// Pure with respect to the tray: it knows nothing of the tray's own value
// map, its re-run scheduler, or its takeover set — its caller supplies
// `values`, `commit`, `run` and `quiet` as closures over that shared state,
// so a slider dragged in one host and a Run pressed in the other still read
// and write the one state tray.ts owns.
import type { SpecElement } from "../spec/types";
import type { ControlSpec, ControlValue } from "../code/controls";
import { h } from "./dom";
import { readout, rowWidth } from "./controls-model";

export interface ControlsGroupDeps {
  /** The element the controls belong to — its id labels the group, and its
   *  `autorun` decides whether a Run ▶ row is added. */
  el: SpecElement;
  /** The authored script `applyControls` rewrites — carried through for
   *  parity with the callers' own deps (both build it the same way; the
   *  group itself only needs `el` and `controls`). */
  authoredCode: string;
  controls: ControlSpec[];
  /** The current values for this script — read fresh for every row built. */
  values: () => Record<string, ControlValue>;
  /** A control moved: the tray's next-values step, then a re-run. */
  commit: (c: ControlSpec, raw: string | boolean, immediate: boolean) => void;
  /** The group's own Run ▶, for `autorun: false` — an immediate, forced re-run. */
  run: () => void;
  /** Quiet until Continue: the viewer took the script over by editing it. */
  quiet: boolean;
}

/**
 * Builds the controls group for one script — the tray has always shown this
 * DOM; nothing about its markup or classes changed in the extraction (a
 * takeover's `cs-tray-controls-quiet` toggle, wherever the group ends up
 * mounted, still finds exactly this class on exactly this node).
 */
export function buildControlsGroup(d: ControlsGroupDeps): HTMLElement {
  const group = h("div", { class: "cs-tray-controls", role: "group", "aria-label": `Controls for ${d.el.id}` });
  if (d.quiet) group.classList.add("cs-tray-controls-quiet");
  for (const c of d.controls) {
    const row = h("div", { class: `cs-tray-row cs-tray-ctl cs-tray-ctl-${rowWidth(c.kind)}` });
    const label = h("span", { class: "cs-tray-label" }, c.label);
    const current = d.values()[c.name] ?? c.default;
    switch (c.kind) {
      case "slider": {
        const range = h("input", {
          type: "range",
          min: String(c.min),
          max: String(c.max),
          step: String(c.step),
          value: String(current),
          "aria-label": c.label,
        }) as HTMLInputElement;
        const out = h("span", { class: "cs-tray-value" }, readout(c, current));
        range.addEventListener("input", () => {
          out.textContent = readout(c, Number(range.value));
          d.commit(c, range.value, false);
        });
        row.append(label, range, out);
        break;
      }
      case "choice": {
        const seg = h("div", { class: "cs-tray-choice", role: "group", "aria-label": c.label });
        const btns: HTMLButtonElement[] = [];
        for (const v of c.options ?? []) {
          const b = h("button", { class: "cs-tray-choicebtn", "data-value": v }, v);
          b.addEventListener("click", () => {
            for (const x of btns) {
              const on = x === b;
              x.classList.toggle("on", on);
              x.setAttribute("aria-pressed", String(on));
            }
            d.commit(c, v, true);
          });
          const on = v === current;
          b.classList.toggle("on", on);
          b.setAttribute("aria-pressed", String(on));
          btns.push(b);
          seg.appendChild(b);
        }
        row.append(label, seg);
        break;
      }
      case "toggle": {
        const box = h("input", { type: "checkbox", "aria-label": c.label }) as HTMLInputElement;
        box.checked = current === true;
        box.addEventListener("change", () => d.commit(c, box.checked, true));
        row.append(label, box);
        break;
      }
      case "text":
      case "number": {
        const input = h("input", {
          type: c.kind === "number" ? "number" : "text",
          value: String(current),
          "aria-label": c.label,
          ...(c.kind === "number" ? { step: c.integer ? "1" : "any" } : {}),
        }) as HTMLInputElement;
        input.addEventListener("change", () => d.commit(c, input.value, true)); // Enter or blur
        row.append(label, input);
        break;
      }
      case "button": {
        const pill = h("button", { class: "cs-tray-pill cs-tray-ctlbtn" }, c.caption ?? c.label);
        pill.addEventListener("click", () => d.commit(c, "", true));
        row.append(pill);
        break;
      }
    }
    group.appendChild(row);
  }
  if (d.el.autorun === false) {
    const run = h("button", { class: "cs-tray-run" }, "Run ▶");
    run.addEventListener("click", () => d.run());
    group.appendChild(h("div", { class: "cs-tray-actions" }, run));
  }
  return group;
}
