import { beforeEach, describe, expect, test, vi } from "vitest";

// store.ts touches localStorage at call time — give the node env a real-enough stub
// (same pattern as tests/my-templates.test.ts).
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

// Every remote-packs test is offline: fetch is a mock the tests drive explicitly.
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { loadRemotePacks, saveRemotePack, deleteRemotePack } from "../src/store";
import {
  OFFICIAL_INDEX_URL,
  fetchOfficialIndex,
  fetchRemotePackYaml,
  registerRemotePackYaml,
  registerCachedRemotePacksAtStartup,
  unregisterRemotePack,
} from "../src/scenes/remote-packs";
import { unregisterPack, isPackTemplateId } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";

const REMOTE_YAML = `
pack: demo_pack
title: Demo Pack
description: A tiny demo pack for tests.
---
template: remote_widget_a
version: 1
kit: 1
status: ready
description: A demo widget.
params: { type: object }
element_ids: { dot: the dot }
examples:
  - request: "Draw widget A."
    params: {}
layout: |
  return { drawables: [kit.stroke("dot", [[500, 400]], { shapeHint: { type: "circle", c: [500, 400], r: 10 } })], labels: [], anchors: {}, order: ["dot"] };
---
template: remote_widget_b
version: 1
kit: 1
status: ready
description: Another demo widget.
params: { type: object }
element_ids: { dot: the dot }
examples:
  - request: "Draw widget B."
    params: {}
layout: |
  return { drawables: [kit.stroke("dot", [[500, 400]], { shapeHint: { type: "circle", c: [500, 400], r: 10 } })], labels: [], anchors: {}, order: ["dot"] };
`;

beforeEach(() => {
  mem.clear();
  fetchMock.mockReset();
  unregisterPack("demo_pack");
});

describe("store: remote packs", () => {
  test("save/load/delete round-trip, upsert by url, newest first", () => {
    saveRemotePack({ url: "https://a.example/x.yaml", id: "a", yaml: "ya", ts: "1", enabled: true });
    saveRemotePack({ url: "https://b.example/x.yaml", id: "b", yaml: "yb", ts: "2", enabled: false });
    saveRemotePack({ url: "https://a.example/x.yaml", id: "a", yaml: "ya2", ts: "3", enabled: true });
    const all = loadRemotePacks();
    expect(all.map((e) => e.url)).toEqual(["https://a.example/x.yaml", "https://b.example/x.yaml"]);
    expect(all[0].yaml).toBe("ya2");
    deleteRemotePack("https://a.example/x.yaml");
    expect(loadRemotePacks().map((e) => e.url)).toEqual(["https://b.example/x.yaml"]);
  });
});

describe("registerRemotePackYaml", () => {
  test("happy path: parses via parsePack, registers via registerPack, under the pack's OWN id", () => {
    const r = registerRemotePackYaml("https://example.com/demo.yaml", REMOTE_YAML);
    expect(r.ok).toBe(true);
    expect(r.id).toBe("demo_pack");
    expect(scenes.remote_widget_a.layout).toBeDefined();
    expect(scenes.remote_widget_b.layout).toBeDefined();
    expect(isPackTemplateId("remote_widget_a")).toBe(true);
  });

  test("a template id colliding with an existing registry entry rolls the WHOLE pack back", () => {
    const clash = REMOTE_YAML.replace("template: remote_widget_b", "template: supply_demand");
    const before = scenes.supply_demand;
    const r = registerRemotePackYaml("https://example.com/demo.yaml", clash);
    expect(r.ok).toBe(false);
    expect(scenes.supply_demand).toBe(before); // untouched
    expect(scenes.remote_widget_a).toBeUndefined(); // rolled back with the rest of the pack
    expect(isPackTemplateId("remote_widget_a")).toBe(false);
  });
});

describe("registerCachedRemotePacksAtStartup", () => {
  test("registers ONLY enabled entries, from the cache — fetch is never called", () => {
    saveRemotePack({ url: "https://example.com/demo.yaml", id: "demo_pack", yaml: REMOTE_YAML, ts: "1", enabled: true });
    saveRemotePack({ url: "https://example.com/off.yaml", id: "off_pack", yaml: "pack: off_pack\ntitle: x\ndescription: x\n", ts: "2", enabled: false });

    const results = registerCachedRemotePacksAtStartup();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(results).toHaveLength(1); // the disabled entry was never even attempted
    expect(results[0]).toMatchObject({ url: "https://example.com/demo.yaml", ok: true });
    expect(scenes.remote_widget_a.layout).toBeDefined();
  });

  test("a cached-registration failure is reported per-entry, not thrown", () => {
    saveRemotePack({ url: "https://example.com/broken.yaml", id: "broken", yaml: "pack: [broken", ts: "1", enabled: true });

    const results = registerCachedRemotePacksAtStartup();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(results[0].ok).toBe(false);
    expect(results[0].errors.length).toBeGreaterThan(0);
  });
});

describe("unregisterRemotePack", () => {
  test("looks up the cached entry's id and unregisters — no re-parse of the yaml needed", () => {
    saveRemotePack({ url: "https://example.com/demo.yaml", id: "demo_pack", yaml: REMOTE_YAML, ts: "1", enabled: true });
    registerRemotePackYaml("https://example.com/demo.yaml", REMOTE_YAML);
    expect(scenes.remote_widget_a).toBeDefined();

    unregisterRemotePack("https://example.com/demo.yaml");

    expect(scenes.remote_widget_a).toBeUndefined();
    expect(scenes.remote_widget_b).toBeUndefined();
  });

  test("a url with no cached entry is a no-op", () => {
    expect(() => unregisterRemotePack("https://nope.example/x.yaml")).not.toThrow();
  });
});

describe("fetchRemotePackYaml", () => {
  test("rejects http:// URLs WITHOUT calling fetch", async () => {
    await expect(fetchRemotePackYaml("http://example.com/x.yaml")).rejects.toThrow(/https/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects a payload over the 500k char cap", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "x".repeat(500_001) });
    await expect(fetchRemotePackYaml("https://example.com/big.yaml")).rejects.toThrow(/too large/);
  });

  test("returns the body text on a normal https 200", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "pack: x\ntitle: x\ndescription: x\n" });
    const yaml = await fetchRemotePackYaml("https://example.com/x.yaml");
    expect(yaml).toBe("pack: x\ntitle: x\ndescription: x\n");
  });

  test("throws (with the status) on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "" });
    await expect(fetchRemotePackYaml("https://example.com/missing.yaml")).rejects.toThrow(/404/);
  });
});

describe("fetchOfficialIndex", () => {
  test("a well-formed array passes through", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ id: "showcase", title: "Showcase", description: "d", url: "https://raw.githubusercontent.com/x/index.json" }],
    });
    const entries = await fetchOfficialIndex();
    expect(entries).toEqual([{ id: "showcase", title: "Showcase", description: "d", url: "https://raw.githubusercontent.com/x/index.json" }]);
  });

  test("an entry missing the url field throws", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ id: "showcase", title: "Showcase", description: "d" }],
    });
    await expect(fetchOfficialIndex()).rejects.toThrow();
  });

  test("a non-array response throws", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ not: "an array" }) });
    await expect(fetchOfficialIndex()).rejects.toThrow(/array/);
  });

  test("OFFICIAL_INDEX_URL points at the official drawcast-templates repo", () => {
    expect(OFFICIAL_INDEX_URL).toBe("https://raw.githubusercontent.com/hmelberg/drawcast-templates/main/index.json");
  });
});
