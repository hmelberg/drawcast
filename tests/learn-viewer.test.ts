// The viewer's learner block (spec §1, §3): the signed-in account reports,
// or nothing does. Source pins — h() needs a document this suite lacks.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseViewerHash } from "../src/viewer";

const src = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the code is gone", () => {
  test("a &learner= in the hash is an unknown parameter now, not an identity", () => {
    const req = parseViewerHash("#gh=hmelberg/dcast/learn-russian/01.yaml&learner=Fjell-Rev-Havn");
    expect(req?.gh?.path).toBe("learn-russian/01.yaml");
    expect(req).not.toHaveProperty("learner");
  });
  test("no code map, no ?learner= handling, no 🎓 control — and no localStorage read for any of them", () => {
    expect(src).not.toMatch(/learnerButton|saveLearner|learnerFor|forgetLearner|normalizeCode|stripLearnerParam|reportingAllowed|LearnerEntry/);
    expect(src).not.toMatch(/req\.learner|learner=/);
    expect(src).not.toMatch(/safeLocalStorage|localStorage/);
  });
});

describe("the viewer reports as the account", () => {
  const block = src.slice(src.indexOf("const castKey = req.anvil"), src.indexOf("const settings = loadSettings();"));
  test("it uses the client, never its own rules", () => {
    expect(src).toMatch(/import \{ apiBase, DEFAULT_ENROLL_API, firstOpenInSession, joinCourse, joinNote, sendEvent \} from "\.\/learn"/);
    expect(src).toMatch(/import \{ getToken, setToken, signInUrl \} from "\.\/account"/);
  });
  test("no report without a token: the session token is read once, and an empty one means no reporter", () => {
    expect(block).toMatch(/const key = getToken\(\);/);
    expect(block).toMatch(/key !== ""/);
    expect(block).toMatch(/const reporter = castKey !== null && enroll === DEFAULT_ENROLL_API && key !== "" \? \{ api: enroll, key, cast: castKey, stopped: false \} : null;/);
  });
  test("meta.enroll decides whether and where — and the token goes only to the app that issued it", () => {
    expect(block).toMatch(/const enroll = playlist\.meta\.enroll \? apiBase\(playlist\.meta\.enroll\) : null;/);
    // Never an api taken from the file: a published YAML naming another
    // server must not receive this browser's session token. The reporter's
    // api is the gated one; DEFAULT_ENROLL_API itself would be equally safe.
    expect(src).not.toMatch(/sendEvent\((enroll|playlist\.meta\.enroll|apiBase\(playlist)/);
  });
  test("one report function, fed the reporter, carries the token under the cast key to the reporter's api", () => {
    expect(block).toMatch(/const report = \(ev: LearnEvent\): void => \{/);
    expect(block).toMatch(/void sendEvent\(reporter\.api, ev, reporter\.key\)\.then\(\(outcome\) => \{\s*if \(outcome === "refused"\) reporter\.stopped = true;\s*\}\);/);
    expect(src.match(/sendEvent\(/g)).toHaveLength(1); // the import aside — one call site
  });
  test("a refusal stops this cast's reporting for the session; a network failure does not", () => {
    expect(block).toMatch(/if \(!reporter \|\| reporter\.stopped\) return;/);
    expect(block).not.toMatch(/outcome === "failed"\) reporter\.stopped/);
  });
  test("opened is reported once per session, like a view", () => {
    expect(block).toMatch(/if \(firstOpenInSession\(reporter\.cast, session\)\) report\(\{ kind: "opened", cast: reporter\.cast \}\)/);
  });
  test("an answer is keyed by (item, step): the playlist item index plus the step inside it", () => {
    expect(src).toMatch(/onAnswer: reporter\s*\?\s*\(a, _item, index\) =>/);
    expect(src).toMatch(/report\(\{ kind: "answer", cast: reporter\.cast, item: index, step: a\.index/);
  });
  test("opened, answer and completed go through report and are never awaited — a refusal or an outage can never reach playback", () => {
    expect(src.match(/report\(\{ kind: "(opened|answer|completed)"/g)).toHaveLength(3);
    expect(src).not.toMatch(/await\s+(sendEvent|report)\(/);
  });
  test("the reporter is decided before the player mounts, and the player takes no learner control", () => {
    expect(src.indexOf("const reporter = ")).toBeLessThan(src.indexOf("await mountPlaylist("));
    expect(src).toMatch(/controls: \{ speech, fullscreenEl: figureHost \}/);
  });
});
