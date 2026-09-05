// Invalid-JSON robustness in the call layer (src/llm/client.ts): structured
// output decided per schema, a max_tokens cut-off named as such, and one
// mechanical repair round when a reply does not parse. Diagnosed 2026-09-06:
// one 400 for the course-plan schema disabled structured output for every
// schema in the session, and a single unparsable reply killed a whole part.

import { describe, expect, test, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

import Anthropic from "@anthropic-ai/sdk";
import { callForJson, structuredOutputSupported } from "../src/llm/client";
import { OUTLINE_SCHEMA } from "../src/llm/outline";
import { apiSchema } from "../src/llm/compile";

interface Reply {
  text?: string;
  stop_reason?: string;
  /** Throw this instead of answering. */
  error?: Error;
}
interface Recorded {
  body: Record<string, unknown>;
}

/** A queue of replies: each stream() call consumes the next one. */
function queuedClient(replies: Reply[]): { client: Anthropic; recorded: Recorded[] } {
  const recorded: Recorded[] = [];
  const make = (body: Record<string, unknown>) => {
    recorded.push({ body });
    const reply = replies.shift() ?? { text: "{}" };
    const stream = {
      on: () => stream,
      async finalMessage() {
        if (reply.error) throw reply.error;
        return {
          model: body.model,
          stop_reason: reply.stop_reason ?? "end_turn",
          content: [{ type: "text", text: reply.text ?? "" }],
          usage: { input_tokens: 10, output_tokens: 20 },
        } as unknown as Anthropic.Message;
      },
    };
    return stream;
  };
  return { client: { messages: { stream: make }, beta: { messages: { stream: make } } } as unknown as Anthropic, recorded };
}

function schemaError(): Error {
  const message = "output_config.format.schema: For 'object' type, 'additionalProperties: true' is not supported.";
  return new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message } }, message, new Headers());
}

const CLOSED = { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false };
const OPEN = { type: "object", properties: { p: { type: "object", additionalProperties: true } }, additionalProperties: false };

describe("structuredOutputSupported", () => {
  test("accepts the outline schema", () => {
    expect(structuredOutputSupported(OUTLINE_SCHEMA)).toBe(true);
  });
  test("rejects the spec schema (open params)", () => {
    expect(structuredOutputSupported(apiSchema())).toBe(false);
  });
  test("rejects a map-typed additionalProperties", () => {
    const mapped = { type: "object", properties: { c: { type: "object", additionalProperties: { type: "string" } } }, additionalProperties: false };
    expect(structuredOutputSupported(mapped)).toBe(false);
  });
});

describe("structured output is decided per schema", () => {
  test("a locally unsupported schema never sends output_config.format", async () => {
    const { client, recorded } = queuedClient([{ text: '{"p":{}}' }]);
    await callForJson(client, "claude-sonnet-5", "s", [{ role: "user", content: "u" }], OPEN);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].body.output_config).toBeUndefined();
  });

  test("a 400 for one schema does not degrade another", async () => {
    // Schema A: the API rejects it for a reason the local check cannot see;
    // schema B must keep structured output regardless.
    const A = { type: "object", properties: { x: { type: "string", format: "unknown-format" } }, additionalProperties: false };
    const { client, recorded } = queuedClient([{ error: schemaError() }, { text: '{"x":"1"}' }, { text: '{"a":"1"}' }]);
    await callForJson(client, "claude-sonnet-5", "s", [{ role: "user", content: "u" }], A);
    await callForJson(client, "claude-sonnet-5", "s", [{ role: "user", content: "u" }], CLOSED);
    expect(recorded).toHaveLength(3);
    expect(recorded[1].body.output_config).toBeUndefined(); // A retried plain
    expect((recorded[2].body.output_config as { format?: unknown }).format).toBeDefined(); // B still structured
  });
});

describe("max_tokens", () => {
  test("a cut-off reply is reported as such, not as bad JSON", async () => {
    const { client } = queuedClient([{ text: '{"a":"1', stop_reason: "max_tokens" }]);
    await expect(callForJson(client, "claude-sonnet-5", "s", [{ role: "user", content: "u" }], CLOSED)).rejects.toThrow(/cut off/);
  });
});

describe("invalid JSON gets one mechanical repair round", () => {
  test("the repaired reply is used", async () => {
    const { client, recorded } = queuedClient([{ text: 'Sure! {"a": "1",}' }, { text: '{"a":"1"}' }]);
    const { json, meta } = await callForJson(client, "claude-opus-5", "s", [{ role: "user", content: "u" }], OPEN);
    expect(json).toEqual({ a: "1" });
    expect(meta.jsonRepaired).toBe(true);
    expect(recorded).toHaveLength(2);
    const repair = recorded[1].body;
    expect(repair.model).toBe("claude-sonnet-5"); // mechanical → the repair model
    expect((repair.output_config as { effort?: string }).effort).toBe("low");
    const msgs = repair.messages as { role: string; content: string }[];
    expect(msgs[msgs.length - 2]).toEqual({ role: "assistant", content: 'Sure! {"a": "1",}' });
    expect(msgs[msgs.length - 1].content).toMatch(/not valid JSON/);
  });

  test("a second bad reply fails with the parse error and the reply's head", async () => {
    const { client } = queuedClient([{ text: "no json here" }, { text: "still none" }]);
    await expect(callForJson(client, "claude-opus-5", "s", [{ role: "user", content: "u" }], OPEN)).rejects.toThrow(/not valid JSON[\s\S]*still none/);
  });

  test("an empty reply is not sent back for repair", async () => {
    const { client, recorded } = queuedClient([{ text: "" }]);
    await expect(callForJson(client, "claude-opus-5", "s", [{ role: "user", content: "u" }], OPEN)).rejects.toThrow(/empty/);
    expect(recorded).toHaveLength(1);
  });
});
