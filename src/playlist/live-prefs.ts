import type { PlaybackPrefs } from "../ui/controls";

/**
 * The playback preferences a playlist session hands to every item mount.
 *
 * The control bar is rebuilt from scratch at each mount (a ☰ jump, a part
 * edge, an auto-advance) and reads `mode`, `speed` and `muted` from these
 * prefs to set itself up. A copy taken once at session start put the
 * viewer's own choices back to the starting ones at every cut: muted went
 * back to sound (the published viewer passes no `muted`, so it force-
 * unmuted), narrated went back to silent. The Questions choice (⋯) too. This object follows every change
 * the bar reports and still forwards it to the host's own callbacks.
 */
export function livePrefs(start: PlaybackPrefs): PlaybackPrefs {
  const live: PlaybackPrefs = {
    ...start,
    onMode: (m) => {
      live.mode = m;
      start.onMode?.(m);
    },
    onSpeed: (s) => {
      live.speed = s;
      start.onSpeed?.(s);
    },
    onMute: (muted) => {
      live.muted = muted;
      start.onMute?.(muted);
    },
    onQuestions: (mode) => {
      live.questions = mode;
      start.onQuestions?.(mode);
    },
  };
  return live;
}
