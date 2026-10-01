// scripts/share-card-image.mjs — draws public/share-card.png, the picture a
// link card shows when a cast has none of its own (spec 2026-10-02-share-design §4).
// Run: node scripts/share-card-image.mjs
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const home = homedir();
const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
  ?? (process.platform === "darwin" ? `${home}/Library/Caches/ms-playwright`
    : process.platform === "win32" ? `${process.env.LOCALAPPDATA}/ms-playwright`
    : `${process.env.XDG_CACHE_HOME ?? `${home}/.cache`}/ms-playwright`);
const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell")).sort() : [];
if (!shells.length) throw new Error("no headless Chromium — run: npx playwright-core install chromium-headless-shell");
const dir = `${cache}/${shells.at(-1)}`;
const sub = readdirSync(dir).find((d) => d.startsWith("chrome-headless-shell"));
const browser = await chromium.launch({ executablePath: `${dir}/${sub}/${process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell"}` });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(`<!doctype html><html><body style="margin:0">
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#faf7f2"/>
  <path d="M170 420 C 300 250, 420 520, 560 330 S 820 200, 1030 300" fill="none" stroke="#3d3833" stroke-width="10" stroke-linecap="round"/>
  <circle cx="1030" cy="300" r="16" fill="#c8553d"/>
  <text x="170" y="220" font-family="Georgia, serif" font-size="96" fill="#3d3833">drawcast</text>
  <text x="172" y="520" font-family="Georgia, serif" font-size="38" fill="#6b625a">Drawn explanations you can watch and play with</text>
</svg></body></html>`);
await page.screenshot({ path: "public/share-card.png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log("wrote public/share-card.png");
