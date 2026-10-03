export const ICONIFY: string;
export interface IconRecord {
  url: string;
  at: number;
  status: number;
  contentType: string;
  body: string;
}
export function iconFetcher(opts: {
  dir: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  tries?: number;
  baseMs?: number;
  parallel?: number;
}): (url: string) => Promise<IconRecord>;
export function iconCacheDir(root: string): string;
export function nodeFetch(get: (url: string) => Promise<IconRecord>, fetchImpl?: typeof fetch): typeof fetch;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function routePage(page: any, get: (url: string) => Promise<IconRecord>): Promise<void>;
