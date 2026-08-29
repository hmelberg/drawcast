// Upload to the user's own channel over YouTube's resumable protocol. The
// chunking is not an optimisation: fetch() exposes no upload-progress event, so
// a single PUT of a 50 MB blob would show a frozen bar for the entire upload.
// Per-chunk PUTs give a progress tick each time one lands. Resuming an
// interrupted upload is NOT implemented — the session URI stays inside this
// function and there is no resume parameter, so a failure mid-upload means
// starting over from the first chunk.

import { YOUTUBE_CAPTIONS_SCOPE, YOUTUBE_SCOPE, requireScope } from "./auth";

export const CHUNK_SIZE = 8 * 1024 * 1024;

export interface UploadMeta {
  title: string;
  description: string;
  privacyStatus: "private" | "unlisted" | "public";
  /** BCP-47 tag for the narration, e.g. "en" or "nb". */
  language: string;
}

/**
 * The video resource sent with the upload session. defaultAudioLanguage is the
 * field that earns its keep: it tells YouTube what language the audio is in,
 * which is what lets it offer the caption track machine-translated to viewers
 * in other languages — and lets the captions count in search.
 */
export function videoResource(meta: UploadMeta): {
  snippet: { title: string; description: string; defaultLanguage: string; defaultAudioLanguage: string };
  status: { privacyStatus: UploadMeta["privacyStatus"] };
} {
  return {
    snippet: { title: meta.title, description: meta.description, defaultLanguage: meta.language, defaultAudioLanguage: meta.language },
    status: { privacyStatus: meta.privacyStatus },
  };
}

/** What YouTube needs to file a caption track under a video. */
export interface CaptionSnippet {
  videoId: string;
  /** BCP-47 tag, e.g. "en" or "nb". */
  language: string;
  /** Track label in the caption menu when a video carries several. */
  name: string;
}

/**
 * A caption track is a multipart/related upload: the snippet as JSON, then the
 * file itself. Small enough (kilobytes) that the resumable protocol the video
 * needs would be pure ceremony here.
 */
export function captionsMultipart(snippet: CaptionSnippet, vtt: string, boundary: string): { body: string; contentType: string } {
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify({ snippet })}\r\n` +
    `--${boundary}\r\n` +
    "Content-Type: text/vtt\r\n\r\n" +
    `${vtt}\r\n` +
    `--${boundary}--\r\n`;
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

/** Half-open ranges [start, end). An empty blob yields none. */
export function chunkRanges(total: number, chunkSize: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let start = 0; start < total; start += chunkSize) {
    out.push({ start, end: Math.min(start + chunkSize, total) });
  }
  return out;
}

/** `end` is exclusive here but inclusive in the header — hence end - 1. */
export function contentRange(start: number, endExclusive: number, total: number): string {
  return `bytes ${start}-${endExclusive - 1}/${total}`;
}

export async function uploadVideo(
  blob: Blob,
  meta: UploadMeta,
  hooks: { onProgress(fraction: number): void; signal: AbortSignal },
): Promise<{ videoId: string } | null> {
  const token = await requireScope(YOUTUBE_SCOPE);
  if (!token) return null;

  const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": blob.type || "video/webm",
      "X-Upload-Content-Length": String(blob.size),
    },
    body: JSON.stringify(videoResource(meta)),
    signal: hooks.signal,
  });
  if (!start.ok) throw new Error(`YouTube rejected the upload (${start.status}): ${await start.text()}`);

  const session = start.headers.get("Location");
  if (!session) {
    // Spec §8: the browser may not be permitted to read this header. If this
    // fires in practice, the fallback is uploadType=multipart.
    throw new Error("YouTube did not return a readable upload session URL");
  }

  const ranges = chunkRanges(blob.size, CHUNK_SIZE);
  for (const [i, r] of ranges.entries()) {
    const put = await fetch(session, {
      method: "PUT",
      headers: { "Content-Range": contentRange(r.start, r.end, blob.size) },
      body: blob.slice(r.start, r.end),
      signal: hooks.signal,
    });
    // 308 = "resume incomplete": the expected reply to every chunk but the last.
    if (put.status === 308) {
      hooks.onProgress((i + 1) / ranges.length);
      continue;
    }
    if (!put.ok) throw new Error(`Upload failed at chunk ${i + 1}/${ranges.length} (${put.status}): ${await put.text()}`);
    hooks.onProgress(1);
    const j = (await put.json()) as { id: string };
    return { videoId: j.id };
  }
  throw new Error("the upload ended without YouTube confirming the video");
}

/**
 * Attach a caption track to an uploaded video. Returns false when the user
 * declines the (wide) captions scope — a normal outcome, not an error: the
 * caller falls back to telling them the .vtt is downloaded and Studio takes it
 * by hand. Throws only when YouTube itself rejects the track.
 *
 * Must be called from a real click. The consent popup needs live transient
 * activation, and the render that preceded the upload burned the one belonging
 * to the click that started it.
 */
export async function uploadCaptions(snippet: CaptionSnippet, vtt: string, signal: AbortSignal): Promise<boolean> {
  const token = await requireScope(YOUTUBE_CAPTIONS_SCOPE);
  if (!token) return false;
  const part = captionsMultipart(snippet, vtt, `drawcast-${Math.random().toString(36).slice(2)}`);
  const res = await fetch("https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": part.contentType },
    body: part.body,
    signal,
  });
  if (!res.ok) throw new Error(`YouTube rejected the caption track (${res.status}): ${await res.text()}`);
  return true;
}
