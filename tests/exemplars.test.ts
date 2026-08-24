// The exemplar pool behind {{EXEMPLARS}}. Two rules live here: the model is
// never shown an exemplar it cannot reproduce (a spec whose template is not
// registered and ready right now — e.g. a promoted chemistry figure with the
// pack switched off), and the user's own references always outrank the curated
// bundled showcases, which only fill slots the user's library leaves empty.
// See src/llm/exemplars.ts and src/llm/compile.ts.

import { describe, expect, test } from "vitest";
import { pickExemplars, usableExemplars } from "../src/llm/exemplars";
import type { Exemplar } from "../src/llm/prompt";
import type { Spec } from "../src/spec/types";

function spec(template?: string): Spec {
  return { template, commands: [] };
}

const isReady = (id: string) => id === "supply_demand";

describe("usableExemplars", () => {
  test("keeps a tier-2 exemplar (no template at all)", () => {
    const pool = [{ prompt: "explain a flowchart", spec: spec() }];
    expect(usableExemplars(pool, isReady)).toHaveLength(1);
  });

  test("keeps an exemplar whose template is ready", () => {
    const pool = [{ prompt: "draw supply and demand", spec: spec("supply_demand") }];
    expect(usableExemplars(pool, isReady)[0].prompt).toBe("draw supply and demand");
  });

  test("drops an exemplar whose template is not registered", () => {
    const pool = [{ prompt: "draw aspirin", spec: spec("molecule") }];
    expect(usableExemplars(pool, isReady)).toEqual([]);
  });

  test("drops a candidate with no spec at all (a playlist-only bundled example)", () => {
    const pool = [{ prompt: "methane in 3D" }];
    expect(usableExemplars(pool, isReady)).toEqual([]);
  });
});

describe("pickExemplars", () => {
  const user: Exemplar[] = [
    { prompt: "draw supply and demand for coffee", spec: spec("supply_demand") },
    { prompt: "draw supply and demand for housing", spec: spec("supply_demand") },
    { prompt: "draw supply and demand for wheat", spec: spec("supply_demand") },
  ];
  const bundled: Exemplar[] = [
    { prompt: "draw supply and demand shifting right", spec: spec("supply_demand") },
    { prompt: "show the forces on a crate on a ramp", spec: spec("free_body") },
  ];

  test("the user's own references take the slots when they match", () => {
    const picked = pickExemplars("draw supply and demand for tea", user, bundled, 3);
    expect(picked.map((e) => e.prompt)).toEqual(user.map((e) => e.prompt));
  });

  test("bundled showcases fill the slots an empty user library leaves", () => {
    const picked = pickExemplars("show the forces on a crate", [], bundled, 3);
    expect(picked.map((e) => e.prompt)).toEqual(["show the forces on a crate on a ramp"]);
  });

  test("bundled showcases top up a partial user match without displacing it", () => {
    const onlyOne = [user[0]];
    const picked = pickExemplars("draw supply and demand forces on a crate", onlyOne, bundled, 3);
    expect(picked[0].prompt).toBe(onlyOne[0].prompt);
    expect(picked.map((e) => e.prompt)).toContain("show the forces on a crate on a ramp");
    expect(picked).toHaveLength(3);
  });

  test("never returns more than n, and never the same exemplar twice", () => {
    const shared: Exemplar = { prompt: "draw supply and demand for coffee", spec: spec("supply_demand") };
    const picked = pickExemplars("draw supply and demand for coffee", [shared], [shared], 3);
    expect(picked).toHaveLength(1);
  });

  test("no keyword overlap anywhere yields nothing (the model gets '(none yet)')", () => {
    expect(pickExemplars("zzz qqq", user, bundled, 3)).toEqual([]);
  });
});
