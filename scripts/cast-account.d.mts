export interface Session {
  api: string;
  key: string;
  email: string | null;
}
export function apiUrl(): string;
export function sessionPath(home: string): string;
export function readSession(home: string): Session | null;
export function writeSession(home: string, s: Session): void;
export function clearSession(home: string): void;
export function deviceLogin(args: {
  api: string;
  label: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  say?: (s: string) => void;
}): Promise<{ key: string; email: string | null }>;
export function registrationFor(
  origin: Record<string, unknown>,
  name: string,
  lib: { courseRegistration: (...a: never[]) => unknown; castRegistration: (...a: never[]) => unknown; parseCourse: (text: string) => unknown },
  courseText?: string,
): { name: string; kind: "cast" | "course"; target: string; page?: string; title?: string; lectures?: string[] };
export function nameAdvice(state: string, name: string, price: number): string;
