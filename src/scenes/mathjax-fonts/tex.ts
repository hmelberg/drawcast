// MathJax's original TeX font — the fallback, and what version 3 drew with.
// All of its glyph data is in the font module itself: no dynamic files.
import { MathJaxTexFont } from "@mathjax/mathjax-tex-font/js/svg.js";

export const font = MathJaxTexFont;
export const dynamic: Record<string, unknown> = {};
