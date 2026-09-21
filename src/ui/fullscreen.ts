// Fullscreen that also works on a phone.
//
// Safari on iPhone has no Fullscreen API for ordinary elements — only a
// <video> can go fullscreen, through webkitEnterFullscreen. So the control
// bar's one-liner, `el.requestFullscreen?.()`, evaluated to `undefined` on
// every iPhone: the ⛶ button was inert, in portrait and in landscape alike,
// and nothing on screen said so. (iPadOS and desktop Safari do support the
// unprefixed API, which is why this only ever showed up on a phone.)
//
// Hence two paths to the same place: the real API where it exists, and where
// it does not, a FAUX fullscreen — the figure pinned over the viewport with
// the page scroll locked underneath it. styles.css keys every fullscreen rule
// on `:is(:fullscreen, .cs-faux-fs)`, so both paths get identical layout, and
// this module fires a `fullscreenchange` event on either path so listeners
// written for the native one keep working unchanged.

/** On the figure that is standing in for a fullscreen element. */
const FAUX = "cs-faux-fs";
/** On <html> while the page beneath a faux fullscreen is frozen. */
const LOCK = "cs-faux-fs-lock";

let fauxEl: HTMLElement | null = null;
/** Where the page was scrolled to when the lock went on. */
let savedScrollY = 0;

/**
 * The element currently filling the screen by either route — `null` when
 * nothing is. Callers that need to reparent something INTO the fullscreen
 * element (ui/code-typing.ts's suggestion list) must use this rather than
 * `document.fullscreenElement`, which knows nothing about the faux path.
 */
export function fullscreenElement(): HTMLElement | null {
  return (document.fullscreenElement as HTMLElement | null) ?? fauxEl;
}

/**
 * Whether this browser can put THIS element in real fullscreen. Takes its two
 * inputs rather than reading the globals so the routing decision — the whole
 * point of this module — is testable without a DOM: an iPhone is an element
 * with no `requestFullscreen` at all, an iframe without the permission is one
 * that has the method while `fullscreenEnabled` is false.
 */
export function canGoNative(el: { requestFullscreen?: unknown }, doc: { fullscreenEnabled?: boolean }): boolean {
  return typeof el.requestFullscreen === "function" && doc.fullscreenEnabled === true;
}

// `overflow: hidden` on <body> alone does not hold on iOS Safari — the page
// still rubber-bands and, worse, scrolls away under the overlay, so leaving
// fullscreen lands somewhere else than where it started. Pinning the body and
// restoring the offset on exit is the construction that does hold.
function lockScroll(): void {
  savedScrollY = window.scrollY;
  const s = document.body.style;
  s.position = "fixed";
  s.top = `${-savedScrollY}px`;
  s.left = "0";
  s.right = "0";
  s.width = "100%";
  document.documentElement.classList.add(LOCK);
}

function unlockScroll(): void {
  const s = document.body.style;
  s.position = "";
  s.top = "";
  s.left = "";
  s.right = "";
  s.width = "";
  document.documentElement.classList.remove(LOCK);
  window.scrollTo(0, savedScrollY);
}

const onKeyDown = (e: KeyboardEvent): void => {
  // The native path gets this from the browser; the faux one has to spend the
  // key itself. Capture phase, so a figure that binds Escape of its own (the
  // suggestion list, a card) does not swallow the way out of fullscreen.
  if (e.key !== "Escape" || !fauxEl) return;
  e.preventDefault();
  exitFullscreen();
};

function enterFaux(el: HTMLElement): void {
  if (fauxEl) return;
  fauxEl = el;
  el.classList.add(FAUX);
  lockScroll();
  document.addEventListener("keydown", onKeyDown, true);
  document.dispatchEvent(new Event("fullscreenchange"));
}

/** Leave fullscreen by whichever route we are in; a no-op when we are not. */
export function exitFullscreen(): void {
  if (fauxEl) {
    fauxEl.classList.remove(FAUX);
    fauxEl = null;
    unlockScroll();
    document.removeEventListener("keydown", onKeyDown, true);
    document.dispatchEvent(new Event("fullscreenchange"));
    return;
  }
  if (document.fullscreenElement) void document.exitFullscreen();
}

/** What the ⛶ button does: in → out, out → in, by the best route available. */
export function toggleFullscreen(el: HTMLElement): void {
  if (fullscreenElement()) {
    exitFullscreen();
    return;
  }
  if (!canGoNative(el, document)) {
    enterFaux(el);
    return;
  }
  // Presence of the method is not consent: an iframe without allow-fullscreen,
  // or a gesture the browser does not count as a user activation, rejects at
  // call time. The promise is the real answer, so the fallback hangs off it
  // too — a rejection lands the viewer in fullscreen rather than nowhere.
  void el.requestFullscreen().catch(() => enterFaux(el));
}
