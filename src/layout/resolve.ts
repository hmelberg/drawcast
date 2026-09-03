import type { SpecDraw, SpecStyle } from "../spec/types";
import { defaultDrawOpts, defaultStyle, type DrawResolved, type ResolvedStyle } from "./model";

export function resolveStyle(style: SpecStyle | undefined, base?: Partial<ResolvedStyle>): ResolvedStyle {
  const s = defaultStyle(base);
  if (!style) return s;
  return {
    color: style.color ?? s.color,
    fill: style.fill ?? s.fill,
    strokeWidth: style.stroke_width ?? s.strokeWidth,
    dash: style.dash ?? s.dash,
    roughness: style.roughness ?? s.roughness,
    opacity: style.opacity ?? s.opacity,
  };
}

export function resolveDrawOpts(draw: SpecDraw | undefined, defaults?: Partial<DrawResolved>): DrawResolved {
  // "type" is a text-leaf reveal that only code lines honour: the layout
  // asks for it through `defaults` on exactly those leaves; everywhere else
  // an author's draw.mode: type means sketch.
  const requested = draw?.mode ?? defaults?.mode ?? "sketch";
  const mode = requested === "type" && defaults?.mode !== "type" ? "sketch" : requested;
  const base = defaultDrawOpts(mode, defaults?.duration);
  if (draw?.duration !== undefined) {
    return { mode, duration: mode === "instant" ? 0 : draw.duration * 1000 };
  }
  return base;
}
