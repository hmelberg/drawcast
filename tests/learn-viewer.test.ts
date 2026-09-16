// The viewer's learner block (spec §1, §3): the signed-in account reports,
// or nothing does. Source pins — h() needs a document this suite lacks.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseViewerHash, stripJoin } from "../src/viewer";

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
    // Since the course-progress round the function hands the outcome back
    // (the answer path stamps its record entry sent on ok); callers still
    // never await it.
    expect(block).toMatch(/const report = \(ev: LearnEvent\): Promise<SendOutcome \| null> => \{/);
    expect(block).toMatch(/return sendEvent\(reporter\.api, ev, reporter\.key\)\.then\(\(outcome\) => \{\s*if \(outcome === "refused"\) reporter\.stopped = true;\s*return outcome;\s*\}\);/);
    expect(src.match(/sendEvent\(/g)).toHaveLength(1); // the import aside — one call site
  });
  test("a refusal stops this cast's reporting for the session; a network failure does not", () => {
    expect(block).toMatch(/if \(!reporter \|\| reporter\.stopped\) return Promise\.resolve\(null\);/);
    expect(block).not.toMatch(/outcome === "failed"\) reporter\.stopped/);
  });
  test("opened is reported once per session, like a view", () => {
    expect(block).toMatch(/if \(firstOpenInSession\(reporter\.cast, session\)\) void report\(\{ kind: "opened", cast: reporter\.cast \}\)/);
  });
  test("an answer is keyed by (item, step): the playlist item index plus the step inside it", () => {
    expect(src).toMatch(/onAnswer: \(a, item, index\) =>/);
    expect(src).toMatch(/if \(reporter\)\s*void report\(\{ kind: "answer"/); // the record is kept for everyone; only the report needs an enrolled account
    expect(src).toMatch(/report\(\{ kind: "answer", cast: reporter\.cast, item: index, step: a\.index/);
  });
  test("opened, answer and completed go through report and are never awaited — a refusal or an outage can never reach playback", () => {
    // Four since the course-progress round: a second "opened" goes out after
    // a join from the link, because the first was refused before enrolment.
    expect(src.match(/report\(\{ kind: "(opened|answer|completed)"/g)).toHaveLength(4);
    expect(src).not.toMatch(/await\s+(sendEvent|report)\(/);
  });
  test("the reporter is decided before the player mounts, and the player takes no learner control", () => {
    expect(src.indexOf("const reporter = ")).toBeLessThan(src.indexOf("await mountPlaylist("));
    // Share rides the bar (player round); nothing learner-shaped does.
    expect(src).toMatch(/controls: \{ speech, fullscreenEl: figureHost, trailing: \[shareBtn\] \}/);
  });
});

// The course-progress round (spec 2026-09-16-course-progress-and-submit-design.md §2–§4).
describe("course progress in the viewer", () => {
  const src = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  test("the join parameter is parsed, kept through sign-in, and stripped once the join was attempted", () => {
    expect(parseViewerHash("#gh=hmelberg/dcast/learn-russian/01.yaml&join=2027")?.join).toBe("2027");
    expect(parseViewerHash("#gh=hmelberg/dcast/learn-russian/01.yaml&join")?.join).toBe("");
    expect(parseViewerHash("#gh=hmelberg/dcast/learn-russian/01.yaml")).not.toHaveProperty("join");
    expect(stripJoin("https://drawcast.app/#gh=a/b/c.yaml&join=2027&mode=silent")).toBe("https://drawcast.app/#gh=a/b/c.yaml&mode=silent");
    expect(stripJoin("https://drawcast.app/#gh=a/b/c.yaml&join")).toBe("https://drawcast.app/#gh=a/b/c.yaml");
    // signed out: the handshake keeps the whole address; signed in: joinCourse, then replaceState with the parameter gone
    expect(src).toMatch(/if \(key === ""\) \{\s*location\.href = signInUrl\(location\.href\);\s*return;/);
    expect(src).toMatch(/history\.replaceState\(null, "", stripJoin\(location\.href\)\)/);
  });
  test("the outbox is swept at open and after a successful join; a streamed answer is stamped sent on ok", () => {
    expect(src.match(/sweep\(\);/g)?.length).toBe(2);
    expect(src).toMatch(/sweepOutbox\(\{ storage: localRecordStorage\(\), castKey: r\.cast, cast: r\.cast, send: \(evs\) => sendEvents\(r\.api, evs, r\.key\) \}\)/);
    expect(src).toMatch(/if \(outcome === "ok" && kept\) markSent\(/);
  });
  test("item views and hand-in go through the reporter; the hand-in state is read lazily by the session", () => {
    expect(src).toMatch(/onItem: \(view\) => \{\s*if \(reporter\) void report\(\{ kind: "item", cast: reporter\.cast, \.\.\.view \}\);/);
    expect(src).toMatch(/handIn: \(\) => handIn/);
    expect(src).toMatch(/runInfo\(r\.api, r\.key, courseKeyOf\(r\.cast\)\)/);
    expect(src).toMatch(/if \(!info\?\.handin\) return;/);
    expect(src).toMatch(/report\(\{ kind: "handed_in", cast: r\.cast \}\)/);
    // still never awaited, and the three original kinds still go through report exactly once each
    expect(src).not.toMatch(/await\s+(sendEvent|sendEvents|report|sweepOutbox|runInfo)\(/);
  });
});
