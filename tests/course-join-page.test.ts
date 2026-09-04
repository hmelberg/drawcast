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
  innerHTML = "";
  value = "";
  hidden = false;
  handlers: Record<string, ((e: { preventDefault(): void }) => void)[]> = {};
  constructor(public id: string, attrs: Record<string, string> = {}) { this.attrs = attrs; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener(type: string, fn: (e: { preventDefault(): void }) => void) { (this.handlers[type] ??= []).push(fn); }
  fire(type: string) { for (const fn of this.handlers[type] ?? []) fn({ preventDefault() {} }); }
}

// Ruling A: the real page puts data-cast on both the <li> and its <a>, so
// the script uses two distinct selectors (a[data-cast] for link rewriting,
// li[data-cast] for progress marks/review) instead of one that would also
// rewrite the anchor's innerHTML.
function fakeDom(join: El | null, lis: El[], anchors: El[]) {
  const byId: Record<string, El> = {};
  for (const id of ["join-form", "join-name", "join-email", "join-button", "join-status", "join-you", "join-code", "join-progress-note", "join-forget", "join-switch", "join-switch-box", "join-switch-input", "join-switch-button"]) byId[id] = new El(id);
  return {
    byId,
    document: {
      querySelector: (sel: string) => (sel === ".join" ? join : null),
      getElementById: (id: string) => byId[id] ?? null,
      querySelectorAll: (sel: string) => (sel === "a[data-cast]" ? anchors : sel === "li[data-cast]" ? lis : []),
    },
  };
}

function memoryStorage() {
  const data: Record<string, string> = {};
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; }, removeItem: (k: string) => { delete data[k]; }, data };
}

async function run(opts: { search?: string; storage?: ReturnType<typeof memoryStorage>; fetch?: typeof fetch; join?: boolean }) {
  const join = opts.join === false ? null : new El("join", { "data-course": LEARN.courseKey, "data-enroll": LEARN.enroll, "data-title": "Learn Russian" });
  const anchors = LINKS.map((l) => new El("a", { "data-cast": l.cast, href: l.href }));
  const lis = LINKS.map((l) => new El("li", { "data-cast": l.cast }));
  const dom = fakeDom(join, lis, anchors);
  const storage = opts.storage ?? memoryStorage();
  const replaced: string[] = [];
  const location = { search: opts.search ?? "", pathname: "/dcast/learn-russian/", hash: "", origin: "https://hmelberg.github.io", href: "https://hmelberg.github.io/dcast/learn-russian/" + (opts.search ?? "") };
  const history = { replaceState: (_: unknown, __: string, url: string) => replaced.push(url) };
  const fetchImpl = opts.fetch ?? (vi.fn(async () => new Response("{}", { status: 404 })) as unknown as typeof fetch);
  new Function("document", "localStorage", "fetch", "location", "history", ENROL_SCRIPT)(dom.document, storage, fetchImpl, location, history);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return { ...dom, lis, anchors, storage, replaced, fetchImpl };
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
      { cast: LINKS[0].cast, opened: true, completed: true, answers: [{ step: 2, question: "Which case?", given: ["dative", "genitive"], expected: "genitive", correct: true }, { step: 5, question: "Gender?", given: ["m"], expected: "f", correct: false }] },
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
    expect(r.lis[0].innerHTML).not.toContain("<script");
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

  test("use another code stores what was pasted", async () => {
    const r = await run({});
    r.byId["join-switch-input"].value = " Havn-Ulv-Bok ";
    r.byId["join-switch-button"].fire("click");
    await new Promise((res) => setTimeout(res, 0));
    expect(JSON.parse(r.storage.data["drawcast.learners"])[LEARN.courseKey].code).toBe("havn-ulv-bok");
    expect(r.byId["join-you"].hidden).toBe(false);
  });
});
