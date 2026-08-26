import { describe, expect, test } from "vitest";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";

const flush = () => new Promise((r) => setTimeout(r, 10));

describe("Player frame scheduler injection", () => {
  test("the timeline animates on the injected scheduler, not the global rAF", async () => {
    // node env has no requestAnimationFrame — a pause step can only complete
    // if the Player consults the injected scheduler.
    const player = new Player(planCommands([{ pause: 0.1 }], []), new Map(), new SpeechManager(), null, { mode: "narrated" });
    const frames: ((now: number) => void)[] = [];
    player.raf = (cb) => frames.push(cb);
    const done = player.play();
    await flush();
    expect(player.state).toBe("playing");
    expect(frames.length).toBeGreaterThan(0);
    // Drive the injected clock far past the pause — the step must complete.
    for (let guard = 0; player.state === "playing" && guard < 20; guard++) {
      for (const cb of frames.splice(0)) cb(performance.now() + 100_000);
      await flush();
    }
    await done;
    expect(player.state).toBe("done");
  });
});
