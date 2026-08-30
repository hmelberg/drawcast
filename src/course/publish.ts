// What a publish contains, and the one function that touches the network.
//
// The plan is pure and tested; publishCourse is the thin orchestration around
// it, so a second target (Drive) would replace that function alone.

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
import { parseCourse, setLectureStatus, type Course } from "./document";
import { coursePage, lectureHref, repoIndexPage, type PageLink } from "./page";

/**
 * Join a repo path, tolerating an empty directory. The default IS empty: a
 * repo dedicated to courses should give hmelberg/dcast/<course>/, not
 * hmelberg/dcast/courses/<course>/. The setting exists for a repo that holds
 * other things too.
 */
export function joinPath(dir: string, ...parts: string[]): string {
  return [dir, ...parts].filter((p) => p !== "").join("/");
}

export interface PublishPlan {
  slug: string;
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
}

export function buildPublishPlan(args: PlanArgs): PublishPlan {
  const { course, text, repo, coursesDir, viewerBase, manifest } = args;
  const slug = slugFor(course.title || "course", new Set());
  const dir = joinPath(coursesDir, slug);

  const taken = new Set<string>();
  const fileOf = new Map<number, string>();
  const files: PublishFile[] = [];
  const links: PageLink[] = [];

  // A lecture already published keeps its recorded name — reserve those first,
  // so a newly minted slug can never collide with one that is permanent.
  for (const lecture of course.lectures) {
    if (lecture.status?.file) taken.add(lecture.status.file.replace(/\.ya?ml$/, ""));
  }

  course.lectures.forEach((lecture, i) => {
    const yaml = args.lectureYaml(i);
    if (!yaml) {
      links.push({ title: lecture.title, questions: lecture.questions, href: null });
      return;
    }
    // A recorded name is permanent: renaming or reordering a lecture must never
    // move the file a published link already points at.
    let name = lecture.status?.file;
    if (!name) {
      const minted = slugFor(lecture.title, taken);
      taken.add(minted);
      name = `${minted}.yaml`;
    }
    fileOf.set(i, name);
    files.push({ path: joinPath(dir, name), content: yaml });
    links.push({
      title: lecture.title,
      questions: lecture.questions,
      href: lectureHref(viewerBase, repo.owner, repo.repo, joinPath(dir, name)),
    });
  });

  files.push({ path: joinPath(dir, "course.md"), content: text });
  files.push({ path: joinPath(dir, "index.html"), content: coursePage(course, links) });

  const entry = {
    slug,
    title: course.title || "Untitled course",
    files: files.map((f) => f.path),
    updated: new Date().toISOString().slice(0, 10),
  };
  const next = upsertCourse(manifest, entry);
  files.push({ path: joinPath(coursesDir, "courses.json"), content: JSON.stringify(next, null, 2) + "\n" });
  files.push({ path: joinPath(coursesDir, "index.html"), content: repoIndexPage(next.courses, course.title) });

  return {
    slug,
    files,
    deletions: removedPaths(
      manifest,
      slug,
      files.map((f) => f.path),
    ),
    fileOf,
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
}

export interface PublishResult {
  /** The course document with each published lecture's file name recorded. */
  text: string;
  courseUrl: string;
  pagesUrl: string;
  defaultBranch: string;
  /** Files written; useful for the report. */
  count: number;
}

export async function publishCourse(args: PublishArgs): Promise<PublishResult> {
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
  let updated = text;
  for (const [index, name] of plan.fileOf) {
    const status = course.lectures[index].status;
    if (status) updated = setLectureStatus(updated, index, { ...status, file: name });
  }
  const withNames = buildPublishPlan({
    course: parseCourse(updated),
    text: updated,
    repo,
    coursesDir,
    viewerBase,
    manifest,
    lectureYaml,
  });

  await commitFiles(
    repo,
    token,
    defaultBranch,
    withNames.files,
    withNames.deletions,
    `drawcast: publish course "${course.title || "Untitled course"}"`,
    fetchImpl,
  );

  return {
    text: updated,
    courseUrl: withNames.courseUrl,
    pagesUrl: withNames.pagesUrl,
    defaultBranch,
    count: withNames.files.length,
  };
}
