import { describe, expect, it, vi } from "vitest";
import { PublishError, parseRepo, preflight } from "../src/publish/github";

describe("parseRepo", () => {
  it("reads owner/repo", () => {
    expect(parseRepo("hmelberg/kurs")).toEqual({ owner: "hmelberg", repo: "kurs" });
  });

  it("accepts a full GitHub URL", () => {
    expect(parseRepo("https://github.com/hmelberg/kurs")).toEqual({ owner: "hmelberg", repo: "kurs" });
  });

  it("trims a trailing slash and .git", () => {
    expect(parseRepo("hmelberg/kurs.git")).toEqual({ owner: "hmelberg", repo: "kurs" });
    expect(parseRepo("hmelberg/kurs/")).toEqual({ owner: "hmelberg", repo: "kurs" });
  });

  it("rejects nonsense", () => {
    expect(parseRepo("kurs")).toBeNull();
    expect(parseRepo("")).toBeNull();
  });
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => "" }) as Response;
const fail = (status: number) => ({ ok: false, status, json: async () => ({}), text: async () => "" }) as Response;

describe("preflight", () => {
  it("returns the default branch", async () => {
    const f = vi.fn(async () => ok({ private: false, default_branch: "main" }));
    expect(await preflight({ owner: "o", repo: "r" }, "t", f as unknown as typeof fetch)).toEqual({ defaultBranch: "main" });
  });

  it("reads the real default branch rather than assuming main", async () => {
    const f = vi.fn(async () => ok({ private: false, default_branch: "trunk" }));
    expect((await preflight({ owner: "o", repo: "r" }, "t", f as unknown as typeof fetch)).defaultBranch).toBe("trunk");
  });

  it("refuses a private repo, because raw.githubusercontent cannot serve it", async () => {
    const f = vi.fn(async () => ok({ private: true, default_branch: "main" }));
    await expect(preflight({ owner: "o", repo: "r" }, "t", f as unknown as typeof fetch)).rejects.toThrow(/public/);
  });

  it("explains a 404 as a missing repo or a token without access", async () => {
    const f = vi.fn(async () => fail(404));
    await expect(preflight({ owner: "o", repo: "r" }, "t", f as unknown as typeof fetch)).rejects.toThrow(PublishError);
  });

  it("explains a 401 as a bad token", async () => {
    const f = vi.fn(async () => fail(401));
    await expect(preflight({ owner: "o", repo: "r" }, "t", f as unknown as typeof fetch)).rejects.toThrow(/token/i);
  });
});
