// Trust for code that travels inside a drawcast (security review 2026-09-28,
// docs/security/2026-09-28-code-execution-inventory.md).
//
// Two things in a cast are programs, and both run in this page's origin with
// everything the page can reach — localStorage (the Anthropic key, the
// account token), fetch, the DOM:
//   - a template document's `layout` / `widget` / `lint` bodies (`spec.templates`,
//     compiled with new Function in scenes/compile.ts), and
//   - a code element's script (python / micropython / brython / microdata run
//     on the main thread with `import js` / `browser.window`; R runs in webR's
//     worker, which still has fetch).
// BASIC is the one exception: it is drawcast's own pure interpreter
// (code/basic.ts) with no way out to the page.
//
// The rule, in one line: such code runs only if it is TRUSTED, and trust is
// a property of the exact bytes (a SHA-256 of the body), never of where a
// cast says it came from. Trusted bytes are:
//   - bundled: built-in templates and packs never pass through here at all;
//     the bundled examples are marked at startup (memory only);
//   - yours: what this browser's own AI session produced, what you typed or
//     edited in the editor (an edit inherits the trust of what it replaced;
//     something with no predecessor is yours), your My templates, the courses
//     loaded from your own GitHub repository, and — once, on first run of
//     this version — everything already in your library;
//   - approved: bytes you chose "Run it" for. Remembered in localStorage, so
//     the same cast does not ask twice; any change to the code asks again.
// Everything else is untrusted. The sinks (cast-templates.ts, render/code.ts,
// the tray and the sweep runner) refuse untrusted code on their own — a path
// nobody thought to gate still cannot run it — and the page asks once, before
// the first render, through the consent handler it installs here.
// "Show without it" is remembered for the tab (sessionStorage).
//
// Node (tests, scripts/*) and pages that only ever render content their host
// supplied (the embeddable engine, the dev frames harness) set the policy to
// "all": there is no stranger's cast there to protect anyone from.

import { sha256Hex } from "./sha256";

export type TrustPolicy = "check" | "all";

export interface CodeItem {
  /** The trust key: kind + SHA-256 of the exact body. */
  key: string;
  kind: "template" | "code";
  /** The template id, or the code element's id. */
  name: string;
  /** Code elements only. */
  language?: string;
}

const TRUSTED_KEY = "drawcast.trustedCode";
const DECLINED_KEY = "drawcast.declinedCode";
const MIGRATED_KEY = "drawcast.trustedCode.migrated";
/** ~37 bytes a key: 3000 keys stay near 110 kB of localStorage. */
const MAX_PERSISTED = 3000;

/** Languages whose scripts can reach the page. BASIC is drawcast's own sandboxed interpreter. */
const SAFE_LANGUAGES: ReadonlySet<string> = new Set(["basic"]);

function defaultPolicy(): TrustPolicy {
  if (typeof window === "undefined") return "all";
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.VITEST ? "all" : "check";
}

let policy: TrustPolicy = defaultPolicy();
/** Session-only trust: bundled examples. */
const memoryTrusted = new Set<string>();
let persisted: Set<string> | null = null;
let declined: Set<string> | null = null;

export function setTrustPolicy(p: TrustPolicy): void {
  policy = p;
}

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? globalThis.localStorage ?? null : globalThis.sessionStorage ?? null;
  } catch {
    return null; // private mode can throw on access
  }
}

function readSet(kind: "local" | "session", key: string): Set<string> {
  try {
    const raw = storage(kind)?.getItem(key);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSet(kind: "local" | "session", key: string, set: Set<string>, cap?: number): void {
  try {
    let arr = [...set];
    if (cap !== undefined && arr.length > cap) arr = arr.slice(arr.length - cap);
    storage(kind)?.setItem(key, JSON.stringify(arr));
  } catch {
    /* quota or private mode: trust stays in memory for this page */
  }
}

function trustedSet(): Set<string> {
  persisted ??= readSet("local", TRUSTED_KEY);
  return persisted;
}

function declinedSet(): Set<string> {
  declined ??= readSet("session", DECLINED_KEY);
  return declined;
}

const short = (text: string): string => sha256Hex(text).slice(0, 32);

/**
 * Every template-document field scenes/compile.ts turns into a function.
 * A new one there must be added here, or its body would ride along
 * unhashed — tests/code-trust.test.ts reads compile.ts and fails if so.
 */
export const TEMPLATE_CODE_FIELDS = ["layout", "widget", "lint"] as const;
type TemplateCode = { [K in (typeof TEMPLATE_CODE_FIELDS)[number]]?: unknown };

/** The trust key of a template document's code (id-independent: the same bodies are the same program). */
export function templateKey(doc: TemplateCode): string {
  return `t:${short(JSON.stringify(TEMPLATE_CODE_FIELDS.map((f) => (typeof doc[f] === "string" ? doc[f] : ""))))}`;
}

export function codeKey(language: string, code: string): string {
  return `c:${short(JSON.stringify([language, code]))}`;
}

/** Does a template document carry a body that would be compiled? */
export function templateHasCode(doc: TemplateCode): boolean {
  return TEMPLATE_CODE_FIELDS.some((f) => typeof doc[f] === "string" && (doc[f] as string).trim() !== "");
}

/** Would this language's script reach the page if it ran? */
export function languageNeedsTrust(language: unknown): boolean {
  return !(typeof language === "string" && SAFE_LANGUAGES.has(language));
}

type SpecLike = { templates?: unknown; elements?: unknown } | null | undefined;

/** Every program a spec carries, deduplicated by key. Tolerates unvalidated input. */
export function codeItemsOf(spec: SpecLike): CodeItem[] {
  const out: CodeItem[] = [];
  const seen = new Set<string>();
  const push = (item: CodeItem): void => {
    if (seen.has(item.key)) return;
    seen.add(item.key);
    out.push(item);
  };
  if (Array.isArray(spec?.templates)) {
    for (const t of spec.templates as unknown[]) {
      if (typeof t !== "object" || t === null) continue;
      const doc = t as TemplateCode & { template?: unknown };
      if (!templateHasCode(doc)) continue;
      push({ key: templateKey(doc), kind: "template", name: typeof doc.template === "string" ? doc.template : "?" });
    }
  }
  if (Array.isArray(spec?.elements)) {
    for (const e of spec.elements as unknown[]) {
      if (typeof e !== "object" || e === null) continue;
      const el = e as { type?: unknown; id?: unknown; language?: unknown; code?: unknown; code_src?: unknown };
      if (el.type !== "code" || typeof el.language !== "string" || !languageNeedsTrust(el.language)) continue;
      const name = typeof el.id === "string" ? el.id : "?";
      // `code` is what the resolve pass runs; `code_src` is what the tray and
      // the sweep rewrite and run. A cast may carry both, and they may differ.
      for (const body of [el.code, el.code_src]) {
        if (typeof body === "string" && body.trim() !== "") push({ key: codeKey(el.language, body), kind: "code", name, language: el.language });
      }
    }
  }
  return out;
}

export function codeItemsOfAll(specs: Iterable<SpecLike>): CodeItem[] {
  const out: CodeItem[] = [];
  const seen = new Set<string>();
  for (const s of specs) {
    for (const item of codeItemsOf(s)) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      out.push(item);
    }
  }
  return out;
}

export function isTrusted(key: string): boolean {
  if (policy === "all") return true;
  return memoryTrusted.has(key) || trustedSet().has(key);
}

export function isDeclined(key: string): boolean {
  return declinedSet().has(key);
}

/** Mark keys trusted. `persist: false` keeps them for this page only (bundled content). */
export function trustKeys(keys: Iterable<string>, opts: { persist?: boolean } = {}): void {
  const persist = opts.persist ?? true;
  const set = trustedSet();
  const dec = declinedSet();
  let changed = false;
  let undeclined = false;
  for (const k of keys) {
    if (persist) {
      // Re-inserting moves the key to the end, so the cap drops the oldest.
      set.delete(k);
      set.add(k);
      changed = true;
    } else memoryTrusted.add(k);
    if (dec.delete(k)) undeclined = true;
  }
  if (changed) writeSet("local", TRUSTED_KEY, set, MAX_PERSISTED);
  if (undeclined) writeSet("session", DECLINED_KEY, dec);
}

/** Everything these specs carry is yours (AI output, bundled examples, your own repository). */
export function trustSpecs(specs: Iterable<SpecLike>, opts: { persist?: boolean } = {}): void {
  trustKeys(
    codeItemsOfAll(specs).map((i) => i.key),
    opts,
  );
}

/**
 * An edit of `before` into `after` (typing in the editor, an AI revise):
 * a program that is new — no template of that id, no code element of that
 * id, before — is the editor's own and becomes trusted; a changed program
 * inherits the trust of what it replaced (an edit of trusted code is
 * trusted; an edit of untrusted code is still someone else's code).
 */
export function trustDerived(before: Iterable<SpecLike>, after: Iterable<SpecLike>): void {
  const prior = new Map<string, string[]>();
  for (const item of codeItemsOfAll(before)) {
    const id = `${item.kind}:${item.name}`;
    prior.set(id, [...(prior.get(id) ?? []), item.key]);
  }
  const fresh: string[] = [];
  for (const item of codeItemsOfAll(after)) {
    if (isTrusted(item.key)) continue;
    const pred = prior.get(`${item.kind}:${item.name}`);
    if (!pred || pred.some((k) => isTrusted(k))) fresh.push(item.key);
  }
  if (fresh.length > 0) trustKeys(fresh);
}

/** The programs in these specs that may not run as things stand. */
export function untrustedItems(specs: Iterable<SpecLike>): CodeItem[] {
  if (policy === "all") return [];
  return codeItemsOfAll(specs).filter((i) => !isTrusted(i.key));
}

export function declineKeys(keys: Iterable<string>): void {
  const dec = declinedSet();
  for (const k of keys) dec.add(k);
  writeSet("session", DECLINED_KEY, dec);
}

// ---- asking ----------------------------------------------------------------

/** Shows the page's consent prompt; resolves true for "Run it". */
export type ConsentHandler = (items: CodeItem[]) => Promise<boolean>;

let handler: ConsentHandler | null = null;
let queue: Promise<unknown> = Promise.resolve();

export function setConsentHandler(h: ConsentHandler | null): void {
  handler = h;
}

function serialized<T>(run: () => Promise<T>): Promise<T> {
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

async function ask(pending: CodeItem[]): Promise<boolean> {
  if (!handler) {
    declineKeys(pending.map((i) => i.key));
    return false;
  }
  let ok = false;
  try {
    ok = await handler(pending);
  } catch {
    ok = false;
  }
  if (ok) trustKeys(pending.map((i) => i.key));
  else declineKeys(pending.map((i) => i.key));
  return ok;
}

/**
 * Before a render: may these specs' programs run? Asks at most once per set
 * of programs per tab — a set the viewer already declined this session is
 * declined again silently. No handler installed = declined (fail closed).
 * Serialized, so two renders racing never stack two prompts.
 */
export function gateSpecs(specs: SpecLike[], opts: { askAgain?: boolean } = {}): Promise<boolean> {
  return serialized(async () => {
    const pending = untrustedItems(specs);
    if (pending.length === 0) return true;
    if (!opts.askAgain && pending.every((i) => isDeclined(i.key))) return false;
    return ask(pending);
  });
}

/** A direct click on Run for one program (the tray): asks even if declined before. */
export function gateItem(item: CodeItem): Promise<boolean> {
  if (isTrusted(item.key)) return Promise.resolve(true);
  return serialized(async () => (isTrusted(item.key) ? true : ask([item])));
}

// ---- first run ---------------------------------------------------------------

/**
 * Once per browser: the library that existed before this gate did is the
 * owner's own work (it already ran without asking), so it is trusted as it
 * stands. Anything added after this goes through the gate.
 */
export function migrateOnce(specs: () => Iterable<SpecLike>): void {
  const ls = storage("local");
  if (!ls) return;
  try {
    if (ls.getItem(MIGRATED_KEY)) return;
    trustSpecs(specs());
    ls.setItem(MIGRATED_KEY, new Date().toISOString());
  } catch {
    /* next load tries again */
  }
}

// ---- what the sinks refused ---------------------------------------------------

const blockedListeners = new Set<(item: CodeItem) => void>();

/** Called by a sink that refused to run a program. */
export function noteBlocked(item: CodeItem): void {
  for (const l of blockedListeners) l(item);
}

export function onBlocked(l: (item: CodeItem) => void): () => void {
  blockedListeners.add(l);
  return () => blockedListeners.delete(l);
}

/** Test seam: forget everything (memory and storage) and restore the default policy. */
export function resetCodeTrust(p: TrustPolicy = defaultPolicy()): void {
  policy = p;
  memoryTrusted.clear();
  persisted = null;
  declined = null;
  handler = null;
  queue = Promise.resolve();
  blockedListeners.clear();
  try {
    storage("local")?.removeItem(TRUSTED_KEY);
    storage("local")?.removeItem(MIGRATED_KEY);
    storage("session")?.removeItem(DECLINED_KEY);
  } catch {
    /* nothing stored */
  }
}
