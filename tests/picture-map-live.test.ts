// A LIVE check of picture mapping against the real API — skipped unless
// DRAWCAST_LIVE_KEY is set (never run in CI or the ordinary suite; it costs a
// few cents). It maps the two example pictures and compares the boxes with
// the ones measured by hand for the examples (spec §9), printing both.
//
//   DRAWCAST_LIVE_KEY=sk-ant-… npx vitest run tests/picture-map-live.test.ts
import { describe, expect, test } from "vitest";
import { makeClient, planningModelFor } from "../src/llm/client";
import { mapPicture, type MapOptions } from "../src/llm/picture-map";

const key = process.env.DRAWCAST_LIVE_KEY;
const noCache = { cacheGet: async () => null, cachePut: async () => undefined };

/** Centre distance between two [x, y, w, h] boxes, in picture fractions. */
const off = (a: number[], b: number[]) => Math.hypot(a[0] + a[2] / 2 - (b[0] + b[2] / 2), a[1] + a[3] / 2 - (b[1] + b[3] / 2));

const cases: { name: string; url: string; opts: MapOptions; hand: Record<string, number[]> }[] = [
  {
    name: "microdata command window",
    url: "https://microdata.no/manual/assets/images/image79-3a6b840c804b98810159afecdbdab29c.png",
    opts: { detail: "few", kinds: ["areas", "controls"], find: ["dataset panel", "register variables panel", "search field", "results area", "command line"] },
    hand: { datasets: [0, 0.069, 0.2, 0.466], variables: [0, 0.535, 0.2, 0.465], filter: [0, 0.562, 0.2, 0.02], results: [0.2, 0.069, 0.8, 0.9], command_line: [0.2, 0.97, 0.8, 0.03] },
  },
  {
    name: "Arnolfini Portrait",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Van_Eyck_-_Arnolfini_Portrait.jpg/1920px-Van_Eyck_-_Arnolfini_Portrait.jpg",
    opts: { detail: "few", kinds: ["areas"], find: ["convex mirror", "chandelier", "dog", "signature on the wall"] },
    hand: { mirror: [0.425, 0.241, 0.16, 0.117], chandelier: [0.37, 0, 0.286, 0.198], dog: [0.365, 0.823, 0.208, 0.16], signature: [0.417, 0.194, 0.188, 0.038] },
  },
];

describe.skipIf(!key)("live picture mapping", () => {
  // mapPicture swallows every failure into null (the app degrades quietly);
  // here a bad key or model must say so plainly before the picture tests run.
  test("the key and model answer", { timeout: 60_000 }, async () => {
    expect(key!, "DRAWCAST_LIVE_KEY looks like a placeholder, not a real key").toMatch(/^sk-ant-[\x21-\x7e]+$/);
    const client = makeClient(key!);
    const reply = await client.messages.create({ model: planningModelFor("claude-opus-5-5"), max_tokens: 8, messages: [{ role: "user", content: "Say ok." }] });
    expect(reply.content.length).toBeGreaterThan(0);
  });
  for (const c of cases) {
    test(c.name, { timeout: 120_000 }, async () => {
      const map = await mapPicture(c.url, c.opts, { client: makeClient(key!), model: planningModelFor("claude-opus-5-5"), ...noCache });
      expect(map).not.toBeNull();
      console.log(`\n${c.name}: ${map!.regions.length} parts; not found: ${map!.notFound.join(", ") || "—"}`);
      for (const r of map!.regions) console.log(`  ${r.name.padEnd(24)} ${r.kind.padEnd(8)} [${r.box.join(", ")}]${r.label ? `  "${r.label}"` : ""}`);
      // Report how close the model came to each hand-measured box (by the nearest found part).
      for (const [name, box] of Object.entries(c.hand)) {
        const nearest = Math.min(...map!.regions.map((r) => off(r.box, box)));
        console.log(`  hand ${name.padEnd(14)} nearest found part centre is ${(nearest * 100).toFixed(1)}% of the picture away`);
      }
      expect(map!.regions.length).toBeGreaterThan(0);
    });
  }
});
