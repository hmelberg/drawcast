export function globalHeaders(toml: string): Record<string, string>;
export function cspDirectives(toml: string): Map<string, string[]>;
export function serve(dir: string, port: number, headers: Record<string, string>): import("node:http").Server;
