// The local author's toolbox (the /drawcast skill, .claude/skills/drawcast):
// every step of writing a drawcast by hand-with-eyes, using the app's OWN
// code, so a figure made here is made to the same prompt, templates and
// checks as one the app generates.
//
//   node scripts/cast.mjs prompt "<request>" [out.md]   the app's system prompt for this request (catalog shortlist,
//                                                        few-shots, exemplars, code/sound gates), wrapped for reading;
//                                                        the JSON schema goes to dev-casts/_schema.json (look fields up there)
//   node scripts/cast.mjs template <id>                  a template's full catalog entry (params, element ids)
//   node scripts/cast.mjs check <cast.json|yaml>         validation + layout/command lint (the generator's own checks)
//   node scripts/cast.mjs frames <cast.json> [outdir] [--large]   frames after every spoken line, as PNG tiles, plus
//                                                        the browser-measured lint per frame (--large: one frame per row,
//                                                        for fine text) — needs the dev server
//   node scripts/cast.mjs open <cast.json> [--launch]    the app URL that opens this cast (--launch opens it too)
//
// Courses (a folder dev-casts/courses/<slug>/, the shape of a published course):
//   node scripts/cast.mjs course-prompt "<request>" [out.md] [--lectures N]   the app's course planner prompt
//   node scripts/cast.mjs course-new <plan.json> <dir>                        the plan JSON → <dir>/course.md (the app's own normalizer)  [--brief "#for=nurses #basic"]
//   node scripts/cast.mjs lecture-prompt <dir> <n> [--storyboard v1]         lecture n's storyboard prompt → <dir>/lecture-NN/
//   node scripts/cast.mjs part-prompt <dir> <n> <i> [--storyboard v1]        part i's system prompt + request (storyboard.json first)
//        (default v2: the storyboard prompt (storyline rules, templates with "Viewer can") and its per-part
//        staging note, the app's default since 2026-09-28); --storyboard v1 gives the previous prompt)
//   node scripts/cast.mjs lecture-build <dir> <n>                            part-*.json → <dir>/NN-<title>.yaml, marked done in course.md
//   node scripts/cast.mjs course-open <dir> [--launch]                       the app URL that imports the course and opens it
//
// Revising what is published (any GitHub link to a course folder, a lecture, a cast or a saved source):
//   node scripts/cast.mjs pull <github-url> [workdir] [--force]   sparse clone in dev-casts/repos/ + a working copy
//        (a course → dev-casts/courses/<slug>/, a cast → dev-casts/pulled/<slug>/) with origin.json. A PRIVATE
//        course or cast is unlocked here with the owner's own key (signed in as the owner — else it stops before
//        writing anything) and origin.private is recorded true, so later steps see plain YAML like any other pull.
//   node scripts/cast.mjs unpack <course-dir> <n>  |  unpack <cast.yaml> [outdir]   → part-N.json + outline.json
//   node scripts/cast.mjs revise-prompt <parts-dir | cast.json> "<change>" [out.md]   the app's rules, the document's templates in full
//   node scripts/cast.mjs repack <parts-dir>             parts → the YAML again; narration kept for every unchanged line
//   node scripts/cast.mjs push <workdir> [--dry-run | --no-push] [--direct] [-m msg] [--body text] [--new-pr]
//        regenerates what the app's publish would (course page, READMEs, manifests, end pages) and commits it:
//        a branch + PR by default (from a fork without push rights; later pushes update the same PR), --direct to
//        the default branch. Refuses if the files changed on GitHub since the pull. Signed in (see below), the
//        commit also carries a claim file (only on a repo you can push to — never from a fork), and a --direct push registers with Anvil and prints its free link
//        (drawcast.app/#<name>) — a PR push prints when to run register instead, once it is merged. With
//        origin.private true: quotes first (refusing, with the price and the exact `private` command, if more is
//        due), fetches the item key and locks every lecture file of the plan before anything is written — no
//        poster rides along, and a lock failure leaves nothing committed.
//   node scripts/cast.mjs register <workdir>   after a PR-published first publish merges: verifies the claim
//        and registers the item (a --direct push already does this on its own, right after the commit)
//
// Publishing something new (a course folder or a folder with one cast YAML) to a repo of the user's:
//   node scripts/cast.mjs pack <cast.json> <workdir>   a {request, spec} (or bare spec) → <workdir>/<name>.yaml,
//        validated — the folder with one cast YAML that publish-target takes
//   node scripts/cast.mjs publish-target <workdir> <owner/repo> [--dir <folder>] [--create]
//        writes <workdir>/origin.json aimed at the repo (a free slug, Pages switched on; --create makes the repo,
//        public); then push <workdir> --direct publishes it like any revision.
//
// A pretty link, drawcast.app/#<name> (bought, one-time, on Stripe's page), for something published:
//   node scripts/cast.mjs login | logout      the drawcast account: a code to type on drawcast.anvil.app/#device
//                                             → a session token in ~/.config/drawcast/session.json (0600)
//   node scripts/cast.mjs name <workdir> <name>                         free (and its price) / yours / taken
//   node scripts/cast.mjs name <workdir> <name> --buy --price <cents>   yours: repoint it, free; free: Stripe Checkout
//                                             opens in the browser (--price must equal the name's price)
//   node scripts/cast.mjs name-wait <workdir> [--timeout 540]         until the name resolves here; records it (a course:
//                                             `name:` in course.md, and the next push puts it on the page's door)
//
// Private (registry delivery 2, task 11) — locked on GitHub, only for enrolled learners:
//   node scripts/cast.mjs private <workdir> [--unlisted]        the quote (what is due, in USD) and the exact next
//                                             command; already paid says so instead. --unlisted buys private AND
//                                             unlisted in the SAME purchase (without it, the item stays listed).
//   node scripts/cast.mjs private <workdir> --price <cents> [--unlisted]   --price must equal the quote's due;
//                                             opens Stripe Checkout in the browser, waits (up to 9 minutes) for it
//                                             to clear, then sets origin.private = true. The next `push` locks the
//                                             plan and commits it locked; `pull` on a private course/cast needs the
//                                             owner's own login to read it back at all.
//
// Listing (registry deliveries 3–4, task 10) — whether an already-registered course or cast
// shows in the public catalogue (drawcast.app/#browse); takes effect at once, no push needed:
//   node scripts/cast.mjs listing <workdir> --listed             turns listing back on — always free
//   node scripts/cast.mjs listing <workdir> --unlisted            already covered (paid private before, or an
//                                             earlier unlisted purchase) → off at once, free. Otherwise prints what
//                                             is due; on the user's yes, --price <cents> (must equal it) opens
//                                             Stripe Checkout, waits (up to 9 minutes), then confirms unlisted. The
//                                             item stays PUBLIC — this only leaves it out of the catalogue.
//
// Narration credit (registry delivery 3) — lets a signed-in author with no Google TTS key of
// their own still publish narration (the server synthesizes against prepaid credit):
//   node scripts/cast.mjs credit                                  the signed-in author's balance
//   node scripts/cast.mjs credit --buy <cents>                    500, 1000 or 2000 (5/10/20 USD) — only on the
//                                             user's own yes to that amount; opens Stripe Checkout in the browser,
//                                             waits (up to 9 minutes) for the balance to rise, then prints it.
//                                             The skill's own bake (frames, etc.) still uses a local TTS key when
//                                             one is configured — credit is for publishing narration from the app
//                                             without one.
//
// A cast file is a spec, a {request, spec}, or playlist YAML — anything the
// app opens. Files live under dev-casts/ (gitignored). The dev server:
//   npm run dev -- --port 5199 --strictPort      (DRAWCAST_URL overrides http://localhost:5199)

import { createServer } from "vite";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir, hostname } from "node:os";
import { pageDoor, pagesUrlFor, parseGithubTarget, publishOrigin, takenSlugs } from "./cast-github.mjs";
import {
  apiUrl,
  boundedFetch,
  checkName,
  clearSession,
  creditBalanceAdvice,
  creditPayAdvice,
  nameBlocker,
  deviceLogin,
  dollars,
  listingAdvice,
  unlistStep,
  creditBaseline,
  registryTargetFor,
  nameAdvice,
  privatePayAdvice,
  privateItemFor,
  privateCourseText,
  privateQuoteAdvice,
  readSession,
  registerFor,
  registerNow,
  registrable,
  registrationFor,
  shouldClaim,
  waitForCredit,
  waitForListing,
  waitForName,
  waitForPrivate,
  writeSession,
} from "./cast-account.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const ROOT = process.cwd();
const URL_BASE = process.env.DRAWCAST_URL ?? "http://localhost:5199";

const wrap = (text, width = 300) =>
  String(text)
    .split("\n")
    .map((line) => {
      if (line.length <= width) return line;
      const out = [];
      let r = line;
      while (r.length > width) {
        let cut = r.lastIndexOf(" ", width);
        if (cut < width / 2) cut = width;
        out.push(r.slice(0, cut));
        r = r.slice(cut).replace(/^ /, "");
      }
      out.push(r);
      return out.join("\n");
    })
    .join("\n");

function readCast(file) {
  const text = readFileSync(resolve(ROOT, file), "utf8");
  try {
    const j = JSON.parse(text);
    return j.spec ?? j;
  } catch {
    return null; // playlist YAML: the frames harness reads it; check needs JSON
  }
}

/** What a cast file is, as `open` reports it. Mirrors src/playlist/cast-file.ts. */
function castShape(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { label: "playlist YAML / script", empty: false };
  }
  const e = Array.isArray(j) ? j[0] : j;
  if (!e || typeof e !== "object") return { label: "JSON that is not a cast", empty: true };
  if (e.playlist !== undefined) return { label: "a {request, playlist} wrapper", empty: false };
  const spec = e.commands === undefined && e.spec && typeof e.spec === "object" ? e.spec : e;
  const n = Array.isArray(spec.commands) ? spec.commands.length : 0;
  const label = spec === e ? `a spec, ${n} commands` : `a {request, spec} wrapper, ${n} commands`;
  const drawn = Array.isArray(spec.elements) && spec.elements.length > 0;
  return { label, empty: n === 0 && !drawn && !spec.template };
}

function devPath(file) {
  const rel = relative(ROOT, resolve(ROOT, file));
  if (rel.startsWith("..")) throw new Error(`${file} must be inside the repo (e.g. dev-casts/) so the dev server can serve it`);
  return "/" + rel.split("\\").join("/");
}

async function withVite(fn) {
  const server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
  try {
    const { ensureEnabledPacks, PACK_DEFS, DEFAULT_OFF_PACKS } = await server.ssrLoadModule("/src/scenes/packs.ts");
    await ensureEnabledPacks(Object.keys(PACK_DEFS).filter((id) => !DEFAULT_OFF_PACKS.has(id)));
    return await fn((p) => server.ssrLoadModule(p));
  } finally {
    await server.close();
  }
}

async function browser() {
  const { chromium } = await import("playwright-core");
  // Playwright's own browser cache, per platform (PLAYWRIGHT_BROWSERS_PATH overrides).
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
    ?? (process.platform === "darwin" ? `${home}/Library/Caches/ms-playwright`
      : process.platform === "win32" ? `${process.env.LOCALAPPDATA}/ms-playwright`
      : `${process.env.XDG_CACHE_HOME ?? `${home}/.cache`}/ms-playwright`);
  const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell")).sort() : [];
  if (!shells.length) throw new Error("no headless Chromium — run: npx playwright-core install chromium-headless-shell");
  const dir = `${cache}/${shells.at(-1)}`;
  const sub = readdirSync(dir).find((d) => d.startsWith("chrome-headless-shell"));
  const exe = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  return chromium.launch({ executablePath: `${dir}/${sub}/${exe}` });
}

/**
 * The system prompt the app would send for this request — the compiler
 * prompt, the catalog shortlist, few-shots, exemplars, the code/sound gates —
 * wrapped for reading. The schema goes to dev-casts/_schema.json.
 */
async function appPromptText(load, request, priorityIds = []) {
  mkdirSync(resolve(ROOT, "dev-casts"), { recursive: true });
  const compile = await load("/src/llm/compile.ts");
  const { buildSystemBlocks, formatExemplars, wantsC64, wantsCode, wantsSound } = await load("/src/llm/prompt.ts");
  const { pickExemplars } = await load("/src/llm/exemplars.ts");
  const { usableExemplars } = await load("/src/llm/exemplars.ts");
  const { catalogParts, isReadyTemplate } = await load("/src/scenes/catalog.ts");
  const examples = JSON.parse(readFileSync(resolve(ROOT, "src/examples.json"), "utf8"));
  const bundled = usableExemplars(
    examples.filter((e) => !e.specimen).map((e) => ({ prompt: e.request, spec: e.spec })),
    isReadyTemplate,
  );
  const code = wantsCode(request), sound = wantsSound(request), c64 = wantsC64(request);
  const catalog = catalogParts({ request, priorityIds });
  // The schema (~90k characters of the ~210k) goes to its own file: the
  // prompt keeps a pointer, and the author looks fields up when needed.
  const schema = compile.apiSchema({ code, sound, c64 });
  const variant = compile.promptVariants()[0].source.replace("{{SCHEMA}}", "(The JSON schema is in dev-casts/_schema.json — look up an element's or a command's fields there when you need them.)");
  writeFileSync(resolve(ROOT, "dev-casts/_schema.json"), JSON.stringify(schema, null, 1));
  const blocks = buildSystemBlocks(variant, {
    schema,
    catalog: catalog.stable,
    fewshots: compile.fewshotsText({ code }),
    exemplars: formatExemplars(pickExemplars(request, [], bundled, 3)),
    code: compile.codePromptFor(code, c64),
    sound: sound ? compile.SOUND_PROMPT_SOURCE : "",
  });
  const text = blocks.prefix + blocks.suffix + (catalog.variable ? "\n\n" + catalog.variable : "");
  return text;
}

/**
 * One lecture of a course folder, as the course runner sees it
 * (course/run.ts requestFor): the request buildLectureRequest composes, the
 * part count, the chapters and the tag brief — and, when asked, the
 * storyboard already written to lecture-NN/storyboard.json, normalized the
 * way the app normalizes a storyboard reply.
 */
async function lectureContext(load, dir, n, withOutline = false) {
  const { parseCourse } = await load("/src/course/document.ts");
  const { buildLectureRequest, lectureTags, partsOf } = await load("/src/course/run.ts");
  const { buildBrief, parseTags } = await load("/src/llm/tags.ts");
  const text = readFileSync(resolve(ROOT, dir, "course.md"), "utf8");
  const course = parseCourse(text);
  const lecture = course.lectures[n - 1];
  if (!lecture) throw new Error(`the course has ${course.lectures.length} lectures`);
  const parts = partsOf(lecture, course);
  const chapters = lecture.chapters.length > 0 ? lecture.chapters : undefined;
  const lectureDir = resolve(ROOT, dir, `lecture-${String(n).padStart(2, "0")}`);
  const ctx = { course, text, lecture, request: buildLectureRequest(course, n - 1), parts, chapters, brief: buildBrief(parseTags(lectureTags(course, lecture).join(" ")).tags), lectureDir };
  if (!withOutline) return ctx;
  const f = resolve(lectureDir, "storyboard.json");
  if (!existsSync(f)) throw new Error(`no storyboard yet: write ${relative(ROOT, f)} (lecture-prompt shows the prompt)`);
  const { normalizeOutline } = await load("/src/llm/outline.ts");
  const outline = normalizeOutline(JSON.parse(readFileSync(f, "utf8")), chapters, parts);
  if (!outline) throw new Error(`${relative(ROOT, f)} is not a usable storyboard (the app would reject it)`);
  if (!outline.title) outline.title = ctx.request;
  return { ...ctx, outline };
}

/** `--storyboard v1|v2` (default v2, the app's default since 2026-09-28). */
function storyboardFlag(args) {
  const at = args.indexOf("--storyboard");
  if (at === -1) return "v2";
  const v = args[at + 1];
  if (v !== "v1" && v !== "v2") throw new Error("--storyboard takes v1 or v2");
  return v;
}

/** The arguments without `--storyboard <v>`. */
function positional(args) {
  return args.filter((a, i) => a !== "--storyboard" && args[i - 1] !== "--storyboard");
}

// ---- Revising from GitHub: helpers -------------------------------------------

/** Run a command; its trimmed stdout, or an error carrying its stderr. */
function sh(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`${bin} ${args.slice(0, 3).join(" ")} …: ${(r.stderr || r.stdout || "").trim()}`);
  return r.stdout.trim();
}

const joinRepo = (...parts) => parts.filter(Boolean).join("/");

/** A sparse, blob-less clone of owner/repo@branch under dev-casts/repos/,
 *  fresh from origin, with `folders` checked out. Cone mode: every file
 *  directly in each parent folder comes too (courses.json, the repo's index
 *  pages). */
function ensureClone(owner, repo, branch, folders) {
  const clone = resolve(ROOT, "dev-casts/repos", `${owner}__${repo}`);
  if (!existsSync(clone)) {
    mkdirSync(resolve(ROOT, "dev-casts/repos"), { recursive: true });
    sh("git", ["clone", "--quiet", "--filter=blob:none", "--sparse", "--depth", "1", "--branch", branch, `https://github.com/${owner}/${repo}.git`, clone]);
  } else {
    sh("git", ["-C", clone, "fetch", "--quiet", "--depth", "1", "origin", branch]);
    sh("git", ["-C", clone, "checkout", "--quiet", "--force", "-B", branch, "FETCH_HEAD"]);
  }
  const dirs = new Set(sh("git", ["-C", clone, "sparse-checkout", "list"]).split("\n").filter(Boolean));
  for (const f of folders) if (f) dirs.add(f);
  sh("git", ["-C", clone, "sparse-checkout", "set", ...dirs]);
  return { clone, base: sh("git", ["-C", clone, "rev-parse", "HEAD"]) };
}

/** The player the published links point at (the app's viewerBase), read off the repo's own READMEs. */
function findViewerBase(clone, folder) {
  for (let dir = folder; ; dir = dir.split("/").slice(0, -1).join("/")) {
    const f = resolve(clone, dir, "README.md");
    const m = existsSync(f) && /\((https?:\/\/[^)\s]*?)\/?#gh=/.exec(readFileSync(f, "utf8"));
    if (m) return m[1] + "/";
    if (!dir) return "https://drawcast.app/";
  }
}

/** A file as it is at `commit` (the clone is sparse and blob-less, so not from the worktree); null if absent. */
function readAtCommit(clone, commit, path) {
  const r = spawnSync("git", ["-C", clone, "show", `${commit}:${path}`], { encoding: "utf8", maxBuffer: 1 << 30 });
  return r.status === 0 ? r.stdout : null;
}

function guardWorkdir(work, force) {
  if (!existsSync(work) || force) return;
  const has = readdirSync(work).length > 0;
  if (has) throw new Error(`${relative(ROOT, work)} exists — pass another workdir, or --force to overwrite its published files (part files and lecture folders are left alone)`);
}

/** unpack's arguments: a YAML (→ <name>.parts/), or a course folder and a lecture number (→ lecture-NN/). */
async function unpackTarget(load, args) {
  const [a, b] = args;
  if (!a) throw new Error("usage: cast.mjs unpack <cast.yaml> [outdir]  |  cast.mjs unpack <course-dir> <lecture>");
  const at = resolve(ROOT, a);
  if (existsSync(resolve(at, "course.md"))) {
    const n = Number(b);
    const { lectures } = await courseLectures(load, readFileSync(resolve(at, "course.md"), "utf8"));
    const file = lectures[n - 1]?.status?.file;
    if (!file) throw new Error(`lecture ${b} has no published file in ${a}/course.md (${lectures.length} lectures)`);
    return { yaml: resolve(at, file), outdir: resolve(at, `lecture-${String(n).padStart(2, "0")}`) };
  }
  return { yaml: at, outdir: resolve(ROOT, b ?? a.replace(/\.ya?ml$/i, "") + ".parts") };
}

async function courseLectures(load, text) {
  const { parseCourse } = await load("/src/course/document.ts");
  return parseCourse(text);
}

/**
 * cast.mjs's own wrapper around cast-account.mjs's (tested, pure)
 * registerNow: loads the app's registry/names modules through withVite and
 * builds the registration (registerFor), then hands the actual network
 * sequence — verifyClaim, a course's claimCourse, registerItem — to it,
 * every call bounded (boundedFetch — fix round 1: a stalled Anvil must
 * never hang `push --direct` after the git push has already landed, nor a
 * `push --dry-run`'s claim). Records any free name that comes back on
 * origin.freeName (written to origin.json only when one did).
 *
 * verifyClaim/claimCourse/registerItem never throw on their own (a network
 * or server trouble is a string outcome, folded into the note
 * registerNow/registryNote build); this can still throw for a genuine
 * usage error (registerFor's "no slug"). Callers that must never fail on
 * it (push, after the commit already landed) wrap the call themselves;
 * `register`'s whole job IS this step, so it lets a throw surface as a
 * real error.
 */
async function registerPublished(origin, wd, session, verify) {
  const fetchImpl = boundedFetch();
  const { note, name } = await withVite(async (load) => {
    const registry = await load("/src/registry.ts");
    const { parseCourse } = await load("/src/course/document.ts");
    const { courseRegistration } = await load("/src/course/publish.ts");
    const courseText = origin.kind === "course" ? readFileSync(resolve(wd, "course.md"), "utf8") : undefined;
    const reg = registerFor(origin, { parseCourse, courseRegistration }, courseText);
    const names = origin.kind === "course" ? await load("/src/names.ts") : undefined;
    return registerNow({ origin, session, verify, reg, registry, names, fetchImpl });
  });
  if (name) origin.freeName = name;
  if (origin.freeName) writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
  return note;
}

const commands = {
  async prompt([request, out]) {
    if (!request) throw new Error('usage: cast.mjs prompt "<request>" [out.md]');
    // One file per request by default: parallel authors (subagents) used to
    // share dev-casts/_prompt.md and read each other's shortlist (2026-09-28).
    out ??= `dev-casts/_prompt-${request.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)}.md`;
    await withVite(async (load) => {
      const text = await appPromptText(load, request);
      writeFileSync(resolve(ROOT, out), wrap(text) + "\n");
      console.log(`${out}: ${text.length} characters (wrapped at 300 columns; line breaks are not part of it). Shortlisted templates are in full at the end; the schema is in dev-casts/_schema.json.`);
    });
  },

  // ---- Courses (the /drawcast skill's course mode) --------------------------
  // A course folder dev-casts/courses/<slug>/ holds course.md (the app's own
  // course document), one lecture-NN/ working folder per lecture (the
  // storyboard and the part specs) and one NN-<title>.yaml per built lecture —
  // the same shape a published course has, so the app imports it as one.

  async "course-prompt"(args) {
    const n = args.includes("--lectures") ? Number(args[args.indexOf("--lectures") + 1]) : null;
    const [request, out = "dev-casts/_course-prompt.md"] = args.filter((a, i) => a !== "--lectures" && args[i - 1] !== "--lectures");
    if (!request) throw new Error('usage: cast.mjs course-prompt "<request>" [out.md] [--lectures N]');
    await withVite(async (load) => {
      const { buildCourseMessages } = await load("/src/course/plan.ts");
      // The brief, as the app's course panel takes it: audience and level
      // tags typed in the request (#for=nurses #basic) are the course's.
      const { courseBriefFrom } = await load("/src/llm/brief-controls.ts");
      const brief = courseBriefFrom(request);
      const { system, user } = buildCourseMessages(brief.request, Number.isFinite(n) ? n : null, brief.tags);
      mkdirSync(resolve(ROOT, "dev-casts"), { recursive: true });
      writeFileSync(resolve(ROOT, out), wrap(`# SYSTEM\n\n${system}\n\n# USER\n\n${user}`) + "\n");
      const briefArg = brief.tags.length ? ` --brief "${brief.tags.join(" ")}"` : "";
      console.log(`${out}: the app's course planner prompt. Write the plan JSON it asks for to a file, then: cast.mjs course-new <plan.json> dev-casts/courses/<slug>${briefArg}`);
    });
  },

  async "course-new"(args) {
    const briefAt = args.indexOf("--brief");
    const briefText = briefAt === -1 ? "" : args[briefAt + 1] ?? "";
    const [planFile, dir] = args.filter((a, i) => a !== "--brief" && args[i - 1] !== "--brief");
    if (!planFile || !dir) throw new Error('usage: cast.mjs course-new <plan.json> <dir> [--brief "#for=nurses #basic"]');
    await withVite(async (load) => {
      const { normalizeCoursePlan } = await load("/src/course/plan.ts");
      const { formatCourse, parseCourse, setCourseOption } = await load("/src/course/document.ts");
      const course = normalizeCoursePlan(JSON.parse(readFileSync(resolve(ROOT, planFile), "utf8")));
      if (!course) throw new Error("the plan is unusable (the app needs a title and at least two lectures)");
      // The course's brief goes in the header's tag line, as the app stores it.
      const { courseBriefFrom } = await load("/src/llm/brief-controls.ts");
      const brief = courseBriefFrom(briefText).tags;
      if (brief.length > 0) course.tags = brief;
      const slug = basename(resolve(ROOT, dir));
      const text = setCourseOption(formatCourse(course), "slug", slug);
      mkdirSync(resolve(ROOT, dir), { recursive: true });
      writeFileSync(resolve(ROOT, dir, "course.md"), text);
      const parsed = parseCourse(text);
      console.log(`${dir}/course.md: "${parsed.title}", ${parsed.lectures.length} lectures${parsed.warnings.length ? "\n  " + parsed.warnings.join("\n  ") : ""}`);
    });
  },

  async "lecture-prompt"(args) {
    const version = storyboardFlag(args);
    const [dir, nArg] = positional(args);
    if (!dir || !nArg) throw new Error("usage: cast.mjs lecture-prompt <dir> <lecture number, 1-based> [--storyboard v2]");
    await withVite(async (load) => {
      const { request, parts, chapters, brief, lectureDir } = await lectureContext(load, dir, Number(nArg));
      const { buildStoryboardMessages, buildStoryboardMessagesV2 } = await load("/src/llm/storyboard.ts");
      // v2 sees the templates the app would show it: the keyword shortlist
      // (the app asks its router first) with "Viewer can", and the index.
      const { storyboardTemplates } = await load("/src/llm/multi.ts");
      const { system, user } =
        version === "v2"
          ? buildStoryboardMessagesV2(request, parts, { chapters, brief, ...storyboardTemplates(request) })
          : buildStoryboardMessages(request, parts, { chapters, brief });
      mkdirSync(lectureDir, { recursive: true });
      const out = resolve(lectureDir, "_storyboard-prompt.md");
      writeFileSync(out, wrap(`# SYSTEM\n\n${system}\n\n# USER\n\n${user}`) + "\n");
      console.log(`${relative(ROOT, out)}: the app's storyboard prompt ${version} (${parts ?? "1–4"} parts). Write the JSON it asks for to ${relative(ROOT, resolve(lectureDir, "storyboard.json"))}, then part-prompt for each part.`);
    });
  },

  async "part-prompt"(args) {
    const version = storyboardFlag(args);
    const [dir, nArg, iArg] = positional(args);
    if (!dir || !nArg || !iArg) throw new Error("usage: cast.mjs part-prompt <dir> <lecture> <part> [--storyboard v2]  (both 1-based)");
    await withVite(async (load) => {
      const { request, brief, lectureDir, outline } = await lectureContext(load, dir, Number(nArg), true);
      const i = Number(iArg) - 1;
      if (!outline.parts[i]) throw new Error(`the storyboard has ${outline.parts.length} parts`);
      const { buildPartRequest } = await load("/src/llm/outline.ts");
      const partRequest = buildPartRequest(request, outline, i, brief, version);
      // v2: a template the storyboard planned for this part gets its full
      // entry, as the app's partConfig gives it.
      const { isReadyTemplate } = await load("/src/scenes/catalog.ts");
      const planned = version === "v2" && outline.parts[i].template && isReadyTemplate(outline.parts[i].template) ? [outline.parts[i].template] : [];
      const text = await appPromptText(load, partRequest, planned);
      const out = resolve(lectureDir, `_part-${i + 1}-prompt.md`);
      writeFileSync(out, wrap(text) + "\n\n# USER (the part's request)\n\n" + wrap(partRequest) + "\n");
      console.log(`${relative(ROOT, out)}: ${text.length} characters of system prompt, then the part's request at the end. Write the spec to ${relative(ROOT, resolve(lectureDir, `part-${i + 1}.json`))} as {"request": …, "spec": …}; check and frames it as any cast.`);
    });
  },

  async "lecture-build"([dir, nArg]) {
    if (!dir || !nArg) throw new Error("usage: cast.mjs lecture-build <dir> <lecture>");
    await withVite(async (load) => {
      const n = Number(nArg);
      const { course, text, lecture, lectureDir, outline } = await lectureContext(load, dir, n, true);
      const { lecturePlaylist, lectureTags, stripClickGates } = await load("/src/course/run.ts");
      const { parseTags } = await load("/src/llm/tags.ts");
      const { formatPlaylist } = await load("/src/playlist/playlist.ts");
      const { setLectureStatus } = await load("/src/course/document.ts");
      const { validateSpec } = await load("/src/spec/schema.ts");
      const { slugify } = await load("/src/publish/github.ts");
      const tags = parseTags(lectureTags(course, lecture).join(" "));
      const specs = [], chapterOf = [], failed = [];
      outline.parts.forEach((part, i) => {
        const f = resolve(lectureDir, `part-${i + 1}.json`);
        if (!existsSync(f)) return failed.push(i + 1);
        const spec = readCast(f);
        const v = validateSpec(spec);
        if (!v.ok) throw new Error(`part ${i + 1} is invalid:\n  ${v.errors.join("\n  ")}`);
        // What the runner does to every part (course/run.ts, llm/multi.ts).
        spec.title ??= part.title;
        spec.level ??= part.level ?? tags.level ?? undefined;
        spec.voice ??= tags.voiceGender ?? undefined;
        stripClickGates(spec, tags.tags);
        specs.push(spec);
        chapterOf.push(part.chapter);
      });
      if (failed.length) throw new Error(`missing part spec(s): ${failed.map((k) => `part-${k}.json`).join(", ")}`);
      const playlist = lecturePlaylist(course, n - 1, { outline, specs, chapterOf, failed: [] });
      const file = lecture.status?.file ?? `${String(n).padStart(2, "0")}-${slugify(lecture.title)}.yaml`;
      writeFileSync(resolve(ROOT, dir, file), formatPlaylist(playlist, "yaml"));
      const id = lecture.status?.id ?? crypto.randomUUID();
      writeFileSync(resolve(ROOT, dir, "course.md"), setLectureStatus(text, n - 1, { state: "done", id, file, ts: new Date().toISOString().slice(0, 10) }));
      console.log(`${dir}/${file}: lecture ${n} "${lecture.title}", ${specs.length} parts; course.md marks it done. Frames it with: cast.mjs frames ${dir}/${file}`);
    });
  },

  async "course-open"(args) {
    const dir = args.find((a) => a !== "--launch");
    if (!dir) throw new Error("usage: cast.mjs course-open <dir> [--launch]");
    const url = `${URL_BASE}/?course=${devPath(`${dir}/course.md`)}`;
    console.log(url + "\n(imports the course into the app's local courses — built lectures only — and opens its panel; reopening re-imports it)");
    if (args.includes("--launch")) {
      const { spawn } = await import("node:child_process");
      spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    }
  },

  // ---- Revising what is already published (a GitHub URL) --------------------
  // pull makes a sparse clone under dev-casts/repos/ and a working copy
  // (a course folder shaped like the ones above, or one cast) with an
  // origin.json saying where it came from. unpack/repack turn a published
  // YAML into part-N.json + outline.json and back, keeping its meta and the
  // baked narration of every line still spoken. push regenerates what the
  // app's own publish would (course page, READMEs, manifests, next links)
  // and commits it: a branch and a PR by default, the default branch only
  // with --direct.

  async pull(args) {
    const force = args.includes("--force");
    const [url, out] = args.filter((a) => a !== "--force");
    if (!url) throw new Error("usage: cast.mjs pull <github-url> [workdir] [--force]");
    const t = parseGithubTarget(url);
    const branch = t.branch ?? sh("gh", ["api", `repos/${t.owner}/${t.repo}`, "--jq", ".default_branch"]);
    // A path that is a file is checked out by its folder: a lecture needs its
    // course, a cast its casts.json.
    const isFile = /\.ya?ml$/i.test(t.path);
    const folder = isFile ? t.path.split("/").slice(0, -1).join("/") : t.path;
    const { clone, base } = ensureClone(t.owner, t.repo, branch, [folder]);
    const at = (p) => resolve(clone, p);
    if (!existsSync(at(t.path))) throw new Error(`${t.owner}/${t.repo}@${branch} has no ${t.path || "(root)"}`);

    const courseDir = existsSync(at(joinRepo(folder, "course.md"))) ? folder : null;
    if (!courseDir && !isFile) {
      const listing = readdirSync(at(folder)).filter((f) => !f.startsWith("."));
      throw new Error(`${t.path || "the repo root"} is neither a course folder (no course.md) nor a .yaml. It holds: ${listing.join(", ")}. Pass a course folder or a cast's .yaml.`);
    }
    const viewerBase = findViewerBase(clone, folder);
    const common = { owner: t.owner, repo: t.repo, branch, base, clone: relative(ROOT, clone), viewerBase, pulled: new Date().toISOString() };

    const session = readSession(homedir());

    if (courseDir) {
      const slug = courseDir.split("/").at(-1);
      const work = resolve(ROOT, out ?? `dev-casts/courses/${slug}`);
      guardWorkdir(work, force);
      const text = readFileSync(at(joinRepo(courseDir, "course.md")), "utf8");
      // Every published lecture's text is read — and, if locked, unlocked with
      // the OWNER's own key — before anything is written to the workdir: a
      // private course whose key cannot be had must leave no half-written
      // workdir (only dev-casts/repos/'s clone, never the workdir, is touched).
      const { course, files, plain, anyPrivate } = await withVite(async (load) => {
        const course = await courseLectures(load, text);
        const { isLocked } = await load("/src/crypto/lecture-lock.ts");
        const files = course.lectures.map((l) => l.status?.file ?? null);
        const raw = files.map((f) => (f && existsSync(at(joinRepo(courseDir, f))) ? readFileSync(at(joinRepo(courseDir, f)), "utf8") : null));
        let anyPrivate = false, unlockForAuthor;
        const plain = [];
        for (const t of raw) {
          if (t === null || !isLocked(t)) {
            plain.push(t);
            continue;
          }
          anyPrivate = true;
          if (!session) throw new Error("This course is private — sign in (cast.mjs login) as its owner to pull it.");
          unlockForAuthor ??= (await load("/src/item-key.ts")).unlockForAuthor;
          const r = await unlockForAuthor(t, { api: session.api, token: () => session.key, fetchImpl: boundedFetch(), storage: null });
          if ("locked" in r) throw new Error(`This course is private — sign in (cast.mjs login) as its owner to pull it. (${r.locked})`);
          plain.push(r.text);
        }
        return { course, files, plain, anyPrivate };
      });
      mkdirSync(work, { recursive: true });
      writeFileSync(resolve(work, "course.md"), text);
      const copied = [];
      files.forEach((f, i) => {
        if (!f || plain[i] === null) return;
        writeFileSync(resolve(work, f), plain[i]);
        copied.push(f);
      });
      const coursesDir = courseDir.split("/").slice(0, -1).join("/");
      const lecture = isFile ? files.indexOf(t.path.split("/").at(-1)) + 1 || null : null;
      const origin = { kind: "course", ...common, path: courseDir, coursesDir, lecture };
      if (anyPrivate) origin.private = true;
      writeFileSync(resolve(work, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
      const lines = course.lectures.map((l, i) => `  ${String(i + 1).padStart(2)}. ${l.title}${files[i] && copied.includes(files[i]) ? "" : "   (not published — nothing to revise)"}${lecture === i + 1 ? "   ← the link pointed here" : ""}`);
      console.log(`${relative(ROOT, work)}: course "${text.match(/^# (.*)$/m)?.[1] ?? slug}" from ${t.owner}/${t.repo}@${branch}, ${copied.length} of ${files.length} lecture(s) published${anyPrivate ? " (private — unlocked with your key)" : ""}:\n${lines.join("\n")}\nNext: cast.mjs unpack ${relative(ROOT, work)} <n>  (a lecture → lecture-NN/part-*.json)`);
      return;
    }

    const file = t.path.split("/").at(-1);
    const slug = file.replace(/\.ya?ml$/i, "");
    const kind = folder.split("/").at(-1) === "sources" ? "source" : "cast";
    const work = resolve(ROOT, out ?? `dev-casts/pulled/${slug}`);
    guardWorkdir(work, force);
    const raw = readFileSync(at(t.path), "utf8");
    // Read and, if locked, unlocked before the workdir exists at all (see the
    // course branch above for why).
    const { text, isPrivate } = await withVite(async (load) => {
      const { isLocked } = await load("/src/crypto/lecture-lock.ts");
      if (!isLocked(raw)) return { text: raw, isPrivate: false };
      if (!session) throw new Error(`This ${kind} is private — sign in (cast.mjs login) as its owner to pull it.`);
      const { unlockForAuthor } = await load("/src/item-key.ts");
      const r = await unlockForAuthor(raw, { api: session.api, token: () => session.key, fetchImpl: boundedFetch(), storage: null });
      if ("locked" in r) throw new Error(`This ${kind} is private — sign in (cast.mjs login) as its owner to pull it. (${r.locked})`);
      return { text: r.text, isPrivate: true };
    });
    mkdirSync(work, { recursive: true });
    writeFileSync(resolve(work, file), text);
    const origin = { kind, ...common, path: t.path, castsDir: folder, file };
    if (isPrivate) origin.private = true;
    writeFileSync(resolve(work, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
    console.log(`${relative(ROOT, work)}/${file}: ${kind === "source" ? "a saved source" : "a published drawcast"} from ${t.owner}/${t.repo}@${branch}${isPrivate ? " (private — unlocked with your key)" : ""}.\nNext: cast.mjs unpack ${relative(ROOT, work)}/${file}`);
  },

  async unpack(args) {
    await withVite(async (load) => {
      const { parsePlaylistText } = await load("/src/playlist/playlist.ts");
      const { yaml, outdir } = await unpackTarget(load, args);
      const playlist = parsePlaylistText(readFileSync(yaml, "utf8"));
      mkdirSync(outdir, { recursive: true });
      for (const f of readdirSync(outdir)) if (/^part-\d+\.json$/.test(f)) throw new Error(`${relative(ROOT, outdir)} already holds part files — repack or remove them first`);
      let n = 0;
      const entries = playlist.entries.map((e) => {
        if (e.kind === "chapter") return { chapter: e.title };
        n++;
        writeFileSync(resolve(outdir, `part-${n}.json`), JSON.stringify(e.spec, null, 1) + "\n");
        return { part: n };
      });
      writeFileSync(resolve(outdir, "outline.json"), JSON.stringify({ source: relative(outdir, yaml), meta: playlist.meta, entries }, null, 1) + "\n");
      const audio = playlist.audio ? Object.keys(playlist.audio.lines).length : 0;
      const parts = entries.flatMap((e) => {
        if (!e.part) return [`  (chapter) ${e.chapter}`];
        const spec = JSON.parse(readFileSync(resolve(outdir, `part-${e.part}.json`), "utf8"));
        const next = spec.end_page === true || (spec.elements ?? []).some((el) => el.id === "nx_kicker");
        return [`  part-${e.part}.json  ${next ? "(the end page — push redraws it from course.md; add your own link elements to it, leave the rest)" : (spec.title ?? "")}`];
      });
      console.log(`${relative(ROOT, outdir)}: ${n} part(s)${audio ? `, ${audio} baked narration clip(s) kept aside in the source` : ""}\n${parts.join("\n")}\nEdit the parts (check/frames each), reorder/drop/add in outline.json entries, then: cast.mjs repack ${relative(ROOT, outdir)}`);
    });
  },

  async repack([outdir]) {
    if (!outdir) throw new Error("usage: cast.mjs repack <parts-dir>");
    const dir = resolve(ROOT, outdir);
    const outline = JSON.parse(readFileSync(resolve(dir, "outline.json"), "utf8"));
    const yaml = resolve(dir, outline.source);
    await withVite(async (load) => {
      const { parsePlaylistText, formatPublished } = await load("/src/playlist/playlist.ts");
      const { validateSpec } = await load("/src/spec/schema.ts");
      const { playlistSpeakLines } = await load("/src/playlist/session.ts");
      const { speechKey } = await load("/src/render/delivery.ts");
      const errors = [];
      const entries = outline.entries.map((e) => {
        if (e.chapter !== undefined) return { kind: "chapter", title: e.chapter };
        const f = resolve(dir, `part-${e.part}.json`);
        if (!existsSync(f)) throw new Error(`outline.json lists part ${e.part} but ${relative(ROOT, f)} is missing`);
        const spec = readCast(f);
        const v = validateSpec(spec);
        if (!v.ok) errors.push(...v.errors.map((m) => `part ${e.part}: ${m}`));
        return { kind: "item", spec };
      });
      if (errors.length) throw new Error(`not repacked — invalid:\n  ${errors.join("\n  ")}`);
      const playlist = { meta: outline.meta, entries, warnings: [] };
      // Narration is keyed by the sentence (speechKey): unchanged lines keep
      // their clip, and a clip for a line no longer said is dropped, as the
      // app's own bake does.
      const before = parsePlaylistText(readFileSync(yaml, "utf8")).audio;
      let audio = null, report = "";
      if (before) {
        const wanted = playlistSpeakLines(playlist).filter((l) => l.text.trim()).map(speechKey);
        const lines = Object.fromEntries(wanted.filter((k) => before.lines[k]).map((k) => [k, before.lines[k]]));
        audio = { ...before, lines };
        const missing = wanted.filter((k) => !before.lines[k]).length;
        const dropped = Object.keys(before.lines).length - Object.keys(lines).length;
        report = `\n  narration: ${Object.keys(lines).length} clip(s) kept, ${dropped} dropped (lines no longer said)` + (missing ? `, ${missing} line(s) with no recording — they play in the browser's voice until re-baked (republish with narration from the app)` : "");
      }
      writeFileSync(yaml, formatPublished(playlist, audio));
      console.log(`${relative(ROOT, yaml)}: ${entries.filter((e) => e.kind === "item").length} part(s) repacked${report}`);
    });
  },

  async "revise-prompt"([target, instruction, out]) {
    if (!target || !instruction) throw new Error('usage: cast.mjs revise-prompt <parts-dir | cast.json> "<what to change>" [out.md]');
    const t = resolve(ROOT, target);
    const files = existsSync(resolve(t, "outline.json")) ? readdirSync(t).filter((f) => /^part-\d+\.json$/.test(f)).map((f) => resolve(t, f)) : [t];
    const templates = [...new Set(files.map((f) => readCast(f)?.template).filter(Boolean))];
    out ??= `dev-casts/_revise-${relative(resolve(ROOT, "dev-casts"), t).replace(/\.json$/, "").replace(/[^\w-]+/g, "-").slice(-60)}.md`;
    await withVite(async (load) => {
      // The app's revise sends the compiler prompt with the document's own
      // templates in full (llm/revise.ts); the instruction picks the rest.
      const text = await appPromptText(load, instruction, templates);
      writeFileSync(resolve(ROOT, out), wrap(text) + `\n\n# THE CHANGE ASKED FOR\n\n${instruction}\n\nEdit the part file(s) in place; change only what this asks for. The spoken lines are the drawcast: keep every line the change does not touch word for word (its baked narration is keyed by the sentence).\n`);
      console.log(`${out}: ${text.length} characters — the app's rules and schema, with ${templates.length ? `the document's templates (${templates.join(", ")})` : "no template"} in full.`);
    });
  },

  async pack([file, work]) {
    if (!file || !work) throw new Error("usage: cast.mjs pack <cast.json> <workdir>");
    const spec = readCast(file);
    if (!spec) throw new Error(`${file} is not JSON — pack takes a {request, spec} or a spec; a YAML already is a cast file (copy it into the workdir)`);
    await withVite(async (load) => {
      const { validateSpec } = await load("/src/spec/schema.ts");
      const { formatSpec } = await load("/src/spec/text.ts");
      const v = validateSpec(spec);
      if (!v.ok) throw new Error(`${file} is invalid:\n  ${v.errors.join("\n  ")}`);
      const wd = resolve(ROOT, work);
      mkdirSync(wd, { recursive: true });
      const existing = readdirSync(wd).filter((f) => /\.ya?ml$/i.test(f));
      if (existing.length) throw new Error(`${work} already holds ${existing.join(", ")} — a cast workdir holds exactly one .yaml`);
      const name = basename(file).replace(/\.json$/i, "");
      writeFileSync(resolve(wd, `${name}.yaml`), formatSpec(spec, "yaml"));
      console.log(`${relative(ROOT, resolve(wd, `${name}.yaml`))}: ready for publish-target ${work} <owner/repo>`);
    });
  },

  async "publish-target"(args) {
    const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
    const [work, target] = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "--dir");
    if (!work || !target || !/^[\w.-]+\/[\w.-]+$/.test(target)) throw new Error("usage: cast.mjs publish-target <workdir> <owner/repo> [--dir <folder>] [--create]");
    const wd = resolve(ROOT, work);
    if (existsSync(resolve(wd, "origin.json"))) throw new Error(`${work} already has an origin.json — it is published; use push`);
    const [owner, repo] = target.split("/");
    const me = sh("gh", ["api", "user", "--jq", ".login"]);
    let info = spawnSync("gh", ["api", `repos/${owner}/${repo}`], { encoding: "utf8" });
    if (info.status !== 0) {
      if (!args.includes("--create")) throw new Error(`${owner}/${repo} does not exist (gh is signed in as ${me}) — pass --create to make it, public`);
      sh("gh", ["repo", "create", `${owner}/${repo}`, "--public", "--add-readme", "-d", "Drawcasts"]);
      info = spawnSync("gh", ["api", `repos/${owner}/${repo}`], { encoding: "utf8" });
    }
    const meta = JSON.parse(info.stdout);
    if (meta.private) throw new Error(`${owner}/${repo} is private — the player cannot read it; choose a public repo`);
    if (!meta.permissions?.push) throw new Error(`${me} cannot push to ${owner}/${repo}`);
    const branch = meta.default_branch;
    // Pages from the default branch's root; 409 means it is on already.
    const pages = spawnSync("gh", ["api", "-X", "POST", `repos/${owner}/${repo}/pages`, "-f", `source[branch]=${branch}`, "-f", "source[path]=/"], { encoding: "utf8" });
    if (pages.status !== 0 && !/409|already/i.test(pages.stderr + pages.stdout)) console.log(`(GitHub Pages not switched on: ${(pages.stderr || pages.stdout).trim()} — the #gh= player link works without it)`);

    const dir = (flag("--dir") ?? "").replace(/^\/+|\/+$/g, "");
    const isCourse = existsSync(resolve(wd, "course.md"));
    const { clone, base } = ensureClone(owner, repo, branch, [dir, isCourse ? "" : joinRepo(dir, "casts")]);
    await withVite(async (load) => {
      const { slugify, slugFor, parseManifest } = await load("/src/publish/github.ts");
      const { parseCastIndex } = await load("/src/publish/cast.ts");
      const { parseCourse, setCourseOption } = await load("/src/course/document.ts");
      const viewerBase = findViewerBase(clone, dir);
      // Entry names in a folder at `base` (the clone is sparse and blob-less, so not from the worktree).
      const treeAt = (folder) => sh("git", ["-C", clone, "ls-tree", "--name-only", base, folder ? `${folder}/` : ""].filter(Boolean)).split("\n").filter(Boolean).map((p) => p.split("/").at(-1));
      const common = { owner, repo, branch, base, clone: relative(ROOT, clone), viewerBase, dir, slugFor };
      if (isCourse) {
        const text = readFileSync(resolve(wd, "course.md"), "utf8");
        const course = parseCourse(text);
        const manifest = readAtCommit(clone, base, joinRepo(dir, "courses.json"));
        const taken = takenSlugs({ kind: "course", listed: manifest ? parseManifest(manifest).courses.map((c) => c.slug) : [], tree: treeAt(dir) });
        const { origin, slug } = publishOrigin({ ...common, kind: "course", slug: course.context.slug ?? slugify(course.title || basename(wd)), takenSlugs: taken });
        if (course.context.slug !== slug) writeFileSync(resolve(wd, "course.md"), setCourseOption(text, "slug", slug));
        writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
        console.log(`${work} → ${owner}/${repo}/${origin.path} (as ${me}). Page after push: ${pagesUrlFor(owner, repo, origin.path)}\nNext: cast.mjs push ${work} --dry-run`);
        return;
      }
      const yamls = readdirSync(wd).filter((f) => /\.ya?ml$/i.test(f));
      if (yamls.length !== 1) throw new Error(`${work} must hold exactly one .yaml or a course.md (it holds ${yamls.length} .yaml)`);
      const index = readAtCommit(clone, base, joinRepo(dir, "casts", "casts.json"));
      const taken = takenSlugs({ kind: "cast", listed: index ? parseCastIndex(index).casts.map((c) => c.slug) : [], tree: treeAt(joinRepo(dir, "casts")) });
      const { origin } = publishOrigin({ ...common, kind: "cast", slug: slugify(yamls[0].replace(/\.ya?ml$/i, "")), takenSlugs: taken });
      if (origin.file !== yamls[0]) writeFileSync(resolve(wd, origin.file), readFileSync(resolve(wd, yamls[0])));
      writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
      console.log(`${work} → ${owner}/${repo}/${origin.path} (as ${me}). Player after push: ${viewerBase}#gh=${owner}/${repo}/${origin.path}\nNext: cast.mjs push ${work} --dry-run`);
    });
  },

  async login() {
    const api = apiUrl();
    const { key, email } = await deviceLogin({ api, label: `Claude Code on ${hostname()}` });
    writeSession(homedir(), { api, key, email });
    console.log(`Signed in to ${api} as ${email}. Sign this terminal out with cast.mjs logout, or under Signed-in browsers on your account page.`);
  },

  async logout() {
    const s = readSession(homedir());
    if (s) await fetch(`${s.api}/_/api/signout`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ key: s.key }) }).catch(() => {});
    clearSession(homedir());
    console.log(s ? "Signed out." : "Not signed in.");
  },

  async name(args) {
    const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
    const [work, raw] = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "--price");
    if (!work || !raw) throw new Error("usage: cast.mjs name <workdir> <name> [--buy --price <cents>]");
    const wd = resolve(ROOT, work);
    if (!existsSync(resolve(wd, "origin.json"))) throw new Error(`${work} is not published (no origin.json) — publish-target and push it first`);
    const origin = JSON.parse(readFileSync(resolve(wd, "origin.json"), "utf8"));
    const prState = origin.published === "pr" && origin.pr?.url ? spawnSync("gh", ["pr", "view", origin.pr.url, "--json", "state", "--jq", ".state"], { encoding: "utf8" }).stdout.trim() : null;
    const blocked = nameBlocker(origin, prState);
    if (blocked) throw new Error(`${work}: ${blocked}`);
    if (origin.published === "pr") {
      delete origin.published; // merged: live now
      writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
    }
    const s = readSession(homedir());
    await withVite(async (load) => {
      const N = await load("/src/names.ts");
      const lib = { ...(await load("/src/course/publish.ts")), ...(await load("/src/publish/cast.ts")), ...(await load("/src/course/document.ts")) };
      const name = N.normalizeName(raw);
      if (!name) return console.log(nameAdvice("invalid", raw, 0));
      if (!N.isPayable(name)) return console.log(nameAdvice("short", name, 0));
      if (!s) return console.log(nameAdvice("key", name, 0));
      const price = N.priceFor(name);
      const courseText = origin.kind === "course" ? readFileSync(resolve(wd, "course.md"), "utf8") : undefined;
      const reg = { key: s.key, ...registrationFor(origin, name, lib, courseText) };
      if (!args.includes("--buy")) {
        return console.log(nameAdvice(await checkName(N, s.api, reg), name, price));
      }
      // Already yours: POST /name repoints it, free. A free name answers "pay".
      const first = await N.registerName(s.api, reg);
      if (first === "ok") return console.log(`https://drawcast.app/#${name} now points at ${reg.target}.`);
      if (first !== "pay") return console.log(nameAdvice(first, name, price));
      if (Number(flag("--price")) !== price) throw new Error(`--price must be ${price} (${N.formatPrice(price)}) — say the price to the user and get a yes first`);
      const pay = await N.startNamePayment(s.api, { ...reg, return: "https://drawcast.app/" });
      if (typeof pay !== "object") return console.log(nameAdvice(pay, name, price));
      origin.pendingName = { name, target: reg.target, started: new Date().toISOString() };
      writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
      spawnSync("open", [pay.url]);
      console.log(`Opened Stripe Checkout for drawcast.app/#${name} (${N.formatPrice(price)}) in the browser:\n  ${pay.url}\nPay there, then: cast.mjs name-wait ${work}`);
    });
  },

  async "name-wait"(args) {
    const [work] = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "--timeout");
    if (!work) throw new Error("usage: cast.mjs name-wait <workdir> [--timeout <seconds>]");
    const timeoutS = Number(args.includes("--timeout") ? args[args.indexOf("--timeout") + 1] : 540);
    const wd = resolve(ROOT, work);
    const origin = JSON.parse(readFileSync(resolve(wd, "origin.json"), "utf8"));
    const p = origin.pendingName;
    if (!p) throw new Error(`${work} has no name being bought — run cast.mjs name … --buy first`);
    const outcome = await waitForName({ api: readSession(homedir())?.api ?? apiUrl(), name: p.name, target: p.target, timeoutS });
    if (outcome === "timeout") return console.log(`drawcast.app/#${p.name} is not paid (yet). If the payment went through, run name-wait again; a cancelled checkout charges nothing.`);
    if (outcome === "elsewhere") return console.log(`drawcast.app/#${p.name} went to someone else between checkout and payment — the payment is refunded by hand (write to the drawcast server's owner). Pick another name.`);
    origin.registered = p.name;
    delete origin.pendingName;
    writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
    if (origin.kind !== "course") return console.log(`https://drawcast.app/#${p.name} is yours and plays the drawcast.`);
    const { setCourseOption } = await withVite((load) => load("/src/course/document.ts"));
    const f = resolve(wd, "course.md");
    writeFileSync(f, setCourseOption(readFileSync(f, "utf8"), "name", p.name));
    console.log(`https://drawcast.app/#${p.name} is yours and plays the course. Push once more (cast.mjs push ${work} --direct) so the course page carries the name.`);
  },

  /**
   * Registry delivery 2, task 11: what makes a pushed course/cast lock
   * instead of publishing plain — quotes what is due right now, and, on the
   * user's own yes to that price (`--price` must equal the quote's `due`,
   * exactly like `name --buy`), opens Stripe Checkout and waits for it to
   * clear. Never prints the key; `push` (not this command) is what actually
   * locks and commits, once origin.private is true.
   *
   * `--unlisted` (registry deliveries 3–4, task 10) buys private AND
   * unlisted in the SAME purchase — one payment covers both (plan ruling 8)
   * — by sending `listed: false` through `payListedFields`, the app's own
   * single place these two booleans are assembled (src/ui/share.ts); without
   * it the item stays listed (`payListedFields(true, true)`). Fix round 1:
   * the pay body must send `private`/`listed` explicitly — the server
   * defaults an absent `private` to true, but never omit it either way.
   */
  async private(args) {
    const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
    const unlisted = args.includes("--unlisted");
    const [work] = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "--price");
    if (!work) throw new Error("usage: cast.mjs private <workdir> [--price <cents>] [--unlisted]");
    const wd = resolve(ROOT, work);
    if (!existsSync(resolve(wd, "origin.json"))) throw new Error(`${work} is not published (no origin.json) — publish-target and push it first`);
    const origin = JSON.parse(readFileSync(resolve(wd, "origin.json"), "utf8"));
    if (!registrable(origin)) throw new Error(`a ${origin.kind} cannot be made private — only a cast or a course`);
    const session = readSession(homedir());
    if (!session) throw new Error("not signed in to drawcast — run: node scripts/cast.mjs login");
    const priceArg = flag("--price");

    await withVite(async (load) => {
      const lib = { ...(await load("/src/course/publish.ts")), ...(await load("/src/publish/cast.ts")), ...(await load("/src/course/document.ts")) };
      const { quotePrivate, startPrivatePayment } = await load("/src/registry.ts");
      const { payListedFields } = await load("/src/ui/share.ts");
      const courseText = origin.kind === "course" ? readFileSync(resolve(wd, "course.md"), "utf8") : undefined;
      const reg = registerFor(origin, lib, courseText);
      // A cast's target/item is the ONE prediction publish/cast.ts's own
      // privateCastTarget makes (fix round 1, #6) — the same function Share
      // itself quotes and locks under — rather than a second copy of it;
      // `registerFor`'s own target agrees with it for cast.mjs's own casts
      // (it never renames on push), but this is the app's shared source of
      // truth, not a re-derivation. A course has no such helper: its item IS
      // its registry target, unchanged.
      const target = registryTargetFor(origin, lib, reg);
      const lectures = origin.kind === "course" ? Math.max(1, reg.lectures.length) : 1;
      const body = { key: session.key, kind: origin.kind, target, lectures, private: true, listed: !unlisted };
      const quote = await quotePrivate(session.api, body, boundedFetch());

      if (!priceArg) {
        // Already fully settled server-side (paid some other way — e.g. a
        // retry after a poll that never got to finish): worth recording
        // locally too, so a plain `push` after this locks it without
        // re-running `private` first.
        if (typeof quote === "object" && quote.due === 0 && quote.private === true && !origin.private) {
          origin.private = true;
          writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
        }
        return console.log(privateQuoteAdvice(quote, work));
      }
      if (typeof quote !== "object" || quote.owner === "other") throw new Error(privateQuoteAdvice(quote, work));
      if (Number(priceArg) !== quote.due) throw new Error(`--price must be ${quote.due} (${dollars(quote.due)}) — say the price to the user and get a yes first`);

      const pay = await startPrivatePayment(
        session.api,
        { key: session.key, kind: origin.kind, target, title: reg.title, page: reg.page, lectures, ...payListedFields(true, !unlisted), return: "https://drawcast.app/" },
        boundedFetch(),
      );
      if (typeof pay !== "object") throw new Error(privatePayAdvice(pay));
      spawnSync("open", [pay.url]);
      console.log(`Opened Stripe Checkout for ${origin.kind === "course" ? "this private course" : "this private drawcast"}${unlisted ? ", unlisted," : ""} (${dollars(quote.due)}) in the browser:\n  ${pay.url}\nPay there — waiting…`);

      const outcome = await waitForPrivate({ api: session.api, body, quotePrivate, fetchImpl: boundedFetch() });
      if (outcome !== "paid") return console.log("Not paid (yet) — run private again after paying.");
      origin.private = true;
      writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
      console.log("Private is paid — push to publish locked.");
    });
  },

  /**
   * Registry deliveries 3–4, task 10: whether an already-registered course
   * or cast shows in the public catalogue (drawcast.app/#browse) — takes
   * effect at once, no push needed (unlike Private above). Listing (again)
   * is always free; unlisting is free only once the item has ever paid for
   * Private or an earlier unlisted purchase (`paid_lectures > 0`) —
   * otherwise it costs the same one-time fee as Private (plan ruling 8),
   * asked for on the user's own yes to it, exactly like `private` itself.
   * The item stays PUBLIC either way: this only ever changes the catalogue
   * listing, never the lock. Never prints the key.
   */
  async listing(args) {
    const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
    const wantListed = args.includes("--listed");
    const wantUnlisted = args.includes("--unlisted");
    if (wantListed === wantUnlisted) throw new Error("usage: cast.mjs listing <workdir> --listed | --unlisted [--price <cents>]");
    const [work] = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "--price");
    if (!work) throw new Error("usage: cast.mjs listing <workdir> --listed | --unlisted [--price <cents>]");
    const wd = resolve(ROOT, work);
    if (!existsSync(resolve(wd, "origin.json"))) throw new Error(`${work} is not published (no origin.json) — publish-target and push it first`);
    const origin = JSON.parse(readFileSync(resolve(wd, "origin.json"), "utf8"));
    if (!registrable(origin)) throw new Error(`a ${origin.kind} cannot be listed — only a cast or a course`);
    const session = readSession(homedir());
    if (!session) throw new Error("not signed in to drawcast — run: node scripts/cast.mjs login");
    const priceArg = flag("--price");

    await withVite(async (load) => {
      const lib = { ...(await load("/src/course/publish.ts")), ...(await load("/src/publish/cast.ts")), ...(await load("/src/course/document.ts")) };
      const { quotePrivate, startPrivatePayment, setListing, registryItemKey } = await load("/src/registry.ts");
      const { payListedFields } = await load("/src/ui/share.ts");
      const courseText = origin.kind === "course" ? readFileSync(resolve(wd, "course.md"), "utf8") : undefined;
      const reg = registerFor(origin, lib, courseText);
      // The same target `private` quotes and locks under (a cast's is
      // privateCastTarget's) — one derivation, registryTargetFor.
      const target = registryTargetFor(origin, lib, reg);
      const item = registryItemKey(origin.kind, target);
      const lectures = origin.kind === "course" ? Math.max(1, reg.lectures.length) : 1;
      // The quote — read-only — only tells an item owned by someone else
      // apart up front; it never decides the price here (a grown course's
      // quote can say due > 0 where the free unlist would work — final
      // review M4). It is also what waitForListing polls after paying.
      // `private: false`: listing never touches the lock, only the catalogue.
      const body = { key: session.key, kind: origin.kind, target, lectures, private: false, listed: wantListed };
      const quote = await quotePrivate(session.api, body, boundedFetch());
      if (typeof quote !== "object" || quote.owner === "other") throw new Error(privateQuoteAdvice(quote, work));

      if (wantListed) {
        const r = await setListing(session.api, session.key, item, true, boundedFetch());
        return console.log(listingAdvice(r, true, work));
      }

      // --unlisted: try the free unlist first — the server allows it at once
      // when the item is already covered (paid_lectures > 0: a private
      // purchase or an earlier unlisted one). Only its 402 {due} falls into
      // the priced path — the same price as Private, paid once (plan ruling
      // 8), and only on --price equal to that due (final review M4).
      const r = await setListing(session.api, session.key, item, false, boundedFetch());
      const step = unlistStep(r, priceArg, work);
      if ("message" in step) return console.log(step.message);

      // The item stays public — payListedFields(false, false) — so this
      // purchase never locks it, only settles listed:false (fix round 1's
      // invariant: never omit `private` either way).
      const pay = await startPrivatePayment(
        session.api,
        { key: session.key, kind: origin.kind, target, title: reg.title, page: reg.page, lectures, ...payListedFields(false, false), return: "https://drawcast.app/" },
        boundedFetch(),
      );
      if (typeof pay !== "object") throw new Error(privatePayAdvice(pay));
      spawnSync("open", [pay.url]);
      console.log(`Opened Stripe Checkout to unlist this ${origin.kind === "course" ? "course" : "drawcast"} (${dollars(step.pay)}) in the browser:\n  ${pay.url}\nPay there — waiting…`);

      const outcome = await waitForListing({ api: session.api, body, quotePrivate, wantListed: false, fetchImpl: boundedFetch() });
      console.log(outcome === "done" ? `${work}: unlisted.` : "Not paid (yet) — run listing --unlisted again after paying.");
    });
  },

  /**
   * Registry delivery 3, task 5 (skill half): the signed-in author's
   * narration-credit balance, and buying more of it (500/1000/2000 cents —
   * 5/10/20 USD, the only three packs) when the user has said yes to that
   * exact amount — never picked by the skill itself (SKILL.md says so).
   * Waits (up to 9 minutes) for the balance to rise, the same "poll until
   * it changed" idiom as `private`/`name-wait`. Never prints the key.
   */
  async credit(args) {
    const cents = args.includes("--buy") ? Number(args[args.indexOf("--buy") + 1]) : null;
    if (args.includes("--buy") && ![500, 1000, 2000].includes(cents)) throw new Error("usage: cast.mjs credit [--buy <500|1000|2000>] — the three credit packs (5/10/20 USD); say the amount to the user and get a yes first");
    const session = readSession(homedir());
    if (!session) throw new Error("not signed in to drawcast — run: node scripts/cast.mjs login");

    await withVite(async (load) => {
      const { creditBalance, startCreditPayment } = await load("/src/credit.ts");
      if (cents === null) {
        const balance = await creditBalance(session.api, session.key, boundedFetch());
        return console.log(creditBalanceAdvice(balance));
      }
      // Never assumed 0 — a failed read is retried once, then the purchase
      // stops here, before Checkout opens (task 10 review).
      const startMicro = await creditBaseline({ api: session.api, key: session.key, creditBalance, fetchImpl: boundedFetch() });
      const pay = await startCreditPayment(session.api, { key: session.key, cents, return: "https://drawcast.app/" }, boundedFetch());
      if (typeof pay !== "object") throw new Error(creditPayAdvice(pay));
      spawnSync("open", [pay.url]);
      console.log(`Opened Stripe Checkout for ${dollars(cents)} of narration credit in the browser:\n  ${pay.url}\nPay there — waiting…`);

      const outcome = await waitForCredit({ api: session.api, key: session.key, startMicro, creditBalance, fetchImpl: boundedFetch() });
      if (outcome === "timeout") return console.log("Not paid (yet) — run credit again after paying, or credit to check the new balance.");
      console.log(`Credit purchased — new balance: ${outcome.balanceUsd} USD.`);
    });
  },

  /** For a first publish that went out as a PR (push without --direct): the
   *  claim file rode along in that commit, but registering it — and minting
   *  its free name — has to wait until the PR is merged and the claim file
   *  is live on the default branch. Run this once it is. A --direct push
   *  never needs it: push registers on its own, right after the commit. */
  async register([work]) {
    if (!work) throw new Error("usage: cast.mjs register <workdir>");
    const wd = resolve(ROOT, work);
    if (!existsSync(resolve(wd, "origin.json"))) throw new Error(`${work} is not published (no origin.json) — publish-target and push it first`);
    const origin = JSON.parse(readFileSync(resolve(wd, "origin.json"), "utf8"));
    const prState = origin.published === "pr" && origin.pr?.url ? spawnSync("gh", ["pr", "view", origin.pr.url, "--json", "state", "--jq", ".state"], { encoding: "utf8" }).stdout.trim() : null;
    const blocked = nameBlocker(origin, prState);
    if (blocked) throw new Error(`${work}: ${blocked}`);
    if (origin.published === "pr") {
      delete origin.published; // merged: live now
      writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
    }
    const session = readSession(homedir());
    const note = await registerPublished(origin, wd, session, true);
    console.log(note ? `${work}${note}` : `${work}: registered (no free name)`);
  },

  async push(args) {
    const direct = args.includes("--direct"), dry = args.includes("--dry-run"), fresh = args.includes("--new-pr"), local = args.includes("--no-push");
    const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
    const message = flag("-m"), body = flag("--body");
    const [work] = args.filter((a, i) => !a.startsWith("-") && !["-m", "--body"].includes(args[i - 1]));
    if (!work) throw new Error('usage: cast.mjs push <workdir> [--dry-run | --no-push] [--direct] [-m "<commit message>"] [--body "<PR description>"] [--new-pr]');
    const wd = resolve(ROOT, work);
    const origin = JSON.parse(readFileSync(resolve(wd, "origin.json"), "utf8"));
    if (origin.kind === "source" && origin.private) throw new Error("a private source can't be pushed");
    const clone = resolve(ROOT, origin.clone);
    const repo = { owner: origin.owner, repo: origin.repo };
    const git = (...a) => sh("git", ["-C", clone, ...a]);

    // Nothing is overwritten that changed upstream since the pull.
    git("fetch", "--quiet", "--depth", "1", "origin", origin.branch);
    const upstream = git("rev-parse", "FETCH_HEAD");
    const watched = origin.kind === "course" ? [origin.path, joinRepo(origin.coursesDir, "courses.json")] : [origin.path];
    const moved = upstream === origin.base ? "" : git("diff", "--name-only", origin.base, upstream, "--", ...watched);
    if (moved) throw new Error(`changed on GitHub since the pull, not pushed:\n  ${moved.split("\n").join("\n  ")}\nPull again into a fresh workdir and carry the revision over.`);

    const session = readSession(homedir());
    if (origin.private && !session) throw new Error("This is private — sign in (cast.mjs login) as its owner to push it.");
    // Registry delivery 1: signed in, the claim file rides in the SAME
    // commit as the revision — proof Anvil reads back from GitHub once the
    // commit lands (registerPublished's verifyClaim, after a --direct
    // push). Bounded (fix round 1): a stalled Anvil must never hang a
    // dry run's claim, let alone a real push. `claim` set here (a closure
    // over the withVite callback below) so a failed or not-yet-deployed
    // /claim (null) adds no file at all. It joins the commit only once the
    // push rights are known (shouldClaim, below — final review C2); a
    // source revision never asks for one (M4).
    let claim = null;
    const files = await withVite(async (load) => {
      // Registry delivery 2 (fix round 1, #5): signed in and registrable, the
      // server itself is asked (once — `lockPrivate` below reuses this SAME
      // quote/reg/item rather than asking again) whether this is ACTUALLY
      // private. A local origin.private that never got set — a `private`
      // poll that timed out AFTER the payment cleared — must not let an
      // already-paid course/cast publish in plaintext: the server's own
      // `private` wins over the local flag, and a positive answer is
      // recorded here so the next push does not have to ask again.
      let quote = null, reg = null, item = null, lectures = 1;
      if (session && registrable(origin)) {
        const { claimFile } = await load("/src/registry.ts");
        claim = await claimFile(session.api, session.key, joinRepo(origin.owner, origin.repo), boundedFetch());

        const lib = { ...(await load("/src/course/publish.ts")), ...(await load("/src/publish/cast.ts")), ...(await load("/src/course/document.ts")) };
        const courseText = origin.kind === "course" ? readFileSync(resolve(wd, "course.md"), "utf8") : undefined;
        reg = registerFor(origin, lib, courseText);
        item = privateItemFor(origin, reg);
        lectures = origin.kind === "course" ? Math.max(1, reg.lectures.length) : 1;
        const { quotePrivate } = await load("/src/registry.ts");
        quote = await quotePrivate(session.api, { key: session.key, kind: origin.kind, target: reg.target, lectures, private: true }, boundedFetch());
        if (typeof quote === "object" && quote.private === true && !origin.private) {
          origin.private = true;
          writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
        }
      }
      if (origin.kind === "source") return { files: [{ path: origin.path, content: readFileSync(resolve(wd, origin.file), "utf8") }], deletions: [] };

      // A PRIVATE push (registry delivery 2, task 11): refuses — with the
      // price and the exact `private` command if more is due, exactly the
      // wording `private` itself prints — then fetches the item key as the
      // owner and locks every lecture file of the plan with the APP'S OWN
      // publish/lock.ts lockLectureFiles (not a second copy of it: it checks
      // every locked result starts with the envelope header, drops any
      // stray `bytes`, and refuses a missing lecture path or a `.png`).
      // A private push also removes any poster an earlier PUBLIC publish
      // left for these same lecture paths, exactly as the app's own
      // commitPublish/publishCast do (fix round 1, #1) — a thumbnail would
      // show a frame of what is now locked; only paths that actually exist
      // upstream are scheduled for deletion (readAtCommit), never a phantom
      // one. All before anything is written: a throw here (a refused quote,
      // a missing key, an unregistered name, a lock failure) leaves no git
      // write behind.
      const lockPrivate = async (planFiles, lecturePaths) => {
        if (typeof quote !== "object" || quote.owner === "other" || quote.due > 0) throw new Error(privateQuoteAdvice(quote, work));
        // Covered but never flipped private (an earlier unlist-only
        // purchase): settle it through the same endpoint the Pay button
        // uses before asking for the key — a due-0 quote answers 409
        // nothing-due, which is success here.
        if (!quote.private) {
          const { ensurePrivateApplied } = await load("/src/registry.ts");
          const { payListedFields } = await load("/src/ui/share.ts");
          const applied = await ensurePrivateApplied(
            session.api,
            session.key,
            { kind: origin.kind, target: reg.target, title: reg.title, page: reg.page, lectures, ...payListedFields(true, quote.listed ?? true), return: "https://drawcast.app/" },
            boundedFetch(),
          );
          if (applied !== "ok") throw new Error(privatePayAdvice(applied));
        }
        const { fetchItemKey } = await load("/src/item-key.ts");
        const got = await fetchItemKey(session.api, session.key, item, boundedFetch(), null);
        if (!("key" in got)) throw new Error("Not pushed: the private key isn't available — is private paid for, and are you signed in as the owner?");
        // Known here, before anything is locked: a private course with no
        // registered name would ship a page nobody can join (ui/course.ts's
        // own check, fix round 1, #3).
        if (origin.kind === "course" && !quote.name) throw new Error("Not pushed: the course's link isn't registered yet — try again in a minute.");
        const { lockText } = await load("/src/crypto/lecture-lock.ts");
        const { lockLectureFiles } = await load("/src/publish/lock.ts");
        const locked = await lockLectureFiles(planFiles, lecturePaths, (_path, text) => lockText(text, got.key, item));
        const { posterPathFor } = await load("/src/publish/cast.ts");
        const posters = lecturePaths.map((p) => posterPathFor(p)).filter((p) => readAtCommit(clone, upstream, p) !== null);
        return { files: locked, deletions: posters };
      };

      if (origin.kind === "cast") {
        const { buildCastPlan, parseCastIndex, emptyCastIndex } = await load("/src/publish/cast.ts");
        const { parsePlaylistText, itemsOf } = await load("/src/playlist/playlist.ts");
        const text = readFileSync(resolve(wd, origin.file), "utf8");
        const p = parsePlaylistText(text);
        const title = p.meta.title ?? itemsOf(p)[0]?.spec.title ?? "";
        const indexText = readAtCommit(clone, upstream, joinRepo(origin.castsDir, "casts.json"));
        const slug = origin.file.replace(/\.ya?ml$/i, "");
        const plan = buildCastPlan({ title, text, slug, previousSlug: slug, repo, castsDir: origin.castsDir, viewerBase: origin.viewerBase, index: indexText ? parseCastIndex(indexText) : emptyCastIndex() });
        if (!origin.private) return { files: plan.files, deletions: [] };
        const castPath = joinRepo(origin.castsDir, `${plan.slug}.yaml`);
        const locked = await lockPrivate(plan.files, [castPath]);
        return { files: locked.files, deletions: locked.deletions };
      }
      const { buildPublishPlan } = await load("/src/course/publish.ts");
      const { parseCourse } = await load("/src/course/document.ts");
      const { parseManifest, emptyManifest } = await load("/src/publish/github.ts");
      const { doorlessNote } = await load("/src/course/page.ts");
      const { parsePlaylistText, formatPublished, isEndPage } = await load("/src/playlist/playlist.ts");
      const { endPageFor } = await load("/src/course/run.ts");
      let text = readFileSync(resolve(wd, "course.md"), "utf8");
      // A private course publishes `private: true` and its Join door in
      // course.md itself (final review I1a) — so an app that loads it back
      // from GitHub knows it is private — written into the workdir first, so
      // the published course.md and the workdir agree.
      if (origin.private) {
        const { setCourseOption } = await load("/src/course/document.ts");
        const { applyJoinDoor } = await load("/src/course/publish.ts");
        text = privateCourseText(text, { setCourseOption, applyJoinDoor });
        writeFileSync(resolve(wd, "course.md"), text);
      }
      const course = parseCourse(text);
      const manifestText = readAtCommit(clone, upstream, joinRepo(origin.coursesDir, "courses.json"));
      const plan = buildPublishPlan({
        course,
        text,
        repo,
        coursesDir: origin.coursesDir,
        viewerBase: origin.viewerBase,
        manifest: manifestText ? parseManifest(manifestText) : emptyManifest(),
        lectureYaml: (i) => {
          const f = course.lectures[i].status?.file;
          if (!f || !existsSync(resolve(wd, f))) return null;
          // What course/run.ts's lecturePlaylist ties to the course's order:
          // the lecture's title and its end page (or the legacy drawn "Next"
          // card, which becomes an end page). A retitled or reordered course
          // gets them redrawn, as a rebuild would; an author's own links on
          // the old end page are kept.
          const p = parsePlaylistText(readFileSync(resolve(wd, f), "utf8"));
          p.meta.title = course.lectures[i].title;
          const last = p.entries.at(-1);
          const hadEnd = last?.kind === "item" && isEndPage(last.spec);
          if (hadEnd) p.entries.pop();
          const end = endPageFor(course, i);
          if (end) {
            const own = hadEnd ? (last.spec.elements ?? []).filter((e) => e.type === "link" && !/^end_/.test(e.id)) : [];
            if (own.length > 0) {
              end.elements = [...(end.elements ?? []), ...own];
              end.commands = [...(end.commands ?? []), { draw: own.map((e) => e.id) }];
            }
            p.entries.push({ kind: "item", spec: end });
          }
          return formatPublished(p, p.audio ?? null);
        },
        // A name bought here (name-wait) is the door's; otherwise the page keeps the door it had.
        door: origin.registered
          ? { name: origin.registered, app: "https://drawcast.app/" }
          : pageDoor(readAtCommit(clone, upstream, joinRepo(origin.path, "index.html")), doorlessNote),
      });
      if (!origin.private) return { files: plan.files, deletions: plan.deletions };
      const courseDir = joinRepo(origin.coursesDir, plan.slug);
      const lecturePaths = [...plan.fileOf.values()].map((name) => joinRepo(courseDir, name));
      const locked = await lockPrivate(plan.files, lecturePaths);
      return { files: locked.files, deletions: [...plan.deletions, ...locked.deletions] };
    });

    // What would change, against the repo as it is now.
    const changes = [];
    for (const f of files.files) {
      const now = readAtCommit(clone, upstream, f.path);
      if (now === null) changes.push(["new", f.path]);
      else if (now !== f.content) changes.push(["changed", f.path]);
    }
    for (const p of files.deletions) changes.push(["deleted", p]);
    // The date in the manifests changes on every publish; alone it is no
    // change — nor is the claim file (registry delivery 1): a first push
    // adds it and a stale pending nonce (older than an hour) rotates it, so
    // on its own it must never turn "nothing to push" into a push. (It is
    // not in `files` yet here — it joins below, once shouldClaim allows.)
    const real = changes.filter(([, p]) => !/(^|\/)(courses\.json|casts\.json|index\.html|README\.md|\.drawcast\/claim)$/.test(p));
    console.log(changes.length ? changes.map(([k, p]) => `  ${k.padEnd(8)} ${p}`).join("\n") : "  nothing differs from GitHub");
    if (!real.length) return console.log("Nothing to push.");
    if (dry) return console.log("(dry run — nothing written)");

    // A first publish (publish-target) says so in its branch, commit and PR; once pushed it is a revision like any other.
    const verb = origin.published === "new" ? "publish" : "revise";
    const perm = local ? { push: true } : JSON.parse(sh("gh", ["api", `repos/${origin.owner}/${origin.repo}`, "--jq", "{push: .permissions.push}"]));
    const me = local ? "" : sh("gh", ["api", "user", "--jq", ".login"]);
    if (direct && !perm.push) throw new Error(`${me} cannot push to ${origin.owner}/${origin.repo} — drop --direct to open a pull request from a fork`);
    // The claim file only where the pusher could have pushed it themselves
    // (final review C2): a fork's PR, once merged, would otherwise prove the
    // CONTRIBUTOR and hand them every unproven row under this repo.
    if (claim && !shouldClaim({ kind: origin.kind, direct, canPush: perm.push === true })) claim = null;
    if (claim) files.files = [...files.files, claim];
    const branch = direct ? origin.branch : !fresh && origin.pr?.branch ? origin.pr.branch : `drawcast/${verb}-${basename(origin.path).replace(/\.ya?ml$/i, "")}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
    // A PR branch already pushed is built on (its PR updates); anything else starts from upstream.
    const onPr = !direct && origin.pr?.branch === branch;
    git("checkout", "--quiet", "--force", "-B", branch, upstream);
    if (onPr) {
      const remote = origin.pr.remote;
      try {
        git("fetch", "--quiet", remote, branch);
        git("reset", "--quiet", "--hard", "FETCH_HEAD");
      } catch {
        /* the PR branch is gone (merged and deleted): start a fresh one from upstream */
      }
    }
    const extra = new Set(files.files.map((f) => f.path.split("/").slice(0, -1).join("/")).filter(Boolean));
    if (extra.size) git("sparse-checkout", "add", ...extra);
    for (const f of files.files) {
      mkdirSync(resolve(clone, f.path, ".."), { recursive: true });
      writeFileSync(resolve(clone, f.path), f.bytes ?? f.content);
    }
    for (const p of files.deletions) if (existsSync(resolve(clone, p))) git("rm", "--quiet", p);
    git("add", "--sparse", ...files.files.map((f) => f.path));
    if (!git("status", "--porcelain")) return console.log("Nothing to push (the branch already has these changes).");
    const title = origin.kind === "course" ? readFileSync(resolve(wd, "course.md"), "utf8").match(/^# (.*)$/m)?.[1] : origin.file;
    git("commit", "--quiet", "-m", message ?? `drawcast: ${verb} ${origin.kind} "${title}"`);

    if (local) return console.log(`Committed on ${branch} in ${origin.clone}, not pushed:\n${git("show", "--stat", "--format=%h %s", "HEAD")}`);

    // gh's own credentials for the push, without touching the git config.
    const pushTo = (remote, ref) => sh("git", ["-C", clone, "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "push", "--quiet", remote, ref]);
    if (direct) {
      pushTo("origin", `HEAD:${origin.branch}`);
      origin.base = git("rev-parse", "HEAD");
      delete origin.published;
      // Bookkeeping first: the base/published above are what keep the link
      // permanent, and must not wait behind a network call to the registry.
      writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
      // The commit — and the claim file inside it, if one rode along — are
      // now live: verify it, then register (registry delivery 1). Wrapped:
      // a push that already landed must never be reported as a failure
      // because the registry step after it stumbled.
      let note = "";
      try {
        if (registrable(origin)) note = await registerPublished(origin, wd, session, Boolean(claim));
      } catch (err) {
        console.error("drawcast: registry step failed (the push itself already landed)", err);
      }
      return console.log(`Pushed to ${origin.owner}/${origin.repo}@${origin.branch} (${origin.base.slice(0, 7)}). The viewer reads raw.githubusercontent.com, which can lag a few minutes.${note}`);
    }
    let remote = "origin", head = branch;
    if (!perm.push) {
      sh("gh", ["repo", "fork", `${origin.owner}/${origin.repo}`, "--clone=false"]);
      remote = `https://github.com/${me}/${origin.repo}.git`;
      head = `${me}:${branch}`;
    }
    pushTo(remote, `HEAD:refs/heads/${branch}`);
    let url = onPr ? origin.pr.url : null;
    if (!url) {
      url = sh("gh", ["pr", "create", "--repo", `${origin.owner}/${origin.repo}`, "--base", origin.branch, "--head", head, "--title", message ?? `${verb === "publish" ? "Publish" : "Revise"} ${origin.kind}: ${title}`, "--body", body ?? `A revision made with the drawcast skill (scripts/cast.mjs push).\n\nFiles:\n${changes.map(([k, p]) => `- ${k} \`${p}\``).join("\n")}`]);
    }
    origin.pr = { url, branch, remote };
    // A first publish in a PR is live only once merged — name checks (nameBlocker).
    if (origin.published === "new") origin.published = "pr";
    writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
    console.log(`${onPr ? "Updated" : "Opened"} ${url}`);
    // The claim file rode along in this commit too, but it is not live on
    // the default branch — and so not registerable — until the PR merges.
    if (registrable(origin)) console.log(`Register after the merge: node scripts/cast.mjs register ${work}`);
  },

  async template([id]) {
    if (!id) throw new Error("usage: cast.mjs template <id>");
    await withVite(async (load) => {
      const { catalogParts, routerIndexText } = await load("/src/scenes/catalog.ts");
      const line = routerIndexText().split("\n").find((l) => l.startsWith(`- ${id}:`));
      if (!line) throw new Error(`no ready template "${id}"`);
      const full = catalogParts({ forced: id }).stable;
      const at = full.indexOf(id);
      console.log(wrap(full.slice(Math.max(0, full.lastIndexOf("\n\n", at)))));
    });
  },

  async check([file]) {
    if (!file) throw new Error("usage: cast.mjs check <cast.json | cast.yaml>");
    let spec = readCast(file);
    await withVite(async (load) => {
      if (!spec) {
        // YAML (a spec as the portable skill writes it, or a one-page playlist):
        // the app's own reader, as the player's #cast= / #paste would read it.
        const { parsePlaylistText, itemsOf } = await load("/src/playlist/playlist.ts");
        const items = itemsOf(parsePlaylistText(readFileSync(resolve(ROOT, file), "utf8")));
        if (items.length !== 1) throw new Error(`check reads one page; ${file} has ${items.length} (use frames for a playlist)`);
        spec = items[0].spec;
      }
      const { validateSpec } = await load("/src/spec/schema.ts");
      const { expandSpec } = await load("/src/spec/expand.ts");
      const { layoutSpec } = await load("/src/layout/layout.ts");
      const { heuristicMeasure } = await load("/src/layout/measure.ts");
      const { lintCommands } = await load("/src/lint/lint.ts");
      const { lintCrowding } = await load("/src/lint/crowding.ts");
      const { ensureEnginesForSpecs } = await load("/src/scenes/engines.ts");
      const v = validateSpec(spec);
      if (!v.ok) {
        console.log("INVALID\n" + v.errors.map((e) => "  " + e).join("\n"));
        process.exitCode = 1;
        return;
      }
      await ensureEnginesForSpecs([spec]).catch(() => {});
      const ex = expandSpec(spec);
      const laid = layoutSpec(ex, heuristicMeasure);
      // The layout's own warnings too (a label moved off other ink, …): the
      // bundled-examples gate fails on them, so an author must see them here.
      // Crowding (texts on the page at once, small print) is checked by the
      // app's generation too — advisory; the examples gate does not read it.
      const issues = [...laid.issues, ...(laid.warnings ?? []).map((message) => ({ severity: "warning", message })), ...lintCommands(ex), ...lintCrowding(laid, ex)];
      const speaks = (spec.commands ?? []).filter((c) => typeof c.speak === "string").length;
      console.log(`valid · ${speaks} spoken lines · ${(spec.elements ?? []).length} elements${spec.template ? ` · template ${spec.template}` : ""}`);
      console.log(issues.length ? issues.map((i) => `  [${i.severity}] ${i.message}`).join("\n") : "  lint clean (heuristic metrics — frames gives the browser's)");
    });
  },

  async frames(args) {
    const large = args.includes("--large");
    const [file, outdir] = args.filter((a) => a !== "--large");
    if (!file) throw new Error("usage: cast.mjs frames <cast.json> [outdir] [--large]");
    const name = basename(file).replace(/\.(json|ya?ml)$/i, "");
    const out = resolve(ROOT, outdir ?? `dev-casts/frames-${name}`);
    mkdirSync(out, { recursive: true });
    const b = await browser();
    try {
      // The harness lays frames two to a row at 1000 px; at 760 px they go one
      // to a row, each about twice as wide — for judging fine text.
      const W = large ? 760 : 1000;
      const page = await b.newPage({ viewport: { width: W, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
      const url = `${URL_BASE}/frames.html?cast=${devPath(file)}&beats=all&v=${Date.now()}`;
      await page.goto(url, { waitUntil: "networkidle" }).catch(() => {
        throw new Error(`no dev server at ${URL_BASE} — start one: npm run dev -- --port 5199 --strictPort`);
      });
      await page.waitForFunction(() => document.querySelectorAll("svg").length > 1 || /nothing to show|Error/.test(document.body.innerText), null, { timeout: 90000 });
      await page.waitForTimeout(2500);
      const report = await page.evaluate(() => window.__frames());
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      const tiles = [];
      for (let y = 150, k = 1; y < h; y += 1800, k++) {
        const f = `${out}/frames-${k}.png`;
        await page.screenshot({ path: f, fullPage: true, clip: { x: 0, y, width: W, height: Math.min(1800, h - y) } });
        tiles.push(relative(ROOT, f));
      }
      // A shorter render than the last one leaves its extra tiles behind, and
      // a reader then judges a frame that is no longer in the cast: drop them.
      for (const old of readdirSync(out)) {
        const m = /^frames-(\d+)\.png$/.exec(old);
        if (m && Number(m[1]) > tiles.length) unlinkSync(`${out}/${old}`);
      }
      writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
      console.log(`${tiles.length} tile(s): ${tiles.join(", ")} — one frame per spoken line (mid-gesture where the line highlights, focuses, points or flows)`);
      for (const part of report.parts ?? []) {
        const bad = [...part.validationErrors, ...part.planWarnings, ...part.commandIssues, ...part.playbackErrors];
        if (bad.length) console.log("  " + bad.join("\n  "));
        for (const fr of part.frames ?? []) if (fr.issues?.length) console.log(`  @${fr.at} ${fr.changed}: ${fr.issues.join(" · ")}`);
      }
      if (errors.length) console.log("page errors:\n  " + errors.join("\n  "));
      if (!(report.parts ?? []).some((p) => p.frames?.some((f) => f.issues?.length))) console.log("  no browser lint on any frame");
      // Timing (src/lint/pacing-report.ts): the totals, then one line per idle
      // stretch, silent ink or overlong beat, numbered @N like the tiles.
      for (const [i, part] of (report.parts ?? []).entries()) {
        const lines = part.pacing?.lines ?? [];
        if (lines.length === 0) continue;
        console.log((report.parts.length > 1 ? `part ${i + 1} ` : "") + lines.join("\n"));
      }
    } finally {
      await b.close();
    }
  },

  async open(args) {
    const [file] = args.filter((a) => a !== "--launch");
    if (!file) throw new Error("usage: cast.mjs open <cast.json> [--launch]");
    const url = `${URL_BASE}/?open=${devPath(file)}`;
    // The app's ?open= unwraps the same shapes frames reads (a spec, {request,
    // spec}, {request, title, playlist}; src/playlist/cast-file.ts). Say which
    // one this is, and refuse a JSON file that would open as a blank page.
    const shape = castShape(readFileSync(resolve(ROOT, file), "utf8"));
    if (shape.empty) throw new Error(`${file}: ${shape.label} with nothing to draw — the app would open a blank page`);
    console.log(`${url}\n(${shape.label})`);
    if (args.includes("--launch")) {
      const { spawn } = await import("node:child_process");
      spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    }
  },
};

if (!commands[cmd]) {
  console.log(`usage: node scripts/cast.mjs ${Object.keys(commands).join("|")} …  (see the header of this file)`);
  process.exitCode = 1;
} else {
  await commands[cmd](rest).catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
