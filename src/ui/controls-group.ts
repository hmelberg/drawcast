// The controls-group builder (design 2026-09-14 §2.6; extracted for the
// 2026-09-15 pane-controls round, spec §3.2 in
// docs/superpowers/specs/2026-09-14-pane-controls-design.md): one row per
// control, in authored order, plus a Run row when the script does not run
// itself. This is the EXACT DOM tray.ts always built inline — kept here as
// its own module because the tray is no longer the only live copy of a
// script's controls: since the 2026-09-15 live-controls round the DRAWN
// `pane: controls` panel takes the pointer itself (ui/controls-host.ts),
// and it commits through the very same closures these rows do.
//
// Pure with respect to the tray: it knows nothing of the tray's own value
// map, its re-run scheduler, or its takeover set — its caller supplies
// `values`, `commit`, `run` and `quiet` as closures over that shared state,
// so a knob moved on the drawing and a Run pressed in the tray still read
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
  /** A control moved: the tray's next-values step, then a re-run. `group` is
   *  the row's own enclosing group node — passed so a caller that ever needs
   *  to tell one mounted copy from another can; tray.ts ignores it. */
  commit: (c: ControlSpec, raw: string | boolean, immediate: boolean, group: HTMLElement) => void;
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
    // `data-control` names the row for anything that must find it again by
    // control name — a debugging hook, and the handle a future cross-copy
    // sync would need. Kept because it costs nothing and names the row.
    const row = h("div", { class: `cs-tray-row cs-tray-ctl cs-tray-ctl-${rowWidth(c.kind)}`, "data-control": c.name });
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
          d.commit(c, range.value, false, group);
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
            d.commit(c, v, true, group);
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
        box.addEventListener("change", () => d.commit(c, box.checked, true, group));
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
        input.addEventListener("change", () => d.commit(c, input.value, true, group)); // Enter or blur
        row.append(label, input);
        break;
      }
      case "button": {
        const pill = h("button", { class: "cs-tray-pill cs-tray-ctlbtn" }, c.caption ?? c.label);
        pill.addEventListener("click", () => d.commit(c, "", true, group));
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
