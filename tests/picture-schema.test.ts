import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";

const md = {
  id: "md", type: "image", url: "https://microdata.no/a.png", look: "screen",
  view: [0, 0.069, 1, 0.931],
  regions: { datasets: [0, 0.069, 0.2, 0.466], command_line: [0.2, 0.97, 0.8, 0.03] },
};
const errorsOf = (spec: object) => {
  const r = validateSpec(spec) as { ok?: boolean; errors?: string[] };
  return (r.errors ?? []).join("\n");
};

describe("picture fields", () => {
  test("a url screenshot with view and regions is valid, and places in commands resolve", () => {
    const spec = {
      elements: [md],
      commands: [
        { draw: ["md"] },
        { highlight: { target: ["md:datasets"], effect: "box" } },
        { focus: { target: "md:command_line" } },
        { point: { at: { ref: "md:command_line" }, gesture: "underline" } },
        { camera: { on: ["md@[0.2, 0.9, 0.8, 0.1]"] } },
        { camera: { center: { ref: "md@top" } } },
      ],
    };
    expect(errorsOf(spec)).toBe("");
  });
  test("image needs of or url", () => {
    expect(errorsOf({ elements: [{ id: "p", type: "image" }], commands: [] })).toMatch(/image needs of or url/);
  });
  test("a region name that does not exist names the ones that do", () => {
    const spec = { elements: [md], commands: [{ draw: ["md"] }, { highlight: { target: "md:comand_line" } }] };
    expect(errorsOf(spec)).toMatch(/md has no region "comand_line" — it has: datasets, command_line/);
  });
  test("a place on something that is not an image", () => {
    const spec = { elements: [md, { id: "t", type: "text", text: "hi", x: 1, y: 1 }], commands: [{ highlight: { target: "t:x" } }] };
    expect(errorsOf(spec)).toMatch(/"t:x": t is not an image/);
  });
  test("bad region boxes, bad view, a region outside the view, reserved characters in ids", () => {
    const bad = { ...md, view: [0, 0, 1.5, 1], regions: { a: [0, 0, 2, 0.1], "b c": [0, 0, 0.1, 0.1] } };
    const e = errorsOf({ elements: [bad], commands: [] });
    expect(e).toMatch(/md: view must be \[x, y, w, h\] inside 0\.\.1/);
    expect(e).toMatch(/md: region "a" must be \[x, y, w, h\] inside 0\.\.1/);
    expect(e).toMatch(/md: region name "b c"/);
    const outside = { ...md, view: [0, 0, 0.5, 0.5], regions: { far: [0.8, 0.8, 0.1, 0.1] } };
    expect(errorsOf({ elements: [outside], commands: [] })).toMatch(/md: region "far" lies outside its view/);
    expect(errorsOf({ elements: [{ ...md, id: "m:d" }], commands: [] })).toMatch(/id "m:d" may not contain ":" or "@"/);
  });
  test("box is a highlight effect", () => {
    const spec = { elements: [{ id: "t", type: "text", text: "hi", x: 1, y: 1 }], commands: [{ highlight: { target: "t", effect: "box" } }] };
    expect(errorsOf(spec)).toBe("");
  });
});
