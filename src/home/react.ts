// Like / dislike (open thumbs) on the watch page (2026-10-03, delivery 2): signed-in viewers only,
// listed items only, stored in Anvil (POST /react, /react/state). The 👍
// count is public; a 👎 is private — it counts only for the author's
// signals and is never shown, here or in the catalogue. Beside them the ♡
// Save (save round, 2026-10-04: POST /save) keeps the item on the viewer's
// Saved list (home/my-lists.ts).
//
// One controller per watch page, two views of it: the pill under the player
// and the row in the player's "⋯" menu (ui/menu-slot.ts) — a vote in one
// shows in the other at once.

import { getToken, setToken, signInUrl } from "../account";
import { apiBase, DEFAULT_ENROLL_API } from "../learn";
import { h } from "../ui/dom";
import { icon, type IconName } from "../ui/icons";

export type Vote = 1 | -1 | 0;
export interface ReactState {
  likes: number;
  vote: Vote;
  /** On this viewer's Saved list (false signed out). */
  saved: boolean;
}
/** "unknown": not a listed item (private, unlisted, no such name) — no buttons. */
export type ReactOutcome = ReactState | "unknown" | "signin" | "error";

function readState(body: unknown): ReactState | null {
  const b = body as { likes?: unknown; vote?: unknown; saved?: unknown } | null;
  if (!b || typeof b.likes !== "number") return null;
  const vote: Vote = b.vote === 1 ? 1 : b.vote === -1 ? -1 : 0;
  return { likes: Math.max(0, Math.floor(b.likes)), vote, saved: b.saved === true };
}

async function post(path: string, payload: object, fetchImpl: typeof fetch, api: string): Promise<ReactOutcome> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/${path}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return "unknown";
    if (res.status === 401) return "signin";
    if (!res.ok) return "error";
    return readState(await res.json()) ?? "error";
  } catch {
    return "error";
  }
}

/** This viewer's vote and the public count; vote 0 when signed out. */
export function fetchReactState(name: string, key: string, fetchImpl: typeof fetch = fetch, api = DEFAULT_ENROLL_API): Promise<ReactOutcome> {
  return post("react/state", key ? { key, name } : { name }, fetchImpl, api);
}

export function sendReaction(name: string, key: string, vote: Vote, fetchImpl: typeof fetch = fetch, api = DEFAULT_ENROLL_API): Promise<ReactOutcome> {
  return post("react", { key, name, vote }, fetchImpl, api);
}

/** Save or unsave: `{saved}`, or what went wrong. */
export async function sendSave(name: string, key: string, on: boolean, fetchImpl: typeof fetch = fetch, api = DEFAULT_ENROLL_API): Promise<boolean | "unknown" | "signin" | "error"> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/save`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key, name, on }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return "unknown";
    if (res.status === 401) return "signin";
    if (!res.ok) return "error";
    const b = (await res.json()) as { saved?: unknown };
    return typeof b.saved === "boolean" ? b.saved : "error";
  } catch {
    return "error";
  }
}

/** Pressing the button already pressed takes the vote back. */
export function nextVote(current: Vote, pressed: 1 | -1): Vote {
  return current === pressed ? 0 : pressed;
}

/** The optimistic count while the server answers. */
export function optimistic(s: ReactState, vote: Vote): ReactState {
  return { likes: Math.max(0, s.likes + (vote === 1 ? 1 : 0) - (s.vote === 1 ? 1 : 0)), vote, saved: s.saved };
}

/**
 * The reaction controls for `name` (a lecture's `course/3` reacts to the
 * course). Returns the two views; both stay hidden until the server says the
 * item is listed.
 */
export function reactionControls(rawName: string): { pill: HTMLElement; menuRow: HTMLElement } {
  const name = rawName.split("/", 1)[0];
  const views: { up: HTMLButtonElement; down: HTMLButtonElement; save: HTMLButtonElement; saveLabel: HTMLElement; count: HTMLElement; root: HTMLElement }[] = [];
  let state: ReactState = { likes: 0, vote: 0, saved: false };
  let busy = false;

  const paint = (): void => {
    for (const v of views) {
      v.root.hidden = false;
      v.count.textContent = state.likes ? String(state.likes) : "";
      v.up.setAttribute("aria-pressed", String(state.vote === 1));
      v.down.setAttribute("aria-pressed", String(state.vote === -1));
      v.save.setAttribute("aria-pressed", String(state.saved));
      v.saveLabel.textContent = state.saved ? "Saved" : "Save";
    }
  };

  let saving = false;
  const toggleSave = async (): Promise<void> => {
    const key = getToken();
    if (!key) {
      location.href = signInUrl(location.href);
      return;
    }
    if (saving) return;
    saving = true;
    const before = state.saved;
    state = { ...state, saved: !before };
    paint();
    const answer = await sendSave(name, key, state.saved);
    saving = false;
    if (answer === "signin") {
      setToken("");
      location.href = signInUrl(location.href);
      return;
    }
    state = { ...state, saved: typeof answer === "boolean" ? answer : before };
    paint();
  };

  const press = async (which: 1 | -1): Promise<void> => {
    const key = getToken();
    if (!key) {
      location.href = signInUrl(location.href);
      return;
    }
    if (busy) return;
    busy = true;
    const before = state;
    state = optimistic(state, nextVote(state.vote, which));
    paint();
    const answer = await sendReaction(name, key, state.vote);
    busy = false;
    if (answer === "signin") {
      setToken(""); // the session ended elsewhere; sign in again
      location.href = signInUrl(location.href);
      return;
    }
    // /react answers {likes, vote}: the saved flag is this page's own.
    state = typeof answer === "object" ? { ...answer, saved: state.saved } : before;
    paint();
  };

  const build = (cls: string, withLabels: boolean): HTMLElement => {
    const signedIn = getToken() !== "";
    const tip = (t: string): string => (signedIn ? t : `${t} (sign in)`);
    // Open thumbs, filled while pressed (styles.css swaps the pair).
    const thumbs = (open: IconName, full: IconName): SVGSVGElement[] => {
      const a = icon(open), b = icon(full);
      a.classList.add("react-open");
      b.classList.add("react-full");
      return [a, b];
    };
    const up = h("button", { type: "button", class: "react-btn react-up", title: tip("I like this"), "aria-label": "Like" }, ...thumbs("thumbUp", "thumbUpFilled")) as HTMLButtonElement;
    const count = h("span", { class: "react-count" });
    up.append(count);
    const down = h("button", { type: "button", class: "react-btn react-down", title: tip("I don't like this — only the author's signals see it"), "aria-label": "Dislike" }, ...thumbs("thumbDown", "thumbDownFilled")) as HTMLButtonElement;
    const saveLabel = h("span", { class: "react-save-label" }, "Save");
    const save = h("button", { type: "button", class: "react-btn react-save", title: tip("Keep it on your Saved list"), "aria-label": "Save" }, ...thumbs("heart", "heartFilled"), saveLabel) as HTMLButtonElement;
    up.addEventListener("click", () => void press(1));
    down.addEventListener("click", () => void press(-1));
    save.addEventListener("click", () => void toggleSave());
    const root = withLabels
      ? h("div", { class: `${cls} menu-item cs-menu-row`, hidden: "" }, h("span", {}, "Rate"), h("span", { class: "react-pair" }, up, down, save))
      : h("div", { class: cls, hidden: "" }, up, down, save);
    views.push({ up, down, save, saveLabel, count, root });
    return root;
  };

  const pill = build("react-pill", false);
  const menuRow = build("react-menu-row", true);
  void fetchReactState(name, getToken()).then((answer) => {
    if (typeof answer !== "object") return; // unlisted, private, or unreachable: no buttons at all
    state = answer;
    paint();
  });
  return { pill, menuRow };
}
