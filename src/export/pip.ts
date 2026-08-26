// The export's always-on-top preview: a small Document Picture-in-Picture
// window (Chrome) mirroring the recording. While it is open, its rAF drives
// the whole export — so the recording continues when the drawcast tab is
// hidden, minimized, or covered. Best-effort by design: where the API is
// missing (Firefox, Safari) or the click's transient activation is already
// spent (a sign-in popup), the export still works and simply pauses while
// the tab is hidden, exactly as before.

import type { ExportKeepAlive } from "./keepalive";

export interface PipPreview {
  setStatus(text: string): void;
  showStream(stream: MediaStream): void;
  close(): void;
}

interface DocumentPip {
  requestWindow(opts?: { width?: number; height?: number }): Promise<Window>;
}

export async function openExportPreview(keepAlive: ExportKeepAlive): Promise<PipPreview | null> {
  const dpp = (window as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture;
  if (!dpp?.requestWindow) return null;
  let win: Window;
  try {
    win = await dpp.requestWindow({ width: 380, height: 260 });
  } catch {
    return null; // no user gesture left — fall back to pause-while-hidden
  }
  const doc = win.document;
  doc.title = "drawcast — recording";
  doc.body.style.cssText = "margin:0;height:100vh;display:flex;flex-direction:column;background:#f5f1e6;font-family:system-ui,sans-serif;";
  const video = doc.createElement("video");
  video.muted = true;
  video.autoplay = true;
  video.style.cssText = "flex:1;min-height:0;width:100%;object-fit:contain;";
  const status = doc.createElement("div");
  status.textContent = "Preparing…";
  status.style.cssText = "padding:5px 10px;font-size:12px;color:#3d3833;";
  doc.body.append(video, status);
  win.addEventListener("pagehide", () => keepAlive.detach()); // user closed the preview
  keepAlive.attach((cb) => win.requestAnimationFrame(() => cb()));
  return {
    setStatus: (text) => (status.textContent = text),
    showStream: (stream) => {
      video.srcObject = new MediaStream(stream.getVideoTracks()); // video only — the export stays silent
      void video.play().catch(() => undefined);
    },
    close: () => {
      keepAlive.detach();
      try {
        win.close();
      } catch {
        /* already closed by the user */
      }
    },
  };
}
