// The course document: a plain-text plan the author edits. `#` is the course,
// `##` is a lecture (one drawcast, one video), `###` a chapter inside it.
// `---` lines are decoration and ignored — `##` is the boundary. Reading is
// parseCourse; writing a NEW plan is formatCourse; updating a run's progress is
// setLectureStatus, which edits the text surgically so the author's layout
// survives every run.

export interface LectureStatus {
  state: "pending" | "done" | "failed";
  /** Library id of the generated drawcast. */
  id?: string;
  /** Published file name (stage B writes it; stage A only round-trips it). */
  file?: string;
  ts?: string;
  error?: string;
}

export interface CourseLecture {
  title: string;
  /**
   * What the lecture must cover, one item per line. Questions are what the
   * planner writes and what edits best, but a bare topic is equally valid —
   * the runner reads it as "explain this".
   */
  questions: string[];
  chapters: string[];
  /** Raw drawcast tags, e.g. ["#why", "#parts=4"]. */
  tags: string[];
  options: Record<string, string>;
  status?: LectureStatus;
}

export interface Course {
  title: string;
  /** Shared context injected into every lecture request. */
  context: Record<string, string>;
  /** Learner backend base URL (spec §2) — reserved, never context. */
  enroll?: string;
  /** Name override for drawcast.app/#<name> (spec §7); defaults to the slug. */
  name?: string;
  intro?: string;
  lectures: CourseLecture[];
  warnings: string[];
}

export const MAX_LECTURES = 20;

/** A heading needs the space: "# Title" is a heading, "#why" is a tag. */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
/** A tag line starts with #word and no space. */
const TAG_LINE_RE = /^#[a-zæøå]/i;
const TAG_RE = /#[a-zæøå]+(?:=[^\s#]+)?/gi;
/**
 * An option key is lowercase and single-token, so a capitalised question
 * ("Why: does it matter?") is never mistaken for one.
 */
const OPTION_RE = /^([a-zæøå][a-zæøå0-9_-]*)\s*:\s*(.+)$/;
const RULE_RE = /^-{3,}\s*$/;

function parseOptionLine(line: string): [string, string][] {
  // "level: advanced · minutes: 5" is one line carrying two options.
  return line
    .split("·")
    .map((part) => OPTION_RE.exec(part.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1], m[2].trim()]);
}

export function parseStatus(value: string): LectureStatus {
  const status: LectureStatus = { state: "pending" };
  for (const part of value.split("·").map((p) => p.trim())) {
    const m = OPTION_RE.exec(part);
    if (!m) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(part)) status.ts = part;
      else if (part === "done" || part === "failed" || part === "pending") status.state = part;
      continue;
    }
    if (m[1] === "id") status.id = m[2];
    else if (m[1] === "file") status.file = m[2];
    else if (m[1] === "error") status.error = m[2];
  }
  return status;
}

export function formatStatus(status: LectureStatus): string {
  const parts: string[] = [status.state];
  if (status.id) parts.push(`id: ${status.id}`);
  if (status.file) parts.push(`file: ${status.file}`);
  if (status.error) parts.push(`error: ${status.error}`);
  if (status.ts) parts.push(status.ts);
  return `status: ${parts.join(" · ")}`;
}

function emptyLecture(title: string): CourseLecture {
  return { title, questions: [], chapters: [], tags: [], options: {} };
}

export function parseCourse(text: string): Course {
  const warnings: string[] = [];
  const course: Course = { title: "", context: {}, lectures: [], warnings };
  const introLines: string[] = [];
  let current: CourseLecture | null = null;
  let truncated = false;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || RULE_RE.test(line)) continue;

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const depth = heading[1].length;
      const title = heading[2].trim();
      if (depth === 1) {
        if (course.title) warnings.push(`Second course title "${title}" ignored — the first one wins.`);
        else course.title = title;
        continue;
      }
      if (depth === 2) {
        if (course.lectures.length >= MAX_LECTURES) {
          if (!truncated) {
            warnings.push(`A course is capped at ${MAX_LECTURES} lectures — the rest were dropped.`);
            truncated = true;
          }
          current = null;
          continue;
        }
        current = emptyLecture(title);
        course.lectures.push(current);
        continue;
      }
      if (depth === 3) {
        if (current) current.chapters.push(title);
        continue;
      }
      warnings.push(`"${line}" is deeper than ###; drawcast has one grouping level, so it was kept as a question.`);
      if (current) current.questions.push(title);
      continue;
    }

    if (TAG_LINE_RE.test(line)) {
      if (current) current.tags.push(...(line.match(TAG_RE) ?? []));
      continue;
    }

    // Checked before the generic option split: a status line is ONE option
    // whose value itself contains "·" separators, so splitting first would
    // scatter its id/file/date into unrelated options.
    const status = /^status\s*:\s*(.+)$/.exec(line);
    if (status) {
      if (current) current.status = parseStatus(status[1]);
      continue;
    }

    const options = parseOptionLine(line);
    if (options.length > 0) {
      for (const [key, value] of options) {
        if (current) current.options[key] = value;
        else if (key === "enroll") course.enroll = value;
        else if (key === "name") course.name = value;
        else course.context[key] = value;
      }
      continue;
    }

    if (current) current.questions.push(line);
    else if (course.title) introLines.push(line);
  }

  if (introLines.length > 0) course.intro = introLines.join(" ");
  return course;
}

export function formatCourse(course: Course): string {
  const out: string[] = [`# ${course.title}`];
  // One key per line: parse accepts the "·" form too, but emitting one per line
  // makes parse → format → parse stable without preserving cosmetic grouping.
  for (const [key, value] of Object.entries(course.context)) out.push(`${key}: ${value}`);
  if (course.enroll) out.push(`enroll: ${course.enroll}`);
  if (course.name) out.push(`name: ${course.name}`);
  if (course.intro) out.push("", course.intro);
  for (const lecture of course.lectures) {
    out.push("", "---", `## ${lecture.title}`);
    out.push(...lecture.questions);
    for (const chapter of lecture.chapters) out.push(`### ${chapter}`);
    for (const [key, value] of Object.entries(lecture.options)) out.push(`${key}: ${value}`);
    if (lecture.tags.length > 0) out.push(lecture.tags.join(" "));
    if (lecture.status) out.push(formatStatus(lecture.status));
  }
  return out.join("\n") + "\n";
}

/** The header ends where the first lecture (`##`) begins. */
function headerEnd(lines: string[]): number {
  const firstLecture = lines.findIndex((l) => {
    const h = HEADING_RE.exec(l.trim());
    return h !== null && h[1].length === 2;
  });
  return firstLecture === -1 ? lines.length : firstLecture;
}

/**
 * Write a course-level `key: value` into the header without reformatting
 * anything else — the same surgical contract as setLectureStatus. Used for
 * `slug:`, which the publisher records on first publish so a later retitling
 * cannot move the course's folder and orphan everything already linked.
 */
export function setCourseOption(text: string, key: string, value: string): string {
  const lines = text.split("\n");
  const line = `${key}: ${value}`;
  const end = headerEnd(lines);

  const existing = lines.slice(0, end).findIndex((l) => new RegExp(`^\\s*${key}\\s*:`).test(l));
  if (existing >= 0) {
    lines[existing] = line;
    return lines.join("\n");
  }
  // Straight after the title, so the header reads as a block.
  const title = lines.findIndex((l) => /^#\s+/.test(l.trim()));
  lines.splice(title >= 0 ? title + 1 : 0, 0, line);
  return lines.join("\n");
}

/**
 * Remove a course-level `key:` option from the header — the inverse of
 * setCourseOption. A line carrying several options ("enroll: … · name: …")
 * loses only this key's part; a lecture's own option of the same name is
 * never touched. A surviving shared line IS reformatted, though: its
 * remaining parts are trimmed and rejoined with a normalised " · ", so it may
 * not come back byte-identical even where nothing meaningful changed.
 */
export function removeCourseOption(text: string, key: string): string {
  const lines = text.split("\n");
  const end = headerEnd(lines);
  const keyRe = new RegExp(`^\\s*${key}\\s*:`);
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (i >= end) {
      out.push(line);
      return;
    }
    const parts = line.split("·");
    if (!parts.some((p) => keyRe.test(p))) {
      out.push(line);
      return;
    }
    const kept = parts.map((p) => p.trim()).filter((p) => p !== "" && !keyRe.test(p));
    if (kept.length > 0) out.push(kept.join(" · "));
  });
  return out.join("\n");
}

/**
 * Write one lecture's status into the text without reformatting anything else.
 * A run must never cost the author their layout.
 */
export function setLectureStatus(text: string, index: number, status: LectureStatus): string {
  const lines = text.split("\n");
  const starts: number[] = [];
  lines.forEach((line, i) => {
    const heading = HEADING_RE.exec(line.trim());
    if (heading && heading[1].length === 2) starts.push(i);
  });
  if (index < 0 || index >= starts.length) return text;

  const from = starts[index];
  const to = index + 1 < starts.length ? starts[index + 1] : lines.length;
  const line = formatStatus(status);
  const existing = lines.slice(from, to).findIndex((l) => /^status\s*:/.test(l.trim()));
  if (existing >= 0) {
    lines[from + existing] = line;
    return lines.join("\n");
  }
  // Insert after the block's last non-blank line, so it lands with the lecture.
  let at = to;
  while (at > from && lines[at - 1].trim() === "") at--;
  lines.splice(at, 0, line);
  return lines.join("\n");
}

/**
 * The library ids the course DOCUMENT currently references, in document
 * order. This — not "every row tagged with the courseId" — is what the
 * course actually contains: plan revisions and re-minted statuses leave old
 * versions behind as tagged-but-unreferenced rows, and counting those told
 * Hans his 20-lecture course had 33 lectures (2026-09-02).
 */
export function referencedLectureIds(text: string): string[] {
  return parseCourse(text)
    .lectures.map((l) => l.status?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}
