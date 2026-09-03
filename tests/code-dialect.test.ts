// The Python-dialect seam (Brython and MicroPython): the shared run queue,
// the runner script's contract as text, the vendored-library registry, and
// the envelope the runner returns. No WASM, no network — the
// runner itself is exercised by scripts/pylib-sanity.py (local CPython) and
// the browser smoke.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { RunQueue } from "../src/code/serial";
import { PYLIB_VERSION } from "../src/code/languages";
import { BRYTHON_LIBS, MICROPYTHON_LIBS, libsFor } from "../src/code/pylib";
import { envelopeToResult, parseRunnerEnvelope } from "../src/code/dialect";
import type { CodeRunResult } from "../src/code/run";

const ok = (stdout: string): CodeRunResult => ({ ok: true, stdout, stderr: "", figures: [] });

describe("RunQueue — serialized runs, envelopes, watchdog", () => {
  test("runs are serialized in order; a throw becomes an envelope and does not block the next", async () => {
    const q = new RunQueue(1000);
    const order: string[] = [];
    const a = q.run(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("a");
      return ok("a");
    });
    const b = q.run(async () => {
      order.push("b");
      throw new Error("boom");
    });
    const c = q.run(async () => {
      order.push("c");
      return ok("c");
    });
    expect((await a).stdout).toBe("a");
    expect((await b).error).toBe("boom");
    expect((await c).stdout).toBe("c");
    expect(order).toEqual(["a", "b", "c"]);
  });
  test("a tagged unavailable error keeps its tag", async () => {
    const q = new RunQueue(1000);
    const res = await q.run(async () => {
      const e = new Error("offline") as Error & { runtimeUnavailable?: boolean };
      e.runtimeUnavailable = true;
      throw e;
    });
    expect(res.runtimeUnavailable).toBe(true);
  });
  test("the watchdog returns a timeout envelope while the next run still waits for the slow one", async () => {
    const q = new RunQueue(30);
    let slowDone = false;
    const slow = q.run(async () => {
      await new Promise((r) => setTimeout(r, 80));
      slowDone = true;
      return ok("slow");
    });
    const next = q.run(async () => ok(slowDone ? "after" : "before"));
    expect((await slow).error).toMatch(/timed out/);
    expect((await next).stdout).toBe("after");
  });
});

describe("drawcast_runner.py — contract as text", () => {
  const src = readFileSync(new URL(`../public/pylib/${PYLIB_VERSION}/drawcast_runner.py`, import.meta.url), "utf8");
  test("exposes the three JS-facing functions and the harvest caps", () => {
    for (const fn of ["def _run(code, paths_json)", "def _register_module(name, source)", "def _alias_module(alias, canonical)"]) {
      expect(src).toContain(fn);
    }
    expect(src).toContain("_CAP_N = 5000");
    expect(src).toContain("_CAP_ROWS = 200");
    expect(src).toContain("_TABLE_CAP = 30");
    expect(src).toContain("downsample or aggregate in the script");
    expect(src).toContain("aggregate or sample in the script");
  });
  test("never imports ast (MicroPython) and tolerates a refused stdout swap", () => {
    expect(src).not.toMatch(/^\s*import ast/m);
    expect(src).toContain("captured = False");
  });
  test("every registry file is vendored", () => {
    for (const lib of Object.values(BRYTHON_LIBS)) {
      expect(readFileSync(new URL(`../public/pylib/${PYLIB_VERSION}/${lib.file}`, import.meta.url), "utf8").length).toBeGreaterThan(1000);
    }
  });
});

describe("pylib registry — which vendored modules a script needs", () => {
  test("import forms, aliases, dotted names, and the .plot token", () => {
    expect(libsFor("import pandas as pd\ndf = pd.DataFrame({})", BRYTHON_LIBS)).toEqual(["pandas_brython"]);
    expect(libsFor("import plotly.express as px", BRYTHON_LIBS)).toEqual(["plotly_express_brython"]);
    expect(libsFor("from scipy.stats import norm", BRYTHON_LIBS)).toEqual(["scipy_stats_brython"]);
    expect(libsFor("df.plot(kind='bar')", BRYTHON_LIBS)).toEqual(["plotly_express_brython"]);
  });
  test("dependencies come first, once", () => {
    expect(libsFor("import seaborn as sns\nimport matplotlib.pyplot as plt", BRYTHON_LIBS)).toEqual([
      "plotly_express_brython",
      "matplotlib_brython",
      "seaborn_brython",
    ]);
    expect(libsFor("import statsmodels.formula.api as smf", BRYTHON_LIBS)).toEqual(["scipy_stats_brython", "statsmodels_brython"]);
  });
  test("an unknown import is not the registry's business (the script's own ModuleNotFoundError is)", () => {
    expect(libsFor("import sklearn\nimport json", BRYTHON_LIBS)).toEqual([]);
  });
  test("every dependency names a registry key (a typo would throw inside libsFor)", () => {
    for (const libs of [BRYTHON_LIBS, MICROPYTHON_LIBS]) {
      for (const [name, lib] of Object.entries(libs)) {
        for (const d of lib.deps) expect(libs[d], `${name} depends on ${d}`).toBeDefined();
      }
    }
  });
  test("every dotted alias follows its parent, so dotted aliases can register", () => {
    for (const lib of Object.values(BRYTHON_LIBS)) {
      for (const a of lib.aliases) {
        if (!a.includes(".")) continue;
        const parent = a.slice(0, a.lastIndexOf("."));
        expect(lib.aliases.indexOf(parent), `${a} needs ${parent} first`).toBeGreaterThanOrEqual(0);
        expect(lib.aliases.indexOf(parent)).toBeLessThan(lib.aliases.indexOf(a));
      }
    }
  });
});

describe("MicroPython registry — pandas and plotly.express only", () => {
  test("import forms and the .plot token resolve to the two vendored modules", () => {
    expect(libsFor("import pandas as pd", MICROPYTHON_LIBS)).toEqual(["pandas_mpy"]);
    expect(libsFor("import plotly.express as px", MICROPYTHON_LIBS)).toEqual(["plotly_express_mpy"]);
    expect(libsFor("df.plot(kind='bar')", MICROPYTHON_LIBS)).toEqual(["plotly_express_mpy"]);
    expect(libsFor("import numpy as np", MICROPYTHON_LIBS)).toEqual([]);
  });
  test("every MicroPython registry file is vendored", () => {
    for (const lib of Object.values(MICROPYTHON_LIBS)) {
      expect(readFileSync(new URL(`../public/pylib/${PYLIB_VERSION}/${lib.file}`, import.meta.url), "utf8").length).toBeGreaterThan(1000);
    }
  });
});

describe("dialect envelope → CodeRunResult", () => {
  test("stdout, table, data and errors map straight through; a run error is the envelope's error", async () => {
    const env = parseRunnerEnvelope(
      JSON.stringify({
        stdout: "hi\n",
        error: "",
        table: { columns: ["a"], rows: [["1"]], truncated: 0 },
        figures: [],
        data: { x: [1, 2] },
        errors: { y: "no variable y" },
      }),
    );
    expect(env).not.toBeNull();
    const res = await envelopeToResult(env!, { paths: ["x", "y"], status: () => undefined });
    expect(res).toMatchObject({ ok: true, stdout: "hi", tables: [{ columns: ["a"] }], data: { x: [1, 2] }, dataErrors: { y: "no variable y" } });
    const bad = await envelopeToResult(parseRunnerEnvelope(JSON.stringify({ stdout: "", error: "Traceback…ZeroDivisionError", table: null, figures: [] }))!, {
      paths: [],
      status: () => undefined,
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("ZeroDivisionError");
  });
  test("engine-side stdout/stderr buffers replace uncaptured envelope streams; a captured stderr passes through", async () => {
    const env = parseRunnerEnvelope(JSON.stringify({ stdout: "", error: "", table: null, figures: [] }))!;
    expect(env.stderr).toBe("");
    const res = await envelopeToResult(env, { paths: [], stdout: "from js\n", stderr: "warned\n", status: () => undefined });
    expect(res.stdout).toBe("from js");
    expect(res.stderr).toBe("warned");
    const captured = parseRunnerEnvelope(JSON.stringify({ stdout: "x\n", stderr: "UserWarning: careful\n", error: "", table: null, figures: [] }))!;
    expect((await envelopeToResult(captured, { paths: [], status: () => undefined })).stderr).toBe("UserWarning: careful");
  });
  test("junk is rejected", () => {
    expect(parseRunnerEnvelope("nope")).toBeNull();
    expect(parseRunnerEnvelope(JSON.stringify({ stdout: 1 }))).toBeNull();
  });
});
