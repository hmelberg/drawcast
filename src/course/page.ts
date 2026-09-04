// The overview page a student opens: one self-contained HTML file — inline
// style, no external CSS or JS, no build step — generated from the course
// document on every publish, so it cannot drift from the plan. It is equally
// at home hosted on Pages and pasted into an LMS.

import type { CourseEntry } from "../publish/github";
import type { Course } from "./document";
import { ENROL_SCRIPT } from "./enrol-script";

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

export interface PageLink {
  title: string;
  questions: string[];
  /** null for a lecture that has not been generated yet — listed, never linked. */
  href: string | null;
  /** The cast key of a published lecture (spec §1), for the join box's player. */
  cast?: string;
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
  .join input { font: inherit; padding: 0.35rem 0.5rem; margin: 0.25rem 0.25rem 0.25rem 0; max-width: 100%; }
  .join button { font: inherit; padding: 0.35rem 0.8rem; }
  .join .privacy, .join .small { font-size: 0.85rem; opacity: 0.7; margin: 0.5rem 0 0; }
  .mark { display: inline-block; min-width: 3.2rem; margin-right: 0.5rem; cursor: pointer; font-variant-numeric: tabular-nums; }
  .review { margin: 0.5rem 0 0 3.7rem; font-size: 0.9rem; }
  .review li { border: 0; padding: 0.25rem 0; list-style: none; }
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

export function coursePage(course: Course, links: PageLink[], learn?: { courseKey: string; enroll: string }): string {
  const items = links
    .map((link, i) => {
      const head = link.href
        ? `<a class="t" href="${escapeHtml(link.href)}"${link.cast ? ` data-cast="${escapeHtml(link.cast)}"` : ""}>${escapeHtml(link.title)}</a>`
        : `<span class="t">${escapeHtml(link.title)}</span> <span class="soon">not published yet</span>`;
      const questions = link.questions.length
        ? `<ul class="q">${link.questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul>`
        : "";
      return `<li${link.cast ? ` data-cast="${escapeHtml(link.cast)}"` : ""}><span class="n">${i + 1}</span>${head}${questions}</li>`;
    })
    .join("\n");
  const intro = course.intro ? `<p class="intro">${escapeHtml(course.intro)}</p>` : "";
  const join = learn
    ? `<section class="join" data-course="${escapeHtml(learn.courseKey)}" data-enroll="${escapeHtml(learn.enroll)}" data-title="${escapeHtml(course.title)}">
<form id="join-form">
  <b>Join this course</b>
  <input id="join-name" placeholder="Name (optional)" autocomplete="name">
  <input id="join-email" type="email" placeholder="Email (optional — lets you find your code again)" autocomplete="email">
  <button id="join-button" type="submit">Join</button>
  <p class="privacy">We store your name, email and answers so you and the course's teachers can see your progress. "Forget me" deletes all of it.</p>
</form>
<div id="join-you" hidden>
  <b>Your course code:</b> <code id="join-code"></code>
  <span class="small">— <a href="#" id="join-switch">use another code</a> · <a href="#" id="join-forget">Forget me</a></span>
  <p id="join-progress-note" class="small"></p>
</div>
<div id="join-switch-box" hidden><input id="join-switch-input" placeholder="fjell-rev-havn"> <button id="join-switch-button" type="button">Use this code</button></div>
<p id="join-status" class="small"></p>
</section>
<script>${ENROL_SCRIPT}</script>`
    : "";
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
