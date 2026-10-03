export function decodePicture(b64: string | null): Uint8Array | null;
export function drawPictures(
  texts: string[],
  opts?: {
    root?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    launch?: () => Promise<any>;
    serve?: () => Promise<{ url: string; close(): Promise<void> }>;
    perCastMs?: number;
    /** Where the page's "poster: …" lines go (default console.warn). */
    log?: (line: string) => void;
  },
): Promise<{ pictures: (Uint8Array | null)[]; note: string | null }>;
export function defaultServe(
  root: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  make?: (config: any) => Promise<{ listen(): Promise<unknown>; close(): Promise<void> }>,
): () => Promise<{ url: string; close(): Promise<void> }>;
