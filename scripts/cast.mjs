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
//   node scripts/cast.mjs lecture-prompt <dir> <n>                           lecture n's storyboard prompt → <dir>/lecture-NN/
//   node scripts/cast.mjs part-prompt <dir> <n> <i>                          part i's system prompt + request (storyboard.json first)
//   node scripts/cast.mjs lecture-build <dir> <n>                            part-*.json → <dir>/NN-<title>.yaml, marked done in course.md
//   node scripts/cast.mjs course-open <dir> [--launch]                       the app URL that imports the course and opens it
//
// A cast file is a spec, a {request, spec}, or playlist YAML — anything the
// app opens. Files live under dev-casts/ (gitignored). The dev server:
//   npm run dev -- --port 5199 --strictPort      (DRAWCAST_URL overrides http://localhost:5199)

import { createServer } from "vite";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

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
async function appPromptText(load, request) {
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
  const catalog = catalogParts({ request });
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

const commands = {
  async prompt([request, out = "dev-casts/_prompt.md"]) {
    if (!request) throw new Error('usage: cast.mjs prompt "<request>" [out.md]');
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

  async "lecture-prompt"([dir, nArg]) {
    if (!dir || !nArg) throw new Error("usage: cast.mjs lecture-prompt <dir> <lecture number, 1-based>");
    await withVite(async (load) => {
      const { request, parts, chapters, brief, lectureDir } = await lectureContext(load, dir, Number(nArg));
      const { buildStoryboardMessages } = await load("/src/llm/storyboard.ts");
      const { system, user } = buildStoryboardMessages(request, parts, { chapters, brief });
      mkdirSync(lectureDir, { recursive: true });
      const out = resolve(lectureDir, "_storyboard-prompt.md");
      writeFileSync(out, wrap(`# SYSTEM\n\n${system}\n\n# USER\n\n${user}`) + "\n");
      console.log(`${relative(ROOT, out)}: the app's storyboard prompt (${parts ?? "1–4"} parts). Write the JSON it asks for to ${relative(ROOT, resolve(lectureDir, "storyboard.json"))}, then part-prompt for each part.`);
    });
  },

  async "part-prompt"([dir, nArg, iArg]) {
    if (!dir || !nArg || !iArg) throw new Error("usage: cast.mjs part-prompt <dir> <lecture> <part>  (both 1-based)");
    await withVite(async (load) => {
      const { request, brief, lectureDir, outline } = await lectureContext(load, dir, Number(nArg), true);
      const i = Number(iArg) - 1;
      if (!outline.parts[i]) throw new Error(`the storyboard has ${outline.parts.length} parts`);
      const { buildPartRequest } = await load("/src/llm/outline.ts");
      const partRequest = buildPartRequest(request, outline, i, brief);
      const text = await appPromptText(load, partRequest);
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
      const { ensureEnginesForSpecs } = await load("/src/scenes/engines.ts");
      const v = validateSpec(spec);
      if (!v.ok) {
        console.log("INVALID\n" + v.errors.map((e) => "  " + e).join("\n"));
        process.exitCode = 1;
        return;
      }
      await ensureEnginesForSpecs([spec]).catch(() => {});
      const ex = expandSpec(spec);
      const issues = [...layoutSpec(ex, heuristicMeasure).issues, ...lintCommands(ex)];
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
    console.log(url);
    if (args.includes("--launch")) {
      const { spawn } = await import("node:child_process");
      spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    }
  },
};

if (!commands[cmd]) {
  console.log("usage: node scripts/cast.mjs prompt|template|check|frames|open|course-prompt|course-new|lecture-prompt|part-prompt|lecture-build|course-open …  (see the header of this file)");
  process.exitCode = 1;
} else {
  await commands[cmd](rest).catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
