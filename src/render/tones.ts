// The play command's sound engine. Mirrors the SpeechLike seam: the Player
// calls a ToneLike, live playback uses a lazily-created AudioContext wired to
// the speakers, and the exporter constructs one bound to ITS AudioContext and
// MediaStream destination — so exports record every note while staying
// silent, exactly like narration (see export/tts.ts BufferSpeech).
//
// Scheduling is fire-and-forget on the audio clock: play() schedules all
// notes at ctx.currentTime and returns the total duration; the PLAYER owns
// the wait (via its frame clock), so background-tab timer throttling can
// never desync a beat. Everything is synthesized — no samples, no network.

import { parseNotation, type Instrument, type PlayVoice } from "../spec/notation";

export type { Instrument } from "../spec/notation";

export interface ToneLike {
  /**
   * Schedule the voices (all starting together) at `tempo` BPM; returns the
   * total duration in ms (the longest voice). Playback is not awaited —
   * abort the signal to stop early.
   */
  play(voices: PlayVoice[], tempo: number, signal?: AbortSignal): number;
  cancel(): void;
  pause(): void;
  resume(): void;
}

/** One synthesized voice: oscillator layers + an amplitude envelope. */
interface Recipe {
  /** [waveform, frequency multiple, relative gain] per layer. */
  layers: [OscillatorType, number, number][];
  attack: number;
  /** "sustain" holds until the note ends; "decay" dies exponentially. */
  shape: "sustain" | "decay";
  /** Decay time constant as a fraction of the note length (decay shape). */
  decayFrac: number;
  gain: number;
}

const RECIPES: Record<Instrument, Recipe> = {
  tone: { layers: [["triangle", 1, 1]], attack: 0.02, shape: "sustain", decayFrac: 1, gain: 0.22 },
  piano: {
    layers: [["triangle", 1, 1], ["sine", 2, 0.35], ["sine", 3, 0.12]],
    attack: 0.005,
    shape: "decay",
    decayFrac: 0.45,
    gain: 0.3,
  },
  organ: {
    layers: [["sine", 1, 1], ["sine", 2, 0.55], ["sine", 3, 0.3], ["sine", 4, 0.15]],
    attack: 0.04,
    shape: "sustain",
    decayFrac: 1,
    gain: 0.18,
  },
  pluck: { layers: [["sawtooth", 1, 1]], attack: 0.003, shape: "decay", decayFrac: 0.25, gain: 0.2 },
  bell: {
    layers: [["sine", 1, 1], ["sine", 2.76, 0.4], ["sine", 5.4, 0.18]],
    attack: 0.003,
    shape: "decay",
    decayFrac: 0.8,
    gain: 0.26,
  },
};

export class WebAudioTones implements ToneLike {
  private ctx: AudioContext | null;
  private sink: AudioNode | null;
  /** Owns its context (live mode): pause/resume suspend it. The exporter's shared context is managed by the exporter. */
  private ownsCtx: boolean;
  private active = new Set<{ stop(): void }>();

  constructor(ctx?: AudioContext, sink?: AudioNode) {
    this.ctx = ctx ?? null;
    this.sink = sink ?? null;
    this.ownsCtx = !ctx;
  }

  private ensure(): { ctx: AudioContext; sink: AudioNode } | null {
    if (!this.ctx) {
      if (typeof AudioContext === "undefined") return null;
      this.ctx = new AudioContext();
      this.sink = this.ctx.destination;
    }
    if (this.ownsCtx && this.ctx.state === "suspended") void this.ctx.resume();
    return { ctx: this.ctx, sink: this.sink ?? this.ctx.destination };
  }

  play(voices: PlayVoice[], tempo: number, signal?: AbortSignal): number {
    const bpm = Math.min(300, Math.max(30, tempo));
    const beatSec = 60 / bpm;
    const parsed = voices.map((v) => ({ tokens: parseNotation(v.notes), recipe: RECIPES[v.instrument ?? "tone"] ?? RECIPES.tone }));
    const totalMs = Math.max(0, ...parsed.map((v) => v.tokens.reduce((s, t) => s + t.beats, 0))) * beatSec * 1000;
    const audio = this.ensure();
    if (!audio || parsed.every((v) => v.tokens.length === 0)) return totalMs;
    const { ctx, sink } = audio;

    // Multi-voice damping: parallel channels share headroom.
    const voiceScale = 1 / Math.sqrt(Math.max(1, parsed.filter((v) => v.tokens.length > 0).length));
    const start = ctx.currentTime + 0.03;
    const scheduled: OscillatorNode[] = [];
    for (const { tokens, recipe } of parsed) {
      let at = start;
      for (const tok of tokens) {
        const dur = tok.beats * beatSec;
        const level = tok.freqs.length > 0 ? (recipe.gain * voiceScale) / Math.sqrt(tok.freqs.length) : 0;
        for (const f of tok.freqs) {
          for (const [wave, mult, layerGain] of recipe.layers) {
            const osc = ctx.createOscillator();
            osc.type = wave;
            osc.frequency.value = f * mult;
            const g = ctx.createGain();
            const peak = level * layerGain;
            g.gain.setValueAtTime(0, at);
            g.gain.linearRampToValueAtTime(peak, at + recipe.attack);
            if (recipe.shape === "decay") {
              g.gain.setTargetAtTime(0, at + recipe.attack, Math.max(0.04, dur * recipe.decayFrac));
            } else {
              g.gain.setValueAtTime(peak, Math.max(at + recipe.attack, at + dur - 0.07));
              g.gain.linearRampToValueAtTime(0, at + dur - 0.005);
            }
            osc.connect(g);
            g.connect(sink);
            osc.start(at);
            osc.stop(at + dur + (recipe.shape === "decay" ? 0.35 : 0.01));
            scheduled.push(osc);
          }
        }
        at += dur;
      }
    }

    const handle = {
      stop: () => {
        for (const osc of scheduled) {
          try {
            osc.stop();
          } catch {
            /* already stopped */
          }
        }
      },
    };
    this.active.add(handle);
    const forget = () => this.active.delete(handle);
    signal?.addEventListener("abort", () => {
      handle.stop();
      forget();
    });
    scheduled[scheduled.length - 1]?.addEventListener?.("ended", forget);
    return totalMs;
  }

  cancel(): void {
    for (const h of this.active) h.stop();
    this.active.clear();
    if (this.ownsCtx && this.ctx?.state === "suspended") void this.ctx.resume();
  }

  pause(): void {
    if (this.ownsCtx && this.ctx?.state === "running") void this.ctx.suspend();
  }

  resume(): void {
    if (this.ownsCtx && this.ctx?.state === "suspended") void this.ctx.resume();
  }
}
