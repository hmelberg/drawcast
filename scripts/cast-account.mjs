// The /drawcast skill's drawcast account and names (cast.mjs login, logout,
// name, name-wait). A session token comes from the device sign-in
// (drawcast-anvil's /device/start + /device/poll: the terminal shows a code,
// the person types it on drawcast.anvil.app/#device) and is kept in
// ~/.config/drawcast/session.json, readable by the user only. Apart from
// cast.mjs so tests can reach it; nothing here imports the app.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The drawcast server: DRAWCAST_API, else the default app (src/learn.ts DEFAULT_ENROLL_API). */
export const apiUrl = () => (process.env.DRAWCAST_API || "https://drawcast.anvil.app").replace(/\/+$/, "");
export const sessionPath = (home) => join(home, ".config/drawcast/session.json");

export function readSession(home) {
  const f = sessionPath(home);
  if (!existsSync(f)) return null;
  try {
    const s = JSON.parse(readFileSync(f, "utf8"));
    return typeof s.key === "string" ? { api: s.api, key: s.key, email: s.email ?? null } : null;
  } catch {
    return null;
  }
}

export function writeSession(home, s) {
  const f = sessionPath(home);
  mkdirSync(join(home, ".config/drawcast"), { recursive: true, mode: 0o700 });
  writeFileSync(f, JSON.stringify(s) + "\n", { mode: 0o600 });
  chmodSync(f, 0o600); // writeFileSync's mode only applies to a NEW file
}

export function clearSession(home) {
  rmSync(sessionPath(home), { force: true });
}

const post = (fetchImpl, url, body) => fetchImpl(url, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The device sign-in: say the code and where to type it, poll until the
 *  person allows (→ {key, email}), denies or the code expires (→ throws). */
export async function deviceLogin({ api, label, fetchImpl = fetch, sleep = wait, say = console.log }) {
  const start = await post(fetchImpl, `${api}/_/api/device/start`, { label });
  if (!start.ok) throw new Error(start.status === 429 ? "rate — too many sign-ins in the last hour" : `the drawcast server did not answer (${start.status})`);
  const { device, code, verify, interval, expires_in } = await start.json();
  say(`Open ${verify} (sign in if asked) and type this code: ${code}\nWaiting up to ${Math.round(expires_in / 60)} minutes…`);
  for (let waited = 0; waited < expires_in; waited += interval) {
    await sleep(interval * 1000);
    const r = await post(fetchImpl, `${api}/_/api/device/poll`, { device });
    if (r.status === 202) continue;
    const body = await r.json().catch(() => ({}));
    if (r.ok && typeof body.key === "string") return { key: body.key, email: body.email ?? null };
    throw new Error(body.error || `poll ${r.status}`);
  }
  throw new Error("expired");
}
