// Regenerates public/mark.svg from the same generator the topbar renders
// inline. Not part of any build step — the mark is drawn once, deliberately,
// and committed as a plain asset; tests/mark.test.ts checks the file is
// byte-identical to markSvg(64). Run with: npx vite-node scripts/build-mark.ts
import { writeFileSync } from "node:fs";
import { markSvg } from "../src/brand/mark";

writeFileSync(new URL("../public/mark.svg", import.meta.url), markSvg(64));
