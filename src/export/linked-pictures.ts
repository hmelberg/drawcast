// A linked picture (lnk1: an https picture whose host refuses pixel reads)
// shows in the live player, but a canvas that draws the serialised SVG as an
// image never loads an external href — the movie, the snapshot, the poster
// and the beat sheets would show a blank hole where the picture was. Each
// rasterising path runs its SVG text through here first: every <image> whose
// href is http(s) becomes a light box of its own size naming the host, so the
// viewer at least sees where the picture is (final review fix I3).

const IMAGE_TAG = /<image\b([^>]*?)(?:\/>|>\s*<\/image>)/g;

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
}

function hostOf(href: string): string {
  try {
    return new URL(href.replace(/&amp;/g, "&")).host;
  } catch {
    return "the web";
  }
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `svg` with every external (http/https) <image> replaced by a labelled placeholder box; data: images untouched. */
export function placeholdLinkedPictures(svg: string): string {
  return svg.replace(IMAGE_TAG, (whole, attrs: string) => {
    const href = attr(attrs, "href") ?? attr(attrs, "xlink:href");
    if (!href || !/^https?:\/\//i.test(href)) return whole;
    const x = Number(attr(attrs, "x") ?? 0);
    const y = Number(attr(attrs, "y") ?? 0);
    const w = Number(attr(attrs, "width") ?? 0);
    const h = Number(attr(attrs, "height") ?? 0);
    const size = Math.max(8, Math.min(18, h / 6, w / 12));
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f4f1ea" stroke="#b9b2a3" stroke-width="1"/>` +
      `<text x="${x + w / 2}" y="${y + h / 2}" font-size="${size}" font-family="sans-serif" fill="#7a7466" text-anchor="middle" dominant-baseline="middle">picture: ${escapeXml(hostOf(href))}</text>`
    );
  });
}
