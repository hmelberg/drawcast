import { describe, expect, it } from "vitest";
import { parseViewerHash, rawUrlFor } from "../src/viewer";

describe("#gh= parsing", () => {
  it("reads owner, repo and path", () => {
    const req = parseViewerHash("#gh=hmelberg/kurs/courses/causal/did.yaml");
    expect(req?.gh).toEqual({ owner: "hmelberg", repo: "kurs", path: "courses/causal/did.yaml" });
  });

  it("accepts the dash form, like #gdoc-", () => {
    expect(parseViewerHash("#gh-hmelberg/kurs/a.yaml")?.gh?.owner).toBe("hmelberg");
  });

  it("carries the playback params", () => {
    const req = parseViewerHash("#gh=o/r/a.yaml&mode=silent&speed=1.5&style=sketchy");
    expect(req?.mode).toBe("silent");
    expect(req?.speed).toBe(1.5);
    expect(req?.style).toBe("sketchy");
  });

  it("still parses #gdoc=", () => {
    expect(parseViewerHash("#gdoc=1AbCdEfGhIjKl")?.docId).toBe("1AbCdEfGhIjKl");
  });

  it("rejects a path that climbs out of the repo", () => {
    expect(parseViewerHash("#gh=o/r/../../etc/passwd")).toBeNull();
  });

  it("rejects a path that is not a document", () => {
    expect(parseViewerHash("#gh=o/r/script.js")).toBeNull();
    expect(parseViewerHash("#gh=o/r/a.yaml")).not.toBeNull();
    expect(parseViewerHash("#gh=o/r/a.yml")).not.toBeNull();
    expect(parseViewerHash("#gh=o/r/a.json")).not.toBeNull();
  });
});

describe("rawUrlFor", () => {
  it("uses HEAD rather than a branch name, so a rename cannot break a link", () => {
    expect(rawUrlFor({ owner: "o", repo: "r", path: "a/b.yaml" })).toBe(
      "https://raw.githubusercontent.com/o/r/HEAD/a/b.yaml",
    );
  });
});
