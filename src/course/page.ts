// The overview page a student opens: one self-contained HTML file — inline
// style, no external CSS or JS, no build step — generated from the course
// document on every publish, so it cannot drift from the plan. It is equally
// at home hosted on Pages and pasted into an LMS.

import { MIN_NAME_LENGTH } from "../names";
import type { CourseEntry } from "../publish/github";
import type { Course } from "./document";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function lectureHref(base: string, owner: string, repo: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/#gh=${owner}/${repo}/${path}`;
}

/** The course's door in the app: drawcast.app/#<name> (spec §7, §8). */
export function courseHref(base: string, name: string): string {
  return `${base.replace(/\/+$/, "")}/#${name}`;
}

/**
 * Why a page with `enroll:` carries no door. A door is built ONLY from a name
 * this publish registered (spec §8): a name that came back taken would send
 * the learner into a stranger's run — their address and their answers to
 * someone else — and a name under the floor, or a signed-out publish, to
 * "No drawcast called …". Each reason is a sentence the page says instead.
 */
export type DoorlessReason = "signed-out" | "taken" | "short" | "invalid" | "owner" | "elsewhere" | "unreachable" | "unregistered";

/** The page's join section: a door to a registered name, or why there is none. */
export type Door = { name: string; app: string } | { name: null; why: DoorlessReason };

export function doorlessNote(why: DoorlessReason): string {
  switch (why) {
    case "signed-out":
      return "this course was published without a drawcast account, so it has no name to join under. Its author can publish it again, signed in.";
    case "taken":
      return "the name it asked for belongs to someone else. Its author can set another name: in the course document and publish again.";
    case "short":
      return `its name is too short to register (names need at least ${MIN_NAME_LENGTH} characters). Its author can set a longer name: in the course document and publish again.`;
    case "invalid":
      return "its name is not one the registry accepts. Its author can set another name: in the course document and publish again.";
    case "owner":
      return "the course is owned by another drawcast account, which this publish could not claim.";
    case "elsewhere":
      return "the course names a learner server of its own, and this app reports progress to the drawcast server only.";
    case "unreachable":
      return "the drawcast server could not register it when this was published. Its author can publish again.";
    case "unregistered":
      return "no name was registered for it when it was published.";
    default: {
      const unreachable: never = why;
      return unreachable;
    }
  }
}

export interface PageLink {
  title: string;
  questions: string[];
  /** null for a lecture that has not been generated yet — listed, never linked. */
  href: string | null;
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { max-width: 44rem; margin: 3rem auto; padding: 0 1.25rem;
         font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  h1 { font-size: 1.9rem; margin-bottom: 0.3rem; }
  .intro { opacity: 0.8; margin-top: 0; }
  ol { list-style: none; padding: 0; }
  li { border-top: 1px solid rgba(128,128,128,0.3); padding: 1rem 0; }
  .n { opacity: 0.5; font-variant-numeric: tabular-nums; margin-right: 0.5rem; }
  .t { font-size: 1.1rem; font-weight: 600; }
  .q { margin: 0.35rem 0 0; padding-left: 1.6rem; opacity: 0.8; }
  .q li { border: 0; padding: 0.1rem 0; list-style: disc; }
  .soon { opacity: 0.55; font-size: 0.85rem; font-weight: 400; }
  footer { margin-top: 3rem; font-size: 0.85rem; opacity: 0.6; }
  .join { border: 1px solid rgba(128,128,128,0.35); border-radius: 8px; padding: 1rem; margin: 1rem 0; }
  .join p { margin: 0; }
  .join .door { display: inline-block; margin-top: 0.6rem; font-weight: 600; }
  .join .privacy { font-size: 0.85rem; opacity: 0.7; margin: 0.5rem 0 0; }
`;

/** The shared page look, so a sibling page (published drawcasts) matches. */
export function coursePageStyle(): string {
  return STYLE;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
${body}
<footer>Made with <a href="https://drawcast.app/">drawcast</a></footer>
</html>
`;
}

/**
 * The page is a door, not a dashboard (spec §8): with a `door`, one sentence
 * and one link into the app, where joining is one click for a signed-in
 * account. No script at all — the progress marks, the join form and the
 * code it minted lived in an inline script this page no longer carries.
 * `door.app` is the app's own address (the viewer base), the same base the
 * lecture links use, and `door.name` is the name THIS publish registered —
 * never derived here, so the page cannot point at a name it does not own.
 * A doorless page says why, rather than shipping a broken or hostile link.
 */
export function coursePage(course: Course, links: PageLink[], door?: Door): string {
  const items = links
    .map((link, i) => {
      const head = link.href
        ? `<a class="t" href="${escapeHtml(link.href)}">${escapeHtml(link.title)}</a>`
        : `<span class="t">${escapeHtml(link.title)}</span> <span class="soon">not published yet</span>`;
      const questions = link.questions.length
        ? `<ul class="q">${link.questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul>`
        : "";
      return `<li><span class="n">${i + 1}</span>${head}${questions}</li>`;
    })
    .join("\n");
  const intro = course.intro ? `<p class="intro">${escapeHtml(course.intro)}</p>` : "";
  const join =
    door === undefined
      ? ""
      : door.name !== null
        ? `<section class="join">
<p><b>Join this course</b> — it keeps track of progress for signed-in learners: what you have opened, finished and answered, for you and the course's teachers.</p>
<p><a class="door" href="${escapeHtml(courseHref(door.app, door.name))}">Join this course in drawcast →</a></p>
<p class="privacy">Joining stores your account's email address — the account holds no name — and what you open, finish and answer, so you and the course's teachers can see your progress. The learner backend is hosted in the UK.</p>
</section>`
        : `<section class="join">
<p><b>Joining is not open yet</b> — ${escapeHtml(doorlessNote(door.why))}</p>
</section>`;
  return page(course.title, `<h1>${escapeHtml(course.title)}</h1>\n${intro}\n${join}\n<ol>\n${items}\n</ol>`);
}

export function repoIndexPage(courses: CourseEntry[], base: string): string {
  const items = courses
    .map(
      (c) =>
        `<li><a class="t" href="${escapeHtml(c.slug)}/">${escapeHtml(c.title)}</a> <span class="soon">updated ${escapeHtml(c.updated)}</span></li>`,
    )
    .join("\n");
  return page(base, `<h1>Courses</h1>\n<ol>\n${items}\n</ol>`);
}

// ---- Markdown ------------------------------------------------------------
// github.com renders a folder's README.md with working links, so a course is
// shareable the moment it is committed — no Pages, no build, no waiting. The
// HTML page is the nicer one; this is the one that always works.

/** Only what would otherwise break a link or a heading. */
export function escapeMd(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, "\\$1");
}

export function courseReadme(course: Course, links: PageLink[]): string {
  const out = [`# ${escapeMd(course.title)}`, ""];
  if (course.intro) out.push(escapeMd(course.intro), "");
  links.forEach((link, i) => {
    const title = escapeMd(link.title);
    out.push(link.href ? `${i + 1}. [${title}](${link.href})` : `${i + 1}. ${title} — *not published yet*`);
    for (const q of link.questions) out.push(`   - ${escapeMd(q)}`);
  });
  out.push("", "---", "", "Made with [drawcast](https://drawcast.app/).");
  return out.join("\n") + "\n";
}

export function repoReadme(courses: CourseEntry[]): string {
  const out = ["# Courses", ""];
  for (const c of courses) out.push(`- [${escapeMd(c.title)}](${c.slug}/) — updated ${c.updated}`);
  out.push("", "---", "", "Made with [drawcast](https://drawcast.app/).");
  return out.join("\n") + "\n";
}
