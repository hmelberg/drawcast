export const MIRROR: string;
export interface Catalogue {
  names: Map<string, string>;
  composites: Map<string, { id: string; name: string }[]>;
}
export interface PartSpec {
  fma?: string[];
  composite?: string;
  side?: "right" | "left";
  filter?: RegExp;
  exclude?: string[];
}
export function parseCatalogue(partsText: string, compositeText: string): Catalogue;
export function elementsFor(cat: Catalogue, spec: PartSpec): string[];
export function fetchStl(id: string, opts: { cacheDir: string; mirror?: string; fetchImpl?: typeof fetch; log?: (s: string) => void }): Promise<Uint8Array | null>;
export function fetchCatalogue(opts: { cacheDir: string; mirror?: string; fetchImpl?: typeof fetch }): Promise<Catalogue>;
