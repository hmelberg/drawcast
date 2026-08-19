// YouTube-style player controls: poster (finished drawing), big play button,
// seekable per-command progress bar, mode/speed selects. Shared between the
// player mode, the editor preview, and the standalone #gdoc viewer.

import type { RenderHandle } from "../render";
import { h } from "./dom";

export interface PlaybackPrefs {
  mode: "narrated" | "silent" | "instant";
  speed: number;
  onMode?(mode: "narrated" | "silent" | "instant"): void;
  onSpeed?(speed: number): void;
}

export function attachPlayerControls(
  stageHost: HTMLElement,
  hd: RenderHandle,
  prefs: PlaybackPrefs,
  onPlayingChange?: (playing: boolean) => void,
): void {
  const stage = stageHost.querySelector<HTMLElement>(".cs-stage");
  if (!stage) return;
  stageHost.querySelectorAll(".cs-bigplay, .cs-controlbar").forEach((el) => el.remove());

  const total = hd.plan.steps.length;
  const bigPlay = h("button", { class: "cs-bigplay", title: "Play with narration" }, "▶");
  const playBtn = h("button", { class: "cs-bar-btn", title: "Play / pause" }, "▶");
  const backBtn = h("button", { class: "cs-bar-btn", title: "Step back one command" }, "⏮");
  const fwdBtn = h("button", { class: "cs-bar-btn", title: "Step forward one command" }, "⏭");
  const progressFill = h("div", { class: "cs-progress-fill" });
  const progress = h("div", { class: "cs-progress", title: "Seek (per command)" }, progressFill);
  const stepInd = h("span", { class: "step-indicator" }, `0/${total}`);
  const modeSel = h("select", { class: "cs-bar-select", title: "Playback mode" });
  for (const m of ["narrated", "silent", "instant"]) modeSel.appendChild(h("option", { value: m }, m));
  modeSel.value = prefs.mode;
  const speedSel = h("select", { class: "cs-bar-select", title: "Speed multiplier" });
  for (const s of ["0.5", "0.75", "1", "1.25", "1.5", "2"]) speedSel.appendChild(h("option", { value: s }, `${s}×`));
  speedSel.value = String(prefs.speed);
  if (!speedSel.value) speedSel.value = "1";
  const bar = h("div", { class: "cs-controlbar" }, playBtn, backBtn, fwdBtn, progress, stepInd, modeSel, speedSel);
  stage.appendChild(bigPlay);
  // The bar lives below the drawing so it never covers axis labels.
  stage.insertAdjacentElement("afterend", bar);

  const togglePlay = () => {
    if (hd.timeline.state === "playing") hd.timeline.pause();
    else void hd.timeline.play();
  };
  bigPlay.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlay();
  });
  playBtn.addEventListener("click", togglePlay);
  backBtn.addEventListener("click", () => hd.timeline.stepBack());
  fwdBtn.addEventListener("click", () => hd.timeline.stepForward());
  modeSel.addEventListener("change", () => {
    const m = modeSel.value as "narrated" | "silent" | "instant";
    hd.timeline.setMode(m);
    prefs.onMode?.(m);
  });
  speedSel.addEventListener("change", () => {
    const s = parseFloat(speedSel.value);
    hd.timeline.setSpeed(s);
    prefs.onSpeed?.(s);
  });
  bar.addEventListener("click", (e) => e.stopPropagation());
  // Clicking the drawing itself toggles play/pause, like a video.
  stage.addEventListener("click", togglePlay);
  progress.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = progress.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    hd.timeline.renderUpTo(Math.max(0, Math.min(total, Math.round(frac * total))));
  });

  hd.timeline.callbacks = {
    onState: (s) => {
      stage.classList.toggle("is-playing", s === "playing");
      stage.classList.toggle("is-paused", s === "paused");
      // Focus mode: let the host fade its chrome while playing.
      onPlayingChange?.(s === "playing");
      playBtn.textContent = s === "playing" ? "⏸" : "▶";
      bigPlay.textContent = s === "done" ? "↺" : "▶";
      bigPlay.title = s === "done" ? "Replay with narration" : "Play with narration";
    },
    onStep: (done) => {
      stepInd.textContent = `${done}/${total}`;
      progressFill.style.width = `${total > 0 ? (done / total) * 100 : 0}%`;
    },
  };

  // Thumbnail state: show the finished drawing as the poster.
  hd.timeline.showPoster();
  bigPlay.textContent = "▶"; // poster shows play, not replay
  bigPlay.title = "Play with narration";
}
