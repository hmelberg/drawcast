// Regenerates public/mark.svg from the same engine that draws it at runtime.
// Not part of any build step — the mark is drawn once, deliberately, and
// then committed as a plain asset. Run with: npx vite-node scripts/build-mark.ts
import { writeFileSync } from "node:fs";
import { markSvg } from "../src/brand/mark";

writeFileSync(new URL("../public/mark.svg", import.meta.url), markSvg(64));
