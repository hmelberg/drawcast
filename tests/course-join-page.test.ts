// The course page's join box and its inline script, run against a fake DOM
// just big enough for the handful of calls the script makes.
import { describe, expect, test, vi } from "vitest";
import { parseCourse } from "../src/course/document";
import { coursePage } from "../src/course/page";
import { ENROL_SCRIPT } from "../src/course/enrol-script";

const COURSE = parseCourse("# Learn Russian\nslug: learn-russian\nenroll: https://drawcast.anvil.app\n\n## Cases\nq\n\n## Verbs\nq\n");
const LINKS = [
  { title: "Cases", questions: [], href: "https://drawcast.app/#gh=hmelberg/dcast/learn-russian/01-cases.yaml", cast: "hmelberg/dcast/learn-russian/01-cases.yaml" },
  { title: "Verbs", questions: [], href: "https://drawcast.app/#gh=hmelberg/dcast/learn-russian/02-verbs.yaml", cast: "hmelberg/dcast/learn-russian/02-verbs.yaml" },
];
const LEARN = { courseKey: "hmelberg/dcast/learn-russian", enroll: "https://drawcast.anvil.app" };

class El {
  attrs: Record<string, string> = {};
  textContent = "";
  value = "";
  hidden = false;
  handlers: Record<string, ((e: { preventDefault(): void }) => void)[]> = {};
  /** The <a data-cast> this <li> contains right now. Assigning innerHTML
   *  re-parses the markup in a real browser: the anchor node that was in
   *  there is detached and a NEW one appears, carrying the href the page was
   *  published with. Modelling that is the whole point — a NodeList captured
   *  before the progress rebuild is a list of detached nodes afterwards. */
  anchor: El | null = null;
  /** The href in the published markup, restored by every re-parse. */
  pristine = "";
  /** True once a re-parse has thrown this node out of the document. */
  detached = false;
  private html = "";
  constructor(public id: string, attrs: Record<string, string> = {}) { this.attrs = attrs; }
  get innerHTML() { return this.html; }
  set innerHTML(v: string) {
    this.html = v;
    const old = this.anchor;
    if (!old) return;
    old.detached = true;
    const fresh = new El("a", { "data-cast": old.attrs["data-cast"], href: old.pristine });
    fresh.pristine = old.pristine;
    this.anchor = fresh;
  }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener(type: string, fn: (e: { preventDefault(): void }) => void) { (this.handlers[type] ??= []).push(fn); }
  fire(type: string) { for (const fn of this.handlers[type] ?? []) fn({ preventDefault() {} }); }
}

// Ruling A: the real page puts data-cast on both the <li> and its <a>, so
// the script uses two distinct selectors (a[data-cast] for link rewriting,
// li[data-cast] for progress marks/review) instead of one that would also
// rewrite the anchor's innerHTML.
//
// "a[data-cast]" is answered from the anchors the <li>s hold AT CALL TIME, so
// a rebuild of the marks hands the script a different set of nodes — the same
// way a browser does.
function fakeDom(join: El | null, lis: El[]) {
  const byId: Record<string, El> = {};
  for (const id of ["join-form", "join-name", "join-email", "join-button", "join-status", "join-you", "join-code", "join-progress-note", "join-forget", "join-switch", "join-switch-box", "join-switch-input", "join-switch-button"]) byId[id] = new El(id);
  return {
    byId,
    document: {
      querySelector: (sel: string) => (sel === ".join" ? join : null),
      getElementById: (id: string) => byId[id] ?? null,
      querySelectorAll: (sel: string) => (sel === "a[data-cast]" ? lis.map((li) => li.anchor as El) : sel === "li[data-cast]" ? lis : []),
    },
  };
}

const tick = (): Promise<void> => new Promise((res) => setTimeout(res, 0));

/** A fetch that hangs until the test lets it land. */
function deferred() {
  let go = (): void => {};
  const promise = new Promise<void>((res) => { go = () => res(); });
  return { promise, resolve: () => go() };
}

function memoryStorage() {
  const data: Record<string, string> = {};
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; }, removeItem: (k: string) => { delete data[k]; }, data };
}

async function run(opts: { search?: string; storage?: ReturnType<typeof memoryStorage>; fetch?: typeof fetch; join?: boolean }) {
  const join = opts.join === false ? null : new El("join", { "data-course": LEARN.courseKey, "data-enroll": LEARN.enroll, "data-title": "Learn Russian" });
  const lis = LINKS.map((l) => {
    const li = new El("li", { "data-cast": l.cast });
    const a = new El("a", { "data-cast": l.cast, href: l.href });
    a.pristine = l.href;
    li.anchor = a;
    return li;
  });
  const anchors = lis.map((li) => li.anchor as El); // the nodes at script start — stale after any rebuild
  const dom = fakeDom(join, lis);
  const storage = opts.storage ?? memoryStorage();
  const replaced: string[] = [];
  const location = { search: opts.search ?? "", pathname: "/dcast/learn-russian/", hash: "", origin: "https://hmelberg.github.io", href: "https://hmelberg.github.io/dcast/learn-russian/" + (opts.search ?? "") };
  const history = { replaceState: (_: unknown, __: string, url: string) => replaced.push(url) };
  const fetchImpl = opts.fetch ?? (vi.fn(async () => new Response("{}", { status: 404 })) as unknown as typeof fetch);
  new Function("document", "localStorage", "fetch", "location", "history", ENROL_SCRIPT)(dom.document, storage, fetchImpl, location, history);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  /** The anchors the document holds NOW — what the script must decorate. */
  const current = (): El[] => lis.map((li) => li.anchor as El);
  return { ...dom, lis, anchors, current, storage, replaced, fetchImpl };
}

describe("the page markup", () => {
  test("renders the join box, the privacy line and the script only with learn data", () => {
    const html = coursePage(COURSE, LINKS, LEARN);
    expect(html).toContain('id="join-form"');
    expect(html).toContain("Forget me");
    expect(html).toContain("<script>");
    expect(html).toMatch(/we store your name, email and answers/i);
    const plain = coursePage(COURSE, LINKS);
    expect(plain).not.toContain("<script>");
    expect(plain).not.toContain('class="join"');
  });
});

describe("the script", () => {
  test("does nothing on a page without a join box", async () => {
    const r = await run({ join: false });
    expect(r.storage.data).toEqual({});
  });

  test("an arriving ?learner= code is stored under the course, stripped from the URL, and added to lecture links", async () => {
    const r = await run({ search: "?learner=Fjell-Rev-Havn" });
    expect(JSON.parse(r.storage.data["drawcast.learners"])[LEARN.courseKey]).toEqual({ code: "fjell-rev-havn", api: LEARN.enroll, name: null });
    expect(r.replaced).toEqual(["/dcast/learn-russian/"]);
    expect(r.anchors[0].getAttribute("href")).toBe(LINKS[0].href + "&learner=fjell-rev-havn");
    expect(r.byId["join-form"].hidden).toBe(true);
    expect(r.byId["join-you"].hidden).toBe(false);
    expect(r.byId["join-code"].textContent).toBe("fjell-rev-havn");
  });

  test("joining posts name and email, shows the code, and stores it", async () => {
    const f = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/enroll") ? { code: "havn-ulv-bok", name: "Kari", email_sent: true } : { name: "Kari", course: {}, lectures: [] }), { status: 200 })) as unknown as typeof fetch;
    const r = await run({ fetch: f });
    r.byId["join-name"].value = "Kari";
    r.byId["join-email"].value = "kari@example.com";
    r.byId["join-form"].fire("submit");
    await new Promise((res) => setTimeout(res, 0));
    await new Promise((res) => setTimeout(res, 0));
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://drawcast.anvil.app/_/api/enroll");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(JSON.parse(init.body as string)).toEqual({ course: LEARN.courseKey, title: "Learn Russian", page: "https://hmelberg.github.io/dcast/learn-russian/", run: null, name: "Kari", email: "kari@example.com" });
    expect(r.byId["join-code"].textContent).toBe("havn-ulv-bok");
    expect(r.byId["join-status"].textContent).toMatch(/sent it to you/i);
    expect(JSON.parse(r.storage.data["drawcast.learners"])[LEARN.courseKey].code).toBe("havn-ulv-bok");
  });

  test("a run in the page URL travels with the enrolment", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ code: "a-b-c", name: null, email_sent: false }), { status: 200 })) as unknown as typeof fetch;
    const r = await run({ fetch: f, search: "?run=spring" });
    r.byId["join-form"].fire("submit");
    await new Promise((res) => setTimeout(res, 0));
    expect(JSON.parse(((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string).run).toBe("spring");
    await new Promise((res) => setTimeout(res, 0));
    expect(r.byId["join-status"].textContent).toMatch(/write it down/i);
  });

  test("the server's email requirement is shown, not swallowed", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "email" }), { status: 400 })) as unknown as typeof fetch;
    const r = await run({ fetch: f });
    r.byId["join-form"].fire("submit");
    await new Promise((res) => setTimeout(res, 0));
    await new Promise((res) => setTimeout(res, 0));
    expect(r.byId["join-status"].textContent).toMatch(/needs an email address/i);
  });

  test("with a stored code the progress view marks lectures and unfolds answers", async () => {
    const storage = memoryStorage();
    storage.data["drawcast.learners"] = JSON.stringify({ [LEARN.courseKey]: { code: "fjell-rev-havn", api: LEARN.enroll, name: "Kari" } });
    const progress = { name: "Kari", course: {}, lectures: [
      { cast: LINKS[0].cast, opened: true, completed: true, answers: [{ step: 2, question: "Which case?", given: ["dative", "genitive"], expected: "genitive", correct: true }, { step: 5, question: "Gender? <script>alert(1)</script>", given: ["<img src=x onerror=1>"], expected: "f", correct: false }] },
      { cast: LINKS[1].cast, opened: true, completed: false, answers: [] },
    ] };
    const f = vi.fn(async () => new Response(JSON.stringify(progress), { status: 200 })) as unknown as typeof fetch;
    const r = await run({ storage, fetch: f });
    expect(((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string])[0]).toBe("https://drawcast.anvil.app/_/api/progress?code=fjell-rev-havn");
    expect(r.lis[0].innerHTML).toContain("✓ 1/2");
    expect(r.lis[1].innerHTML).toContain("○");
    expect(r.lis[0].innerHTML).toContain("Which case?");
    expect(r.lis[0].innerHTML).toContain("dative → genitive");
    expect(r.lis[0].innerHTML).toContain("expected: f");
    // esc() escapes &<>" — proving the question's <script> and the answer's
    // <img onerror=...> never survive as live tags. (Their literal "=" text
    // is not HTML-special and is expected to remain as inert page text.)
    expect(r.lis[0].innerHTML).toContain("&lt;script&gt;");
    expect(r.lis[0].innerHTML).not.toContain("<script");
    expect(r.lis[0].innerHTML).not.toContain("<img");
  });

  test("forget posts the code, clears storage and shows the form again", async () => {
    const storage = memoryStorage();
    storage.data["drawcast.learners"] = JSON.stringify({ [LEARN.courseKey]: { code: "fjell-rev-havn", api: LEARN.enroll, name: null } });
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
    const r = await run({ storage, fetch: f });
    r.byId["join-forget"].fire("click");
    await new Promise((res) => setTimeout(res, 0));
    await new Promise((res) => setTimeout(res, 0));
    const forget = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) => (c[0] as string).endsWith("/forget"))!;
    expect(JSON.parse((forget[1] as RequestInit).body as string)).toEqual({ code: "fjell-rev-havn" });
    expect(JSON.parse(storage.data["drawcast.learners"])).toEqual({});
    expect(r.byId["join-form"].hidden).toBe(false);
  });

  test("a failed forget (500) keeps the local code and asks to try again", async () => {
    const storage = memoryStorage();
    storage.data["drawcast.learners"] = JSON.stringify({ [LEARN.courseKey]: { code: "fjell-rev-havn", api: LEARN.enroll, name: null } });
    const f = vi.fn(async (url: string) => (url.endsWith("/forget") ? new Response(JSON.stringify({ error: "server" }), { status: 500 }) : new Response("{}", { status: 404 }))) as unknown as typeof fetch;
    const r = await run({ storage, fetch: f });
    r.byId["join-forget"].fire("click");
    await new Promise((res) => setTimeout(res, 0));
    await new Promise((res) => setTimeout(res, 0));
    expect(JSON.parse(storage.data["drawcast.learners"])).toEqual({ [LEARN.courseKey]: { code: "fjell-rev-havn", api: LEARN.enroll, name: null } });
    expect(r.byId["join-status"].textContent).toMatch(/try again/i);
  });

  test("a 404 forget (code unknown to the server) clears the local code anyway", async () => {
    const storage = memoryStorage();
    storage.data["drawcast.learners"] = JSON.stringify({ [LEARN.courseKey]: { code: "fjell-rev-havn", api: LEARN.enroll, name: null } });
    const f = vi.fn(async (url: string) => (url.endsWith("/forget") ? new Response(JSON.stringify({ error: "code" }), { status: 404 }) : new Response("{}", { status: 404 }))) as unknown as typeof fetch;
    const r = await run({ storage, fetch: f });
    r.byId["join-forget"].fire("click");
    await new Promise((res) => setTimeout(res, 0));
    await new Promise((res) => setTimeout(res, 0));
    expect(JSON.parse(storage.data["drawcast.learners"])).toEqual({});
    expect(r.byId["join-form"].hidden).toBe(false);
  });

  test("use another code stores what was pasted", async () => {
    const r = await run({});
    r.byId["join-switch-input"].value = " Havn-Ulv-Bok ";
    r.byId["join-switch-button"].fire("click");
    await new Promise((res) => setTimeout(res, 0));
    expect(JSON.parse(r.storage.data["drawcast.learners"])[LEARN.courseKey].code).toBe("havn-ulv-bok");
    expect(r.byId["join-you"].hidden).toBe(false);
  });

  test("a malformed ?learner= escape leaves the join box working", async () => {
    // decodeURIComponent("100%") throws — unguarded, it took the whole script
    // down before a single listener was attached.
    const r = await run({ search: "?learner=100%" });
    expect(r.byId["join-form"].handlers["submit"]?.length).toBe(1);
    expect(r.byId["join-form"].hidden).toBe(false);
    expect(r.storage.data["drawcast.learners"]).toBeUndefined();
    expect(r.replaced).toEqual(["/dcast/learn-russian/"]);
  });

  test("a malformed ?run= escape enrols without a run instead of throwing", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ code: "a-b-c", name: null, email_sent: false }), { status: 200 })) as unknown as typeof fetch;
    const r = await run({ fetch: f, search: "?run=100%" });
    r.byId["join-form"].fire("submit");
    await new Promise((res) => setTimeout(res, 0));
    expect(JSON.parse(((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string).run).toBeNull();
  });

  test("forget also takes the code off the lecture links", async () => {
    const storage = memoryStorage();
    storage.data["drawcast.learners"] = JSON.stringify({ [LEARN.courseKey]: { code: "fjell-rev-havn", api: LEARN.enroll, name: null } });
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
    const r = await run({ storage, fetch: f });
    expect(r.current()[0].getAttribute("href")).toBe(LINKS[0].href + "&learner=fjell-rev-havn");
    r.byId["join-forget"].fire("click");
    await new Promise((res) => setTimeout(res, 0));
    await new Promise((res) => setTimeout(res, 0));
    r.current().forEach((a, i) => {
      expect(a.getAttribute("href")).toBe(LINKS[i].href);
      expect(a.getAttribute("href")).not.toContain("&learner=");
    });
  });

  test("the progress rebuild re-parses the links, so the code is written onto the anchors the page has NOW", async () => {
    // The regression this pins: restore()/showProgress assign li.innerHTML,
    // which destroys the <a data-cast> inside and parses a fresh one with the
    // published href. A NodeList captured at script start is detached nodes
    // from then on, and the live links would lose the code — the course page
    // and the viewer are cross-origin, so the link is its only channel.
    const storage = memoryStorage();
    storage.data["drawcast.learners"] = JSON.stringify({ [LEARN.courseKey]: { code: "fjell-rev-havn", api: LEARN.enroll, name: null } });
    const progress = { name: null, course: {}, lectures: [{ cast: LINKS[0].cast, opened: true, completed: true, answers: [] }] };
    const f = vi.fn(async () => new Response(JSON.stringify(progress), { status: 200 })) as unknown as typeof fetch;
    const r = await run({ storage, fetch: f });
    expect(r.anchors.every((a) => a.detached)).toBe(true); // the rebuild threw these away
    expect(r.current().some((a) => r.anchors.includes(a))).toBe(false);
    r.current().forEach((a, i) => expect(a.getAttribute("href")).toBe(LINKS[i].href + "&learner=fjell-rev-havn"));
    expect(r.lis[0].innerHTML.split('class="mark"').length - 1).toBe(1);
  });

  test("switching codes twice leaves one mark, not a stack of them", async () => {
    const progress = { name: null, course: {}, lectures: [{ cast: LINKS[0].cast, opened: true, completed: true, answers: [] }] };
    const f = vi.fn(async () => new Response(JSON.stringify(progress), { status: 200 })) as unknown as typeof fetch;
    const r = await run({ fetch: f });
    for (const code of [" Havn-Ulv-Bok ", "fjell-rev-havn"]) {
      r.byId["join-switch-input"].value = code;
      r.byId["join-switch-button"].fire("click");
      await new Promise((res) => setTimeout(res, 0));
      await new Promise((res) => setTimeout(res, 0));
    }
    expect(r.lis[0].innerHTML.split('class="mark"').length - 1).toBe(1);
    r.current().forEach((a, i) => expect(a.getAttribute("href")).toBe(LINKS[i].href + "&learner=fjell-rev-havn"));
    expect(r.current()[0].getAttribute("href")).not.toContain("havn-ulv-bok");
  });

  test("a progress response that lands after Forget me is ignored", async () => {
    const storage = memoryStorage();
    storage.data["drawcast.learners"] = JSON.stringify({ [LEARN.courseKey]: { code: "fjell-rev-havn", api: LEARN.enroll, name: null } });
    const gate = deferred();
    const progress = { name: null, course: {}, lectures: [{ cast: LINKS[0].cast, opened: true, completed: true, answers: [] }] };
    const f = vi.fn(async (url: string) => {
      if (url.endsWith("/forget")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      await gate.promise; // the GET is still in flight while the learner forgets
      return new Response(JSON.stringify(progress), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await run({ storage, fetch: f });
    r.byId["join-forget"].fire("click");
    await tick();
    await tick();
    expect(JSON.parse(r.storage.data["drawcast.learners"])).toEqual({});
    r.current().forEach((a, i) => expect(a.getAttribute("href")).toBe(LINKS[i].href));
    gate.resolve(); // the answer for the forgotten code arrives now
    for (let i = 0; i < 4; i++) await tick();
    r.current().forEach((a, i) => expect(a.getAttribute("href")).toBe(LINKS[i].href));
    expect(r.lis[0].innerHTML).not.toContain('class="mark"');
  });

  test("a slow progress response for the previous code never wins over the current one", async () => {
    const first = deferred(), second = deferred();
    const bodyFor = (cast: string) => JSON.stringify({ name: null, course: {}, lectures: [{ cast, opened: true, completed: true, answers: [] }] });
    const f = vi.fn(async (url: string) => {
      if (url.includes("code=havn-ulv-bok")) {
        await first.promise;
        return new Response(bodyFor(LINKS[0].cast), { status: 200 });
      }
      await second.promise;
      return new Response(bodyFor(LINKS[1].cast), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await run({ fetch: f });
    for (const code of ["havn-ulv-bok", "fjell-rev-havn"]) {
      r.byId["join-switch-input"].value = code;
      r.byId["join-switch-button"].fire("click");
      await tick();
    }
    second.resolve(); // the current code answers first…
    for (let i = 0; i < 4; i++) await tick();
    first.resolve(); // …and the abandoned one answers last
    for (let i = 0; i < 4; i++) await tick();
    r.current().forEach((a, i) => expect(a.getAttribute("href")).toBe(LINKS[i].href + "&learner=fjell-rev-havn"));
    expect(r.current()[0].getAttribute("href")).not.toContain("havn-ulv-bok");
    expect(r.lis[1].innerHTML.split('class="mark"').length - 1).toBe(1);
    expect(r.lis[0].innerHTML).not.toContain('class="mark"'); // only the second code's lecture is marked
  });

  test("use another code reveals the switch box first", async () => {
    const r = await run({});
    expect(r.byId["join-switch-box"].hidden).toBe(true);
    r.byId["join-switch"].fire("click");
    expect(r.byId["join-switch-box"].hidden).toBe(false);
  });
});
