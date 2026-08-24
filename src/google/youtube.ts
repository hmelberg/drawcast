// Resumable upload to the user's own channel. Chunking is not an optimisation:
// fetch() exposes no upload-progress event, so a single PUT of a 50 MB blob
// would show a frozen bar for the entire upload. Per-chunk PUTs give a progress
// tick each time one lands, and make a mid-upload failure resumable.

import { YOUTUBE_SCOPE, requireScope } from "./auth";

export const CHUNK_SIZE = 8 * 1024 * 1024;

export interface UploadMeta {
  title: string;
  description: string;
  privacyStatus: "private" | "unlisted" | "public";
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
    body: JSON.stringify({
      snippet: { title: meta.title, description: meta.description },
      status: { privacyStatus: meta.privacyStatus },
    }),
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
