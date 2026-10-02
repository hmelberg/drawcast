// scripts/pictures.mjs — the picture a published cast shows on its link card
// (spec 2026-10-02-share-design §7.1), drawn for Claude Code publishes the way
// the app draws it: posterForPlaylistText, in a browser, through the dev
// harness's window.__poster. A picture is never worth a failed push: any
// trouble is a null (one cast) or a note (all of them).
import { existsSync, readdirSync } from "node:fs";
import { createServer as netServer } from "node:net";

export function decodePicture(b64) {
  if (!b64) return null;
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** cast.mjs browser()'s lookup — Playwright's own headless shell cache. */
async function defaultLaunch() {
  const { chromium } = await import("playwright-core");
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
    ?? (process.platform === "darwin" ? `${home}/Library/Caches/ms-playwright`
      : process.platform === "win32" ? `${process.env.LOCALAPPDATA}/ms-playwright`
      : `${process.env.XDG_CACHE_HOME ?? `${home}/.cache`}/ms-playwright`);
  const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell")).sort() : [];
  if (!shells.length) throw new Error("no headless Chromium — run: npx playwright-core install chromium-headless-shell");
  const dir = `${cache}/${shells.at(-1)}`;
  const sub = readdirSync(dir).find((d) => d.startsWith("chrome-headless-shell"));
  const exe = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  return chromium.launch({ executablePath: `${dir}/${sub}/${exe}`, args: ["--mute-audio"] });
}

function freePort() {
  return new Promise((ok, fail) => {
    const s = netServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/** Vite on a free local port, serving the repo (frames.html and src/). */
function defaultServe(root) {
  return async () => {
    const { createServer } = await import("vite");
    const port = await freePort();
    const server = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port, strictPort: true } });
    await server.listen();
    return { url: `http://127.0.0.1:${port}/`, close: () => server.close() };
  };
}

function within(ms, p) {
  return Promise.race([p, new Promise((ok) => setTimeout(() => ok(null), ms))]);
}

export async function drawPictures(texts, opts = {}) {
  if (texts.length === 0) return { pictures: [], note: null };
  const launch = opts.launch ?? defaultLaunch;
  const serve = opts.serve ?? defaultServe(opts.root ?? process.cwd());
  const perCastMs = opts.perCastMs ?? 30000;
  let server = null;
  let browser = null;
  try {
    server = await serve();
    browser = await launch();
    const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
    await page.goto(`${server.url}frames.html`);
    await page.waitForFunction(() => typeof window.__poster === "function", null, { timeout: 60000 });
    const pictures = [];
    for (const text of texts) {
      const b64 = await within(perCastMs, page.evaluate((t) => window.__poster(t), text).catch(() => null));
      pictures.push(decodePicture(b64));
    }
    return { pictures, note: null };
  } catch (err) {
    return { pictures: texts.map(() => null), note: String(err?.message ?? err).split("\n")[0] };
  } finally {
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  }
}
