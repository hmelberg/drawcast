export function decodePicture(b64: string | null): Uint8Array | null;
export function drawPictures(
  texts: string[],
  opts?: {
    root?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    launch?: () => Promise<any>;
    serve?: () => Promise<{ url: string; close(): Promise<void> }>;
    perCastMs?: number;
  },
): Promise<{ pictures: (Uint8Array | null)[]; note: string | null }>;
