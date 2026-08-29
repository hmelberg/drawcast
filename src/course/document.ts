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
