export interface Session {
  api: string;
  key: string;
  email: string | null;
}
export function apiUrl(): string;
export function boundedFetch(timeoutMs?: number, fetchImpl?: typeof fetch): typeof fetch;
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
export function registerFor(
  origin: Record<string, unknown>,
  lib: { courseRegistration: (...a: never[]) => unknown; parseCourse: (text: string) => unknown },
  courseText?: string,
): { kind: "cast" | "course"; target: string; title?: string; page?: string; lectures?: string[] };
export function registerNow(args: {
  origin: Record<string, unknown>;
  session: Session | null;
  verify: boolean;
  reg: { kind: "cast" | "course"; target: string; title?: string; page?: string; lectures?: string[] };
  registry: {
    verifyClaim: (...a: never[]) => Promise<boolean>;
    registerItem: (...a: never[]) => Promise<unknown>;
    registryNote: (out: never, signIn?: string) => string;
  };
  names?: {
    courseClaim: (...a: never[]) => unknown;
    claimCourse: (...a: never[]) => Promise<string>;
    claimNote: (outcome: never) => string;
  };
  fetchImpl?: typeof fetch;
}): Promise<{ note: string; name: string | null }>;
export function nameAdvice(state: string, name: string, price: number): string;
export function waitForName(args: {
  api: string;
  name: string;
  target: string;
  timeoutS?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Promise<"ok" | "elsewhere" | "timeout">;
export function checkName(
  N: { checkPaidName: (...a: never[]) => Promise<{ state: string }>; registerName: (...a: never[]) => Promise<string> },
  api: string,
  reg: { key: string; name: string; kind: "cast" | "course"; target: string },
): Promise<string>;
export function nameBlocker(origin: { published?: string; pr?: { url?: string } }, prState: string | null): string | null;
export function shouldClaim(args: { kind: string; direct: boolean; canPush: boolean }): boolean;
export function registrable(origin: Record<string, unknown> | null | undefined): boolean;

// ---- Private (registry delivery 2, task 11) --------------------------------

export function dollars(cents: number): string;

export function privateItemFor(origin: Record<string, unknown>, reg: { target: string }): string;

export interface PrivateQuoteLike {
  due: number;
  currency: string;
  paidLectures: number;
  private: boolean;
  owner: "you" | "other" | "none";
  name: string | null;
}
export type PrivateQuoteOutcomeLike = PrivateQuoteLike | "key" | "error";

export function privateDueMessage(quote: PrivateQuoteLike, work: string): string | null;
export function privateQuoteAdvice(quote: PrivateQuoteOutcomeLike, work: string): string;
export function privatePayAdvice(pay: "nothing-due" | "pending" | "owner" | "key" | "error"): string;

export function waitForPrivate(args: {
  api: string;
  body: unknown;
  quotePrivate: (api: string, body: unknown, fetchImpl?: typeof fetch) => Promise<PrivateQuoteOutcomeLike>;
  timeoutS?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Promise<"paid" | "timeout">;
