// A minimal SVG walk for the atlas build: every <path> with its fill, its
// chain of enclosing <g> ids, and the transform composed from the root down.
// Regex tokenising is enough here — the source is one Inkscape document with
// <g>, <path>, <text> and <rect>, and we only ever need paths and groups.

export const IDENTITY = [1, 0, 0, 1, 0, 0];

/** SVG `transform` attribute → 2×3 matrix [a, b, c, d, e, f]. Handles a
 *  space-separated LIST of matrix / translate / scale in document order. */
export function parseTransform(str) {
  if (!str) return IDENTITY.slice();
  let M = IDENTITY.slice();
  for (const m of str.matchAll(/(matrix|translate|scale)\(([^)]*)\)/g)) {
    const v = m[2].trim().split(/[\s,]+/).map(Number);
    let T;
    if (m[1] === "matrix") T = v;
    else if (m[1] === "translate") T = [1, 0, 0, 1, v[0], v[1] ?? 0];
    else T = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    M = compose(M, T);
  }
  return M;
}

/** A then B applied to a point = A × B in SVG's column convention. */
export function compose(A, B) {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

export function apply(M, [x, y]) {
  return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
}

const attr = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
};

const fillOf = (attrs) => {
  const style = attr(attrs, "style") || "";
  const m = /(?:^|;)\s*fill:\s*([^;]+)/.exec(style);
  if (m) return m[1].trim();
  return attr(attrs, "fill") || "?";
};

/** Walk the document. Returns the viewBox and every <path>, in document order. */
export function parseSvg(text) {
  const vbm = /viewBox="([^"]*)"/.exec(text);
  const viewBox = vbm ? vbm[1].trim().split(/[\s,]+/).map(Number) : null;
  const paths = [];
  const stack = []; // { id, M }
  for (const t of text.matchAll(/<(\/?)([a-zA-Z:]+)\b([^>]*?)(\/?)>/g)) {
    const [, close, name, attrs, selfClose] = t;
    if (name === "g") {
      if (close) { stack.pop(); continue; }
      const parentM = stack.length ? stack[stack.length - 1].M : IDENTITY;
      const g = { id: attr(attrs, "id"), M: compose(parentM, parseTransform(attr(attrs, "transform"))) };
      if (!selfClose) stack.push(g);
    } else if (name === "path" && !close) {
      const parentM = stack.length ? stack[stack.length - 1].M : IDENTITY;
      paths.push({
        id: attr(attrs, "id"),
        d: attr(attrs, "d") || "",
        fill: fillOf(attrs),
        chain: stack.map((g) => g.id),
        matrix: compose(parentM, parseTransform(attr(attrs, "transform"))),
      });
    }
  }
  return { viewBox, paths };
}

/** Flatten one path's data through the runtime's own sampler and put every
 *  point through the path's composed transform. */
export function ringsOf(path, sample, segments) {
  return sample(path.d, segments).map((ring) => ring.map((p) => apply(path.matrix, p)));
}
