// The confidence bet's gate (W16, guess/confidence.ts): the three buttons
// are marks the player has drawn on the figure; the viewer taps one (or
// presses 1–3, or Tab/Enter) — the choose gate's own handling, pointed at
// the buttons' boxes instead of drawn elements. No ✓/✗: a bet is not judged
// here; the verdict follows it. Skip unless the question is required.

import type { RenderHandle } from "../render";
import type { BBox } from "../layout/geometry";
import { chooseGateFor } from "./choose-gate";

export type ConfidenceGate = (signal: AbortSignal, bet: { boxes: BBox[]; labels: string[]; required: boolean }) => Promise<number | null>;

export function confidenceGateFor(stage: HTMLElement, hd: RenderHandle): ConfidenceGate {
  return async (signal, bet) => {
    const ids = bet.boxes.map((_, i) => `__bet_${i + 1}`);
    const boxes = new Map(ids.map((id, i) => [id, bet.boxes[i]]));
    const gate = chooseGateFor(stage, hd, () => ({ boxes, rings: new Map(), lines: new Map() }));
    const picked = await gate(signal, {
      question: "",
      retry: false,
      required: bet.required,
      choose: ids.map((id, i) => ({ id, label: bet.labels[i] ?? "", members: [] })),
      judge: false,
      quiet: true,
    } as Parameters<typeof gate>[1]);
    const k = picked === null ? -1 : ids.indexOf(picked);
    return k < 0 ? null : k;
  };
}
