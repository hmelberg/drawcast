// The course door (viewer.ts, identity round), driven end to end: signed out
// it is the sign-in; signed in it joins in one click and says what happened.
// The vitest environment is plain node (vite.config.ts) and the repo carries
// no jsdom, so h() is fed a fake document just big enough for what the door
// touches — elements, text, attributes, classList, hidden/disabled, click.
// tests/helpers/mini-dom.ts cannot take string children, which h() appends.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { JoinOutcome } from "../src/learn";
import { joinNote } from "../src/learn";
import { courseDoor, type DoorDeps } from "../src/viewer";

class El {
  tagName: string;
  className = "";
  attrs = new Map<string, string>();
  children: (El | string)[] = [];
  hidden = false;
  disabled = false;
  private handlers = new Map<string, (() => void)[]>();
  classList = {
    toggle: (name: string, force?: boolean): boolean => {
      const has = this.className.split(" ").includes(name);
      const want = force ?? !has;
      const rest = this.className.split(" ").filter((c) => c && c !== name);
      this.className = (want ? [...rest, name] : rest).join(" ");
      return want;
    },
    contains: (name: string): boolean => this.className.split(" ").includes(name),
  };
  constructor(tagName: string) {
    this.tagName = tagName;
  }
  get textContent(): string {
    return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }
  set textContent(v: string) {
    this.children = [v];
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  append(...cs: (El | string)[]): void {
    this.children.push(...cs);
  }
  addEventListener(type: string, fn: () => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  click(): void {
    for (const fn of this.handlers.get("click") ?? []) fn();
  }
  /** Every element under this one, depth first. */
  all(): El[] {
    return this.children.flatMap((c) => (typeof c === "string" ? [] : [c, ...c.all()]));
  }
}

const g = globalThis as { document?: unknown };
let prev: unknown;
beforeAll(() => {
  prev = g.document;
  g.document = { createElement: (tag: string) => new El(tag) };
});
afterAll(() => {
  g.document = prev;
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const RESOLVED = { kind: "course" as const, target: "hmelberg/dcast/learn-russian", page: "https://hmelberg.github.io/dcast/learn-russian/" };

/** A door with every outside dependency recorded, answering `outcome` to a join. */
function door(opts: { token: string; outcome?: JoinOutcome | Promise<JoinOutcome>; page?: string | null }) {
  let token = opts.token;
  const deps: DoorDeps = {
    token: () => token,
    forget: vi.fn(() => {
      token = "";
    }),
    signIn: vi.fn(),
    join: vi.fn(async () => opts.outcome ?? "ok"),
  };
  const root = courseDoor("learn-russian", { ...RESOLVED, page: opts.page === undefined ? RESOLVED.page : opts.page }, deps) as unknown as El;
  const button = root.all().find((e) => e.tagName === "button")!;
  const note = root.all().find((e) => e.className === "viewer-status")!;
  const links = () => root.all().filter((e) => e.tagName === "a");
  return { root, button, note, links, deps };
}

describe("the door, signed out", () => {
  test("the button is the sign-in, and clicking it leaves for the handshake without joining", () => {
    const d = door({ token: "" });
    expect(d.button.textContent).toBe("Sign in to join");
    d.button.click();
    expect(d.deps.signIn).toHaveBeenCalledTimes(1);
    expect(d.deps.join).not.toHaveBeenCalled();
  });
  test("the heading is the name, made readable, and the course's page is linked before any join", () => {
    const d = door({ token: "" });
    expect(d.root.all().find((e) => e.tagName === "h1")!.textContent).toBe("Learn russian");
    expect(d.links().map((a) => a.getAttribute("href"))).toEqual([RESOLVED.page]);
  });
});

describe("the door, signed in", () => {
  test("one click joins with the token and the resolved course key; the button is disabled only while the answer is on its way, then hidden", async () => {
    let settle = (_: JoinOutcome): void => {};
    const pending = new Promise<JoinOutcome>((res) => {
      settle = res;
    });
    const d = door({ token: "tok", outcome: pending });
    expect(d.button.textContent).toBe("Join this course");
    d.button.click();
    expect(d.deps.join).toHaveBeenCalledWith("tok", { course: RESOLVED.target, title: "Learn russian", page: RESOLVED.page });
    expect(d.button.disabled).toBe(true);
    settle("ok");
    await tick();
    expect(d.button.disabled).toBe(false);
    expect(d.button.hidden).toBe(true);
    expect(d.note.textContent).toBe(joinNote("ok"));
    expect(d.note.classList.contains("error")).toBe(false);
    expect(d.deps.forget).not.toHaveBeenCalled();
    expect(d.deps.signIn).not.toHaveBeenCalled();
  });
  test("with no page in the registry, a successful join still leaves something to click: the first lecture", async () => {
    const d = door({ token: "tok", page: null });
    expect(d.links()).toHaveLength(0);
    d.button.click();
    await tick();
    expect(d.deps.join).toHaveBeenCalledWith("tok", { course: RESOLVED.target, title: "Learn russian", page: "https://drawcast.app/#learn-russian" });
    expect(d.links().map((a) => a.getAttribute("href"))).toEqual(["#learn-russian/1"]);
    expect(d.links()[0].textContent).toMatch(/first lecture/);
  });
  test("a dead token is dropped and the button becomes the sign-in, so the next click is the handshake", async () => {
    const d = door({ token: "stale", outcome: "key" });
    d.button.click();
    await tick();
    expect(d.deps.forget).toHaveBeenCalledTimes(1);
    expect(d.note.textContent).toBe(joinNote("key"));
    expect(d.note.classList.contains("error")).toBe(true);
    expect(d.button.hidden).toBe(false);
    expect(d.button.disabled).toBe(false);
    expect(d.button.textContent).toBe("Sign in to join");
    d.button.click();
    expect(d.deps.signIn).toHaveBeenCalledTimes(1);
    expect(d.deps.join).toHaveBeenCalledTimes(1);
  });
  test.each<JoinOutcome>(["closed", "run", "invalid", "rate", "error"])("a %s answer is said in the door's words, keeps the token and the button, and adds no lecture link", async (outcome) => {
    const d = door({ token: "tok", outcome, page: null });
    d.button.click();
    await tick();
    expect(d.note.textContent).toBe(joinNote(outcome));
    expect(d.note.classList.contains("error")).toBe(true);
    expect(d.button.hidden).toBe(false);
    expect(d.button.disabled).toBe(false);
    expect(d.button.textContent).toBe("Join this course");
    expect(d.deps.forget).not.toHaveBeenCalled();
    expect(d.links()).toHaveLength(0);
  });
});
