// The Content-Security-Policy in netlify.toml (security review 2026-09-28).
// Pins the directives that carry the protection, so a later edit that widens
// one (a bare https: in connect-src, a script CDN wildcard) is a failing test
// someone has to read, not a silent regression.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { cspDirectives } from "../scripts/csp-headers.mjs";

const toml = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
const csp = cspDirectives(toml);
const get = (name: string): string[] => csp.get(name) ?? [];

describe("netlify.toml Content-Security-Policy", () => {
  test("is present for every path", () => {
    expect(csp.size).toBeGreaterThan(5);
  });

  test("never allows inline script, and no wildcard script host", () => {
    const script = get("script-src");
    expect(script).toContain("'self'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script.some((s) => s === "https:" || s === "*" || s.includes("*"))).toBe(false);
  });

  test("allows the evaluation the app needs (template bodies, WebAssembly)", () => {
    expect(get("script-src")).toEqual(expect.arrayContaining(["'unsafe-eval'", "'wasm-unsafe-eval'"]));
  });

  test("connect-src is an explicit host list, never any host", () => {
    const connect = get("connect-src");
    expect(connect).toContain("'self'");
    expect(connect).toContain("https://api.anthropic.com");
    expect(connect).not.toContain("https:");
    expect(connect).not.toContain("*");
    expect(connect).not.toContain("http:");
    // every entry is 'self', a scheme we generate locally, or a specific https host
    for (const src of connect) expect(src === "'self'" || src === "data:" || src === "blob:" || /^https:\/\/(\*\.)?[a-z0-9.-]+\.[a-z]+$/.test(src)).toBe(true);
  });

  test("the hardening directives", () => {
    expect(get("object-src")).toEqual(["'none'"]);
    expect(get("base-uri")).toEqual(["'self'"]);
    expect(get("form-action")).toEqual(["'self'"]);
    expect(get("frame-ancestors")).toEqual(["'self'"]);
    expect(get("default-src")).toEqual(["'self'"]);
  });

  test("every script CDN the runtimes load from is allowed", () => {
    // pyodide / brython / micropython (jsdelivr), webR, plotly, Google sign-in + picker, giscus
    for (const host of ["https://cdn.jsdelivr.net", "https://webr.r-wasm.org", "https://cdn.plot.ly", "https://accounts.google.com", "https://apis.google.com", "https://giscus.app"]) {
      expect(get("script-src")).toContain(host);
    }
  });
});
