// Fira Math for the mathjax engine (MathJax 4's mathjax-fira font). Its
// glyph data beyond the base ranges lives in "dynamic" files MathJax asks
// for by name at load time; they are bundled here, eagerly, so a viewer
// fetches ONE chunk and layoutTeX can stay synchronous (engines.ts). This
// module is only ever reached through a dynamic import — its data must
// never ride in the main chunk.
import { MathJaxFiraFont } from "@mathjax/mathjax-fira-font/js/svg.js";

export const font = MathJaxFiraFont;
/** Basename (without .js) → the evaluated dynamic module. */
export const dynamic: Record<string, unknown> = Object.fromEntries(
  Object.entries(import.meta.glob("/node_modules/@mathjax/mathjax-fira-font/mjs/svg/dynamic/*.js", { eager: true })).map(([path, mod]) => [
    path.split("/").pop()!.replace(/\.js$/, ""),
    mod,
  ]),
);
