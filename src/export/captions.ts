// The export's caption track: what the video says, when it says it, as a
// WebVTT sidecar. The text is drawcast's own — never a transcription of the
// synthesized audio — so it carries the respellings back out (pronounce.ts
// says QALY as "qualy"; the caption still reads QALY).

export interface CaptionCue {
  text: string;
  /** Milliseconds from the first recorded frame. */
  startMs: number;
  endMs: number;
}

function timestamp(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${pad(Math.floor(t / 3_600_000))}:${pad(Math.floor(t / 60_000) % 60)}:${pad(Math.floor(t / 1000) % 60)}.${pad(t % 1000, 3)}`;
}

/**
 * Serialize a caption track as WebVTT. A cue's text is flattened to one line
 * and its markup characters escaped: a stray newline would end the cue early
 * and a "<" would open a tag, and either turns the rest of the file into
 * garbage in players that parse strictly.
 */
export function toVtt(cues: CaptionCue[]): string {
  const out = ["WEBVTT", ""];
  for (const cue of cues) {
    const text = cue.text.replace(/\s+/g, " ").trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    out.push(`${timestamp(cue.startMs)} --> ${timestamp(cue.endMs)}`, text, "");
  }
  return out.join("\n");
}

/** A subtitle held longer than this reads as a frozen wall of text. */
export const MAX_CUE_MS = 6000;

/**
 * Break cues that outstay MAX_CUE_MS into word-boundary parts, each holding
 * its share of the span in proportion to how much of the text it carries. A
 * narration line can run a dozen seconds; a subtitle should not.
 */
export function splitLongCues(cues: CaptionCue[], maxMs: number = MAX_CUE_MS): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const cue of cues) {
    const span = cue.endMs - cue.startMs;
    const parts = Math.ceil(span / maxMs);
    const words = cue.text.split(/\s+/).filter(Boolean);
    if (parts <= 1 || words.length <= 1) {
      out.push(cue);
      continue;
    }
    // Greedy fill to an equal-characters target, but never leave a part empty:
    // the tail must always have at least one word left for each part to come.
    const total = words.reduce((n, w) => n + w.length, 0);
    const target = total / parts;
    const groups: string[][] = [];
    let group: string[] = [];
    let chars = 0;
    for (const [i, w] of words.entries()) {
      const remaining = words.length - i;
      const partsLeft = parts - groups.length;
      if (group.length > 0 && (chars >= target || remaining < partsLeft)) {
        groups.push(group);
        group = [];
        chars = 0;
      }
      group.push(w);
      chars += w.length;
    }
    if (group.length > 0) groups.push(group);
    let at = cue.startMs;
    groups.forEach((g, i) => {
      const share = g.reduce((n, w) => n + w.length, 0) / total;
      const endMs = i === groups.length - 1 ? cue.endMs : Math.round(at + span * share);
      out.push({ text: g.join(" "), startMs: at, endMs });
      at = endMs;
    });
  }
  return out;
}

/**
 * The caption clock, ticked once per painted frame. `recording` says whether
 * the interval that just elapsed went into the video: the export pauses the
 * recorder while the tab is hidden (visibilityPauser) but the wall clock keeps
 * running, so timing cues by performance.now() would slide the whole track out
 * of sync for anyone who switches tabs mid-export.
 */
export class CaptionTape {
  private recordedMs = 0;
  private last: number | null = null;
  private openText = "";
  private openStart = 0;
  private readonly cues: CaptionCue[] = [];

  tick(nowMs: number, recording: boolean, text: string): void {
    if (this.last !== null && recording) this.recordedMs += nowMs - this.last;
    this.last = nowMs;
    const next = text.trim();
    if (next === this.openText) return;
    this.close();
    this.openText = next;
    this.openStart = this.recordedMs;
  }

  /** Close the open cue and return the track. Empty and zero-length cues are dropped. */
  finish(): CaptionCue[] {
    this.close();
    this.openText = "";
    return this.cues;
  }

  private close(): void {
    if (this.openText && this.recordedMs > this.openStart) {
      this.cues.push({ text: this.openText, startMs: this.openStart, endMs: this.recordedMs });
    }
  }
}
