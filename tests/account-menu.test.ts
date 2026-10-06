// The account button's pure half (src/account-menu.ts, 2026-10-06).
import { describe, expect, test } from "vitest";
import { fetchMe, initialOf, menuItems, parseMe, planText, type Me } from "../src/account-menu";

const API = "https://drawcast.anvil.app";
const BODY = { email: "ada@example.org", admin: false, credits: 1250, plan: "pro", plan_label: "Pro", grace: false };
const ME: Me = { email: "ada@example.org", admin: false, credits: 1250, plan: "pro", planLabel: "Pro", grace: false };

describe("account menu", () => {
  test("/me's answer becomes a Me; anything else is not one", () => {
    expect(parseMe(BODY)).toEqual(ME);
    expect(parseMe({ email: "a@b" })).toBeNull();
    expect(parseMe(null)).toBeNull();
    expect(parseMe({ ...BODY, plan: null, plan_label: null })).toEqual({ ...ME, plan: null, planLabel: null });
  });

  test("fetchMe posts the key; 401 = sign in again, else error", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const ok = (async (url: string, init?: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(BODY), { status: 200 });
    }) as typeof fetch;
    expect(await fetchMe("k1", ok, API)).toEqual(ME);
    expect(seen[0]).toEqual({ url: `${API}/_/api/me`, body: { key: "k1" } });
    const status = (n: number) => (async () => new Response("{}", { status: n })) as typeof fetch;
    expect(await fetchMe("k", status(401), API)).toBe("key");
    expect(await fetchMe("k", status(429), API)).toBe("error");
    expect(await fetchMe("k", (async () => { throw new Error("offline"); }) as typeof fetch, API)).toBe("error");
  });

  test("the avatar letter and the plan line", () => {
    expect(initialOf("ada@example.org")).toBe("A");
    expect(initialOf("_9x@y")).toBe("9");
    expect(initialOf("")).toBe("?");
    expect(planText(ME)).toBe("Pro plan");
    expect(planText({ ...ME, admin: true })).toBe("Admin");
    expect(planText({ ...ME, plan: null, planLabel: null, grace: true })).toBe("Plan ended");
    expect(planText({ ...ME, plan: null, planLabel: null })).toBe("No plan");
  });

  test("on the front page, items are its own pages; only keys open the editor's Settings by hash", () => {
    const items = menuItems({ where: "home" }, API);
    expect(items.map((i) => i.label)).toEqual(["Your content", "Your courses", "Saved", "Liked", "Watch history", "Credit & plan", "Keys & settings", "Account"]);
    expect(items.find((i) => i.label === "Credit & plan")).toEqual({ label: "Credit & plan", href: "./?you=credit", newTab: false });
    expect(items.find((i) => i.label === "Keys & settings")).toEqual({ label: "Keys & settings", href: "./#settings=keys" });
    expect(items.find((i) => i.label === "Your content")).toEqual({ label: "Your content", href: "./?you=content", newTab: false });
  });

  test("in the editor, front-page items open a new tab and Settings is this page's dialog", () => {
    const opened: (string | undefined)[] = [];
    const items = menuItems({ where: "editor", openSettings: (t) => opened.push(t) }, API);
    expect(items.find((i) => i.label === "Saved")?.newTab).toBe(true);
    expect(items[0]).toEqual({ label: "Your content", href: "./?you=content", newTab: true });
    expect(items.at(-1)).toEqual({ label: "Account", href: "./?you=account", newTab: true });
    items.find((i) => i.label === "Credit & plan")!.run!();
    expect(opened).toEqual(["credits"]);
  });
});
