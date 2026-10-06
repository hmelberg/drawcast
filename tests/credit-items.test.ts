// Names and unlisting paid in credits (credit plan delivery 3).
import { describe, expect, test } from "vitest";
import { describeRow } from "../src/credit";
import { startNamePayment } from "../src/names";
import { startPrivatePayment } from "../src/registry";

const replying = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const reg = { key: "k", name: "my-course", kind: "course" as const, target: "o/r/c", return: "https://drawcast.app/" };
const unlist = { key: "k", kind: "cast" as const, target: "o/r/c.cast", title: "T", lectures: 1, private: false, listed: false, return: "https://drawcast.app/" };

describe("paying from credit", () => {
  test("a name paid from credit answers what it cost; 402 says the balance is short", async () => {
    expect(await startNamePayment("https://a", { ...reg, pay: "credits" }, replying(200, { paid: "credits", name: "my-course", credits: 500 }))).toEqual({ paidCredits: 500 });
    expect(await startNamePayment("https://a", { ...reg, pay: "credits" }, replying(402, { error: "credit" }))).toBe("credit");
    expect(await startNamePayment("https://a", reg, replying(200, { url: "https://stripe" }))).toEqual({ url: "https://stripe" });
  });

  test("unlisting paid from credit, or short", async () => {
    expect(await startPrivatePayment("https://a", { ...unlist, pay: "credits" }, replying(200, { paid: "credits", listed: false, credits: 300 }))).toEqual({ paidCredits: 300 });
    expect(await startPrivatePayment("https://a", { ...unlist, pay: "credits" }, replying(402, {}))).toBe("credit");
  });

  test("the statement names what was bought", () => {
    expect(describeRow({ at: null, reason: "name", credits: -500, note: { name: "my-course" } as never })).toBe("Name drawcast.app/#my-course");
    expect(describeRow({ at: null, reason: "unlisted", credits: -300, note: null })).toBe("Unlisted");
  });
});
