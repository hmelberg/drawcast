// 👍 / 👎: the client half (src/home/react.ts).
import { describe, expect, test } from "vitest";
import { fetchReactState, nextVote, optimistic, sendReaction } from "../src/home/react";

const API = "https://drawcast.anvil.app";
function fake(status: number, body: unknown, seen: { url?: string; body?: unknown }[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe("reactions", () => {
  test("a vote posts key, name and vote; the answer is the public count and my vote", async () => {
    const seen: { url?: string; body?: unknown }[] = [];
    expect(await sendReaction("moon", "k1", 1, fake(200, { likes: 4, vote: 1 }, seen), API)).toEqual({ likes: 4, vote: 1 });
    expect(seen[0]).toEqual({ url: `${API}/_/api/react`, body: { key: "k1", name: "moon", vote: 1 } });
  });
  test("state without a key sends no key; dislikes are never read even if sent", async () => {
    const seen: { url?: string; body?: unknown }[] = [];
    expect(await fetchReactState("moon", "", fake(200, { likes: 2, vote: 0, dislikes: 9 }, seen), API)).toEqual({ likes: 2, vote: 0 });
    expect(seen[0].body).toEqual({ name: "moon" });
  });
  test("404 = not a listed item, 401 = sign in again, else error", async () => {
    expect(await fetchReactState("x", "", fake(404, { error: "unknown" }), API)).toBe("unknown");
    expect(await sendReaction("x", "k", 1, fake(401, { error: "key" }), API)).toBe("signin");
    expect(await sendReaction("x", "k", 1, fake(429, { error: "rate" }), API)).toBe("error");
    expect(await sendReaction("x", "k", 1, fake(200, { nope: 1 }), API)).toBe("error");
  });
  test("pressing the pressed button takes the vote back; the count follows 👍 only", () => {
    expect(nextVote(1, 1)).toBe(0);
    expect(nextVote(-1, 1)).toBe(1);
    expect(nextVote(0, -1)).toBe(-1);
    expect(optimistic({ likes: 3, vote: 0 }, 1)).toEqual({ likes: 4, vote: 1 });
    expect(optimistic({ likes: 4, vote: 1 }, -1)).toEqual({ likes: 3, vote: -1 });
    expect(optimistic({ likes: 0, vote: -1 }, 0)).toEqual({ likes: 0, vote: 0 });
  });
});
