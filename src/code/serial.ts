// One promise queue and one watchdog per runtime, so runs never interleave
// and a hung WASM cannot hang the caller. Shared by every runtime module.
//
// The queue chains on the REAL execution, not the raced result: a timed-out
// run returns early to its caller, but the next run still waits until the
// abandoned execution actually finishes — otherwise its late output would be
// misattributed into the next run's buffers (no runtime here can interrupt:
// pyodide and webR would need COOP/COEP headers, Brython runs on the page's
// own thread).
import type { CodeRunResult } from "./envelope";

export const RUN_TIMEOUT_MS = 180_000;

/** A thrown error as the facade's envelope; a `runtimeUnavailable` tag
 *  (the runtime itself could not start) rides along so the authoring-time
 *  check warns instead of blocking generation. */
export function errorEnvelope(err: unknown): CodeRunResult {
  return {
    ok: false,
    stdout: "",
    stderr: "",
    figures: [],
    error: err instanceof Error ? err.message : String(err),
    runtimeUnavailable: (err as { runtimeUnavailable?: boolean } | undefined)?.runtimeUnavailable === true,
  };
}

export class RunQueue {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly timeoutMs = RUN_TIMEOUT_MS) {}

  run(work: () => Promise<CodeRunResult>): Promise<CodeRunResult> {
    // The watchdog measures EXECUTION, not the wait in the queue: a script
    // queued behind a slow one must not be timed out for the other's sins.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let expire!: (r: CodeRunResult) => void;
    const timeout = new Promise<CodeRunResult>((resolve) => {
      expire = resolve;
    });
    const real = this.queue.then(() => {
      timeoutId = setTimeout(
        () => expire({ ok: false, stdout: "", stderr: "", figures: [], error: `timed out after ${this.timeoutMs / 1000}s` }),
        this.timeoutMs,
      );
      return work();
    });
    this.queue = real.catch(() => undefined);
    const settled = real.catch(errorEnvelope);
    // Clear the watchdog once the real run settles first, so a fast script
    // doesn't leave a 3-minute timer alive (keeping node/test processes open).
    settled.then(() => clearTimeout(timeoutId));
    return Promise.race([settled, timeout]);
  }
}
