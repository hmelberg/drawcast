// A single freehand figure never starts automatic template authoring — it
// only ever OFFERS (spec §5.5, freehand round Task 9): the checkbox that
// used to run authoring automatically now applies to course/multi-part runs
// only (llm/multi.ts authorTemplatesForParts), never to the single-figure
// trigger in generate(). No DOM in vitest, so this pins the SOURCE.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function generateBody(): Promise<string> {
  const src = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const start = src.indexOf("async function generate(): Promise<void> {");
  expect(start).toBeGreaterThan(0);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end);
}

describe("the single-figure trigger always offers, never auto-authors", () => {
  it("generate() never calls authorTemplateAndRedraw except from the offer's own click handler", async () => {
    const body = await generateBody();
    expect(body).not.toMatch(/await authorTemplateAndRedraw\(/);
    // The one call left is inside the button's click callback (void, not awaited by generate()).
    expect(body).toMatch(/void authorTemplateAndRedraw\(/);
  });
  it("the templateWorthy block no longer branches on settings.templatesOnDemand", async () => {
    const body = await generateBody();
    const at = body.indexOf("templateWorthy(outcome.spec)");
    expect(at).toBeGreaterThan(0);
    const block = body.slice(at, at + 600);
    expect(block).not.toMatch(/settings\.templatesOnDemand/);
    expect(block).toContain("setStatusAction(");
  });
  it("authorTemplateAndRedraw keeps its own guard — the offer clicked mid-call must still be refused", async () => {
    const src = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    const start = src.indexOf("async function authorTemplateAndRedraw(");
    const head = src.slice(start, start + 600);
    expect(head).toContain('blockedByAi("authoring a template")');
  });
});
