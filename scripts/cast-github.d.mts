import type { Door, DoorlessReason } from "../src/course/page";

export function parseGithubTarget(url: string): { owner: string; repo: string; branch: string | null; path: string };
export function pageDoor(html: string | null, doorlessNote: (why: DoorlessReason) => string): Door | undefined;
export interface PublishOriginArgs {
  kind: "course" | "cast";
  owner: string;
  repo: string;
  branch: string;
  base: string;
  clone: string;
  viewerBase: string;
  dir: string;
  slug: string;
  takenSlugs: string[];
  slugFor: (title: string, taken: Set<string>) => string;
  /** A cast's extension, publishExt() — ".yaml" when left out. */
  ext?: ".cast" | ".yaml";
}
export const DOC_EXT_RE: RegExp;
export function stripDocExt(name: string): string;
export function formatForName(name: string): "script" | "yaml";
export function publishCastFromEnv(env: Record<string, string | undefined>): boolean;
export function lectureFileName(args: {
  recorded: string | undefined;
  n: number;
  slug: string;
  publishName: (recorded: string) => string;
  publishExt: () => string;
}): { file: string; old: string | null };
export function existingDoc(entries: string[], file: string): string | null;
export function publishOrigin(args: PublishOriginArgs): { slug: string; origin: Record<string, unknown> & { path: string } };
export function pagesUrlFor(owner: string, repo: string, path: string): string;
export function takenSlugs(args: { kind: "course" | "cast"; listed: string[]; tree: string[] }): string[];
export type FileChange = ["new" | "changed" | "deleted", string];
export function fileChanges(
  files: { path: string; content: string; bytes?: Uint8Array }[],
  deletions: string[],
  readAt: (path: string) => Buffer | null,
): { changes: FileChange[]; real: FileChange[] };
