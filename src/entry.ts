// Entry router: #gdoc=<google-doc-id>, #gdrive=<google-drive-file-id>, or
// #gh=<owner>/<repo>/<path> boots the standalone share viewer (a single
// player, no editor/AI); a bare #<name> (spec §7) resolves the name first
// and then boots the same viewer; anything else loads the two-mode app.
// Code-split so shared-link viewers never download the editor or the Anthropic SDK.

import { isNameHash } from "./names";

const hash = location.hash;
if (/[#&](gdoc|gh|gdrive)[=-]/.test(hash)) {
  void import("./viewer").then(({ parseViewerHash, runViewer }) => {
    const req = parseViewerHash(hash);
    if (req) void runViewer(req);
  });
} else if (isNameHash(hash)) {
  void import("./viewer").then(({ runNamed }) => runNamed(hash));
} else {
  void import("./main");
}

// Entering/leaving a share view requires a reload (the app builds eagerly).
window.addEventListener("hashchange", () => location.reload());

export {};
