// Links between drawcasts (spec 2026-09-28-drawcast-links): what a `link`
// element's `to` names, and — given where the playing drawcast came from —
// what to open. Pure: no fetch, no DOM. The player, the lint and the ensure
// phase all read targets through here, so the forms a link may take are
// decided in one place.

/** A target as written, before it is read against a base. */
export type Target =
  | { kind: "gh"; owner: string; repo: string; path: string }
  | { kind: "drive"; id: string }
  | { kind: "relative"; path: string }
  | { kind: "lecture"; n: number };

/** Where the playing drawcast came from — what a relative target is read against. */
export type LinkBase =
  | { kind: "gh"; owner: string; repo: string; path: string }
  /** The dev server's `?open=/dev-casts/…` (the local author's files). */
  | { kind: "dev"; path: string }
  /**
   * A lecture of a course: `lectures` in course order (1-based `lecture:N`),
   * each with its published `file` and/or the app's saved `drawingId`. `dir`
   * is the course folder's own base, when it has one (GitHub, dev).
   */
  | { kind: "course"; lectures: { file?: string; drawingId?: string }[]; dir?: LinkBase };

export interface Resolved {
  /** The page to open (a player link, or the dev server's ?open=). */
  href?: string;
  /** An app-local drawing to open instead (a lecture of a local course). */
  drawingId?: string;
  /** The target's thumbnail, by the `<name>.png`-beside-it convention. */
  posterUrl?: string;
  /** The target's document, fetchable for its title and `poster:`. */
  docUrl?: string;
}

const DOC = /\.(cast|ya?ml|json)$/i;
const SEG = /^[\w.-]+$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

function ghTarget(owner: string, repo: string, path: string): Target | null {
  if (!SEG.test(owner) || !SEG.test(repo) || !DOC.test(path)) return null;
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return { kind: "gh", owner, repo, path };
}

export function parseTarget(raw: unknown): Target | null {
  if (typeof raw !== "string") return null;
  const to = raw.trim();
  if (to === "") return null;

  const lecture = /^lecture:(\d+)$/.exec(to);
  if (lecture) {
    const n = Number(lecture[1]);
    return n >= 1 ? { kind: "lecture", n } : null;
  }
  const gdrive = /^gdrive:(.+)$/.exec(to);
  if (gdrive) return DRIVE_ID.test(gdrive[1]) ? { kind: "drive", id: gdrive[1] } : null;

  if (/^https?:\/\//i.test(to)) {
    let u: URL;
    try {
      u = new URL(to);
    } catch {
      return null;
    }
    // A player link: the viewer's own hash forms.
    const hashGh = /[#&]gh[=-]([\w.-]+)\/([\w.-]+)\/([^&\s]+)/.exec(u.hash);
    if (hashGh) return ghTarget(hashGh[1], hashGh[2], decodeURIComponent(hashGh[3]));
    const hashDrive = /[#&]gdrive[=-]([A-Za-z0-9_-]{10,})/.exec(u.hash);
    if (hashDrive) return { kind: "drive", id: hashDrive[1] };
    const host = u.hostname.toLowerCase();
    const segs = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (host === "github.com" && segs.length >= 5 && segs[2] === "blob") return ghTarget(segs[0], segs[1], segs.slice(4).join("/"));
    if (host === "raw.githubusercontent.com" && segs.length >= 4) return ghTarget(segs[0], segs[1], segs.slice(3).join("/"));
    if (host === "drive.google.com") {
      const id = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname)?.[1] ?? u.searchParams.get("id");
      return id && DRIVE_ID.test(id) ? { kind: "drive", id } : null;
    }
    return null;
  }

  if (!DOC.test(to)) return null;
  if (to.startsWith("./") || to.startsWith("../")) return { kind: "relative", path: to };
  const parts = to.split("/");
  // owner/repo/path…: three or more segments, not dot-led.
  if (parts.length >= 3) return ghTarget(parts[0], parts[1], parts.slice(2).join("/"));
  if (parts.length === 1 && SEG.test(to)) return { kind: "relative", path: to };
  return null;
}

/** `dir/rel` with `.` and `..` folded; null when it climbs above the root. */
function join(dir: string[], rel: string): string[] | null {
  const out = [...dir];
  for (const p of rel.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(p);
  }
  return out;
}

const trim = (base: string): string => base.replace(/\/+$/, "");
const png = (path: string): string => path.replace(DOC, ".png");
const rawUrl = (owner: string, repo: string, path: string): string => `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`;

function ghResolved(owner: string, repo: string, path: string, viewerBase: string): Resolved {
  return { href: `${trim(viewerBase)}/#gh=${owner}/${repo}/${path}`, posterUrl: rawUrl(owner, repo, png(path)), docUrl: rawUrl(owner, repo, path) };
}

/** A relative path read against a base that has a folder. */
function relativeTo(rel: string, base: LinkBase | null | undefined, viewerBase: string): Resolved | null {
  if (!base) return null;
  if (base.kind === "gh") {
    const parts = join(base.path.split("/").slice(0, -1), rel);
    return parts && parts.length > 0 ? ghResolved(base.owner, base.repo, parts.join("/"), viewerBase) : null;
  }
  if (base.kind === "dev") {
    const parts = join(base.path.split("/").filter(Boolean).slice(0, -1), rel);
    if (!parts || parts.length === 0) return null;
    const path = `/${parts.join("/")}`;
    return { href: `${trim(viewerBase)}/?open=${path}`, posterUrl: png(path), docUrl: path };
  }
  // A course: its folder when it has one; else (the app) a lecture by file name.
  if (base.dir) return relativeTo(rel, base.dir, viewerBase);
  const name = rel.split("/").pop();
  const hit = base.lectures.find((l) => l.file === name && l.drawingId);
  return hit ? { drawingId: hit.drawingId } : null;
}

export function resolveLink(to: unknown, base: LinkBase | null, viewerBase: string): Resolved | null {
  const t = parseTarget(to);
  if (!t) return null;
  switch (t.kind) {
    case "gh":
      return ghResolved(t.owner, t.repo, t.path, viewerBase);
    case "drive":
      return { href: `${trim(viewerBase)}/#gdrive=${t.id}` };
    case "relative":
      return relativeTo(t.path, base, viewerBase);
    case "lecture": {
      if (base?.kind !== "course") return null;
      const lecture = base.lectures[t.n - 1];
      if (!lecture) return null;
      if (base.dir && lecture.file) return relativeTo(`./${lecture.file}`, base.dir, viewerBase);
      return lecture.drawingId ? { drawingId: lecture.drawingId } : null;
    }
  }
}
