// The automatic template-on-demand path in the editor (checkbox on) must run
// AFTER generate() has released its busy flag: authorTemplateAndRedraw guards
// itself with blockedByAi, so awaited from inside generate()'s try it refused
// every time — "An AI call is still running — wait for it to finish before
// authoring a template" (Hans, 2026-09-09) — and the automatic path never
// ran. No DOM in vitest, so this pins the SOURCE: the order of the two calls.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function generateBody(): Promise<string> {
  const src = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const start = src.indexOf("async function generate(): Promise<void> {");
  expect(start).toBeGreaterThan(0);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end);
}

describe("the automatic authoring runs after generate() is no longer busy", () => {
  it("generate() never awaits authorTemplateAndRedraw inside its busy span", async () => {
    const body = await generateBody();
    expect(body).not.toMatch(/await authorTemplateAndRedraw\(/);
  });
  it("the deferred call comes after the finally that clears the busy flag", async () => {
    const body = await generateBody();
    const release = body.lastIndexOf("setAiBusy(false)");
    const run = body.indexOf("if (authorNext) await authorNext()");
    expect(release).toBeGreaterThan(0);
    expect(run).toBeGreaterThan(release);
  });
  it("authorTemplateAndRedraw keeps its own guard — the offer clicked mid-call must still be refused", async () => {
    const src = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    const start = src.indexOf("async function authorTemplateAndRedraw(");
    const head = src.slice(start, start + 600);
    expect(head).toContain('blockedByAi("authoring a template")');
  });
});
