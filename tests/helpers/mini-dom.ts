// A tiny DOM stand-in, just big enough to mount the SVG backend in the node
// test environment (vite.config.ts pins `environment: "node"`, and the repo
// carries no jsdom). It supports exactly what src/render/svg-backend.ts and
// rough.js touch: element creation, attributes, children, a `style` bag, and
// tag-name querySelectorAll. Anything measurement-shaped (getBBox) throws the
// way a detached node does, which the backend already guards.

export class FakeNode {
  tagName: string;
  ownerDocument: FakeDocument;
  parentNode: FakeNode | null = null;
  children: FakeNode[] = [];
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  textContent = "";
  isConnected = true;

  constructor(tagName: string, ownerDocument: FakeDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
  }

  setAttribute(k: string, v: string): void {
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string): string | null {
    return this.attrs.has(k) ? this.attrs.get(k)! : null;
  }
  hasAttribute(k: string): boolean {
    return this.attrs.has(k);
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
  appendChild<T extends FakeNode>(c: T): T {
    c.parentNode?.removeChild(c);
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeNode[]): void {
    for (const c of cs) this.appendChild(c);
  }
  removeChild(c: FakeNode): void {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null;
  }
  replaceChildren(...cs: FakeNode[]): void {
    for (const c of this.children) c.parentNode = null;
    this.children = [];
    for (const c of cs) this.appendChild(c);
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  cloneNode(deep?: boolean): FakeNode {
    const c = new FakeNode(this.tagName, this.ownerDocument);
    c.attrs = new Map(this.attrs);
    c.style = { ...this.style };
    c.dataset = { ...this.dataset };
    c.textContent = this.textContent;
    if (deep) for (const k of this.children) c.appendChild(k.cloneNode(true));
    return c;
  }
  /** Tag-name selectors only — the backend never uses anything richer. */
  querySelectorAll(sel: string): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (n: FakeNode) => {
      for (const c of n.children) {
        if (c.tagName === sel) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  getTotalLength(): number {
    // Real path lengths never reach the backend's decisions; a stable positive
    // number keeps the dash-offset math well-defined.
    return 100;
  }
  getBBox(): never {
    throw new Error("no layout engine");
  }
}

export class FakeDocument {
  head = new FakeNode("head", this);
  body = new FakeNode("body", this);
  fonts: undefined = undefined;
  createElementNS(_ns: string, tag: string): FakeNode {
    return new FakeNode(tag, this);
  }
  createElement(tag: string): FakeNode {
    return new FakeNode(tag, this);
  }
}

/**
 * Installs the shim as the global `document` for the duration of a test and
 * returns a disposer. rough.js reads `svg.ownerDocument` (set above) and the
 * backend reads the global directly.
 */
export function installMiniDom(): { doc: FakeDocument; restore: () => void } {
  const doc = new FakeDocument();
  const g = globalThis as { document?: unknown };
  const prev = g.document;
  g.document = doc;
  return { doc, restore: () => { g.document = prev; } };
}

/** Flat list of every node under `root` whose id-ish dataset matches a leaf id. */
export function leafNodesFor(root: FakeNode, leafId: string): FakeNode[] {
  const out: FakeNode[] = [];
  const walk = (n: FakeNode) => {
    if (n.dataset.leafId === leafId) out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}
