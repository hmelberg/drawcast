// The R runtime: pinned webR, booted once (memoized in-flight promise — the
// openstat bootstrap pattern), runs serialized, one shelter per run purged
// in finally (xplainer's never-purged shelter grew all session), typed
// output entries kept apart (xplainer merged stdout and stderr), plots from
// the canvas device as PNG data URIs.
//
// Reached ONLY via dynamic import from run.ts. Never import this module
// statically anywhere: that would put webR's loader on every page.
//
// Honest limitations: without COOP/COEP headers webR uses its PostMessage
// channel, where interrupt() is unavailable — a timeout returns an error
// envelope while the WASM finishes in the background, exactly as pyodide.
// Package installs live in webR's in-memory filesystem, so a page reload
// re-downloads them (the HTTP cache helps).

import type { CodeRunRequest, CodeRunResult, CodeTable } from "./run";
import { RUNTIME_VERSION } from "./languages";
import { parseHarvest } from "./harvest";
import { R_BOOT, R_WRAPPER, rPackagesIn } from "./harvest-r";
import { bitmapToFigure } from "./png";
import { RunQueue } from "./serial";

const WEBR_BASE = `https://webr.r-wasm.org/v${RUNTIME_VERSION.r}/`;
const WEBR_URL = `${WEBR_BASE}webr.mjs`;

/** Canvas device size for one plot page: 2× the pane's logical width so the
 *  video export stays crisp; pointsize scales base-graphics text with it,
 *  the ggplot2 theme hook in R_BOOT does the same for grid text. The live
 *  smoke pins these (spec §5.4). */
const PLOT_WIDTH = 1000;
const PLOT_HEIGHT = 640;
const PLOT_POINTSIZE = 20;

type StatusFn = (phase: "loading" | "running", detail: string) => void;

interface RCharacterLike {
  toArray(): Promise<(string | null)[]>;
}
interface Shelter {
  captureR(
    code: string,
    opts: {
      env: Record<string, unknown>;
      withAutoprint: boolean;
      captureStreams: boolean;
      captureConditions: boolean;
      captureGraphics: { width: number; height: number; pointsize?: number; bg?: string };
      throwJsException: boolean;
    },
  ): Promise<{ result: RCharacterLike; output: { type: string; data: unknown }[]; images: ImageBitmap[] }>;
  purge(): Promise<void>;
}
interface WebRInstance {
  init(): Promise<unknown>;
  evalRVoid(code: string): Promise<void>;
  installPackages(pkgs: string[], opts?: { quiet?: boolean; mount?: boolean }): Promise<void>;
  Shelter: new () => Promise<Shelter>;
}
type WebRModule = { WebR: new (opts: { baseUrl: string }) => WebRInstance };

let bootPromise: Promise<WebRInstance> | null = null;
const queue = new RunQueue();
const installed = new Set<string>();

/** Marks an error as "the runtime itself couldn't start", not a script bug —
 *  read back by RunQueue's errorEnvelope so codeExecutionErrors can warn
 *  instead of blocking generation on it. */
function unavailable(message: string): Error & { runtimeUnavailable: true } {
  const err = new Error(message) as Error & { runtimeUnavailable: true };
  err.runtimeUnavailable = true;
  return err;
}

function boot(): Promise<WebRInstance> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    if (typeof document === "undefined") throw unavailable("R needs a browser to run in");
    let mod: WebRModule;
    try {
      mod = (await import(/* @vite-ignore */ WEBR_URL)) as WebRModule;
    } catch {
      throw unavailable("could not load the R runtime (offline?)");
    }
    // Everything up to a working R is the runtime's problem, never the
    // script's: the 12 MB R.wasm, the filesystem image, the boot script.
    try {
      const webR = new mod.WebR({ baseUrl: WEBR_BASE });
      await webR.init();
      await webR.evalRVoid(R_BOOT);
      return webR;
    } catch (err) {
      throw unavailable(`the R runtime could not start: ${(err as Error).message}`);
    }
  })();
  // A failed boot must not poison every later run: clear so the next render retries.
  bootPromise.catch(() => {
    bootPromise = null;
  });
  return bootPromise;
}

async function ensurePackages(webR: WebRInstance, pkgs: string[], status: StatusFn): Promise<void> {
  const missing = pkgs.filter((p) => !installed.has(p));
  if (missing.length === 0) return;
  status("loading", `Installing ${missing.join(", ")}…`);
  // A package the repo lacks must not sink the run: the script's own
  // library() call then raises the honest R error the panel shows. Only a
  // SUCCESSFUL install is memoized — a CDN hiccup must retry on the next
  // run, not poison every later jsonlite/pkg:: use in this page.
  try {
    await webR.installPackages(missing, { quiet: true });
    for (const p of missing) installed.add(p);
  } catch {
    /* retried next run */
  }
}

function textOf(entries: { type: string; data: unknown }[], type: string): string {
  return entries
    .filter((e) => e.type === type)
    .map((e) => String(e.data))
    .join("\n");
}

async function runOne(req: CodeRunRequest): Promise<CodeRunResult> {
  const status = req.onStatus ?? (() => undefined);
  status("loading", "Loading R…");
  const webR = await boot();
  const paths = req.paths ?? [];
  const pkgs = rPackagesIn(req.code);
  // The data bridge serializes through jsonlite; a script that only prints
  // never pays for it.
  if (paths.length > 0 && !pkgs.includes("jsonlite")) pkgs.push("jsonlite");
  await ensurePackages(webR, pkgs, status);
  // The data harvest runs inside the same captureR call as the script.
  status("running", paths.length > 0 ? "Running and reading data…" : "Running…");
  const shelter = await new webR.Shelter();
  try {
    const captured = await shelter.captureR(R_WRAPPER, {
      // A JS object becomes the evaluation environment: the wrapper reads
      // .__code and .__paths as plain variables, and nothing of it leaks
      // into the global environment — a fresh namespace per run, so the
      // result cache stays order-independent.
      env: { ".__code": req.code, ".__paths": paths.join("\n") },
      withAutoprint: false,
      captureStreams: true,
      captureConditions: true,
      // bg transparent, like matplotlib's savefig: the plot sits on the
      // panel's paper rather than on a white rectangle of its own.
      captureGraphics: { width: PLOT_WIDTH, height: PLOT_HEIGHT, pointsize: PLOT_POINTSIZE, bg: "transparent" },
      throwJsException: true,
    });
    const [rError, rWarn, tableJson, dataJson] = (await captured.result.toArray()).map((s) => s ?? "");
    const stdout = textOf(captured.output, "stdout").replace(/\n$/, "");
    const stderrParts = [textOf(captured.output, "stderr").trim(), rWarn.trim()].filter((s) => s !== "");
    const error = rError !== "" ? rError : undefined;
    const figures = captured.images.map((img) => {
      // Encoded even on error (then dropped): a bitmap is GPU memory until
      // close(), and the error path must release it too.
      const fig = error ? null : bitmapToFigure(img);
      img.close();
      return fig;
    }).filter((f): f is NonNullable<typeof f> => f !== null);
    let tables: CodeTable[] = [];
    if (!error && tableJson !== "") {
      try {
        tables = [JSON.parse(tableJson) as CodeTable];
      } catch {
        /* a malformed table loses the table, not the run */
      }
    }
    let data: Record<string, unknown> | undefined;
    let dataErrors: Record<string, string> | undefined;
    if (!error && paths.length > 0) {
      if (dataJson === "") {
        dataErrors = Object.fromEntries(paths.map((p) => [p, "harvest failed: jsonlite did not load"]));
      } else {
        const harvested = parseHarvest(dataJson);
        data = harvested.data;
        dataErrors = harvested.errors;
      }
    }
    return {
      ok: !error,
      stdout,
      stderr: stderrParts.join("\n"),
      figures,
      tables,
      error,
      ...(data !== undefined ? { data } : {}),
      ...(dataErrors !== undefined && Object.keys(dataErrors).length > 0 ? { dataErrors } : {}),
    };
  } finally {
    await shelter.purge().catch(() => undefined);
  }
}

export function runR(req: CodeRunRequest): Promise<CodeRunResult> {
  return queue.run(() => runOne(req));
}

/** The runtime-module contract run.ts dispatches through. */
export const run = runR;
