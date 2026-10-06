// "Watched to the end" (ranking round, 2026-10-05): netlify/functions/done.mts.
import { expect, test } from "vitest";
import { handleDoneRequest, type DoneDeps } from "../netlify/functions/done.mts";

function deps(listed: string[] | null = ["moon", "spanish"]): DoneDeps & { store: Map<string, number> } {
  const store = new Map<string, number>();
  return {
    store,
    listed: async () => (listed ? new Set(listed) : null),
    read: async (k) => store.get(k) ?? 0,
    write: async (k, c) => void store.set(k, c),
    now: () => Date.parse("2026-10-05T12:00:00Z"),
  };
}
const post = (body: unknown) => new Request("https://www.drawcast.app/api/done", { method: "POST", body: JSON.stringify(body) });

test("counts a listed name by day; a lecture counts for its course", async () => {
  const d = deps();
  expect((await handleDoneRequest(post({ name: "moon" }), d)).status).toBe(204);
  await handleDoneRequest(post({ name: "moon" }), d);
  await handleDoneRequest(post({ name: "spanish/3" }), d);
  expect(Object.fromEntries(d.store)).toEqual({ "d/moon/2026-10-05": 2, "d/spanish/2026-10-05": 1 });
});

test("an unlisted or made-up name, or no feed yet, is not counted", async () => {
  for (const d of [deps(), deps(null)]) {
    await handleDoneRequest(post({ name: "nobody" }), d);
    expect(d.store.size).toBe(0);
  }
  expect((await handleDoneRequest(post({ name: "../x" }), deps())).status).toBe(400);
  expect((await handleDoneRequest(post({}), deps())).status).toBe(400);
  expect((await handleDoneRequest(new Request("https://www.drawcast.app/api/done"), deps())).status).toBe(405);
});
