import { describe, expect, test } from "vitest";
import { parseSvg, parseTransform, compose, apply, ringsOf } from "../scripts/anatomy/svg.mjs";
import { sampleSvgPath } from "../src/scenes/svgpath";

const doc = `<svg viewBox="0 0 100 200">
  <g id="layer3" inkscape:label="Skeleton">
    <g transform="translate(10,20)" id="FemurLeft">
      <path d="M0 0 L10 0 L10 10 Z" style="fill:#dcc06d;stroke:#967348" id="p1"/>
      <g transform="matrix(2,0,0,2,5,5)" id="g99">
        <path d="M0 0 L1 0 L1 1 L0 1 Z" style="fill:#ccb25c" id="p2"/>
      </g>
    </g>
    <path d="M0 0 L5 0 L5 5 Z" style="fill:none;stroke:#000" id="leader"/>
  </g>
  <g id="layer1"><text>Femur</text></g>
</svg>`;

describe("parseSvg", () => {
  const svg = parseSvg(doc);

  test("reads the viewBox", () => {
    expect(svg.viewBox).toEqual([0, 0, 100, 200]);
  });

  test("returns every path with its fill and its chain of group ids", () => {
    const ids = svg.paths.map((p) => p.id);
    expect(ids).toEqual(["p1", "p2", "leader"]);
    expect(svg.paths[0].fill).toBe("#dcc06d");
    expect(svg.paths[0].chain).toEqual(["layer3", "FemurLeft"]);
    expect(svg.paths[1].chain).toEqual(["layer3", "FemurLeft", "g99"]);
    expect(svg.paths[2].fill).toBe("none");
  });

  test("composes transforms down the tree", () => {
    // p2 sits under translate(10,20) then matrix(2,0,0,2,5,5): (1,1) -> (2+5+10, 2+5+20)
    expect(apply(svg.paths[1].matrix, [1, 1])).toEqual([17, 27]);
    expect(apply(svg.paths[0].matrix, [10, 10])).toEqual([20, 30]);
  });
});

test("parseTransform handles matrix, translate and scale, and compose multiplies in document order", () => {
  expect(parseTransform("translate(3)")).toEqual([1, 0, 0, 1, 3, 0]);
  expect(parseTransform("scale(2)")).toEqual([2, 0, 0, 2, 0, 0]);
  expect(parseTransform("matrix(1,2,3,4,5,6)")).toEqual([1, 2, 3, 4, 5, 6]);
  expect(parseTransform(null)).toEqual([1, 0, 0, 1, 0, 0]);
  const M = compose(parseTransform("translate(10,20)"), parseTransform("scale(2)"));
  expect(apply(M, [1, 1])).toEqual([12, 22]);
});

test("ringsOf samples the path through the injected sampler and maps every point", () => {
  const svg = parseSvg(doc);
  const rings = ringsOf(svg.paths[0], sampleSvgPath, 4);
  expect(rings.length).toBe(1);
  expect(rings[0]).toContainEqual([10, 20]);
  expect(rings[0]).toContainEqual([20, 30]);
});
