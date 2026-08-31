// Which Open ▾ / Save ▾ destinations a given credential state offers, and in
// what order. Pinned here, pure, so the mapping is tested directly —
// main.ts itself cannot be: a module-scope h(...) call crashes vitest's
// "node" environment the instant anything imports it.
//
// "disk" is always offered; the network destinations gate on the same
// checks main.ts's menu items use — factored out so the membership can't
// silently drift between the two menus, or between the real DOM build and
// what got tested.

export interface CredentialState {
  /** Drive's file picker (Open) — needs the client id AND its own developer key. */
  drivePicker: boolean;
  /** Drive save/YouTube — needs only the client id. */
  driveSave: boolean;
  /** A parseable repo AND a non-empty token — unlike Drive's checks, this can
   *  change mid-session: both are Settings values, not build-time env vars. */
  github: boolean;
}

/**
 * The exact label text each menu item shows — exported so main.ts builds its
 * real `MenuItem[]` from these same values instead of retyping the strings.
 * Two independent copies of "From GitHub…" (one here deciding visibility,
 * one in main.ts labelling the button) could drift on a rename and leave the
 * item permanently hidden while both test files stayed green — a `hidden`
 * check against a label that no longer matches anything is silently always
 * true. One copy of each string closes that gap structurally.
 */
export const OPEN_LABELS = {
  disk: "From disk…",
  drive: "From Google Drive…",
  github: "From GitHub…",
} as const;

export const SAVE_LABELS = {
  disk: "To disk…",
  drive: "To Google Drive…",
  github: "To GitHub…",
} as const;

export function openDestinations(state: CredentialState): string[] {
  return [OPEN_LABELS.disk, ...(state.drivePicker ? [OPEN_LABELS.drive] : []), ...(state.github ? [OPEN_LABELS.github] : [])];
}

export function saveDestinations(state: CredentialState): string[] {
  return [SAVE_LABELS.disk, ...(state.driveSave ? [SAVE_LABELS.drive] : []), ...(state.github ? [SAVE_LABELS.github] : [])];
}
