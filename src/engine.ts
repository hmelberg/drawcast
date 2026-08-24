// Engine entry — the embeddable drawcast renderer, built by `npm run
// build:engine` into dist-engine/ (ESM + relative chunks; vendor the whole
// directory). Hosts import { render, loadSpecText } or use the
// <drawcast-figure> element. No editor, no app chrome, no Anthropic SDK —
// generation lives in the compiler entry.
export { render, loadSpecText } from "./engine-render";
export { parseSpecText, formatSpec } from "./spec/text";
export { validateSpec } from "./spec/schema";
export type { SpeechLike } from "./render/speech";
export type { RenderHandle, RenderOptions, RenderStyle } from "./render";
export { DrawcastFigure, defineDrawcastFigure, parseFigureAttrs, type FigureAttrs } from "./engine-element";

import { defineDrawcastFigure } from "./engine-element";
defineDrawcastFigure();
