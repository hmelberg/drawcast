// What a publish contains, and the two functions that touch the network.
//
// The plan is pure and tested; preparePublish (reads) and commitPublish (the
// one write) are the thin orchestration around it, split so the caller can
// register the course's name BETWEEN them — the page's door is built from
// that registration, never from a guess. publishCourse composes the two for
// a caller with nothing to decide; a second target (Drive) would replace
// these functions alone.

import {
  commitFiles,
  emptyManifest,
  parseManifest,
  preflight,
  readFile,
  removedPaths,
  slugFor,
  upsertCourse,
  type Manifest,
  type PublishFile,
  type RepoRef,
} from "../publish/github";
import { formatPublished, parsePlaylistText } from "../playlist/playlist";
import { parseCourse, removeCourseOption, setCourseOption, setLectureStatus, type Course } from "./document";
import { coursePage, courseReadme, lectureHref, repoIndexPage, repoReadme, type Door, type PageLink } from "./page";
import { apiBase, DEFAULT_ENROLL_API } from "../learn";
import { normalizeName, type Registration } from "../names";

/**
 * Join a repo path, tolerating an empty directory. The default IS empty: a
 * repo dedicated to courses should give hmelberg/dcast/<course>/, not
 * hmelberg/dcast/courses/<course>/. The setting exists for a repo that holds
 * other things too.
 */
export function joinPath(dir: string, ...parts: string[]): string {
  return [dir, ...parts].filter((p) => p !== "").join("/");
}

/** The learner backend's course identity: the published folder (spec §1). */
export function courseKeyFor(repo: { owner: string; repo: string }, dir: string): string {
  return `${repo.owner}/${repo.repo}/${dir}`;
}

/** Cast keys of the lectures that have a published file, in course order. */
export function lectureCastKeys(course: Course, repo: { owner: string; repo: string }, coursesDir: string): string[] {
  const dir = joinPath(coursesDir, course.context.slug ?? "");
  return course.lectures.flatMap((l) => (l.status?.file ? [`${courseKeyFor(repo, dir)}/${l.status.file}`] : []));
}

/**
 * The name a course answers to at drawcast.app/#<name> (spec §7): `name:` if
 * set, else the slug. The registry is lower-case (names.ts); a name the rule
 * rejects outright travels as written, so registerName can report it as
 * invalid.
 */
export function courseNameFor(course: Pick<Course, "name">, slug: string): string {
  const wanted = course.name ?? slug;
  return normalizeName(wanted) ?? wanted;
}

/** What a course publish registers (spec §7): `name:` if set, else the slug. */
export function courseRegistration(
  course: Course,
  repo: { owner: string; repo: string },
  coursesDir: string,
  pageUrl: string,
): Omit<Registration, "key"> | null {
  const slug = course.context.slug;
  // A course that has never been published has no slug yet, and so no name to
  // register — preparePublish records one before anyone asks.
  if (!slug) return null;
  return {
    name: courseNameFor(course, slug),
    kind: "course",
    target: courseKeyFor(repo, joinPath(coursesDir, slug)),
    page: pageUrl,
    title: course.title,
    lectures: lectureCastKeys(course, repo, coursesDir),
  };
}

/**
 * The Share panel's "Allow sign-up on the course page" box, applied to the
 * document text before a publish (teachers round, spec §5). On: write the
 * default app's URL unless the author already typed an `enroll:` of their
 * own — the box manages the default app only, never someone's own backend.
 * Off: remove the line, whatever it carried, so the page loses its join box.
 */
export function applyJoinBox(text: string, on: boolean, api: string = DEFAULT_ENROLL_API): string {
  const has = parseCourse(text).enroll !== undefined;
  if (on) return has ? text : setCourseOption(text, "enroll", api);
  return has ? removeCourseOption(text, "enroll") : text;
}

export interface PublishPlan {
  slug: string;
  /** github.com's own rendering of the course README — works without Pages. */
  readmeUrl: string;
  files: PublishFile[];
  deletions: string[];
  /** The file name each lecture index was assigned, for the status write-back. */
  fileOf: Map<number, string>;
  courseUrl: string;
  pagesUrl: string;
}

export interface PlanArgs {
  course: Course;
  /** The course document, published verbatim so the repo can be the source. */
  text: string;
  repo: RepoRef;
  coursesDir: string;
  viewerBase: string;
  manifest: Manifest;
  /** The lecture's playlist YAML, or null when it has not been generated. */
  lectureYaml: (index: number) => string | null;
  /**
   * The page's door, decided by the caller from the name THIS publish
   * registered (ui/course.ts, between preparePublish and commitPublish).
   * Absent means no decision was made, and a page with `enroll:` then ships
   * doorless and says so — it never links to a name nobody registered.
   */
  door?: Door;
}

export function buildPublishPlan(args: PlanArgs): PublishPlan {
  const { course, text, repo, coursesDir, viewerBase, manifest } = args;
  // A slug recorded in the document wins and never changes: retitling a course
  // would otherwise move its whole folder and orphan every link already shared.
  const slug = course.context.slug || slugFor(course.title || "course", new Set());
  const dir = joinPath(coursesDir, slug);
  const enroll = course.enroll ? apiBase(course.enroll) : undefined;
  // `enroll:` decides whether the page has a join section at all. A server of
  // the author's own gets no door whatever the caller decided: the viewer
  // reports to the drawcast server only (viewer.ts), so a door there would
  // enrol learners nobody ever follows.
  const door: Door | undefined =
    enroll === undefined ? undefined : enroll !== DEFAULT_ENROLL_API ? { name: null, why: "elsewhere" } : (args.door ?? { name: null, why: "unregistered" });

  const taken = new Set<string>();
  const fileOf = new Map<number, string>();
  const files: PublishFile[] = [];
  const links: PageLink[] = [];

  // A lecture already published keeps its recorded name — reserve those first,
  // so a newly minted slug can never collide with one that is permanent.
  for (const lecture of course.lectures) {
    if (lecture.status?.file) taken.add(lecture.status.file.replace(/\.ya?ml$/, ""));
  }

  // Names first, in their own pass: a lecture's "Next ▸" link needs the
  // FOLLOWING lecture's file name, which does not exist yet while names are
  // still being minted in order.
  course.lectures.forEach((lecture, i) => {
    if (!args.lectureYaml(i)) return;
    // A recorded name is permanent: renaming or reordering a lecture must never
    // move the file a published link already points at.
    let name = lecture.status?.file;
    if (!name) {
      const minted = slugFor(lecture.title, taken);
      taken.add(minted);
      name = `${minted}.yaml`;
    }
    fileOf.set(i, name);
  });

  course.lectures.forEach((lecture, i) => {
    const yaml = args.lectureYaml(i);
    if (!yaml) {
      links.push({ title: lecture.title, questions: lecture.questions, href: null });
      return;
    }
    const name = fileOf.get(i)!;
    // The published copy carries where to go next (meta.next): the one moment
    // the target URL exists is right here, and recomputing it on EVERY
    // publish is what keeps it honest through reordering — including
    // CLEARING a link that an earlier order left behind on what is now the
    // last lecture. The next lecture must itself be publishing (have a
    // file); an ungenerated one has no page to point at.
    const nextIndex = course.lectures.findIndex((_, j) => j > i && fileOf.has(j));
    const parsed = parsePlaylistText(yaml);
    if (nextIndex >= 0) {
      parsed.meta.next = {
        title: course.lectures[nextIndex].title,
        href: lectureHref(viewerBase, repo.owner, repo.repo, joinPath(dir, fileOf.get(nextIndex)!)),
      };
    } else {
      delete parsed.meta.next;
    }
    if (enroll) parsed.meta.enroll = enroll;
    else delete parsed.meta.enroll;
    files.push({ path: joinPath(dir, name), content: formatPublished(parsed, parsed.audio ?? null) });
    links.push({
      title: lecture.title,
      questions: lecture.questions,
      href: lectureHref(viewerBase, repo.owner, repo.repo, joinPath(dir, name)),
    });
  });

  files.push({ path: joinPath(dir, "course.md"), content: text });
  files.push({ path: joinPath(dir, "index.html"), content: coursePage(course, links, door) });
  // github.com renders this one itself, so the course is shareable before
  // Pages is switched on — and if it never is.
  files.push({ path: joinPath(dir, "README.md"), content: courseReadme(course, links) });

  const entry = {
    slug,
    title: course.title || "Untitled course",
    files: files.map((f) => f.path),
    updated: new Date().toISOString().slice(0, 10),
  };
  const next = upsertCourse(manifest, entry);
  files.push({ path: joinPath(coursesDir, "courses.json"), content: JSON.stringify(next, null, 2) + "\n" });
  files.push({ path: joinPath(coursesDir, "index.html"), content: repoIndexPage(next.courses, course.title) });
  files.push({ path: joinPath(coursesDir, "README.md"), content: repoReadme(next.courses) });
  // Pages runs Jekyll by default, which rewrites and skips files by its own
  // rules; these pages are plain HTML and want serving verbatim. Only when the
  // repo is ours to shape, though — a repo we are publishing into a SUBFOLDER
  // of may be someone's Jekyll site, and this file at its root would break it.
  if (coursesDir === "") files.push({ path: ".nojekyll", content: "" });

  return {
    slug,
    files,
    deletions: removedPaths(
      manifest,
      slug,
      files.map((f) => f.path),
    ),
    fileOf,
    readmeUrl: `https://github.com/${repo.owner}/${repo.repo}/tree/HEAD/${dir}`,
    courseUrl: `https://${repo.owner}.github.io/${repo.repo}/${dir}/`,
    pagesUrl: `https://${repo.owner}.github.io/${repo.repo}/${coursesDir ? `${coursesDir}/` : ""}`,
  };
}

export interface PublishArgs {
  text: string;
  repo: RepoRef;
  token: string;
  coursesDir: string;
  viewerBase: string;
  lectureYaml: (index: number) => string | null;
  fetchImpl?: typeof fetch;
  /** Blob upload progress (commitFiles) — surfaced on the panel's status line. */
  onUpload?: (done: number, total: number) => void;
}

export interface PublishResult {
  /** The document with the course's slug and each lecture's file name recorded. */
  text: string;
  courseUrl: string;
  pagesUrl: string;
  readmeUrl: string;
  defaultBranch: string;
  /** Files written; useful for the report. */
  count: number;
}

/** Everything a publish knows before it writes: reads only, nothing committed. */
export interface PreparedPublish {
  /** The document with the slug and every file name recorded — what the commit carries. */
  updated: string;
  defaultBranch: string;
  manifest: Manifest;
  slug: string;
  courseUrl: string;
  /** What this publish registers (spec §7); null only for a document that could not be given a slug, which does not happen here. */
  registration: Omit<Registration, "key"> | null;
}

/**
 * The reads: the repo's branch and manifest, the slug and file names the
 * commit will carry. The slug and the page URL are known here, before
 * anything is written — which is what lets the caller claim and register
 * the course's name first and build the page's door from the answer.
 */
export async function preparePublish(args: PublishArgs): Promise<PreparedPublish> {
  const { text, repo, token, coursesDir, viewerBase, lectureYaml } = args;
  const fetchImpl = args.fetchImpl ?? fetch;

  const { defaultBranch } = await preflight(repo, token, fetchImpl);
  const manifestText = await readFile(repo, joinPath(coursesDir, "courses.json"), fetchImpl);
  const manifest = manifestText ? parseManifest(manifestText) : emptyManifest();

  const course = parseCourse(text);
  const plan = buildPublishPlan({ course, text, repo, coursesDir, viewerBase, manifest, lectureYaml });

  // The document published inside the commit must already carry the file names,
  // or the repo's copy would disagree with the local one on the very first
  // publish — and the repo is meant to be the source you can re-open.
  // Record the slug first, so it is permanent from the first publish onward.
  let updated = course.context.slug ? text : setCourseOption(text, "slug", plan.slug);
  for (const [index, name] of plan.fileOf) {
    const status = course.lectures[index].status;
    if (status) updated = setLectureStatus(updated, index, { ...status, file: name });
  }
  return {
    updated,
    defaultBranch,
    manifest,
    slug: plan.slug,
    courseUrl: plan.courseUrl,
    registration: courseRegistration(parseCourse(updated), repo, coursesDir, plan.courseUrl),
  };
}

/** The one write. `door` is what the caller decided from the registration — see PlanArgs.door. */
export async function commitPublish(args: PublishArgs, prepared: PreparedPublish, door?: Door): Promise<PublishResult> {
  const { repo, token, coursesDir, viewerBase, lectureYaml } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  const { updated, defaultBranch, manifest } = prepared;
  const course = parseCourse(updated);
  const withNames = buildPublishPlan({ course, text: updated, repo, coursesDir, viewerBase, manifest, lectureYaml, door });

  await commitFiles(
    repo,
    token,
    defaultBranch,
    withNames.files,
    withNames.deletions,
    `drawcast: publish course "${course.title || "Untitled course"}"`,
    fetchImpl,
    args.onUpload,
  );

  return {
    text: updated,
    courseUrl: withNames.courseUrl,
    pagesUrl: withNames.pagesUrl,
    readmeUrl: withNames.readmeUrl,
    defaultBranch,
    count: withNames.files.length,
  };
}

/** Prepare and commit in one go, for a caller with no name to register between them. */
export async function publishCourse(args: PublishArgs, door?: Door): Promise<PublishResult> {
  return commitPublish(args, await preparePublish(args), door);
}
