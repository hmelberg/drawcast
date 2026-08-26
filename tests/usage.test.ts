// Vended-key soft caps: per-browser monthly ledger, gated on key provenance.

import { beforeEach, describe, expect, test, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

import {
  ANTHROPIC_MONTHLY_TOKEN_CAP,
  TTS_MONTHLY_CHAR_CAP,
  addAnthropicTokens,
  addTtsChars,
  anthropicBudgetError,
  loadUsage,
  loadVendedFlags,
  setVendedFlags,
  ttsBudgetError,
  usageSummary,
} from "../src/store";

beforeEach(() => mem.clear());

describe("usage ledger", () => {
  test("accumulates within the current month", () => {
    addAnthropicTokens(1000);
    addAnthropicTokens(500);
    addTtsChars(42);
    const u = loadUsage();
    expect(u.anthropicTokens).toBe(1500);
    expect(u.ttsChars).toBe(42);
  });

  test("negative additions are ignored", () => {
    addAnthropicTokens(-99);
    expect(loadUsage().anthropicTokens).toBe(0);
  });

  test("a stored ledger from another month resets", () => {
    mem.set("drawcast.usage.v2", JSON.stringify({ month: "1999-01", anthropicTokens: 999999999, ttsChars: 999999 }));
    const u = loadUsage();
    expect(u.anthropicTokens).toBe(0);
    expect(u.ttsChars).toBe(0);
  });
});

describe("budget gating by key provenance", () => {
  test("own keys are never capped, even far over the numbers", () => {
    setVendedFlags({ anthropic: false, tts: false });
    addAnthropicTokens(ANTHROPIC_MONTHLY_TOKEN_CAP * 2);
    addTtsChars(TTS_MONTHLY_CHAR_CAP * 2);
    expect(anthropicBudgetError()).toBeNull();
    expect(ttsBudgetError()).toBeNull();
  });

  test("vended keys pass under the cap and refuse over it", () => {
    setVendedFlags({ anthropic: true, tts: true });
    expect(anthropicBudgetError()).toBeNull();
    expect(ttsBudgetError()).toBeNull();
    addAnthropicTokens(ANTHROPIC_MONTHLY_TOKEN_CAP);
    addTtsChars(TTS_MONTHLY_CHAR_CAP);
    expect(anthropicBudgetError()).toMatch(/allowance is used up/);
    expect(ttsBudgetError()).toMatch(/allowance is used up/);
  });

  test("the two services gate independently", () => {
    setVendedFlags({ anthropic: true, tts: false });
    addAnthropicTokens(ANTHROPIC_MONTHLY_TOKEN_CAP);
    addTtsChars(TTS_MONTHLY_CHAR_CAP);
    expect(anthropicBudgetError()).not.toBeNull();
    expect(ttsBudgetError()).toBeNull(); // tts key is the user's own
  });
});

describe("flags and summary", () => {
  test("flags default to own keys", () => {
    expect(loadVendedFlags()).toEqual({ anthropic: false, tts: false });
  });

  test("summary is empty for own keys, populated for vended", () => {
    expect(usageSummary()).toBe("");
    setVendedFlags({ anthropic: true, tts: true });
    addAnthropicTokens(1234);
    expect(usageSummary()).toContain("1,234");
    expect(usageSummary()).toContain("tokens");
    expect(usageSummary()).toContain("voice characters");
  });
});

test("caps are generous and distinct", () => {
  expect(ANTHROPIC_MONTHLY_TOKEN_CAP).toBe(2_000_000);
  expect(TTS_MONTHLY_CHAR_CAP).toBe(250_000);
});
