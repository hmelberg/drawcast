// Entry router: #gdoc=<google-doc-id>, #gdrive=<google-drive-file-id>,
// #gh=<owner>/<repo>/<path>, #anvil=<slug> or #cast=<data> (the cast inside
// the link, links/inline-cast.ts) boots the standalone share viewer (a single player, no editor/AI); a bare #<name> (spec §7) resolves
// the name first and then boots the same viewer; anything else loads the
// two-mode app. Code-split so shared-link viewers never download the editor
// or the Anthropic SDK.
//
// Before any of that, a `t=` in the address is a sign-in coming back
// (account.ts, spec §1): it is spent and stripped first, so the router never
// sees it and a copied link never carries it.

import { redeemFromAddress } from "./account";
import { DEFAULT_ENROLL_API } from "./learn";
import { isNameHash } from "./names";
import { bootRoute, onViewOrigin } from "./security/view-origin";

async function boot(): Promise<void> {
  // First of all, before any storage is read: which origin this page belongs
  // on (security/view-origin.ts). Only does anything when a view origin is
  // configured; then other people's public casts play there, and everything
  // that needs the account — the editor, sign-in, private casts — plays here.
  const route = bootRoute({ origin: location.origin, hash: location.hash });
  if (route.go) {
    location.replace(route.go);
    return;
  }
  // Before routing: a `t=` in the address is a sign-in coming back, and the
  // hash it rode in on is the page the person actually asked for. The hash
  // is read AFTER the redeem, once the token has been stripped from it.
  //
  // Bounded, like every other registry call in this repo: this await gates
  // first paint (index.html is a bare <div id="app">), and anyone can craft
  // `#name&t=junk` — an unbounded POST to a sleeping backend would hang a
  // shared link on a blank page. Ten seconds, then the page routes as usual,
  // signed out.
  // Never on the view origin: it holds no account token (bootRoute sends a
  // sign-in coming back there on to the main origin anyway).
  if (!onViewOrigin()) {
    await redeemFromAddress(location.hash, location.href, DEFAULT_ENROLL_API, (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
    );
  }
  const hash = location.hash;
  // index.html's pen-stroke loader covers the download; whatever boots now
  // draws its own page (the viewer its own loading line).
  const doneBooting = (): void => document.getElementById("boot")?.remove();
  // "#remix&gh=…" is the editor opening a copy of a shared cast (main.ts):
  // neither the viewer (whose pattern "&gh=" matches) nor a name ("remix"
  // parses as one), so it is set aside before both are tested.
  const remix = hash.startsWith("#remix&");
  // "#browse" (registry deliveries 3–4, task 9): the public catalogue, a
  // standalone page with no editor/AI/account — checked before both the
  // gh/gdoc/gdrive/anvil viewer test and isNameHash, since "browse" is a
  // reserved name prefix (names.ts RESERVED_PREFIXES) that could otherwise
  // never resolve as a name anyway, but must land on the catalogue rather
  // than falling through to the full app.
  if (hash === "#browse" || hash.startsWith("#browse&")) {
    const { runCatalogue } = await import("./catalogue");
    doneBooting();
    await runCatalogue(hash);
  } else if (hash === "#paste" || hash.startsWith("#paste&")) {
    // The paste page (paste.ts): a textarea for a cast an AI wrote, which
    // opens it as a #cast= link. Like #browse: no editor, AI or account.
    const { runPaste } = await import("./paste");
    doneBooting();
    runPaste();
  } else if (!remix && /[#&](gdoc|gh|gdrive|anvil|cast)[=-]/.test(hash)) {
    const { parseViewerHash, runViewer, showUnplayable } = await import("./viewer");
    doneBooting();
    const req = parseViewerHash(hash);
    // A refused hash is a message, never a silent blank page.
    if (req) await runViewer(req);
    else showUnplayable();
  } else if (!remix && isNameHash(hash)) {
    const { runNamed } = await import("./viewer");
    doneBooting();
    await runNamed(hash);
  } else {
    try {
      await import("./main");
    } finally {
      doneBooting();
    }
  }
}

void boot();

// Entering/leaving a share view requires a reload (the app builds eagerly).
// history.replaceState in the redeem above does not fire this — only a real
// navigation does — so stripping the token never reloads the page.
window.addEventListener("hashchange", () => location.reload());
