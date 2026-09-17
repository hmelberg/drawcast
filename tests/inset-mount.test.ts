// tests/inset-mount.test.ts
// The ghost lesson (tests/ghost-player.test.ts): a plan-level test cannot see
// whether a picture is PAINTED. Mount the real backend over a host with one
// inset and read its leaves back.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { pictureOf } from "../src/render/inset";
import { rendererFor } from "../src/render/svg-backend";
import { installMiniDom, leafNodesFor, FakeNode } from "./helpers/mini-dom";
import type { Spec } from "../src/spec/types";

const SOURCE: Spec = { title: "The model", elements: [{ id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 300]] }], commands: [{ draw: ["tri"] }] };

describe("a mounted inset (spec §9 test 13)", () => {
  test("paints the frame and the picture's leaves", async () => {
    const { restore, doc } = installMiniDom();
    try {
      const host: Spec = {
        elements: [{ id: "pic", type: "inset", of: "The model", picture: { ...pictureOf(SOURCE, heuristicMeasure, planOptionsFor, "pic"), spec: SOURCE, index: 0 } }],
        commands: [{ draw: ["pic"] }],
      };
      const layout = layoutSpec(host, heuristicMeasure);
      const plan = planCommands(host.commands, layout.order, planOptionsFor(host, layout));
      expect(plan.warnings).toEqual([]);
      const container = new FakeNode("div", doc as never);
      const mounted = await rendererFor("clean").mount(layout, host, container as never);
      expect(mounted.elements.has("pic")).toBe(true);
      // leafNodesFor matches the exact data-leaf-id: the frame and the picture's first leaf.
      expect(leafNodesFor(container, "pic__frame").length).toBe(1);
      expect(leafNodesFor(container, "pic__p0").length).toBe(1);
    } finally {
      restore();
    }
  });
});
