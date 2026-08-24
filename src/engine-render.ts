// render()/loadSpecText() for embedders: same contracts as src/render and
// src/spec, plus the default packs' templates and any template engines are
// registered first — the drawcast app does that in main.ts; an embedded
// engine must do it itself. Validation therefore always sees pack templates.
import { render as coreRender, type RenderHandle, type RenderOptions } from "./render";
import { validateSpec } from "./spec/schema";
import { parseSpecText } from "./spec/text";
import type { Spec } from "./spec/types";
import { ensureEnginesForTemplate } from "./scenes/engines";
import { PACK_DEFS, ensureEnabledPacks } from "./scenes/packs";

let packsReady: Promise<unknown> | null = null;
function ensurePacks(): Promise<unknown> {
  packsReady ??= ensureEnabledPacks(Object.keys(PACK_DEFS));
  return packsReady;
}

export async function loadSpecText(text: string): Promise<{ spec: Spec; errors: string[] }> {
  await ensurePacks();
  const { value } = parseSpecText(text);
  const v = validateSpec(value);
  return { spec: value as Spec, errors: v.ok ? [] : v.errors };
}

export async function render(spec: Spec, container: HTMLElement, options: RenderOptions = {}): Promise<RenderHandle> {
  await ensurePacks();
  if (spec.template) await ensureEnginesForTemplate(spec.template);
  return coreRender(spec, container, options);
}
