// The catalogue (registry deliveries 3–4, task 9): a standalone page at
// drawcast.app/#browse listing every LISTED cast and course (server_code/
// registry.py's catalogue_entry, GET /catalogue) — no editor, no AI, no
// account needed to browse. "browse" is a reserved name prefix (names.ts
// RESERVED_PREFIXES), so it can never collide with a real drawcast.app/#name;
// entry.ts routes here before even trying isNameHash.
//
// Split the same way viewer.ts's runNamed/showUnplayable are: pure helpers
// (the query string, the card's own fields, its href) are exported and
// tested directly; the DOM-building half below them touches document/window
// and is exercised the way share.ts's Private/Listed blocks are — by
// reading the source (tests/catalogue.test.ts) — since this suite's vitest
// environment is plain node, with no jsdom (vite.config.ts).

import "./styles.css";
import { apiBase, DEFAULT_ENROLL_API } from "./learn";
import { h } from "./ui/dom";

export type CatalogueKind = "course" | "cast";

export interface CatalogueItem {
  kind: CatalogueKind;
  /** May be empty — a course/cast published with no title yet. */
  title: string;
  /** The free drawcast.app name this item resolves at. */
  name: string;
  page?: string;
  /** The GitHub owner segment of the item's key — never an account email
   *  (server_code/registry.py's catalogue_entry strips that; nothing here
   *  re-derives or shows anything more sensitive than the payload already
   *  carries). */
  owner: string;
  /** 1 for a cast; a course's lecture count. */
  lectures: number;
  /** ISO date string, server-side. */
  updated: string;
  /** Shows the "Private — ask to join" badge (plan ruling 7: a listed item
   *  may still be private). */
  private: boolean;
}

export interface CatalogueAnswer {
  items: CatalogueItem[];
  page: number;
  more: boolean;
}

export type CatalogueOutcome = CatalogueAnswer | "error";

export type CatalogueFilterKind = "" | "course" | "cast";

export interface CatalogueQuery {
  q?: string;
  kind?: CatalogueFilterKind;
  page?: number;
}

/** q is capped server-side at 80 chars (else 400) — trimmed here too, so a
 *  long paste never turns into a refused request. Pure: no fetch, easily
 *  tested for exactly what a search/filter/page produces. */
export function catalogueQueryString(query: CatalogueQuery): string {
  const params = new URLSearchParams();
  const q = (query.q ?? "").trim().slice(0, 80);
  if (q) params.set("q", q);
  if (query.kind) params.set("kind", query.kind);
  if (typeof query.page === "number" && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** One raw item from the server's `items` array, narrowed and defaulted —
 *  never trusts a field's presence or type. A row missing any REQUIRED
 *  field (kind/title/name/owner/updated) is dropped rather than shown half
 *  blank; `lectures`/`private`/`page` default sensibly when absent. */
function parseCatalogueItem(raw: unknown): CatalogueItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "course" && r.kind !== "cast") return null;
  if (typeof r.title !== "string" || typeof r.name !== "string" || typeof r.owner !== "string" || typeof r.updated !== "string") return null;
  return {
    kind: r.kind,
    title: r.title,
    name: r.name,
    page: typeof r.page === "string" ? r.page : undefined,
    owner: r.owner,
    lectures: typeof r.lectures === "number" && r.lectures > 0 ? r.lectures : 1,
    updated: r.updated,
    private: r.private === true,
  };
}

/**
 * GET /catalogue?q=&kind=&page=: 50 items per page, newest `updated` first
 * (the server's own ordering — never re-sorted here). A malformed row is
 * dropped, never shown with missing fields; a malformed BODY (no `items`
 * array) or any non-200 answer, or a network failure, is `"error"` — never
 * a throw, so the page can show its one fixed error state.
 */
export async function fetchCatalogue(api: string, query: CatalogueQuery, fetchImpl: typeof fetch = fetch): Promise<CatalogueOutcome> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/catalogue${catalogueQueryString(query)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return "error";
    const body = (await res.json()) as Partial<{ items: unknown; page: unknown; more: unknown }>;
    if (!Array.isArray(body.items)) return "error";
    const items: CatalogueItem[] = [];
    for (const raw of body.items) {
      const item = parseCatalogueItem(raw);
      if (item) items.push(item);
    }
    return { items, page: typeof body.page === "number" ? body.page : 1, more: body.more === true };
  } catch {
    return "error";
  }
}

/** The pretty link a card points at — exactly the address a bought/free
 *  name already resolves at (names.ts). Pure, so the escaping the DOM
 *  builder below relies on (h()'s setAttribute, never innerHTML) can be
 *  checked without a DOM: nothing about `name` is trusted to be safe markup
 *  either way, since h() only ever sets attributes/text. */
export function catalogueHref(item: Pick<CatalogueItem, "name">): string {
  return `https://drawcast.app/#${item.name}`;
}

/** The one meta line under a card's title — "Course · 6 lectures · updated
 *  2026-09-20" or "Drawcast · updated 2026-09-20". Pure and the whole
 *  reason the card's fields are worth deriving separately from the DOM. */
export function catalogueMeta(item: Pick<CatalogueItem, "kind" | "lectures" | "updated">): string {
  const kindLabel = item.kind === "course" ? "Course" : "Drawcast";
  const lectures = item.kind === "course" ? ` · ${item.lectures} lecture${item.lectures === 1 ? "" : "s"}` : "";
  return `${kindLabel}${lectures} · updated ${item.updated}`;
}

/** #browse&q=…&kind=course — a nice-to-have (task brief), read once at
 *  boot to seed the form; never round-tripped through parsing beyond this. */
function seedFromHash(hash: string): { q: string; kind: CatalogueFilterKind } {
  const q = /[#&]q=([^&]*)/.exec(hash);
  const kind = /[#&]kind=(course|cast)/.exec(hash);
  return { q: q ? decodeURIComponent(q[1]) : "", kind: kind ? (kind[1] as CatalogueFilterKind) : "" };
}

function buildCard(item: CatalogueItem): HTMLElement {
  // The app's own h() helper throughout — never innerHTML with server text.
  // There is nothing SENSITIVE in the payload (catalogue_entry strips keys,
  // owner emails and lecture lists server-side already), but a crafted
  // title must still never be parsed as markup, only ever set as text/attrs.
  const titleLink = h("a", { class: "cat-title", href: catalogueHref(item), target: "_blank", rel: "noopener" }, item.title || item.name);
  const children: (Node | string)[] = [
    titleLink,
    h("div", { class: "cat-meta" }, catalogueMeta(item)),
    h("div", { class: "cat-owner" }, `by ${item.owner}`),
  ];
  if (item.private) children.push(h("span", { class: "cat-badge" }, "Private — ask to join"));
  return h("div", { class: "cat-card" }, ...children);
}

/**
 * Renders the standalone catalogue page into document.body (viewer.ts's own
 * pattern — showUnplayable/runNamed do the same, never `#app`, which the
 * two-mode editor owns). Search runs on the form's submit and the kind
 * select's change — never per keystroke (task brief) — and "More" appends
 * the next page rather than replacing what is shown.
 */
export async function runCatalogue(hash: string): Promise<void> {
  document.body.classList.add("catalogue-body");
  const seeded = seedFromHash(hash);

  const heading = h("h1", { class: "cat-heading" }, "drawcast catalogue");
  const qInput = h("input", { type: "search", class: "cat-q", placeholder: "Search the catalogue…", "aria-label": "Search" }) as HTMLInputElement;
  qInput.value = seeded.q;
  const kindSelect = h("select", { class: "cat-kind", "aria-label": "Kind" }) as HTMLSelectElement;
  for (const [value, label] of [
    ["", "All"],
    ["course", "Courses"],
    ["cast", "Drawcasts"],
  ] as const) {
    kindSelect.appendChild(h("option", { value }, label));
  }
  kindSelect.value = seeded.kind;
  const searchBtn = h("button", { class: "cat-search-btn", type: "submit" }, "Search") as HTMLButtonElement;
  const form = h("form", { class: "cat-search" }, qInput, kindSelect, searchBtn);

  const results = h("div", { class: "cat-results" });
  const moreBtn = h("button", { class: "cat-more", type: "button" }, "More") as HTMLButtonElement;
  const moreRow = h("div", { class: "cat-more-row" }, moreBtn);
  moreRow.hidden = true;

  const root = h("div", { class: "catalogue" }, heading, form, results, moreRow);
  document.body.append(root);

  let items: CatalogueItem[] = [];
  let page = 1;
  let loadToken = 0;

  function currentQuery(): CatalogueQuery {
    return { q: qInput.value, kind: kindSelect.value as CatalogueFilterKind, page };
  }

  function pushHash(): void {
    const q = qInput.value.trim();
    const kind = kindSelect.value;
    const parts = ["#browse"];
    if (q) parts.push(`q=${encodeURIComponent(q)}`);
    if (kind) parts.push(`kind=${kind}`);
    history.replaceState(null, "", parts.join("&"));
  }

  async function load(reset: boolean): Promise<void> {
    const my = ++loadToken;
    if (reset) {
      page = 1;
      items = [];
      results.replaceChildren();
    }
    const answer = await fetchCatalogue(DEFAULT_ENROLL_API, currentQuery());
    if (my !== loadToken) return; // superseded by a newer search/page
    if (answer === "error") {
      moreRow.hidden = true;
      results.replaceChildren(h("p", { class: "cat-status error" }, "The catalogue can't be reached right now."));
      return;
    }
    items = reset ? answer.items : [...items, ...answer.items];
    if (items.length === 0) {
      results.replaceChildren(h("p", { class: "cat-status" }, "Nothing listed yet."));
    } else {
      results.replaceChildren(...items.map(buildCard));
    }
    moreRow.hidden = !answer.more;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    pushHash();
    void load(true);
  });
  kindSelect.addEventListener("change", () => {
    pushHash();
    void load(true);
  });
  moreBtn.addEventListener("click", () => {
    page += 1;
    void load(false);
  });

  void load(true);
}
