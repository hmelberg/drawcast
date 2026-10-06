// The locked-lecture door in runViewer (registry delivery 2, task 7):
// lockedDoor renders item-key.ts's denial shapes, and a source guard pins
// the wiring — isLocked checked before the playlist is parsed, lockedRoute
// tried before ever asking for a key, and the fetch always going to
// DEFAULT_ENROLL_API, never the envelope's own (unauthenticated) `enroll`
// field. Same fake-DOM approach as tests/course-door.test.ts: no jsdom in
// this repo, and h() appends string children mini-dom.ts cannot take.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { JoinOutcome } from "../src/learn";
import { lockedDoor, type DoorDeps } from "../src/viewer";
import type { KeyDenial } from "../src/item-key";

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
const ITEM = "hmelberg/dcast/learn-russian/03.yaml";

function deps(token: string, outcome: JoinOutcome | Promise<JoinOutcome> = "ok") {
  let t = token;
  const d: DoorDeps = {
    token: () => t,
    forget: vi.fn(() => {
      t = "";
    }),
    signIn: vi.fn(),
    join: vi.fn(async () => outcome),
  };
  return d;
}

function render(door: KeyDenial & { item: string }, d: DoorDeps, onJoined = vi.fn()) {
  const root = lockedDoor(door, d, onJoined) as unknown as El;
  return {
    root,
    onJoined,
    h1: root.all().find((e) => e.tagName === "h1")!,
    note: root.all().find((e) => e.className.split(" ").includes("viewer-status"))!,
    button: root.all().find((e) => e.tagName === "button"),
  };
}

describe("lockedDoor", () => {
  test("401: the same sign-in door a refused server cast gets — reuses deniedDoor", () => {
    const d = deps("");
    const r = render({ denied: 401, item: ITEM }, d);
    expect(r.h1.textContent).toBe("This drawcast is private");
    expect(r.button!.textContent).toBe("Sign in to watch");
    r.button!.click();
    expect(d.forget).toHaveBeenCalledTimes(1);
    expect(d.signIn).toHaveBeenCalledTimes(1);
  });

  test("404: the item stopped being private, or moved — no button, just what happened", () => {
    const r = render({ denied: 404, item: ITEM }, deps("tok"));
    expect(r.h1.textContent).toBe("This lecture is locked");
    expect(r.note.textContent).toBe("This lecture is locked, and its key is no longer available.");
    expect(r.note.classList.contains("error")).toBe(true);
    expect(r.button).toBeUndefined();
  });

  test("offline: a plain message and a Try again button that reloads — NEVER deniedDoor's sign-in button, which would drop a perfectly good session", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    try {
      const d = deps("tok");
      const r = render({ denied: "offline", item: ITEM }, d);
      expect(r.h1.textContent).toBe("This lecture is locked");
      expect(r.note.textContent).toBe("Can't reach the drawcast server — check your connection and try again.");
      expect(r.button!.textContent).toBe("Try again");
      r.button!.click();
      expect(reload).toHaveBeenCalledTimes(1);
      expect(d.forget).not.toHaveBeenCalled();
      expect(d.signIn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("403 none: the course's join door, built from the ENVELOPE'S item, not the cast key", async () => {
    const d = deps("tok");
    const r = render({ denied: 403, standing: "none", title: "Learn russian", page: "https://x.example/course", item: ITEM }, d);
    expect(r.h1.textContent).toBe("Learn russian");
    expect(r.note.textContent).toBe("This lecture is private to its course. Ask to join — the teacher approves requests.");
    expect(r.button!.textContent).toBe("Join this course");
    r.button!.click();
    await tick();
    expect(d.join).toHaveBeenCalledWith("tok", { course: ITEM, title: "Learn russian", page: "https://x.example/course" });
  });

  test("403 none with a free name (final review M3): the title heads the door, the join's page falls back to #<name> — never #<Title With Spaces>", async () => {
    const d = deps("tok");
    const r = render({ denied: 403, standing: "none", title: "Learn russian", page: null, name: "russian", item: ITEM }, d);
    expect(r.h1.textContent).toBe("Learn russian");
    r.button!.click();
    await tick();
    expect(d.join).toHaveBeenCalledWith("tok", { course: ITEM, title: "Learn russian", page: "https://www.drawcast.app/#russian" });
  });

  test("403 none: an empty title falls back to the item as the name", () => {
    const r = render({ denied: 403, standing: "none", title: "", page: null, item: ITEM }, deps("tok"));
    // courseDoor title-cases whatever name it is given (hyphens to spaces,
    // first letter up) — the same transform the item fallback goes through.
    expect(r.h1.textContent).toBe(ITEM.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()));
  });

  test("403 pending: waiting for the teacher, not an error, no button to click again", () => {
    const r = render({ denied: 403, standing: "pending", title: "x", page: null, item: ITEM }, deps("tok"));
    expect(r.note.textContent).toBe("Your request to join is waiting for the teacher's approval.");
    expect(r.note.classList.contains("error")).toBe(false);
    expect(r.button).toBeUndefined();
  });

  test("403 rejected: declined, and it reads as an error", () => {
    const r = render({ denied: 403, standing: "rejected", title: "x", page: null, item: ITEM }, deps("tok"));
    expect(r.note.textContent).toBe("Your request to join this course was declined.");
    expect(r.note.classList.contains("error")).toBe(true);
    expect(r.button).toBeUndefined();
  });

  test("a successful join calls onJoined (default: reload) so there is always a next step", async () => {
    const onJoined = vi.fn();
    const d = deps("tok", "ok");
    const r = render({ denied: 403, standing: "none", title: "x", page: "https://x.example", item: ITEM }, d, onJoined);
    r.button!.click();
    await tick();
    expect(onJoined).toHaveBeenCalledTimes(1);
  });
});

// The wiring inside runViewer itself: the source is what proves the choke
// point (interfaces, not behaviour a fake DOM could exercise end to end).
describe("runViewer's locked-lecture wiring (source guard)", () => {
  const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const run = viewer.slice(viewer.indexOf("export async function runViewer("), viewer.indexOf("const playlist = parsePlaylistText(text);"));

  test("isLocked is checked before the playlist is ever parsed", () => {
    const isLockedAt = viewer.indexOf("isLocked(text)");
    const parseAt = viewer.indexOf("const playlist = parsePlaylistText(text);");
    expect(isLockedAt).toBeGreaterThan(0);
    expect(parseAt).toBeGreaterThan(isLockedAt);
  });

  test("lockedRoute is tried, and used to bounce, before ever asking for a key", () => {
    const routeAt = run.indexOf("lockedRoute(location.origin, location.hash)");
    const replaceAt = run.indexOf("location.replace(elsewhere)");
    const unlockAt = run.indexOf("unlockForViewer(text,");
    expect(routeAt).toBeGreaterThan(0);
    expect(replaceAt).toBeGreaterThan(routeAt);
    expect(unlockAt).toBeGreaterThan(replaceAt);
  });

  test("the key fetch is always sent to DEFAULT_ENROLL_API — never the envelope's own enroll field", () => {
    expect(run).toMatch(/unlockForViewer\(text, \{ api: DEFAULT_ENROLL_API, token: getToken \}\)/);
    expect(run).not.toMatch(/envelope\.enroll|\.enroll\b/);
  });

  test("no localStorage of its own — the item-key store is item-key.ts's own default, not something runViewer reaches for", () => {
    expect(viewer).not.toMatch(/localStorage/);
  });

  test("a door result replaces the whole page, like deniedDoor's, and stops there", () => {
    const doorAt = run.indexOf('"door" in unlocked');
    const replaceChildrenAt = run.indexOf("app.replaceChildren(lockedDoor(unlocked.door))");
    expect(doorAt).toBeGreaterThan(0);
    expect(replaceChildrenAt).toBeGreaterThan(doorAt);
  });
});
