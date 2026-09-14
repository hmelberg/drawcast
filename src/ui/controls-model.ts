// The tray's controls group, DOM-free (design 2026-09-14 §2.6): row widths,
// the re-run debounce per runtime, the trailing readout and the value step
// from a DOM event to the next values map. tray.ts renders it.
import type { ControlKind, ControlSpec, ControlValue } from "../code/controls";

export type RowWidth = "full" | "half";

export function rowWidth(kind: ControlKind): RowWidth {
  return kind === "slider" || kind === "text" ? "full" : "half";
}

/** Pyodide re-runs slower (a WASM CPython plus matplotlib per run), so it waits a little longer for the slider to settle. */
export function debounceMs(language: string): number {
  return language === "python" ? 400 : 250;
}

export function readout(control: ControlSpec, value: ControlValue): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return control.integer ? String(Math.round(n)) : n.toFixed(control.decimals ?? 2);
}

export function nextValues(values: Record<string, ControlValue>, control: ControlSpec, raw: string | boolean): Record<string, ControlValue> {
  const out = { ...values };
  switch (control.kind) {
    case "button":
      out[control.name] = Number(values[control.name] ?? 0) + 1;
      break;
    case "toggle":
      out[control.name] = raw === true || raw === "true";
      break;
    case "slider":
    case "number": {
      const n = Number(raw);
      out[control.name] = Number.isFinite(n) && raw !== "" ? n : control.default;
      break;
    }
    default:
      out[control.name] = String(raw);
  }
  return out;
}
