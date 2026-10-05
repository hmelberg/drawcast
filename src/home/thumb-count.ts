// Counting which thumbnail was shown and clicked (2026-10-06,
// netlify/functions/thumbs.mts): a card counts as shown once half of it has
// been on screen for a second; what was shown goes in one beacon when the page
// is left, a click in its own. Only on drawcast.app itself. A random id kept
// in this browser seeds which variant a viewer sees (src/card/choose.ts) — it
// never leaves the browser.

const ENDPOINT = "/api/thumbs";
const VIEWER_KEY = "drawcast:viewer";
/** How long half a card must stay on screen to count as shown. */
const SEEN_MS = 1000;

function live(): boolean {
  return typeof location !== "undefined" && location.hostname === "drawcast.app";
}

/** This browser's random id (or a fresh one each load when storage is refused). */
export function viewerId(): string {
  try {
    let id = localStorage.getItem(VIEWER_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      localStorage.setItem(VIEWER_KEY, id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

const shown = new Set<string>();
let flushed = false;

function send(body: unknown): void {
  if (!live()) return;
  const data = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([data], { type: "application/json" }))) return;
  } catch {
    /* fall through to fetch */
  }
  void fetch(ENDPOINT, { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: data }).catch(() => undefined);
}

function flush(): void {
  if (shown.size === 0) return;
  send({ seen: [...shown], seg: "all" });
  shown.clear();
}

let io: IntersectionObserver | null = null;
const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
const keys = new WeakMap<Element, string>();

/** Count `el` (a card showing variant `variant` of `name`) as shown once it stays half on screen for a second. */
export function watchShown(el: Element, name: string, variant: number): void {
  if (!live() || typeof IntersectionObserver === "undefined") return;
  keys.set(el, `${name}:${variant}`);
  io ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          if (!timers.has(e.target))
            timers.set(
              e.target,
              setTimeout(() => {
                const k = keys.get(e.target);
                if (k) shown.add(k);
                io?.unobserve(e.target);
              }, SEEN_MS),
            );
        } else {
          clearTimeout(timers.get(e.target));
          timers.delete(e.target);
        }
      }
    },
    { threshold: 0.5 },
  );
  io.observe(el);
  if (!flushed) {
    flushed = true;
    addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }
}

/** A click on a card showing variant `variant` of `name` (what was shown goes too). */
export function countClick(name: string, variant: number): void {
  shown.add(`${name}:${variant}`);
  flush();
  send({ click: `${name}:${variant}`, seg: "all" });
}
