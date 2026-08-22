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
  OFFICIAL_PACK_URL_PREFIX,
  fetchOfficialIndex,
  fetchRemotePackYaml,
  isOfficialPackUrl,
  registerRemotePackYaml,
  registerCachedRemotePacksAtStartup,
  unregisterRemotePack,
} from "../src/scenes/remote-packs";
import { registerPack, unregisterPack, isPackTemplateId } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import physicsYaml from "../src/scenes/packs/physics.yaml?raw";

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

// A remote pack whose header id collides with a BUILT-IN pack's id ("physics").
const PHYSICS_COLLISION_YAML = `
pack: physics
title: Fake Physics
description: Attempts to claim the built-in physics pack's id.
---
template: fake_physics_widget
version: 1
kit: 1
status: ready
description: A widget.
params: { type: object }
element_ids: { dot: the dot }
examples:
  - request: "Draw it."
    params: {}
layout: |
  return { drawables: [kit.stroke("dot", [[500, 400]], { shapeHint: { type: "circle", c: [500, 400], r: 10 } })], labels: [], anchors: {}, order: ["dot"] };
`;

beforeEach(() => {
  mem.clear();
  fetchMock.mockReset();
  unregisterPack("demo_pack");
  unregisterPack("physics");
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

describe("registerRemotePackYaml: pack-id collisions across sources (review fix round 1)", () => {
  test("a DIFFERENT url claiming an already-owned pack id is refused — the first pack's templates stay live", () => {
    const first = registerRemotePackYaml("https://example.com/demo.yaml", REMOTE_YAML);
    expect(first.ok).toBe(true);
    saveRemotePack({ url: "https://example.com/demo.yaml", id: "demo_pack", yaml: REMOTE_YAML, ts: "1", enabled: true });

    const otherYaml = REMOTE_YAML.replace(/remote_widget_a/g, "remote_widget_c").replace(/remote_widget_b/g, "remote_widget_d");
    const second = registerRemotePackYaml("https://other.example/demo2.yaml", otherYaml);

    expect(second.ok).toBe(false);
    expect(second.id).toBe("demo_pack");
    expect(second.errors.join(" ")).toMatch(/already in use/);

    // The FIRST pack's templates are untouched and still functional — this
    // is the exact bug the fix closes: registerPack's own idempotent
    // short-circuit would otherwise report phantom success for the SECOND
    // url here, and a later Remove on that phantom entry would delete the
    // FIRST pack's real, live templates.
    expect(scenes.remote_widget_a.layout).toBeDefined();
    expect(scenes.remote_widget_b.layout).toBeDefined();
    expect(scenes.remote_widget_c).toBeUndefined();
    expect(scenes.remote_widget_d).toBeUndefined();
  });

  test("the SAME url re-registering the same pack id REPLACES — the new template set is visible, the old one is gone", () => {
    saveRemotePack({ url: "https://example.com/demo.yaml", id: "demo_pack", yaml: REMOTE_YAML, ts: "1", enabled: true });
    const first = registerRemotePackYaml("https://example.com/demo.yaml", REMOTE_YAML);
    expect(first.ok).toBe(true);
    expect(scenes.remote_widget_a).toBeDefined();
    expect(scenes.remote_widget_b).toBeDefined();

    const updatedYaml = REMOTE_YAML.replace("template: remote_widget_b", "template: remote_widget_c");
    const second = registerRemotePackYaml("https://example.com/demo.yaml", updatedYaml);

    expect(second.ok).toBe(true);
    expect(scenes.remote_widget_a.layout).toBeDefined(); // unchanged template, still there
    expect(scenes.remote_widget_c.layout).toBeDefined(); // the renamed template is now registered
    expect(scenes.remote_widget_b).toBeUndefined(); // the old id is truly gone — a real replace, not additive
  });

  test("a pack id colliding with a registered BUILT-IN pack is refused", () => {
    const physics = registerPack("physics", physicsYaml);
    expect(physics.ok).toBe(true);

    const r = registerRemotePackYaml("https://example.com/fake-physics.yaml", PHYSICS_COLLISION_YAML);

    expect(r.ok).toBe(false);
    expect(r.id).toBe("physics");
    expect(r.errors.join(" ")).toMatch(/already in use/);
    // The REAL built-in physics templates are untouched.
    expect(scenes.ray_diagram.layout).toBeDefined();
    expect(scenes.fake_physics_widget).toBeUndefined();
  });

  test("review fix round 2: a same-url replace whose fresh registration fails is SELF-RESTORING — ok:false, unloaded falsy, the previous version stays live and functional", () => {
    saveRemotePack({ url: "https://example.com/demo.yaml", id: "demo_pack", yaml: REMOTE_YAML, ts: "1", enabled: true });
    const first = registerRemotePackYaml("https://example.com/demo.yaml", REMOTE_YAML);
    expect(first.ok).toBe(true);
    expect(scenes.remote_widget_a.layout).toBeDefined();
    expect(scenes.remote_widget_b.layout).toBeDefined();
    const beforeSupplyDemand = scenes.supply_demand;

    // A same-url "refresh" attempt whose new content collides with an
    // already-registered (built-in) template id — registerPack must fail,
    // and reachable via the ordinary loadAndRegisterRemotePack path (no
    // caller-side restore logic there, unlike main.ts's Refresh handler).
    const badYaml = REMOTE_YAML.replace("template: remote_widget_b", "template: supply_demand");
    const second = registerRemotePackYaml("https://example.com/demo.yaml", badYaml);

    expect(second.ok).toBe(false);
    expect(second.unloaded).toBeFalsy();
    expect(second.errors.join(" ")).toMatch(/previous version was kept/);
    // The restore worked: both original templates are back, and the
    // built-in supply_demand this attempt tried to steal was never actually
    // clobbered (registerPack's own per-pack rollback already guaranteed
    // that mid-attempt; this asserts the OUTER self-restore too).
    expect(scenes.remote_widget_a.layout).toBeDefined();
    expect(scenes.remote_widget_b.layout).toBeDefined();
    expect(scenes.supply_demand).toBe(beforeSupplyDemand);
  });

  test("review fix round 2: a same-url replace whose fresh registration AND restore BOTH fail reports unloaded:true and registers nothing", () => {
    // Simulate a cache that has drifted from what's actually live (e.g.
    // edited/corrupted out of band) so the restore attempt can genuinely
    // fail too, not just the fresh one.
    const live = registerPack("demo_pack", REMOTE_YAML);
    expect(live.ok).toBe(true);
    const brokenCachedYaml = "pack: demo_pack\ntitle: Demo Pack\ndescription: header only, no templates\n";
    saveRemotePack({ url: "https://example.com/demo.yaml", id: "demo_pack", yaml: brokenCachedYaml, ts: "1", enabled: true });

    const badYaml = REMOTE_YAML.replace("template: remote_widget_b", "template: supply_demand");
    const r = registerRemotePackYaml("https://example.com/demo.yaml", badYaml);

    expect(r.ok).toBe(false);
    expect(r.unloaded).toBe(true);
    expect(r.errors.join(" ")).toMatch(/unloaded; re-add it/);
    expect(scenes.remote_widget_a).toBeUndefined();
    expect(scenes.remote_widget_b).toBeUndefined();
    expect(isPackTemplateId("remote_widget_a")).toBe(false);
  });
});

describe("isOfficialPackUrl / OFFICIAL_PACK_URL_PREFIX (origin pinning, review fix round 1)", () => {
  test("a URL under the official repo's raw prefix is official", () => {
    expect(isOfficialPackUrl("https://raw.githubusercontent.com/hmelberg/drawcast-templates/main/packs/showcase.yaml")).toBe(true);
    expect(isOfficialPackUrl(OFFICIAL_INDEX_URL)).toBe(true);
  });

  test("an https URL that is NOT under the prefix is NOT official, even if it looks similar", () => {
    expect(isOfficialPackUrl("https://raw.githubusercontent.com/someone-else/drawcast-templates/main/packs/evil.yaml")).toBe(false);
    expect(isOfficialPackUrl("https://example.com/packs/showcase.yaml")).toBe(false);
  });

  test("a non-https URL is never official", () => {
    expect(isOfficialPackUrl("http://raw.githubusercontent.com/hmelberg/drawcast-templates/main/index.json")).toBe(false);
  });

  test("OFFICIAL_PACK_URL_PREFIX is a prefix of OFFICIAL_INDEX_URL", () => {
    expect(OFFICIAL_INDEX_URL.startsWith(OFFICIAL_PACK_URL_PREFIX)).toBe(true);
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
