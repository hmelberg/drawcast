// The account button (account round, 2026-10-06): one control at the top
// right of the front page, the watch page and the editor, as YouTube has.
// Signed out it is a "Sign in" pill; signed in, a round initial that opens a
// menu — who you are, your credit and plan, and where your things live.
// The same everywhere; the pages it points to exist once.
//
// Like account.ts it must stay light: no store.ts (the library), no credit.ts
// (it pulls the TTS exporter). Who is signed in comes from one call, POST
// /_/api/me, cached for the tab so the menu opens at once.

import { getToken, setToken, signInUrl, signOut } from "./account";
import { apiBase, DEFAULT_ENROLL_API } from "./learn";
import { onViewOrigin } from "./security/view-origin";
import { h } from "./ui/dom";

export interface Me {
  email: string;
  admin: boolean;
  credits: number;
  plan: string | null;
  planLabel: string | null;
  grace: boolean;
}

/** /me's answer, or null when it is not one. */
export function parseMe(body: unknown): Me | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.email !== "string" || typeof b.credits !== "number") return null;
  return {
    email: b.email,
    admin: b.admin === true,
    credits: b.credits,
    plan: typeof b.plan === "string" ? b.plan : null,
    planLabel: typeof b.plan_label === "string" ? b.plan_label : null,
    grace: b.grace === true,
  };
}

export async function fetchMe(key: string, fetchImpl: typeof fetch = fetch, api: string = DEFAULT_ENROLL_API): Promise<Me | "key" | "error"> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/me`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key }),
    });
    if (res.status === 401) return "key";
    if (!res.ok) return "error";
    return parseMe(await res.json()) ?? "error";
  } catch {
    return "error";
  }
}

/** The avatar's letter: the email's first letter or digit, upper-cased. */
export function initialOf(email: string): string {
  const m = /[a-z0-9]/i.exec(email);
  return m ? m[0].toUpperCase() : "?";
}

/** The plan as the menu says it. */
export function planText(me: Me): string {
  if (me.admin) return "Admin";
  if (me.planLabel) return `${me.planLabel} plan`;
  if (me.grace) return "Plan ended";
  return "No plan";
}

// ---------- the tab's cache ----------
// Keyed by the token's tail, so a sign-in as someone else never shows the
// last person's menu. Only what the menu shows is kept — never the token.

const ME_KEY = "drawcast.me";

function tagOf(token: string): string {
  return token.slice(-8);
}

export function cachedMe(token: string): Me | null {
  try {
    const raw = sessionStorage.getItem(ME_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { tag?: string; me?: unknown };
    return v.tag === tagOf(token) ? parseMe(v.me) : null;
  } catch {
    return null;
  }
}

function keepMe(token: string, me: Me): void {
  try {
    // Kept in /me's own shape, so parseMe reads it back.
    const body = { email: me.email, admin: me.admin, credits: me.credits, plan: me.plan, plan_label: me.planLabel, grace: me.grace };
    sessionStorage.setItem(ME_KEY, JSON.stringify({ tag: tagOf(token), me: body }));
  } catch {
    /* no storage — the menu asks again next page */
  }
}

/** Drop the cached menu: after sign-out, or once credit or the plan changed. */
export function forgetMe(): void {
  try {
    sessionStorage.removeItem(ME_KEY);
  } catch {
    /* nothing kept */
  }
}

// ---------- the menu ----------

export interface MenuItem {
  label: string;
  /** A link… */
  href?: string;
  newTab?: boolean;
  /** …or an action in this page. */
  run?: () => void;
}

export interface AccountOpts {
  /** "editor": account pages open in a new tab so unsaved work is never
   *  left behind, and Settings is this page's dialog. */
  where: "home" | "editor";
  /** The editor's Settings dialog, opened on a tab. */
  openSettings?: (tab?: string) => void;
  /** After sign-out has reached the server (the front page reloads; the
   *  editor refreshes its own rows). */
  onSignOut?: () => void;
}

/**
 * What the signed-in menu lists, in order. Your content and courses still
 * live on the server's account page (drawcast.anvil.app) until the front
 * page has its own; credit and keys are the editor's Settings.
 */
export function menuItems(opts: AccountOpts, api: string = DEFAULT_ENROLL_API): MenuItem[] {
  const editor = opts.where === "editor";
  const front = (href: string, label: string): MenuItem => ({ label, href, newTab: editor });
  const settings = (tab: string, label: string): MenuItem =>
    editor && opts.openSettings ? { label, run: () => opts.openSettings!(tab) } : { label, href: `./#settings=${tab}` };
  return [
    { label: "Your drawcasts & courses", href: `${apiBase(api)}/`, newTab: true },
    front("./?list=saved", "Saved"),
    front("./?list=liked", "Liked"),
    front("./?list=history", "Watch history"),
    settings("credits", "Credit & plan"),
    settings("keys", "Keys & settings"),
  ];
}

/** A head and shoulders, for the avatar until the email is known. */
function personIcon(): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 20c0-4 3.6-6 8-6s8 2 8 6"]) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "2");
    p.setAttribute("stroke-linecap", "round");
    svg.append(p);
  }
  return svg;
}

/**
 * The control itself. It draws at once from what this tab already knows,
 * then asks the server and redraws; a token the server no longer knows
 * signs this browser out quietly.
 */
export function accountButton(opts: AccountOpts, fetchImpl: typeof fetch = fetch): HTMLElement {
  const root = h("div", { class: "acct" });
  // The view origin holds no account (security/view-origin.ts): no button.
  if (onViewOrigin()) return root;
  let me: Me | null = null;

  const draw = (): void => {
    root.replaceChildren();
    const token = getToken();
    if (!token) {
      root.append(h("a", { class: "acct-signin", href: signInUrl(location.href) }, "Sign in"));
      return;
    }
    const btn = h(
      "button",
      { type: "button", class: "acct-avatar", "aria-haspopup": "menu", "aria-expanded": "false", title: me ? me.email : "Your account" },
      me ? initialOf(me.email) : personIcon(),
    ) as HTMLButtonElement;
    const head = h(
      "div",
      { class: "acct-head" },
      h("div", { class: "acct-email" }, me ? me.email : "Signed in"),
      ...(me ? [h("div", { class: "acct-sub" }, `${me.credits.toLocaleString("en-US")} credits · ${planText(me)}`)] : []),
    );
    const items = menuItems(opts).map((it) => {
      if (it.run) {
        const b = h("button", { type: "button", class: "acct-item", role: "menuitem" }, it.label);
        b.addEventListener("click", () => {
          close();
          it.run!();
        });
        return b;
      }
      return h("a", { class: "acct-item", role: "menuitem", href: it.href!, ...(it.newTab ? { target: "_blank", rel: "noopener" } : {}) }, it.label);
    });
    const out = h("button", { type: "button", class: "acct-item", role: "menuitem" }, "Sign out");
    out.addEventListener("click", () => {
      close();
      const t = getToken();
      setToken("");
      forgetMe();
      draw();
      // The local sign-out is what the person sees; the server row follows,
      // and only then may a page reload (or the POST is cut off).
      void signOut(DEFAULT_ENROLL_API, t).finally(() => opts.onSignOut?.());
    });
    const menu = h("div", { class: "acct-menu", role: "menu", hidden: "" }, head, h("div", { class: "acct-sep" }), ...items, h("div", { class: "acct-sep" }), out);

    const onDoc = (e: Event): void => {
      if (!root.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        close();
        btn.focus();
      }
    };
    function close(): void {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    }
    btn.addEventListener("click", () => {
      if (!menu.hidden) return close();
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", onDoc);
      document.addEventListener("keydown", onKey);
      (menu.querySelector(".acct-item") as HTMLElement | null)?.focus();
    });
    root.append(btn, menu);
  };

  const token = getToken();
  me = token ? cachedMe(token) : null;
  draw();
  if (token) {
    void fetchMe(token, fetchImpl).then((got) => {
      if (getToken() !== token) return; // signed out or in again meanwhile
      if (got === "key") {
        setToken("");
        forgetMe();
        draw();
      } else if (got !== "error") {
        me = got;
        keepMe(token, got);
        draw();
      }
    });
  }
  return root;
}
