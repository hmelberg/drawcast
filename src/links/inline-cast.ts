// A cast carried INSIDE its link: https://drawcast.app/#cast=<data>.
//
// For people who use the drawcast skill in their own LLM (claude.ai, ChatGPT,
// …) with no repo, no GitHub and no account: the LLM writes the cast and a
// link that holds it, and the link plays. The format is fixed — the portable
// skill's link builder (Python, a browser, Node) must produce exactly this:
//
//   <data> = base64url, WITHOUT padding, of the raw DEFLATE (RFC 1951: no
//            zlib or gzip header) of the UTF-8 text of a cast file — YAML or
//            JSON, the same text a #gh= file may hold.
//
//   browser  new CompressionStream("deflate-raw")
//   Node     zlib.deflateRawSync(Buffer.from(text, "utf8"))
//   Python   c = zlib.compressobj(9, zlib.DEFLATED, -15); c.compress(b) + c.flush()
//
// Decoding is strict about the alphabet and bounded in size: a link is a
// stranger's input, and a few kilobytes of deflate can expand to gigabytes.
// Pure: no DOM, no storage — tests/inline-cast.test.ts pins a Python-made
// vector so the two builders can never drift apart.

/** Cap on the decoded text. The largest example in src/examples.json is well under 100 kB. */
export const MAX_CAST_BYTES = 2 * 1024 * 1024;
/** Cap on the link data itself, checked before any work (a 2 MB cast compresses far below this). */
export const MAX_DATA_CHARS = 4 * 1024 * 1024;

export type CastLinkProblem = "empty" | "base64" | "deflate" | "too-large" | "utf8";

export class CastLinkError extends Error {
  readonly problem: CastLinkProblem;
  constructor(problem: CastLinkProblem, message: string) {
    super(message);
    this.name = "CastLinkError";
    this.problem = problem;
  }
}

const B64URL_RE = /^[A-Za-z0-9_-]*$/;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(data: string): Uint8Array {
  // Padding is not part of the format, but tolerated: some encoders add it.
  const bare = data.replace(/=+$/, "");
  if (!B64URL_RE.test(bare) || bare.length % 4 === 1) {
    throw new CastLinkError("base64", "The link's cast data is damaged (it is not base64url). The link may have been cut short or altered — copy the whole link again.");
  }
  const std = bare.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std + "=".repeat((4 - (std.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function readAll(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      void reader.cancel().catch(() => undefined);
      throw new CastLinkError("too-large", `The cast in this link is too large (over ${Math.round(limit / 1024 / 1024)} MB once unpacked).`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  // Errors surface on the readable side; these promises only must not go unhandled.
  writer.write(bytes as Uint8Array<ArrayBuffer>).catch(() => undefined);
  writer.close().catch(() => undefined);
  return readAll(transform.readable as ReadableStream<Uint8Array>, limit);
}

/** The <data> of a #cast= link for this cast text. */
export async function encodeCast(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_CAST_BYTES) throw new CastLinkError("too-large", `The cast is too large for a link (over ${MAX_CAST_BYTES / 1024 / 1024} MB).`);
  const packed = await pipe(bytes, new CompressionStream("deflate-raw"), Number.POSITIVE_INFINITY);
  return toBase64Url(packed);
}

/** The cast text inside a #cast= link's <data>. Throws CastLinkError. */
export async function decodeCast(data: string): Promise<string> {
  const trimmed = data.trim();
  if (trimmed === "") throw new CastLinkError("empty", "The link carries no cast (nothing after #cast=).");
  if (trimmed.length > MAX_DATA_CHARS) throw new CastLinkError("too-large", "The cast in this link is too large.");
  const bytes = fromBase64Url(trimmed);
  let raw: Uint8Array;
  try {
    raw = await pipe(bytes, new DecompressionStream("deflate-raw"), MAX_CAST_BYTES);
  } catch (err) {
    if (err instanceof CastLinkError) throw err;
    throw new CastLinkError(
      "deflate",
      "The link's cast data could not be unpacked (it is not raw DEFLATE, or it was cut short). Copy the whole link again, or ask the AI to rebuild it.",
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new CastLinkError("utf8", "The link's cast is not UTF-8 text.");
  }
}

/** A full link for this data: `<base>#cast=<data>`. */
export function castLinkFor(data: string, base = "https://drawcast.app/"): string {
  return `${base.replace(/#.*$/, "")}#cast=${data}`;
}
