// The call layer streams, so a generation can be watched and cancelled while
// it runs. The seam under test is callForJson/callForText's options bag: the
// text deltas it forwards, the AbortSignal it hands the SDK, and the effort
// dial repair rounds turn down. See src/llm/client.ts.

import { describe, expect, test, vi } from "vitest";

// The calls book tokens into the usage ledger on the way out (src/store.ts).
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

import Anthropic from "@anthropic-ai/sdk";
import { callForJson, callForText, describeApiError } from "../src/llm/client";

interface Recorded {
  body: Record<string, unknown>;
  options: { signal?: AbortSignal } | undefined;
}

/** A stand-in for the SDK's MessageStream: chainable .on(), awaited .finalMessage(). */
function fakeStream(deltas: string[], recorded: Recorded[], body: Record<string, unknown>, options: Recorded["options"]) {
  recorded.push({ body, options });
  const text = deltas.join("");
  const handlers: ((delta: string, snapshot: string) => void)[] = [];
  const stream = {
    on(event: string, cb: (delta: string, snapshot: string) => void) {
      if (event === "text") handlers.push(cb);
      return stream;
    },
    async finalMessage() {
      let snapshot = "";
      for (const d of deltas) {
        snapshot += d;
        for (const cb of handlers) cb(d, snapshot);
      }
      return {
        model: (body.model as string) ?? "m",
        stop_reason: "end_turn",
        content: [{ type: "text", text }],
        usage: { input_tokens: 10, output_tokens: 20 },
      } as unknown as Anthropic.Message;
    },
  };
  return stream;
}

function fakeClient(deltas: string[]): { client: Anthropic; recorded: Recorded[] } {
  const recorded: Recorded[] = [];
  const make = (body: Record<string, unknown>, options?: Recorded["options"]) => fakeStream(deltas, recorded, body, options);
  return { client: { messages: { stream: make }, beta: { messages: { stream: make } } } as unknown as Anthropic, recorded };
}

describe("callForJson streams", () => {
  test("forwards every text delta while the call is still running", async () => {
    const { client } = fakeClient(['{"title"', ':"Tax"}']);
    const seen: string[] = [];
    const { json } = await callForJson(client, "claude-sonnet-5", "sys", [{ role: "user", content: "q" }], {}, { onDelta: (_d, snapshot) => seen.push(snapshot) });
    expect(seen).toEqual(['{"title"', '{"title":"Tax"}']);
    expect(json).toEqual({ title: "Tax" });
  });

  test("hands the abort signal to the SDK as a request option", async () => {
    const { client, recorded } = fakeClient(["{}"]);
    const controller = new AbortController();
    await callForJson(client, "claude-sonnet-5", "sys", [{ role: "user", content: "q" }], {}, { signal: controller.signal });
    expect(recorded[0].options?.signal).toBe(controller.signal);
  });

  test("effort rides in output_config beside the schema", async () => {
    const { client, recorded } = fakeClient(["{}"]);
    await callForJson(client, "claude-sonnet-5", "sys", [{ role: "user", content: "q" }], { type: "object", additionalProperties: false }, { effort: "low" });
    expect(recorded[0].body.output_config).toEqual({ format: { type: "json_schema", schema: { type: "object", additionalProperties: false } }, effort: "low" });
  });

  test("no effort means no effort field — the model's own default stands", async () => {
    const { client, recorded } = fakeClient(["{}"]);
    await callForJson(client, "claude-sonnet-5", "sys", [{ role: "user", content: "q" }], { type: "object", additionalProperties: false });
    expect(recorded[0].body.output_config).toEqual({ format: { type: "json_schema", schema: { type: "object", additionalProperties: false } } });
  });
});

describe("callForText streams", () => {
  test("forwards text deltas and returns the joined text", async () => {
    const { client } = fakeClient(["title: A", "\ncommands: []"]);
    const seen: string[] = [];
    const { text } = await callForText(client, "claude-sonnet-5", "sys", [{ role: "user", content: "q" }], { onDelta: (d) => seen.push(d) });
    expect(seen).toEqual(["title: A", "\ncommands: []"]);
    expect(text).toBe("title: A\ncommands: []");
  });

  test("hands the abort signal to the SDK as a request option", async () => {
    const { client, recorded } = fakeClient(["x"]);
    const controller = new AbortController();
    await callForText(client, "claude-sonnet-5", "sys", [{ role: "user", content: "q" }], { signal: controller.signal });
    expect(recorded[0].options?.signal).toBe(controller.signal);
  });

  test("a text call carries effort alone — there is no schema to sit beside", async () => {
    const { client, recorded } = fakeClient(["x"]);
    await callForText(client, "claude-sonnet-5", "sys", [{ role: "user", content: "q" }], { effort: "low" });
    expect(recorded[0].body.output_config).toEqual({ effort: "low" });
  });
});

describe("describeApiError", () => {
  test("a user abort reads as cancelled, not as a failure", () => {
    expect(describeApiError(new Anthropic.APIUserAbortError())).toBe("Cancelled.");
  });
});
