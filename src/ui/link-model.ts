// Authored links, pure half (interactivity spec §13): the kind is sniffed
// from the URL, never declared — YouTube gets its embed id, Wikipedia its
// language and title (for the summary card), .pdf (and arxiv) the framed
// viewer, everything else a plain new tab. Sniffing keeps the schema to
// one string-array field: no kind vocabulary for the model to learn or
// misremember.

export type LinkKind =
  | { kind: "youtube"; id: string }
  | { kind: "wiki"; lang: string; title: string }
  | { kind: "pdf" }
  | { kind: "url" };

const YT_ID = /^[A-Za-z0-9_-]{6,15}$/;

export function linkKindOf(url: string): LinkKind {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "url" };
  }
  const host = u.hostname.toLowerCase();
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    if (YT_ID.test(id)) return { kind: "youtube", id };
  }
  if (/^(www\.|m\.)?(youtube|youtube-nocookie)\.com$/.test(host)) {
    const embed = /^\/(?:embed|shorts|live)\/([^/?]+)/.exec(u.pathname);
    const id = embed?.[1] ?? (u.pathname === "/watch" ? (u.searchParams.get("v") ?? "") : "");
    if (YT_ID.test(id)) return { kind: "youtube", id };
  }
  const wiki = /^([a-z-]+)\.(?:m\.)?wikipedia\.org$/.exec(host);
  if (wiki) {
    const m = /^\/wiki\/(.+)$/.exec(u.pathname);
    if (m) return { kind: "wiki", lang: wiki[1], title: decodeURIComponent(m[1]) };
  }
  if (/\.pdf$/i.test(u.pathname) || (host.endsWith("arxiv.org") && u.pathname.startsWith("/pdf/"))) return { kind: "pdf" };
  return { kind: "url" };
}

export interface LinkAction {
  url: string;
  link: LinkKind;
  label: string;
}

const FACE: Record<LinkKind["kind"], string> = { youtube: "📺 Watch", wiki: "📖 Wikipedia", pdf: "📕 PDF", url: "🌐" };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** One card action per link: kind faces, plain urls named by their host,
 *  same-kind duplicates disambiguated by host, dedup, at most four. */
export function linkActionsFor(links: readonly string[]): LinkAction[] {
  const urls = [...new Set(links)].slice(0, 4);
  const sniffed = urls.map((url) => ({ url, link: linkKindOf(url) }));
  const kindCount = new Map<string, number>();
  for (const s of sniffed) kindCount.set(s.link.kind, (kindCount.get(s.link.kind) ?? 0) + 1);
  return sniffed.map(({ url, link }) => {
    const face = FACE[link.kind];
    const label =
      link.kind === "url"
        ? `${face} ${hostOf(url) || "Open"}`
        : (kindCount.get(link.kind) ?? 0) > 1
          ? `${face} · ${hostOf(url)}`
          : face;
    return { url, link, label };
  });
}
