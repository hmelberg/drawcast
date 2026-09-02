// The R side of the code element that node can see: package pre-scan, and
// the wrapper script's contract (the variables it reads, the four-string
// value it returns, the caps it carries). webR itself runs only in a
// browser — the live smoke covers execution.

import { describe, expect, test } from "vitest";
import { R_BOOT, R_DATA_CAP_NUMBERS, R_DATA_CAP_ROWS, R_TABLE_CAP, R_WRAPPER, rPackagesIn } from "../src/code/harvest-r";

describe("rPackagesIn — what to install before the run", () => {
  test("library, require, requireNamespace and pkg:: forms, deduplicated, in order", () => {
    const code = `library(ggplot2)\nrequire("dplyr")\nrequireNamespace('tidyr')\ndata.table::fread("x")\nlibrary(ggplot2)`;
    expect(rPackagesIn(code)).toEqual(["ggplot2", "dplyr", "tidyr", "data.table"]);
  });
  test("base packages and webr's own are not packages to install", () => {
    expect(rPackagesIn("library(stats)\nutils::head(x)\nlibrary(graphics)\nwebr::install('x')")).toEqual([]);
  });
  test("a comment is not a package", () => {
    expect(rPackagesIn("# library(ggplot2) later\nx <- 1")).toEqual([]);
  });
});

describe("R wrapper — contract", () => {
  test("reads .__code and .__paths, returns four strings", () => {
    expect(R_WRAPPER).toContain(".__code");
    expect(R_WRAPPER).toContain(".__paths");
    expect(R_WRAPPER.trim().split("\n").at(-1)).toBe('c(.__err, paste(.__warn, collapse = "\\n"), .__table_json, .__data_json)');
  });
  test("carries the caps as errors, never truncation, with the Python wording", () => {
    expect(R_WRAPPER).toContain(`${R_TABLE_CAP}L`);
    expect(R_WRAPPER).toContain(`${R_DATA_CAP_NUMBERS}L`);
    expect(R_WRAPPER).toContain(`${R_DATA_CAP_ROWS}L`);
    expect(R_WRAPPER).toContain("downsample or aggregate in the script");
    expect(R_WRAPPER).toContain("aggregate or sample in the script");
  });
  test("console semantics: autoprint for all but the last expression, withVisible for the last", () => {
    expect(R_WRAPPER).toContain("withAutoprint(");
    expect(R_WRAPPER).toContain("withVisible(");
    expect(R_WRAPPER).toContain("is.data.frame(");
  });
  test("the JSON string escaper is real R (a backslash in R is a backslash here)", () => {
    expect(R_WRAPPER).toContain('gsub("\\\\", "\\\\\\\\", s, fixed = TRUE)');
    expect(R_WRAPPER).toContain('gsub("\\"", "\\\\\\"", s, fixed = TRUE)');
  });
  test("boot installs the library() shim and the ggplot2 theme hook", () => {
    expect(R_BOOT).toContain("webr::shim_install()");
    expect(R_BOOT).toContain('packageEvent("ggplot2", "onLoad")');
  });
});
