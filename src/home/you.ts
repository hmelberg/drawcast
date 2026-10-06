// The front page's "You" pages (account round delivery 2, 2026-10-06), as
// YouTube's: ?you=content (your published items as a table, YouTube Studio's
// content list), ?you=courses (what you follow and what you teach) and
// ?you=credit (balance, packs, statement, plan). What the server's account
// page (drawcast.anvil.app, Form1) shows, here, with its small actions:
// copy a link, list or unlist, show a private key, leave a course, set who
// may watch a course. The teacher's run view stays on the server for now.
//
// Server calls: POST /_/api/my/* (drawcast-anvil server_code/you.py). Text
// only through h() — every title here is the author's own, but still text.

import { getToken, setToken, signInUrl, signOut } from "../account";
import { forgetMe } from "../account-menu";
import { apiBase, DEFAULT_ENROLL_API } from "../learn";
import { formatPrice } from "../names";
import { setListing } from "../registry";
import type { StatementRow } from "../credit";
import { planCards } from "../plan-cards";
import { openPortal, startSubscription, subStatus, subscribedInHash } from "../subscription";
import { h } from "../ui/dom";
import { fetchRanks } from "./rank";

export const YOU_PAGES = [
  { id: "content", label: "Your content" },
  { id: "courses", label: "Your courses" },
  { id: "credit", label: "Credit & plan" },
  { id: "account", label: "Account" },
] as const;
export type YouPage = (typeof YOU_PAGES)[number]["id"];

export function parseYou(value: string | null): YouPage | null {
  return YOU_PAGES.some((p) => p.id === value) ? (value as YouPage) : null;
}

// ---------- server ----------

type Answer<T> = T | "signin" | "error";

async function post<T>(path: string, body: Record<string, unknown>, read: (b: unknown, status: number) => T | null, fetchImpl: typeof fetch = fetch, api = DEFAULT_ENROLL_API): Promise<Answer<T>> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api${path}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) return "signin";
    const b: unknown = await res.json().catch(() => null);
    return read(b, res.status) ?? "error";
  } catch {
    return "error";
  }
}

export interface MyItem {
  key: string;
  kind: string;
  title: string;
  link: string;
  names: { name: string; free: boolean }[];
  private: boolean;
  listed: boolean;
  updated: string;
}

export function parseItems(b: unknown): MyItem[] | null {
  const items = (b as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  return items
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object" && typeof (i as { key?: unknown }).key === "string")
    .map((i) => ({
      key: i.key as string,
      kind: typeof i.kind === "string" ? i.kind : "",
      title: typeof i.title === "string" && i.title ? i.title : (i.key as string),
      link: typeof i.link === "string" ? i.link : "",
      names: Array.isArray(i.names) ? (i.names as { name: string; free: boolean }[]).filter((n) => typeof n?.name === "string") : [],
      private: i.private === true,
      listed: i.listed === true,
      updated: typeof i.updated === "string" ? i.updated : "",
    }));
}

export const fetchItems = (key: string, f?: typeof fetch): Promise<Answer<MyItem[]>> => post("/my/items", { key }, (b, s) => (s === 200 ? parseItems(b) : null), f);

export const fetchVisits = (key: string, name: string, f?: typeof fetch): Promise<Answer<number | null>> =>
  post("/my/visits", { key, name }, (b, s) => (s === 200 && b && typeof b === "object" ? ((b as { total?: unknown }).total as number | null) ?? null : null), f).then((a) =>
    a === "error" ? null : a,
  );

export const fetchItemKey = (key: string, item: string, f?: typeof fetch): Promise<Answer<string | null>> =>
  post("/my/item-key", { key, item }, (b, s) => (s === 200 ? (b as { item_key?: string }).item_key ?? null : s === 404 ? "" : null), f).then((a) => (a === "" ? null : a));

export interface Lecture {
  title: string;
  opened: boolean;
  completed: boolean;
}
export interface Following {
  id: string;
  title: string;
  link: string;
  run: string;
  state: string;
  joined: string;
  lectures: Lecture[];
}
export interface Run {
  id: string;
  title: string;
  open: boolean;
  default: boolean;
  learners: number;
  pending: number;
}
export interface Teaching {
  key: string;
  title: string;
  link: string;
  access: string;
  canManage: boolean;
  runs: Run[];
}

export function parseCourses(b: unknown): { following: Following[]; teaching: Teaching[] } | null {
  const o = b as { following?: unknown; teaching?: unknown } | null;
  if (!o || !Array.isArray(o.following) || !Array.isArray(o.teaching)) return null;
  return {
    following: (o.following as Following[]).filter((f) => typeof f?.id === "string").map((f) => ({ ...f, lectures: Array.isArray(f.lectures) ? f.lectures : [] })),
    teaching: (o.teaching as (Teaching & { can_manage?: boolean })[])
      .filter((t) => typeof t?.key === "string")
      .map((t) => ({ key: t.key, title: t.title, link: t.link, access: t.access, canManage: t.can_manage === true, runs: Array.isArray(t.runs) ? t.runs : [] })),
  };
}

export const fetchCourses = (key: string, f?: typeof fetch) => post("/my/courses", { key }, (b, s) => (s === 200 ? parseCourses(b) : null), f);
export const leaveCourse = (key: string, id: string, f?: typeof fetch) => post("/my/leave", { key, id }, (_b, s) => (s === 200 ? true : null), f);
export interface Session {
  label: string;
  lastUsed: string;
  current: boolean;
}

export function parseSessions(b: unknown): { email: string; sessions: Session[] } | null {
  const o = b as { email?: unknown; sessions?: unknown } | null;
  if (!o || typeof o.email !== "string" || !Array.isArray(o.sessions)) return null;
  return {
    email: o.email,
    sessions: (o.sessions as Record<string, unknown>[]).map((r) => ({
      label: typeof r?.label === "string" ? r.label : "a browser",
      lastUsed: typeof r?.last_used === "string" ? r.last_used : "",
      current: r?.current === true,
    })),
  };
}

export const fetchSessions = (key: string, f?: typeof fetch) => post("/my/sessions", { key }, (b, s) => (s === 200 ? parseSessions(b) : null), f);
export const signOutEverywhere = (key: string, f?: typeof fetch) => post("/my/signout-all", { key }, (_b, s) => (s === 200 ? true : null), f);

/** "Mozilla/5.0 (Macintosh; …) … Safari/605" → "Safari on Mac": the label is
 *  the first 60 characters of the browser's user agent (account.ts redeemToken). */
export function browserName(label: string): string {
  const os = /iPhone|iPad/.test(label) ? "iPhone/iPad" : /Android/.test(label) ? "Android" : /Mac/.test(label) ? "Mac" : /Windows/.test(label) ? "Windows" : /Linux/.test(label) ? "Linux" : "";
  const br = /Edg\//.test(label) ? "Edge" : /Firefox\//.test(label) ? "Firefox" : /Chrome\//.test(label) ? "Chrome" : /Safari\//.test(label) ? "Safari" : /node|curl|skill/i.test(label) ? "A terminal" : "";
  // The label is cut at 60 characters, often before the browser's own name:
  // then only the system is known.
  if (br && os) return `${br} on ${os}`;
  if (os) return `A browser on ${os}`;
  return br || label || "A browser";
}

export const setCourseAccess = (key: string, course: string, access: string, f?: typeof fetch) =>
  post("/my/course-access", { key, course, access }, (_b, s) => (s === 200 ? true : null), f);

/** "Public" / "Unlisted" / "Private", as YouTube words visibility. */
export function visibility(i: MyItem): string {
  if (i.private) return "Private";
  return i.listed ? "Public" : "Unlisted";
}

export const ACCESS_LEVELS: [string, string][] = [
  ["open", "Anyone with the link"],
  ["signed-in", "Anyone signed in"],
  ["enrolled", "Enrolled learners"],
];

/** "claude-opus-5-5" → "Opus 5.5", for the statement; anything else as it is. */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id;
}

// ---------- sortable tables ----------
// Click a heading to sort by it; click again to turn the order round (as in
// YouTube Studio). Text sorts A→Z first, numbers and dates biggest first.

export type SortValue = string | number;
export interface Col<T> {
  label: string;
  /** Absent: the column does not sort (an actions column). */
  key?: (t: T) => SortValue;
  cls?: string;
}

/** `items` ordered by `key`, `dir` 1 ascending, -1 descending; stable. */
export function sortBy<T>(items: T[], key: (t: T) => SortValue, dir: 1 | -1): T[] {
  return items
    .map((t, i) => ({ t, i, v: key(t) }))
    .sort((a, b) => {
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { sensitivity: "base", numeric: true });
      return c * dir || a.i - b.i;
    })
    .map((x) => x.t);
}

/** The first click's direction: A→Z for text, biggest first otherwise. */
export function firstDir(sample: SortValue | undefined): 1 | -1 {
  return typeof sample === "string" && !/^\d{4}-\d\d-\d\d/.test(sample) ? 1 : -1;
}

function sortableTable<T>(cols: Col<T>[], items: T[], rowOf: (t: T) => HTMLTableRowElement, start: { col: number; dir: 1 | -1 }, cls = "you-table"): { table: HTMLElement; resort: () => void } {
  const rows = new Map(items.map((t) => [t, rowOf(t)]));
  const body = h("tbody", {});
  let { col, dir } = start;
  const ths = cols.map((c, i) => {
    if (!c.key) return h("th", c.cls ? { class: c.cls } : {}, c.label);
    const b = h("button", { type: "button", class: "you-sort" }, c.label, h("span", { class: "you-arrow", "aria-hidden": "true" }));
    b.addEventListener("click", () => {
      if (col === i) dir = dir === 1 ? -1 : 1;
      else {
        col = i;
        dir = firstDir(items.length ? c.key!(items[0]) : undefined);
      }
      draw();
    });
    return h("th", c.cls ? { class: c.cls } : {}, b);
  });
  function draw(): void {
    ths.forEach((th, i) => {
      if (!cols[i].key) return;
      th.setAttribute("aria-sort", i === col ? (dir === 1 ? "ascending" : "descending") : "none");
      const arrow = th.querySelector(".you-arrow");
      if (arrow) arrow.textContent = i === col ? (dir === 1 ? " ▲" : " ▼") : "";
    });
    body.replaceChildren(...sortBy(items, cols[col].key!, dir).map((t) => rows.get(t)!));
  }
  draw();
  return { table: h("div", { class: "you-table-wrap" }, h("table", { class: cls }, h("thead", {}, h("tr", {}, ...ths)), body)), resort: draw };
}

// ---------- pages ----------

const title = (text: string): HTMLElement => h("h2", { class: "home-list-title" }, text);
const say = (text: string, kind = ""): HTMLElement => h("p", { class: `home-note ${kind}`.trim() }, text);

function signInFirst(label: string, ended = false): HTMLElement[] {
  return [title(label), say(ended ? "Your session has ended — sign in again." : "Sign in to see this page."), h("a", { class: "home-create", href: signInUrl(location.href) }, "Sign in")];
}

/** A small button that runs `act` once at a time and says how it went. */
function action(label: string, act: (b: HTMLButtonElement) => Promise<void>): HTMLButtonElement {
  const b = h("button", { type: "button", class: "you-btn" }, label) as HTMLButtonElement;
  b.addEventListener("click", () => {
    if (b.disabled) return;
    b.disabled = true;
    void act(b).finally(() => (b.disabled = false));
  });
  return b;
}

/** The page for `which`; `rerender` redraws the whole page after a change;
 *  `returned` is the fragment Stripe came back with, if any (the page has
 *  already taken it off the address). */
export async function youView(which: YouPage, rerender: () => void, returned = ""): Promise<HTMLElement[]> {
  const label = YOU_PAGES.find((p) => p.id === which)!.label;
  const key = getToken();
  if (!key) return signInFirst(label);
  const tabs = h(
    "nav",
    { class: "you-tabs", "aria-label": "Your pages" },
    ...YOU_PAGES.map((p) => h("a", { class: p.id === which ? "you-tab current" : "you-tab", href: `./?you=${p.id}`, ...(p.id === which ? { "aria-current": "page" } : {}) }, p.label)),
  );
  const ended = (): HTMLElement[] => {
    setToken("");
    forgetMe();
    return signInFirst(label, true);
  };
  if (which === "content") {
    const items = await fetchItems(key);
    if (items === "signin") return ended();
    return [tabs, ...(items === "error" ? [say("Your content can't be reached right now.", "error")] : contentTable(items, key))];
  }
  if (which === "courses") {
    const c = await fetchCourses(key);
    if (c === "signin") return ended();
    return [tabs, ...(c === "error" ? [say("Your courses can't be reached right now.", "error")] : coursesPage(c, key, rerender))];
  }
  if (which === "account") {
    const a = await fetchSessions(key);
    if (a === "signin") return ended();
    return [tabs, ...(a === "error" ? [say("Your account can't be reached right now.", "error")] : accountPage(a, key))];
  }
  return [tabs, ...(await creditPage(key, returned))];
}

// ---------- Your content ----------

function contentTable(items: MyItem[], key: string): HTMLElement[] {
  if (!items.length) return [say("Nothing published yet. Publish from the editor while signed in and it shows here."), h("a", { class: "home-create", href: "#create" }, "＋ Create")];
  const status = say("");
  // Views: the public 30-day visit counts (the Popular row's), summed over
  // the item's names — a lecture's visits already count toward its course.
  const views = new Map<MyItem, number | null>(items.map((i) => [i, null]));
  const cells = new Map<MyItem, HTMLElement>();
  const rowOf = (i: MyItem): HTMLTableRowElement => {
    const viewsCell = h("td", { class: "you-num", "data-label": "views" }, "…");
    cells.set(i, viewsCell);
    const vis = h("span", { class: `you-vis you-vis-${visibility(i).toLowerCase()}` }, visibility(i));
    const acts = h("div", { class: "you-acts" });
    acts.append(
      action("Copy link", async (b) => {
        try {
          await navigator.clipboard.writeText(i.link);
          b.textContent = "Copied";
          setTimeout(() => (b.textContent = "Copy link"), 1500);
        } catch {
          status.textContent = i.link;
        }
      }),
    );
    if (!i.private) {
      acts.append(
        action(i.listed ? "Unlist" : "List", async () => {
          const out = await setListing(DEFAULT_ENROLL_API, key, i.key, !i.listed);
          if (out === "ok") {
            i.listed = !i.listed;
            vis.textContent = visibility(i);
            vis.className = `you-vis you-vis-${visibility(i).toLowerCase()}`;
            (acts.children[1] as HTMLButtonElement).textContent = i.listed ? "Unlist" : "List";
            status.textContent = i.listed ? `“${i.title}” is in the catalogue again.` : `“${i.title}” is unlisted — only people with the link find it.`;
          } else if (typeof out === "object") {
            status.textContent = `Unlisting “${i.title}” costs ${formatPrice(out.due, "usd")}, one time — or nothing with a subscription (Credit & plan). Pay for it from the editor's Publish.`;
          } else {
            status.textContent = out === "key" ? "Sign in again to change this." : "Could not change the listing — try again.";
          }
        }),
      );
    } else {
      const shown = h("input", { class: "you-key", readonly: "", "aria-label": "Private key", hidden: "" }) as HTMLInputElement;
      acts.append(
        action("Show key", async (b) => {
          if (!shown.hidden) {
            shown.hidden = true;
            b.textContent = "Show key";
            return;
          }
          const k = await fetchItemKey(key, i.key);
          if (typeof k === "string" && k) {
            shown.value = k;
            shown.hidden = false;
            shown.select();
            b.textContent = "Hide key";
          } else status.textContent = "The key can't be shown right now.";
        }),
        shown,
      );
    }
    return h(
      "tr",
      {},
      h(
        "td",
        { class: "you-title" },
        h("a", { href: i.link, target: "_blank", rel: "noopener" }, i.title),
        h("div", { class: "you-sub" }, [i.kind === "course" ? "Course" : "Drawcast", ...i.names.map((n) => `#${n.name}`)].join(" · ")),
      ),
      h("td", {}, vis),
      h("td", { class: "you-date" }, i.updated),
      viewsCell,
      h("td", { class: "you-acts-cell" }, acts),
    );
  };
  const cols: Col<MyItem>[] = [
    { label: "Title", key: (i) => i.title },
    { label: "Visibility", key: (i) => visibility(i) },
    { label: "Updated", key: (i) => i.updated },
    { label: "Views (30 days)", key: (i) => views.get(i) ?? -1, cls: "you-num" },
    { label: "" },
  ];
  const { table, resort } = sortableTable(cols, items, rowOf, { col: 2, dir: -1 }, "you-table you-content");
  void fetchRanks(fetch, true).then((ranks) => {
    const byName = new Map(ranks.map((r) => [r.name, r.visits]));
    for (const i of items) {
      const n = ranks.length ? i.names.reduce((sum, x) => sum + (byName.get(x.name) ?? 0), 0) : null;
      views.set(i, n);
      cells.get(i)!.textContent = n === null ? "—" : n.toLocaleString("en-US");
    }
    resort();
  });
  return [
    table,
    status,
  ];
}

// ---------- Your courses ----------

function coursesPage(c: { following: Following[]; teaching: Teaching[] }, key: string, rerender: () => void): HTMLElement[] {
  const status = say("");
  const following = c.following.map((f) => {
    const done = f.lectures.filter((l) => l.completed).length;
    const state = f.state === "pending" ? "Waiting for the teachers' approval" : f.state === "rejected" ? "The teachers declined this request" : `${done} of ${f.lectures.length} lectures done`;
    let armed = false;
    const leave = action("Leave", async (b) => {
      // Two presses, not a browser dialog: leaving deletes your progress.
      if (!armed) {
        armed = true;
        b.textContent = "Leave — and delete my progress";
        setTimeout(() => {
          armed = false;
          b.textContent = "Leave";
        }, 4000);
        return;
      }
      const out = await leaveCourse(key, f.id);
      if (out === true) rerender();
      else status.textContent = "Could not leave the course — try again.";
    });
    return h(
      "div",
      { class: "you-course" },
      h("div", {}, h("a", { class: "you-course-title", href: f.link }, f.title), h("div", { class: "you-sub" }, `${f.run} · joined ${f.joined} · ${state}`)),
      h(
        "div",
        { class: "you-progress", "aria-hidden": "true" },
        ...f.lectures.map((l) => h("span", { class: l.completed ? "done" : l.opened ? "opened" : "", title: l.title })),
      ),
      leave,
    );
  });
  const teaching = c.teaching.map((t) => {
    const door = h("select", { "aria-label": `Who can watch ${t.title}` }, ...ACCESS_LEVELS.map(([v, text]) => h("option", { value: v }, text))) as HTMLSelectElement;
    door.value = t.access;
    door.disabled = !t.canManage;
    door.addEventListener("change", () => {
      const want = door.value;
      door.disabled = true;
      void setCourseAccess(key, t.key, want).then((ok) => {
        door.disabled = false;
        if (ok === true) {
          t.access = want;
          status.textContent = `“${t.title}”: ${ACCESS_LEVELS.find(([v]) => v === want)![1].toLowerCase()} can watch now.`;
        } else {
          door.value = t.access;
          status.textContent = "Could not change who can watch — try again.";
        }
      });
    });
    return h(
      "div",
      { class: "you-course" },
      h("div", {}, h("a", { class: "you-course-title", href: t.link }, t.title), h("label", { class: "you-door" }, "Who can watch ", door)),
      h(
        "div",
        { class: "you-runs" },
        ...t.runs.map((r) =>
          h(
            "a",
            { class: "you-btn", href: `${apiBase(DEFAULT_ENROLL_API)}/#run=${encodeURIComponent(r.id)}`, target: "_blank", rel: "noopener", title: "The teacher's view of this run: learners, answers, settings (on the drawcast server)" },
            `${r.title} — ${r.learners} learner${r.learners === 1 ? "" : "s"}${r.pending ? `, ${r.pending} waiting` : ""}`,
          ),
        ),
      ),
    );
  });
  return [
    h("h3", { class: "you-h" }, "Following"),
    ...(following.length ? following : [say("You don't follow any course yet. Join one from its first lecture.")]),
    h("h3", { class: "you-h" }, "Teaching"),
    ...(teaching.length ? teaching : [say("Publish a course from the editor while signed in and it shows here.")]),
    status,
  ];
}

// ---------- Account ----------

function accountPage(a: { email: string; sessions: Session[] }, key: string): HTMLElement[] {
  const status = say("");
  const leaveHere = (): void => {
    setToken("");
    forgetMe();
    location.href = "./";
  };
  const thisOne = action("Sign out of this browser", async () => {
    await signOut(DEFAULT_ENROLL_API, key);
    leaveHere();
  });
  let armed = false;
  const everywhere = action("Sign out everywhere", async (b) => {
    // Two presses, not a browser dialog: every other device signs out too.
    if (!armed) {
      armed = true;
      b.textContent = "Sign out every browser, this one too";
      setTimeout(() => {
        armed = false;
        b.textContent = "Sign out everywhere";
      }, 4000);
      return;
    }
    const out = await signOutEverywhere(key);
    if (out === true || out === "signin") leaveHere();
    else status.textContent = "Could not sign out everywhere — try again.";
  });
  return [
    h("div", { class: "you-balance" }, h("div", { class: "you-sub" }, "Signed in as"), h("div", { class: "you-email" }, a.email)),
    h("h3", { class: "you-h" }, "Signed-in browsers"),
    ...(a.sessions.length
      ? a.sessions.map((s) =>
          h(
            "div",
            { class: "you-course" },
            h("div", {}, h("span", { class: "you-course-title" }, browserName(s.label)), h("div", { class: "you-sub" }, [s.current ? "This browser" : "", s.lastUsed ? `last used ${s.lastUsed}` : ""].filter(Boolean).join(" · "))),
          ),
        )
      : [say("No other browser is signed in.")]),
    h("div", { class: "you-acts" }, thisOne, everywhere),
    status,
    h("h3", { class: "you-h" }, "On the drawcast server"),
    say("Teachers: a run's learners, answers and settings open from Your courses. The server's own account page is here:"),
    h("a", { class: "you-btn", href: `${apiBase(DEFAULT_ENROLL_API)}/`, target: "_blank", rel: "noopener" }, "drawcast.anvil.app"),
  ];
}

// ---------- Credit & plan ----------

async function creditPage(key: string, returned: string): Promise<HTMLElement[]> {
  // credit.ts carries the narration exporter's request shape, so it loads
  // only here, not with the front page.
  const { creditInHash, creditStatement, describeRow, startCreditPayment, CREDIT_CLOSED } = await import("../credit");
  const status = say("");
  // Stripe's way back (?you=credit#creditpaid=…, #subscribed=…): say how it went.
  const paid = creditInHash(returned);
  const subbed = subscribedInHash(returned);
  if (paid || subbed) {
    forgetMe();
    if (paid) status.textContent = paid.outcome === "creditpaid" ? `Credit added — ${paid.cents.toLocaleString("en-US")} credits.` : "Credit was not bought — nothing was charged.";
    else status.textContent = subbed!.plan ? "Subscribed — thank you." : "Not subscribed — nothing was charged.";
  }
  const here = `${location.origin}${location.pathname}?you=credit`;
  const [st, sub] = await Promise.all([creditStatement(DEFAULT_ENROLL_API, key), subStatus(DEFAULT_ENROLL_API, key)]);
  const packs = ([500, 1000, 2000] as const).map((cents) =>
    action(`${cents.toLocaleString("en-US")} credits — $${cents / 100}`, async () => {
      const out = await startCreditPayment(DEFAULT_ENROLL_API, { key, cents, return: here });
      if (typeof out === "object") location.href = out.url;
      else status.textContent = out === "closed" ? CREDIT_CLOSED : out === "pending" ? "A checkout is already open — finish or close it first." : "Could not open the checkout — try again.";
    }),
  );
  const balance = typeof st === "object" ? `${st.credits.toLocaleString("en-US")} credits` : "—";
  const stmtRow = (r: StatementRow): HTMLTableRowElement =>
    h(
      "tr",
      {},
      h("td", { class: "you-date" }, r.at ? new Date(r.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : ""),
      h("td", {}, describeRow(r, modelName)),
      h("td", { class: `you-num${r.credits < 0 ? " out" : ""}` }, `${r.credits > 0 ? "+" : ""}${r.credits.toLocaleString("en-US", { maximumFractionDigits: 2 })}`),
    );
  const rows =
    typeof st === "object" && st.rows.length
      ? sortableTable<StatementRow>(
          [
            { label: "When", key: (r) => r.at ?? "" },
            { label: "What", key: (r) => describeRow(r, modelName) },
            { label: "Credits", key: (r) => r.credits, cls: "you-num" },
          ],
          st.rows,
          stmtRow,
          { col: 0, dir: -1 },
        ).table
      : say(typeof st === "object" ? "No credit used yet." : "The statement can't be reached right now.", typeof st === "object" ? "" : "error");
  const plan: HTMLElement[] =
    typeof sub === "object"
      ? [
          planCards(sub, {
            subscribe: (id, b) => {
              b.disabled = true;
              void startSubscription(DEFAULT_ENROLL_API, { key, plan: id, return: here }).then((out) => {
                b.disabled = false;
                if (typeof out === "object") location.href = out.url;
                else status.textContent = out === "closed" ? "Subscriptions are not open yet — drawcast is in testing mode." : out === "subscribed" ? "You already subscribe — change plan under Manage subscription." : "Could not open the checkout — try again.";
              });
            },
            manage: (b) => {
              b.disabled = true;
              void openPortal(DEFAULT_ENROLL_API, { key, return: here }).then((out) => {
                b.disabled = false;
                if (typeof out === "object") location.href = out.url;
                else status.textContent = "Could not open the subscription page — try again.";
              });
            },
          }),
        ]
      : [say("Your plan can't be reached right now.", "error")];
  return [
    status,
    h("div", { class: "you-balance" }, h("div", { class: "you-big" }, balance), h("div", { class: "you-sub" }, "100 credits = $1. Credit pays for AI and narration when you don't use your own keys.")),
    h("div", { class: "you-acts" }, ...packs),
    h("h3", { class: "you-h" }, "Plan"),
    ...plan,
    h("h3", { class: "you-h" }, "Recent use"),
    rows,
  ];
}
