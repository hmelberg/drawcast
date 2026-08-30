// The overview page a student opens: one self-contained HTML file — inline
// style, no external CSS or JS, no build step — generated from the course
// document on every publish, so it cannot drift from the plan. It is equally
// at home hosted on Pages and pasted into an LMS.

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
`;

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

export function coursePage(course: Course, links: PageLink[]): string {
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
  return page(course.title, `<h1>${escapeHtml(course.title)}</h1>\n${intro}\n<ol>\n${items}\n</ol>`);
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
