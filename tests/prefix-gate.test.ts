// The prefix gate (src/llm/client.ts): parallel calls over the same cached
// system prefix must not all pay the cache write. A cache entry is readable
// only once the first response that writes it begins streaming (measured
// 2026-09-18: a leader wrote 14,861 tokens, two followers fired at its
// message_start each read 14,861 and wrote 0), so the first call per
// (model, cached prefix) leads and the rest wait for its first stream event.

import { describe, expect, test, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

import Anthropic from "@anthropic-ai/sdk";
import { callForJson } from "../src/llm/client";

/** A stream the test drives by hand: `firstEvent()` emits message_start, `finish()` resolves finalMessage. */
interface Handle {
  model: string;
  firstEvent: () => void;
  finish: () => void;
  fail: (err: Error) => void;
}

function fakeClient(): { client: Anthropic; opened: Handle[] } {
  const opened: Handle[] = [];
  const make = (body: Record<string, unknown>) => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    let resolve!: (m: unknown) => void;
    let reject!: (e: Error) => void;
    const final = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const stream = {
      on(event: string, cb: (...args: unknown[]) => void) {
        (listeners[event] ??= []).push(cb);
        return stream;
      },
      finalMessage: () => final,
    };
    opened.push({
      model: body.model as string,
      firstEvent: () => {
        for (const cb of listeners.streamEvent ?? []) cb({ type: "message_start" }, {});
      },
      finish: () => resolve({ model: body.model, stop_reason: "end_turn", content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 1 } }),
      fail: (err) => reject(err),
    });
    return stream;
  };
  return { client: { messages: { stream: make }, beta: { messages: { stream: make } } } as unknown as Anthropic, opened };
}

const cached = (text: string): Anthropic.TextBlockParam[] => [{ type: "text", text, cache_control: { type: "ephemeral" } }];
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the prefix gate", () => {
  test("followers over the same cached prefix wait for the leader's first stream event", async () => {
    const { client, opened } = fakeClient();
    const system = cached("shared prefix A");
    const a = callForJson(client, "claude-sonnet-5", system, [{ role: "user", content: "1" }], {});
    const b = callForJson(client, "claude-sonnet-5", system, [{ role: "user", content: "2" }], {});
    const c = callForJson(client, "claude-sonnet-5", system, [{ role: "user", content: "3" }], {});
    await tick();
    expect(opened.length).toBe(1); // only the leader is in flight
    opened[0].firstEvent();
    await tick();
    expect(opened.length).toBe(3); // the followers fired at its first event
    for (const h of opened) h.finish();
    await Promise.all([a, b, c]);
  });

  test("a different model or a different prefix does not wait", async () => {
    const { client, opened } = fakeClient();
    const p1 = callForJson(client, "claude-sonnet-5", cached("prefix B"), [{ role: "user", content: "1" }], {});
    const p2 = callForJson(client, "claude-opus-5", cached("prefix B"), [{ role: "user", content: "2" }], {});
    const p3 = callForJson(client, "claude-sonnet-5", cached("prefix C"), [{ role: "user", content: "3" }], {});
    await tick();
    expect(opened.length).toBe(3);
    for (const h of opened) h.finish();
    await Promise.all([p1, p2, p3]);
  });

  test("a plain string system prompt is never gated", async () => {
    const { client, opened } = fakeClient();
    const p1 = callForJson(client, "claude-sonnet-5", "same", [{ role: "user", content: "1" }], {});
    const p2 = callForJson(client, "claude-sonnet-5", "same", [{ role: "user", content: "2" }], {});
    await tick();
    expect(opened.length).toBe(2);
    for (const h of opened) h.finish();
    await Promise.all([p1, p2]);
  });

  test("a leader that fails before streaming releases its followers", async () => {
    const { client, opened } = fakeClient();
    const system = cached("prefix D");
    const a = callForJson(client, "claude-sonnet-5", system, [{ role: "user", content: "1" }], {});
    const b = callForJson(client, "claude-sonnet-5", system, [{ role: "user", content: "2" }], {});
    await tick();
    expect(opened.length).toBe(1);
    opened[0].fail(new Error("boom"));
    await expect(a).rejects.toThrow("boom");
    await tick();
    expect(opened.length).toBe(2); // the follower went ahead
    opened[1].finish();
    await b;
  });

  test("after the leader has streamed, a late arrival leads on its own (no waiting on a finished leader)", async () => {
    const { client, opened } = fakeClient();
    const system = cached("prefix E");
    const a = callForJson(client, "claude-sonnet-5", system, [{ role: "user", content: "1" }], {});
    await tick();
    opened[0].firstEvent();
    await tick();
    const b = callForJson(client, "claude-sonnet-5", system, [{ role: "user", content: "2" }], {});
    await tick();
    expect(opened.length).toBe(2); // fired at once — nobody to wait for
    opened[0].finish();
    opened[1].finish();
    await Promise.all([a, b]);
  });
});

describe("effort on a model without the dial", () => {
  test("Haiku gets no output_config.effort even when asked", async () => {
    const { client, opened } = fakeClient();
    const bodies: Record<string, unknown>[] = [];
    const make = (client as unknown as { messages: { stream: (b: Record<string, unknown>) => unknown } }).messages.stream;
    (client as unknown as { messages: { stream: unknown } }).messages.stream = (b: Record<string, unknown>) => {
      bodies.push(b);
      return make(b);
    };
    const p = callForJson(client, "claude-haiku-4-5", "sys", [{ role: "user", content: "1" }], {}, { effort: "low" });
    await tick();
    opened[0].finish();
    await p;
    expect((bodies[0].output_config as { effort?: string } | undefined)?.effort).toBeUndefined();
  });
});
