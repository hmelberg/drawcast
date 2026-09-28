// The pure parts of the /drawcast skill's revise-from-GitHub commands
// (scripts/cast.mjs pull/push), apart so tests can reach them.

/**
 * Where a drawcast lives on GitHub, from any link to it: github.com (tree/blob),
 * raw.githubusercontent.com, a player link (…/#gh=owner/repo/path), a Pages
 * URL (owner.github.io/repo/path/) or plain owner/repo/path.
 */
export function parseGithubTarget(url) {
  const u = url.trim().replace(/[?#]$/, "");
  const trim = (p) => decodeURIComponent(p ?? "").replace(/^\/+|\/+$/g, "").replace(/\/index\.html$|^index\.html$/, "");
  let m;
  if ((m = /#gh=([\w.-]+)\/([\w.-]+)\/(.+)$/.exec(u))) return { owner: m[1], repo: m[2], branch: null, path: trim(m[3]) };
  if ((m = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(\/.*)?)?\/?$/.exec(u))) return { owner: m[1], repo: m[2], branch: m[3] ?? null, path: trim(m[4]) };
  if ((m = /^https?:\/\/raw\.githubusercontent\.com\/([\w.-]+)\/([\w.-]+)\/([^/]+)\/(.+)$/.exec(u))) return { owner: m[1], repo: m[2], branch: m[3], path: trim(m[4]) };
  if ((m = /^https?:\/\/([\w-]+)\.github\.io\/([\w.-]+)(\/.*)?$/.exec(u))) return { owner: m[1], repo: m[2], branch: null, path: trim(m[3]) };
  if ((m = /^([\w.-]+)\/([\w.-]+)(\/.*)?$/.exec(u))) return { owner: m[1], repo: m[2], branch: null, path: trim(m[3]) };
  throw new Error(`not a GitHub link I can read: ${url}`);
}

/**
 * The course page's Join door as it is now, so a republish from here keeps it:
 * a door to a registered name, or the reason there is none (course/page.ts).
 * A page with no join section gives undefined, which is what it was built with.
 */
export function pageDoor(html, doorlessNote) {
  if (!html) return undefined;
  const door = /<a class="door" href="([^"]*?)\/?#([^"]+)"/.exec(html);
  if (door) return { name: door[2], app: door[1] + "/" };
  const note = /Joining is not open yet<\/b> — ([^<]*)</.exec(html)?.[1];
  if (note === undefined) return undefined;
  const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const reasons = ["signed-out", "taken", "short", "invalid", "owner", "elsewhere", "unreachable", "unregistered"];
  const why = reasons.find((r) => doorlessNote(r) === unescape(note).trim());
  return { name: null, why: why ?? "unregistered" };
}
