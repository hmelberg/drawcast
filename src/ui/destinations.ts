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

export function openDestinations(state: CredentialState): string[] {
  return ["From disk…", ...(state.drivePicker ? ["From Google Drive…"] : []), ...(state.github ? ["From GitHub…"] : [])];
}

export function saveDestinations(state: CredentialState): string[] {
  return ["To disk…", ...(state.driveSave ? ["To Google Drive…"] : []), ...(state.github ? ["To GitHub…"] : [])];
}
