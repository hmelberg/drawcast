// Drive save/open under the drive.file scope, which reaches ONLY files this app
// created or the user explicitly picked. That narrowness is the point: `drive`
// and `drive.readonly` are restricted scopes requiring a paid annual security
// assessment, and this app must never ask for them.

import { DRIVE_SCOPE, pickerKey, requireScope } from "./auth";

export interface DriveMeta {
  name: string;
  mimeType: string;
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
 */
export async function saveSpec(text: string, name: string, fileId: string | null): Promise<{ fileId: string } | null> {
  const token = await requireScope(DRIVE_SCOPE);
  if (!token) return null;

  if (fileId) {
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/yaml" },
      body: text,
    });
    if (!r.ok) throw new Error(`Drive update failed (${r.status}): ${await r.text()}`);
    return { fileId };
  }

  const boundary = `drawcast-${crypto.randomUUID()}`;
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipartBody({ name, mimeType: "text/yaml" }, text, boundary),
  });
  if (!r.ok) throw new Error(`Drive save failed (${r.status}): ${await r.text()}`);
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
