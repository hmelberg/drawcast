// Drive save/open under the drive.file scope, which reaches ONLY files this app
// created or the user explicitly picked. That narrowness is the point: `drive`
// and `drive.readonly` are restricted scopes requiring a paid annual security
// assessment, and this app must never ask for them.
// The "drawcast" folder saves land in is itself app-created, so listing and
// writing to it stays inside drive.file too — no broader scope is ever needed.

import { DRIVE_SCOPE, pickerKey, requireScope } from "./auth";

export interface DriveMeta {
  name: string;
  mimeType: string;
  parents?: string[];
}

/** Pure query-string builder — the Drive `q` filter for our own folder, by name, excluding trash. */
export function folderQuery(name: string): string {
  return `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
}

/** Memoized per session: cleared (not stuck) on failure, so the next Save retries rather than being permanently folderless. */
let cachedFolderId: string | null = null;

/**
 * Find or create the app's own "drawcast" folder, so Saves stop littering the
 * user's Drive root. drive.file's `files.list` only ever returns files this
 * app created or the user picked, so this query can only ever find OUR
 * folder — never something a user happens to have named "drawcast" already.
 *
 * Any failure (declined sign-in, network, a non-OK response) resolves to
 * null rather than throwing: a folderless save to root beats a failed save.
 */
export async function ensureFolder(name = "drawcast"): Promise<string | null> {
  if (cachedFolderId) return cachedFolderId;
  const token = await requireScope(DRIVE_SCOPE);
  if (!token) return null;
  try {
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(folderQuery(name))}&fields=files(id)`;
    const lr = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!lr.ok) throw new Error(`Drive folder lookup failed (${lr.status})`);
    const found = (await lr.json()) as { files?: { id: string }[] };
    if (found.files && found.files.length > 0) {
      cachedFolderId = found.files[0].id;
      return cachedFolderId;
    }
    const cr = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
    });
    if (!cr.ok) throw new Error(`Drive folder create failed (${cr.status})`);
    const created = (await cr.json()) as { id: string };
    cachedFolderId = created.id;
    return cachedFolderId;
  } catch {
    cachedFolderId = null;
    return null;
  }
}

/** Assemble a Drive multipart upload body: metadata part, then content part. */
export function multipartBody(metadata: DriveMeta, content: string, boundary: string): string {
  return (
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${metadata.mimeType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`
  );
}

/**
 * Create the file, or update the one we created before. Passing the previous
 * fileId is what stops a second Save from littering Drive with copies.
 *
 * BOTH paths are multipart, deliberately. `uploadType=media` sends content
 * only and silently drops the metadata, so a PATCH through it would leave a
 * retitled drawcast saved under its old name while the status line claimed the
 * new one. Carrying the metadata part on the update keeps the name Drive holds
 * equal to the name the user was told about.
 */
export async function saveSpec(text: string, name: string, mimeType: string, fileId: string | null, parent?: string | null): Promise<{ fileId: string } | null> {
  const token = await requireScope(DRIVE_SCOPE);
  if (!token) return null;

  const boundary = `drawcast-${crypto.randomUUID()}`;
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  // Parents are a CREATE-time placement, not a move — PATCH must never carry
  // them (Drive rejects `parents` on update; re-parenting an existing file is
  // not this function's job).
  const metadata: DriveMeta = fileId ? { name, mimeType } : parent ? { name, mimeType, parents: [parent] } : { name, mimeType };
  const r = await fetch(url, {
    method: fileId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipartBody(metadata, text, boundary),
  });
  if (!r.ok) throw new Error(`Drive ${fileId ? "update" : "save"} failed (${r.status}): ${await r.text()}`);
  const j = (await r.json()) as { id: string };
  return { fileId: j.id };
}

/** Loaded on first use only. */
let pickerReady: Promise<void> | null = null;
function loadPicker(): Promise<void> {
  // Drop the memo if the load fails, so one transient network blip does not
  // make Open permanently unavailable for the rest of the page's life.
  pickerReady ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onload = () => (window as unknown as { gapi: any }).gapi.load("picker", { callback: () => resolve() });
    s.onerror = () => reject(new Error("could not load the Google file picker"));
    document.head.appendChild(s);
  }).catch((err: unknown) => {
    pickerReady = null;
    throw err;
  });
  return pickerReady;
}

/**
 * Google's own chooser. Picking a file is what grants access to it under
 * drive.file — nothing else in the user's Drive is reachable.
 * Resolves null when the user cancels.
 */
export async function openSpec(): Promise<{ name: string; text: string } | null> {
  const token = await requireScope(DRIVE_SCOPE);
  if (!token) return null;
  await loadPicker();
  const google = (window as unknown as { google: any }).google;

  const picked = await new Promise<{ id: string; name: string } | null>((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes("text/yaml,text/x-yaml,application/json,text/plain")
      .setMode(google.picker.DocsViewMode.LIST);
    new google.picker.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(pickerKey())
      .addView(view)
      .setTitle("Open a drawcast spec")
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) resolve({ id: data.docs[0].id, name: data.docs[0].name });
        else if (data.action === google.picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
  if (!picked) return null;

  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${picked.id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Drive open failed (${r.status}): ${await r.text()}`);
  return { name: picked.name, text: await r.text() };
}
