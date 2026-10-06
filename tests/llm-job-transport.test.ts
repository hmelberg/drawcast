import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { LlmCreditError, onJobStatus, pollDelay, runJob, type JobDeps, type JobStatus } from "../src/llm/job-transport";

type Reply = { status?: number; body: unknown };

function fakeDeps(script: Record<string, Reply[]>, token = "tok"): { deps: JobDeps; calls: { path: string; body: Record<string, unknown> }[] } {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let clock = 0;
  const deps: JobDeps = {
    api: "https://anvil.test",
    token: () => token,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetch: (async (url: string, init: RequestInit) => {
      const path = String(url).replace("https://anvil.test/_/api", "");
      calls.push({ path, body: JSON.parse(String(init.body)) });
      const queue = script[path] ?? [];
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      if (!next) throw new Error("no script for " + path);
      return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
    }) as unknown as typeof fetch,
  };
  return { deps, calls };
}

const request = { model: "claude-haiku-4-5", max_tokens: 100, messages: [{ role: "user", content: "hi" }] };

describe("runJob", () => {
  it("starts, polls the text in by offset and returns a Message", async () => {
    const { deps, calls } = fakeDeps({
      "/llm/start": [{ body: { job: "j1", held_micro: 5000 } }],
      "/llm/poll": [
        { body: { phase: "queued", text: "", offset: 0, final: false } },
        { body: { phase: "writing", text: "Hel", offset: 3, final: false } },
        { body: { phase: "done", text: "lo", offset: 5, final: true, model: "claude-haiku-4-5", stop_reason: "end_turn", usage: { input_tokens: 4, output_tokens: 2 }, charged_micro: 120 } },
      ],
    });
    const deltas: string[] = [];
    let first = 0;
    const msg = await runJob(request, [], { onDelta: (d) => deltas.push(d), onFirstEvent: () => first++ }, deps);
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(first).toBe(1);
    expect(msg.content).toEqual([{ type: "text", text: "Hello", citations: null }]);
    expect(msg.usage).toEqual({ input_tokens: 4, output_tokens: 2 });
    expect(msg.stop_reason).toBe("end_turn");
    expect(calls[0]).toEqual({ path: "/llm/start", body: { key: "tok", request, betas: [] } });
    expect(calls.slice(1).map((c) => c.body.from)).toEqual([0, 0, 3]);
  });

  it("a 402 is a credit error with both numbers", async () => {
    const { deps } = fakeDeps({ "/llm/start": [{ status: 402, body: { error: "credit", needed_micro: 120_000, balance_micro: 30_000 } }] });
    const err = await runJob(request, [], {}, deps).catch((e) => e);
    expect(err).toBeInstanceOf(LlmCreditError);
    expect(err.message).toContain("about 12 credits");
    expect(err.message).toContain("3 are left");
  });

  it("a refused request is the SDK's BadRequestError, so createMessage's degradation still works", async () => {
    const { deps } = fakeDeps({ "/llm/start": [{ status: 400, body: { error: "bad", field: "betas" } }] });
    const err = await runJob(request, [], {}, deps).catch((e) => e);
    expect(err).toBeInstanceOf(Anthropic.BadRequestError);
  });

  it("an Anthropic 400 from the job is a BadRequestError too", async () => {
    const { deps } = fakeDeps({
      "/llm/start": [{ body: { job: "j" } }],
      "/llm/poll": [{ body: { phase: "failed", final: true, error: { status: 400, type: "invalid_request_error", message: "output_config.format.schema bad" } } }],
    });
    const err = await runJob(request, [], {}, deps).catch((e) => e);
    expect(err).toBeInstanceOf(Anthropic.BadRequestError);
    expect(err.message).toContain("schema");
  });

  it("an overloaded call with no text is retried, a new job each time", async () => {
    const { deps, calls } = fakeDeps({
      "/llm/start": [{ body: { job: "a" } }, { body: { job: "b" } }],
      "/llm/poll": [
        { body: { phase: "failed", final: true, error: { status: 529, type: "overloaded_error", message: "busy" } } },
        { body: { phase: "done", text: "ok", offset: 2, final: true, usage: {} } },
      ],
    });
    const msg = await runJob(request, [], {}, deps);
    expect(msg.content[0]).toMatchObject({ text: "ok" });
    expect(calls.filter((c) => c.path === "/llm/start")).toHaveLength(2);
  });

  it("a failure after text arrived is not retried (it was charged and shown)", async () => {
    const { deps, calls } = fakeDeps({
      "/llm/start": [{ body: { job: "a" } }],
      "/llm/poll": [
        { body: { phase: "writing", text: "par", offset: 3, final: false } },
        { body: { phase: "failed", final: true, error: { status: 529, type: "overloaded_error", message: "busy" } } },
      ],
    });
    await expect(runJob(request, [], {}, deps)).rejects.toBeInstanceOf(Anthropic.APIError);
    expect(calls.filter((c) => c.path === "/llm/start")).toHaveLength(1);
  });

  it("an abort cancels the job and throws the SDK's abort error", async () => {
    const ac = new AbortController();
    const { deps, calls } = fakeDeps({
      "/llm/start": [{ body: { job: "j9" } }],
      "/llm/poll": [{ body: { phase: "thinking", final: false } }],
      "/llm/cancel": [{ body: { ok: true } }],
    });
    const p = runJob(request, [], { signal: ac.signal, onFirstEvent: () => ac.abort() }, deps);
    await expect(p).rejects.toBeInstanceOf(Anthropic.APIUserAbortError);
    expect(calls.at(-1)).toEqual({ path: "/llm/cancel", body: { key: "tok", job: "j9" } });
  });

  it("without a session it asks the author to sign in or add a key", async () => {
    const { deps } = fakeDeps({}, "");
    await expect(runJob(request, [], {}, deps)).rejects.toThrow(/Sign in to use credit/);
  });

  it("publishes each poll's phase and, at the end, the charge", async () => {
    const seen: JobStatus[] = [];
    const off = onJobStatus((s) => seen.push(s));
    const { deps } = fakeDeps({
      "/llm/start": [{ body: { job: "j" } }],
      "/llm/poll": [
        { body: { phase: "thinking", final: false } },
        { body: { phase: "done", text: "x", offset: 1, final: true, usage: {}, charged_micro: 2_345_678 } },
      ],
    });
    await runJob(request, [], {}, deps);
    off();
    expect(seen.map((s) => s.phase)).toEqual(["starting", "thinking", "done"]);
    expect(seen.at(-1)!.chargedCredits).toBe(234.57);
  });
});

describe("pollDelay", () => {
  it("polls fast for three seconds, then once a second", () => {
    expect(pollDelay(0)).toBe(300);
    expect(pollDelay(2999)).toBe(300);
    expect(pollDelay(3000)).toBe(1000);
  });
});
