// Entry router: #gdoc=<google-doc-id>, #gdrive=<google-drive-file-id>,
// #gh=<owner>/<repo>/<path> or #anvil=<slug> boots the standalone share
// viewer (a single player, no editor/AI); a bare #<name> (spec §7) resolves
// the name first and then boots the same viewer; anything else loads the
// two-mode app. Code-split so shared-link viewers never download the editor
// or the Anthropic SDK.
//
// Before any of that, a `t=` in the address is a sign-in coming back
// (account.ts, spec §1): it is spent and stripped first, so the router never
// sees it and a copied link never carries it.

import { redeemFromAddress } from "./account";
import { isNameHash } from "./names";

async function boot(): Promise<void> {
  // Before routing: a `t=` in the address is a sign-in coming back, and the
  // hash it rode in on is the page the person actually asked for. The hash
  // is read AFTER the redeem, once the token has been stripped from it.
  await redeemFromAddress(location.hash, location.href);
  const hash = location.hash;
  if (/[#&](gdoc|gh|gdrive|anvil)[=-]/.test(hash)) {
    const { parseViewerHash, runViewer } = await import("./viewer");
    const req = parseViewerHash(hash);
    if (req) await runViewer(req);
  } else if (isNameHash(hash)) {
    const { runNamed } = await import("./viewer");
    await runNamed(hash);
  } else {
    await import("./main");
  }
}

void boot();

// Entering/leaving a share view requires a reload (the app builds eagerly).
// history.replaceState in the redeem above does not fire this — only a real
// navigation does — so stripping the token never reloads the page.
window.addEventListener("hashchange", () => location.reload());
