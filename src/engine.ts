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
import { setTrustPolicy } from "./security/code-trust";
// The embeddable engine renders what its HOST page hands it, in the host's
// own origin: the host is the author, and there is no drawcast secret in
// that origin to protect. Code in those specs runs as the host wrote it
// (security/code-trust.ts; the app and the share viewer use "check").
setTrustPolicy("all");
defineDrawcastFigure();
