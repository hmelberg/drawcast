// A book's text pane, as HTML (spec 2026-10-01-book-layout §5): the Markdown
// a `write` carries. Deliberately small — what a textbook column needs and
// nothing that would let a block escape it: headings (# ##), paragraphs,
// (and ###), lists (-), quotes (>), **bold**, *italic*, tables, fenced code listings
// (```python … ``` with an ```output block under it), $inline$ and $$display$$
// math. Raw HTML is escaped, never passed through.
//
// Pure: math is handed to the caller's `tex` function (the engine's MathJax,
// src/book/math.ts) so this module runs in the tests without a DOM.

export type TexFn = (tex: string, display: boolean) => string;

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Bold and italic on already-escaped text. */
function emphasis(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
}

/** A line of prose: `$…$` math, the rest escaped with emphasis. */
function inline(s: string, tex: TexFn): string {
  let out = "";
  let last = 0;
  for (const m of s.matchAll(/\$(?!\$)(.+?)\$/g)) {
    out += emphasis(esc(s.slice(last, m.index)));
    out += `<span class="bk-math">${tex(m[1], false)}</span>`;
    last = (m.index ?? 0) + m[0].length;
  }
  return out + emphasis(esc(s.slice(last)));
}

const PY_KW = /\b(def|return|import|from|as|for|in|if|elif|else|while|lambda|True|False|None|and|or|not|print|round|library|function|TRUE|FALSE|NULL)\b/g;

/** A static code listing, lightly coloured. Never run: code that runs is a
 *  figure (the `code` element). `output` is the run's text, computed when
 *  the lesson was made. */
function listing(lang: string, lines: string[]): string {
  if (lang === "output") return `<pre class="bk-listing bk-output">${esc(lines.join("\n"))}</pre>`;
  const body = lines
    .map((l) => {
      const hash = l.search(/#|\/\//);
      const code = hash >= 0 ? l.slice(0, hash) : l;
      const comment = hash >= 0 ? l.slice(hash) : "";
      // Tokens first, on the raw text, so a keyword inside a string stays a string.
      let html = "";
      let last = 0;
      for (const m of code.matchAll(/("[^"]*"|'[^']*')|\b(\d+(?:\.\d+)?)\b/g)) {
        html += esc(code.slice(last, m.index)).replace(PY_KW, '<span class="k">$1</span>');
        html += m[1] !== undefined ? `<span class="s">${esc(m[1])}</span>` : `<span class="n">${m[2]}</span>`;
        last = (m.index ?? 0) + m[0].length;
      }
      html += esc(code.slice(last)).replace(PY_KW, '<span class="k">$1</span>');
      return html + (comment ? `<span class="c">${esc(comment)}</span>` : "");
    })
    .join("\n");
  return `<pre class="bk-listing" data-lang="${esc(lang)}">${body}</pre>`;
}

const cells = (row: string): string[] => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const isNumber = (c: string): boolean => /^[-−+]?\d+([.,]\d+)?\s*%?$/.test(c);

function table(rows: string[][], tex: TexFn): string {
  const [head, ...body] = rows;
  const numeric = head.map((_, j) => body.length > 0 && body.every((r) => isNumber(r[j] ?? "")));
  const cls = (j: number): string => (numeric[j] ? ' class="num"' : "");
  return (
    "<table>" +
    `<tr>${head.map((c, j) => `<th${cls(j)}>${inline(c, tex)}</th>`).join("")}</tr>` +
    body.map((r) => `<tr>${head.map((_, j) => `<td${cls(j)}>${inline(r[j] ?? "", tex)}</td>`).join("")}</tr>`).join("") +
    "</table>"
  );
}

/** Whether a block's first line is a heading — the auto part heading steps aside for one. */
export function startsWithHeading(src: string): boolean {
  return /^\s*#{1,3}\s/.test(src);
}

/** The Markdown of one `write`, as HTML for the text pane. */
export function renderMarkdown(src: string, tex: TexFn): string {
  let html = "";
  let list = false;
  let fence: string | null = null;
  let fenceLines: string[] = [];
  let rows: string[][] | null = null;
  let para: string[] = [];
  const endList = (): void => {
    if (list) html += "</ul>";
    list = false;
  };
  const endTable = (): void => {
    if (rows) html += table(rows, tex);
    rows = null;
  };
  const endPara = (): void => {
    if (para.length) html += `<p>${para.map((l) => inline(l, tex)).join("<br>")}</p>`;
    para = [];
  };
  const endAll = (): void => {
    endPara();
    endList();
    endTable();
  };
  for (const line of src.replace(/\r\n?/g, "\n").split("\n")) {
    const t = line.trim();
    if (fence !== null) {
      if (t === "```") {
        html += listing(fence, fenceLines);
        fence = null;
        fenceLines = [];
      } else fenceLines.push(line);
      continue;
    }
    if (t.startsWith("```")) {
      endAll();
      fence = t.slice(3).trim() || "text";
      continue;
    }
    if (t.startsWith("|")) {
      endPara();
      endList();
      if (/^\|[\s|:-]+\|?$/.test(t)) continue; // the --- row under the header
      (rows ??= []).push(cells(t));
      continue;
    }
    endTable();
    if (t === "") {
      endPara();
      endList();
      continue;
    }
    if (/^[-*]\s/.test(t)) {
      endPara();
      if (!list) html += "<ul>";
      list = true;
      html += `<li>${inline(t.slice(2), tex)}</li>`;
      continue;
    }
    endList();
    if (t.startsWith("$$") && t.endsWith("$$") && t.length > 4) {
      endPara();
      html += `<div class="bk-display">${tex(t.slice(2, -2).trim(), true)}</div>`;
    } else if (t.startsWith("### ")) {
      endPara();
      html += `<h3>${inline(t.slice(4), tex)}</h3>`;
    } else if (t.startsWith("## ")) {
      endPara();
      html += `<h2>${inline(t.slice(3), tex)}</h2>`;
    } else if (t.startsWith("# ")) {
      endPara();
      html += `<h1>${inline(t.slice(2), tex)}</h1>`;
    } else if (t.startsWith("> ")) {
      endPara();
      html += `<blockquote>${inline(t.slice(2), tex)}</blockquote>`;
    } else para.push(t);
  }
  if (fence !== null) html += listing(fence, fenceLines); // an unclosed fence still shows
  endAll();
  return html;
}
