import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines } from "../src/scenes/engines";
import type { AnatomyEngine, AtlasPart } from "../src/scenes/anatomy/types";
import { focusTargetFor, breadcrumbFor, partLabel, BODY_LABEL, SYSTEM_CHOICES } from "../src/ui/body-model";

let parts: Record<string, AtlasPart>;
beforeAll(async () => {
  await ensureEngines(["anatomy"]);
  parts = (getLoadedEngines(["anatomy"]).anatomy as AnatomyEngine).parts({ systems: ["skeleton", "viscera"], sex: "neutral" });
});

describe("focusTargetFor", () => {
  test("a leaf clicked on the whole body zooms to its region or group", () => {
    expect(focusTargetFor(parts, "liver", null)).toEqual({ focus: "abdomen", highlight: null });
    expect(focusTargetFor(parts, "femur_left", null)).toEqual({ focus: "thigh_left", highlight: null });
    expect(focusTargetFor(parts, "carpals_left", null)).toEqual({ focus: "hand_left", highlight: null });
    expect(focusTargetFor(parts, "knee_left", null)).toEqual({ focus: "leg_left", highlight: null });
    expect(focusTargetFor(parts, "brain", null)).toEqual({ focus: "head", highlight: null });
  });

  test("a region clicked zooms to itself", () => {
    expect(focusTargetFor(parts, "hand_left", null)).toEqual({ focus: "hand_left", highlight: null });
    expect(focusTargetFor(parts, "rib_cage", null)).toEqual({ focus: "rib_cage", highlight: null });
  });

  test("inside the focused region a leaf is highlighted and named, not zoomed", () => {
    expect(focusTargetFor(parts, "liver", "abdomen")).toEqual({ focus: "abdomen", highlight: "liver" });
    expect(focusTargetFor(parts, "carpals_left", "hand_left")).toEqual({ focus: "hand_left", highlight: "carpals_left" });
  });

  test("inside a wide focus a leaf whose own region is narrower zooms one level further", () => {
    expect(focusTargetFor(parts, "femur_left", "leg_left")).toEqual({ focus: "thigh_left", highlight: null });
    expect(focusTargetFor(parts, "phalanges_foot_left", "leg_left")).toEqual({ focus: "foot_left", highlight: null });
  });

  test("the outline, the frame and unknown ids do nothing", () => {
    expect(focusTargetFor(parts, "body_outline", null)).toEqual({ focus: null, highlight: null });
    expect(focusTargetFor(parts, "frame", "abdomen")).toEqual({ focus: "abdomen", highlight: null });
    expect(focusTargetFor(parts, "nope", null)).toEqual({ focus: null, highlight: null });
  });
});

describe("breadcrumbFor", () => {
  test("is the ancestor chain, root first, ending at the focus", () => {
    expect(breadcrumbFor(parts, null)).toEqual([]);
    expect(breadcrumbFor(parts, "abdomen")).toEqual(["abdomen"]);
    expect(breadcrumbFor(parts, "thigh_left")).toEqual(["leg_left", "thigh_left"]);
    expect(breadcrumbFor(parts, "carpals_left")).toEqual(["arm_left", "hand_left", "carpals_left"]);
  });
});

describe("labels", () => {
  test("partLabel speaks the chosen language and falls back to English", () => {
    expect(partLabel(parts, "liver", "nb")).toBe("Lever");
    expect(partLabel(parts, "liver", "la")).toBe("Hepar");
    expect(partLabel(parts, "liver", "en")).toBe("Liver");
    expect(partLabel(parts, "not_a_part", "nb")).toBe("not_a_part");
    expect(BODY_LABEL.nb).toBe("Kropp");
  });

  test("the systems pills offer organs, skeleton and both", () => {
    expect(SYSTEM_CHOICES.map((c) => c.value)).toEqual([["viscera"], ["skeleton"], ["skeleton", "viscera"]]);
  });
});
