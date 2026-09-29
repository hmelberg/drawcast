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
}
export function publishOrigin(args: PublishOriginArgs): { slug: string; origin: Record<string, unknown> & { path: string } };
export function pagesUrlFor(owner: string, repo: string, path: string): string;
