import type { Door, DoorlessReason } from "../src/course/page";

export function parseGithubTarget(url: string): { owner: string; repo: string; branch: string | null; path: string };
export function pageDoor(html: string | null, doorlessNote: (why: DoorlessReason) => string): Door | undefined;
