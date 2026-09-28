// The local author's toolbox (the /drawcast skill, .claude/skills/drawcast):
// every step of writing a drawcast by hand-with-eyes, using the app's OWN
// code, so a figure made here is made to the same prompt, templates and
// checks as one the app generates.
//
//   node scripts/cast.mjs prompt "<request>" [out.md]   the app's system prompt for this request (catalog shortlist,
//                                                        few-shots, exemplars, code/sound gates), wrapped for reading;
//                                                        the JSON schema goes to dev-casts/_schema.json (look fields up there)
//   node scripts/cast.mjs template <id>                  a template's full catalog entry (params, element ids)
//   node scripts/cast.mjs check <cast.json>              validation + layout/command lint (the generator's own checks)
//   node scripts/cast.mjs frames <cast.json> [outdir] [--large]   frames after every spoken line, as PNG tiles, plus
//                                                        the browser-measured lint per frame (--large: one frame per row,
//                                                        for fine text) — needs the dev server
//   node scripts/cast.mjs open <cast.json> [--launch]    the app URL that opens this cast (--launch opens it too)
//
// Courses (a folder dev-casts/courses/<slug>/, the shape of a published course):
//   node scripts/cast.mjs course-prompt "<request>" [out.md] [--lectures N]   the app's course planner prompt
//   node scripts/cast.mjs course-new <plan.json> <dir>                        the plan JSON → <dir>/course.md (the app's own normalizer)
//   node scripts/cast.mjs lecture-prompt <dir> <n> [--storyboard v1]         lecture n's storyboard prompt → <dir>/lecture-NN/
//   node scripts/cast.mjs part-prompt <dir> <n> <i> [--storyboard v1]        part i's system prompt + request (storyboard.json first)
//        (default v2: the storyboard prompt (storyline rules, templates with "Viewer can") and its per-part
//        staging note, the app's default since 2026-09-28); --storyboard v1 gives the previous prompt)
//   node scripts/cast.mjs lecture-build <dir> <n>                            part-*.json → <dir>/NN-<title>.yaml, marked done in course.md
//   node scripts/cast.mjs course-open <dir> [--launch]                       the app URL that imports the course and opens it
//
// Revising what is published (any GitHub link to a course folder, a lecture, a cast or a saved source):
//   node scripts/cast.mjs pull <github-url> [workdir] [--force]   sparse clone in dev-casts/repos/ + a working copy
//        (a course → dev-casts/courses/<slug>/, a cast → dev-casts/pulled/<slug>/) with origin.json
//   node scripts/cast.mjs unpack <course-dir> <n>  |  unpack <cast.yaml> [outdir]   → part-N.json + outline.json
//   node scripts/cast.mjs revise-prompt <parts-dir | cast.json> "<change>" [out.md]   the app's rules, the document's templates in full
//   node scripts/cast.mjs repack <parts-dir>             parts → the YAML again; narration kept for every unchanged line
//   node scripts/cast.mjs push <workdir> [--dry-run | --no-push] [--direct] [-m msg] [--body text] [--new-pr]
//        regenerates what the app's publish would (course page, READMEs, manifests, Next cards) and commits it:
//        a branch + PR by default (from a fork without push rights; later pushes update the same PR), --direct to
//        the default branch. Refuses if the files changed on GitHub since the pull.
//
// A cast file is a spec, a {request, spec}, or playlist YAML — anything the
// app opens. Files live under dev-casts/ (gitignored). The dev server:
//   npm run dev -- --port 5199 --strictPort      (DRAWCAST_URL overrides http://localhost:5199)

import { createServer } from "vite";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pageDoor, parseGithubTarget } from "./cast-github.mjs";

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
  const cache = `${process.env.HOME}/Library/Caches/ms-playwright`;
  const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell")).sort() : [];
  if (!shells.length) throw new Error("no headless Chromium — run: npx playwright-core install chromium-headless-shell");
  const dir = `${cache}/${shells.at(-1)}`;
  const sub = readdirSync(dir).find((d) => d.startsWith("chrome-headless-shell"));
  return chromium.launch({ executablePath: `${dir}/${sub}/chrome-headless-shell` });
}

/**
 * The system prompt the app would send for this request — the compiler
 * prompt, the catalog shortlist, few-shots, exemplars, the code/sound gates —
 * wrapped for reading. The schema goes to dev-casts/_schema.json.
 */
async function appPromptText(load, request, priorityIds = []) {
  mkdirSync(resolve(ROOT, "dev-casts"), { recursive: true });
  const compile = await load("/src/llm/compile.ts");
  const { buildSystemBlocks, formatExemplars, wantsCode, wantsSound } = await load("/src/llm/prompt.ts");
  const { pickExemplars } = await load("/src/llm/exemplars.ts");
  const { usableExemplars } = await load("/src/llm/exemplars.ts");
  const { catalogParts, isReadyTemplate } = await load("/src/scenes/catalog.ts");
  const examples = JSON.parse(readFileSync(resolve(ROOT, "src/examples.json"), "utf8"));
  const bundled = usableExemplars(
    examples.filter((e) => !e.specimen).map((e) => ({ prompt: e.request, spec: e.spec })),
    isReadyTemplate,
  );
  const code = wantsCode(request), sound = wantsSound(request);
  const catalog = catalogParts({ request, priorityIds });
  // The schema (~90k characters of the ~210k) goes to its own file: the
  // prompt keeps a pointer, and the author looks fields up when needed.
  const schema = compile.apiSchema({ code, sound });
  const variant = compile.promptVariants()[0].source.replace("{{SCHEMA}}", "(The JSON schema is in dev-casts/_schema.json — look up an element's or a command's fields there when you need them.)");
  writeFileSync(resolve(ROOT, "dev-casts/_schema.json"), JSON.stringify(schema, null, 1));
  const blocks = buildSystemBlocks(variant, {
    schema,
    catalog: catalog.stable,
    fewshots: compile.fewshotsText({ code }),
    exemplars: formatExemplars(pickExemplars(request, [], bundled, 3)),
    code: code ? compile.CODE_PROMPT_SOURCE : "",
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
  const { buildLectureRequest, partsOf } = await load("/src/course/run.ts");
  const { buildBrief, parseTags } = await load("/src/llm/tags.ts");
  const text = readFileSync(resolve(ROOT, dir, "course.md"), "utf8");
  const course = parseCourse(text);
  const lecture = course.lectures[n - 1];
  if (!lecture) throw new Error(`the course has ${course.lectures.length} lectures`);
  const parts = partsOf(lecture);
  const chapters = lecture.chapters.length > 0 ? lecture.chapters : undefined;
  const lectureDir = resolve(ROOT, dir, `lecture-${String(n).padStart(2, "0")}`);
  const ctx = { course, text, lecture, request: buildLectureRequest(course, n - 1), parts, chapters, brief: buildBrief(parseTags(lecture.tags.join(" ")).tags), lectureDir };
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
      const { system, user } = buildCourseMessages(request, Number.isFinite(n) ? n : null);
      mkdirSync(resolve(ROOT, "dev-casts"), { recursive: true });
      writeFileSync(resolve(ROOT, out), wrap(`# SYSTEM\n\n${system}\n\n# USER\n\n${user}`) + "\n");
      console.log(`${out}: the app's course planner prompt. Write the plan JSON it asks for to a file, then: cast.mjs course-new <plan.json> dev-casts/courses/<slug>`);
    });
  },

  async "course-new"([planFile, dir]) {
    if (!planFile || !dir) throw new Error("usage: cast.mjs course-new <plan.json> <dir>");
    await withVite(async (load) => {
      const { normalizeCoursePlan } = await load("/src/course/plan.ts");
      const { formatCourse, parseCourse, setCourseOption } = await load("/src/course/document.ts");
      const course = normalizeCoursePlan(JSON.parse(readFileSync(resolve(ROOT, planFile), "utf8")));
      if (!course) throw new Error("the plan is unusable (the app needs a title and at least two lectures)");
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
      const { lecturePlaylist, stripClickGates } = await load("/src/course/run.ts");
      const { parseTags } = await load("/src/llm/tags.ts");
      const { formatPlaylist } = await load("/src/playlist/playlist.ts");
      const { setLectureStatus } = await load("/src/course/document.ts");
      const { validateSpec } = await load("/src/spec/schema.ts");
      const { slugify } = await load("/src/publish/github.ts");
      const tags = parseTags(lecture.tags.join(" "));
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
    const clone = resolve(ROOT, "dev-casts/repos", `${t.owner}__${t.repo}`);
    // A path that is a file is checked out by its folder: a lecture needs its
    // course, a cast its casts.json.
    const isFile = /\.ya?ml$/i.test(t.path);
    const folder = isFile ? t.path.split("/").slice(0, -1).join("/") : t.path;
    if (!existsSync(clone)) {
      mkdirSync(resolve(ROOT, "dev-casts/repos"), { recursive: true });
      sh("git", ["clone", "--quiet", "--filter=blob:none", "--sparse", "--depth", "1", "--branch", branch, `https://github.com/${t.owner}/${t.repo}.git`, clone]);
    } else {
      sh("git", ["-C", clone, "fetch", "--quiet", "--depth", "1", "origin", branch]);
      sh("git", ["-C", clone, "checkout", "--quiet", "--force", "-B", branch, "FETCH_HEAD"]);
    }
    const dirs = new Set(sh("git", ["-C", clone, "sparse-checkout", "list"]).split("\n").filter(Boolean));
    if (folder) dirs.add(folder);
    // Cone mode: every file directly in each parent folder comes too
    // (courses.json, the repo's index pages).
    sh("git", ["-C", clone, "sparse-checkout", "set", ...dirs]);
    const base = sh("git", ["-C", clone, "rev-parse", "HEAD"]);
    const at = (p) => resolve(clone, p);
    if (!existsSync(at(t.path))) throw new Error(`${t.owner}/${t.repo}@${branch} has no ${t.path || "(root)"}`);

    const courseDir = existsSync(at(joinRepo(folder, "course.md"))) ? folder : null;
    if (!courseDir && !isFile) {
      const listing = readdirSync(at(folder)).filter((f) => !f.startsWith("."));
      throw new Error(`${t.path || "the repo root"} is neither a course folder (no course.md) nor a .yaml. It holds: ${listing.join(", ")}. Pass a course folder or a cast's .yaml.`);
    }
    const viewerBase = findViewerBase(clone, folder);
    const common = { owner: t.owner, repo: t.repo, branch, base, clone: relative(ROOT, clone), viewerBase, pulled: new Date().toISOString() };

    if (courseDir) {
      const slug = courseDir.split("/").at(-1);
      const work = resolve(ROOT, out ?? `dev-casts/courses/${slug}`);
      guardWorkdir(work, force);
      mkdirSync(work, { recursive: true });
      const text = readFileSync(at(joinRepo(courseDir, "course.md")), "utf8");
      writeFileSync(resolve(work, "course.md"), text);
      const course = await withVite((load) => courseLectures(load, text));
      const files = course.lectures.map((l) => l.status?.file ?? null);
      const copied = [];
      for (const f of files) {
        if (!f || !existsSync(at(joinRepo(courseDir, f)))) continue;
        writeFileSync(resolve(work, f), readFileSync(at(joinRepo(courseDir, f))));
        copied.push(f);
      }
      const coursesDir = courseDir.split("/").slice(0, -1).join("/");
      const lecture = isFile ? files.indexOf(t.path.split("/").at(-1)) + 1 || null : null;
      writeFileSync(resolve(work, "origin.json"), JSON.stringify({ kind: "course", ...common, path: courseDir, coursesDir, lecture }, null, 1) + "\n");
      const lines = course.lectures.map((l, i) => `  ${String(i + 1).padStart(2)}. ${l.title}${files[i] && copied.includes(files[i]) ? "" : "   (not published — nothing to revise)"}${lecture === i + 1 ? "   ← the link pointed here" : ""}`);
      console.log(`${relative(ROOT, work)}: course "${text.match(/^# (.*)$/m)?.[1] ?? slug}" from ${t.owner}/${t.repo}@${branch}, ${copied.length} of ${files.length} lecture(s) published:\n${lines.join("\n")}\nNext: cast.mjs unpack ${relative(ROOT, work)} <n>  (a lecture → lecture-NN/part-*.json)`);
      return;
    }

    const file = t.path.split("/").at(-1);
    const slug = file.replace(/\.ya?ml$/i, "");
    const kind = folder.split("/").at(-1) === "sources" ? "source" : "cast";
    const work = resolve(ROOT, out ?? `dev-casts/pulled/${slug}`);
    guardWorkdir(work, force);
    mkdirSync(work, { recursive: true });
    writeFileSync(resolve(work, file), readFileSync(at(t.path)));
    writeFileSync(resolve(work, "origin.json"), JSON.stringify({ kind, ...common, path: t.path, castsDir: folder, file }, null, 1) + "\n");
    console.log(`${relative(ROOT, work)}/${file}: ${kind === "source" ? "a saved source" : "a published drawcast"} from ${t.owner}/${t.repo}@${branch}.\nNext: cast.mjs unpack ${relative(ROOT, work)}/${file}`);
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
        const next = (spec.elements ?? []).some((el) => el.id === "nx_kicker");
        return [`  part-${e.part}.json  ${next ? '(the drawn "Next" card — push redraws it from course.md; leave it)' : (spec.title ?? "")}`];
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

  async push(args) {
    const direct = args.includes("--direct"), dry = args.includes("--dry-run"), fresh = args.includes("--new-pr"), local = args.includes("--no-push");
    const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
    const message = flag("-m"), body = flag("--body");
    const [work] = args.filter((a, i) => !a.startsWith("-") && !["-m", "--body"].includes(args[i - 1]));
    if (!work) throw new Error('usage: cast.mjs push <workdir> [--dry-run | --no-push] [--direct] [-m "<commit message>"] [--body "<PR description>"] [--new-pr]');
    const wd = resolve(ROOT, work);
    const origin = JSON.parse(readFileSync(resolve(wd, "origin.json"), "utf8"));
    const clone = resolve(ROOT, origin.clone);
    const repo = { owner: origin.owner, repo: origin.repo };
    const git = (...a) => sh("git", ["-C", clone, ...a]);

    // Nothing is overwritten that changed upstream since the pull.
    git("fetch", "--quiet", "--depth", "1", "origin", origin.branch);
    const upstream = git("rev-parse", "FETCH_HEAD");
    const watched = origin.kind === "course" ? [origin.path, joinRepo(origin.coursesDir, "courses.json")] : [origin.path];
    const moved = upstream === origin.base ? "" : git("diff", "--name-only", origin.base, upstream, "--", ...watched);
    if (moved) throw new Error(`changed on GitHub since the pull, not pushed:\n  ${moved.split("\n").join("\n  ")}\nPull again into a fresh workdir and carry the revision over.`);

    const files = await withVite(async (load) => {
      if (origin.kind === "source") return { files: [{ path: origin.path, content: readFileSync(resolve(wd, origin.file), "utf8") }], deletions: [] };
      if (origin.kind === "cast") {
        const { buildCastPlan, parseCastIndex, emptyCastIndex } = await load("/src/publish/cast.ts");
        const { parsePlaylistText, itemsOf } = await load("/src/playlist/playlist.ts");
        const text = readFileSync(resolve(wd, origin.file), "utf8");
        const p = parsePlaylistText(text);
        const title = p.meta.title ?? itemsOf(p)[0]?.spec.title ?? "";
        const indexText = readAtCommit(clone, upstream, joinRepo(origin.castsDir, "casts.json"));
        const slug = origin.file.replace(/\.ya?ml$/i, "");
        const plan = buildCastPlan({ title, text, slug, previousSlug: slug, repo, castsDir: origin.castsDir, viewerBase: origin.viewerBase, index: indexText ? parseCastIndex(indexText) : emptyCastIndex() });
        return { files: plan.files, deletions: [] };
      }
      const { buildPublishPlan } = await load("/src/course/publish.ts");
      const { parseCourse } = await load("/src/course/document.ts");
      const { parseManifest, emptyManifest } = await load("/src/publish/github.ts");
      const { doorlessNote } = await load("/src/course/page.ts");
      const { parsePlaylistText, formatPublished, makeNextCard } = await load("/src/playlist/playlist.ts");
      const text = readFileSync(resolve(wd, "course.md"), "utf8");
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
          // the lecture's title and the drawn "Next" card. A retitled or
          // reordered course gets them redrawn, as a rebuild would.
          const p = parsePlaylistText(readFileSync(resolve(wd, f), "utf8"));
          p.meta.title = course.lectures[i].title;
          const last = p.entries.at(-1);
          const isNextCard = last?.kind === "item" && (last.spec.elements ?? []).some((e) => e.id === "nx_kicker");
          if (isNextCard) p.entries.pop();
          const following = course.lectures[i + 1];
          if (isNextCard && following) p.entries.push({ kind: "item", spec: makeNextCard({ next: following.title, position: i + 2, total: course.lectures.length }) });
          return formatPublished(p, p.audio ?? null);
        },
        door: pageDoor(readAtCommit(clone, upstream, joinRepo(origin.path, "index.html")), doorlessNote),
      });
      return { files: plan.files, deletions: plan.deletions };
    });

    // What would change, against the repo as it is now.
    const changes = [];
    for (const f of files.files) {
      const now = readAtCommit(clone, upstream, f.path);
      if (now === null) changes.push(["new", f.path]);
      else if (now !== f.content) changes.push(["changed", f.path]);
    }
    for (const p of files.deletions) changes.push(["deleted", p]);
    // The date in the manifests changes on every publish; alone it is no change.
    const real = changes.filter(([, p]) => !/(^|\/)(courses\.json|casts\.json|index\.html|README\.md)$/.test(p));
    console.log(changes.length ? changes.map(([k, p]) => `  ${k.padEnd(8)} ${p}`).join("\n") : "  nothing differs from GitHub");
    if (!real.length) return console.log("Nothing to push.");
    if (dry) return console.log("(dry run — nothing written)");

    const perm = local ? { push: true } : JSON.parse(sh("gh", ["api", `repos/${origin.owner}/${origin.repo}`, "--jq", "{push: .permissions.push}"]));
    const me = local ? "" : sh("gh", ["api", "user", "--jq", ".login"]);
    if (direct && !perm.push) throw new Error(`${me} cannot push to ${origin.owner}/${origin.repo} — drop --direct to open a pull request from a fork`);
    const branch = direct ? origin.branch : !fresh && origin.pr?.branch ? origin.pr.branch : `drawcast/revise-${basename(origin.path).replace(/\.ya?ml$/i, "")}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
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
    git("commit", "--quiet", "-m", message ?? `drawcast: revise ${origin.kind} "${title}"`);

    if (local) return console.log(`Committed on ${branch} in ${origin.clone}, not pushed:\n${git("show", "--stat", "--format=%h %s", "HEAD")}`);

    // gh's own credentials for the push, without touching the git config.
    const pushTo = (remote, ref) => sh("git", ["-C", clone, "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "push", "--quiet", remote, ref]);
    if (direct) {
      pushTo("origin", `HEAD:${origin.branch}`);
      origin.base = git("rev-parse", "HEAD");
      writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
      return console.log(`Pushed to ${origin.owner}/${origin.repo}@${origin.branch} (${origin.base.slice(0, 7)}). The viewer reads raw.githubusercontent.com, which can lag a few minutes.`);
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
      url = sh("gh", ["pr", "create", "--repo", `${origin.owner}/${origin.repo}`, "--base", origin.branch, "--head", head, "--title", message ?? `Revise ${origin.kind}: ${title}`, "--body", body ?? `A revision made with the drawcast skill (scripts/cast.mjs push).\n\nFiles:\n${changes.map(([k, p]) => `- ${k} \`${p}\``).join("\n")}`]);
    }
    origin.pr = { url, branch, remote };
    writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
    console.log(`${onPr ? "Updated" : "Opened"} ${url}`);
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
    if (!file) throw new Error("usage: cast.mjs check <cast.json>");
    const spec = readCast(file);
    if (!spec) throw new Error("check reads JSON (a spec or {request, spec}); for YAML use frames");
    await withVite(async (load) => {
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
      writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
      console.log(`${tiles.length} tile(s): ${tiles.join(", ")} — one frame per spoken line (mid-gesture where the line highlights, focuses, points or flows)`);
      for (const part of report.parts ?? []) {
        const bad = [...part.validationErrors, ...part.planWarnings, ...part.commandIssues, ...part.playbackErrors];
        if (bad.length) console.log("  " + bad.join("\n  "));
        for (const fr of part.frames ?? []) if (fr.issues?.length) console.log(`  @${fr.at} ${fr.changed}: ${fr.issues.join(" · ")}`);
      }
      if (errors.length) console.log("page errors:\n  " + errors.join("\n  "));
      if (!(report.parts ?? []).some((p) => p.frames?.some((f) => f.issues?.length))) console.log("  no browser lint on any frame");
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
  console.log("usage: node scripts/cast.mjs prompt|template|check|frames|open|course-prompt|course-new|lecture-prompt|part-prompt|lecture-build|course-open|pull|unpack|revise-prompt|repack|push …  (see the header of this file)");
  process.exitCode = 1;
} else {
  await commands[cmd](rest).catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
