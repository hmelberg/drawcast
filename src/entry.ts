// Entry router: #gdoc=<google-doc-id>, #gdrive=<google-drive-file-id>, or
// #gh=<owner>/<repo>/<path> boots the standalone share viewer (a single
// player, no editor/AI); anything else loads the two-mode app.
// Code-split so shared-link viewers never download the editor or the Anthropic SDK.

const hash = location.hash;
if (/[#&](gdoc|gh|gdrive)[=-]/.test(hash)) {
  void import("./viewer").then(({ parseViewerHash, runViewer }) => {
    const req = parseViewerHash(hash);
    if (req) void runViewer(req);
  });
} else {
  void import("./main");
}

// Entering/leaving a share view requires a reload (the app builds eagerly).
window.addEventListener("hashchange", () => location.reload());

export {};
