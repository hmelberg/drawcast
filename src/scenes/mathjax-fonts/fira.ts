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

// Each dynamic file registers its glyphs by calling dynamicSetup on the font
// class IT imports (`../../svg.js`). In a production build that is the class
// above; under the dev server (the font is a pre-bundled dep, the glob is
// served raw) and under Vite SSR (cast.mjs check/frames: the font is
// externalized) it is a second copy, so the class above kept its placeholder
// setups — which mark the file failed — and the first Latin-1 letter in a
// formula (å, ø, æ in \text{…}) threw "dynamic file 'latin' failed to load".
// Hand the twin's real setups to the class MathJax draws with.
type FontClass = { dynamicFiles: Record<string, { setup: (font: unknown) => void }> };
const twins = import.meta.glob("/node_modules/@mathjax/mathjax-fira-font/mjs/svg.js", { eager: true }) as Record<string, { MathJaxFiraFont?: FontClass }>;
for (const twin of Object.values(twins)) {
  const other = twin.MathJaxFiraFont;
  const own = MathJaxFiraFont as unknown as FontClass;
  if (!other || other === own) continue;
  for (const [name, file] of Object.entries(other.dynamicFiles)) {
    if (own.dynamicFiles[name]) own.dynamicFiles[name].setup = file.setup;
  }
}
