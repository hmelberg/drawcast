// Every id a template's manifest documents must be drawn by SOME example —
// its manifest examples or a bundled one. The model reads element_ids as a
// contract, and ids that never existed (ring_molecule's ring_center, plot3d's
// pt_<i> under a surface, morse_key's chart_<letter>) sent it — and the
// revision agents — to "unknown id" (ledger, 2026-09-25).
//
// Ids that exist only under a param no example sets (a title when `title` is
// given, a shifted curve, a truncation note) are listed below as known. The
// list may only shrink: a NEW documented id must be exercised by an example.
import { beforeAll, expect, test } from "vitest";
import { scenes } from "../src/scenes/registry";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";
import { ensureEnginesForSpecs } from "../src/scenes/engines";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { heuristicMeasure } from "../src/layout/measure";
import { expandSpec } from "../src/spec/expand";
import examples from "../src/examples.json";
import type { Spec } from "../src/spec/types";

const CONDITIONAL: Record<string, string[]> = {
  supply_demand: ["supply_shift_curve", "supply_shift_arrow", "label_S_shift", "tax_demand_curve", "label_D_tax"],
  free_body: ["label_body", "axes", "net_force", "label_net"],
  ring_molecule: ["atom_<i>"],
  protein_secondary: ["strip_title"],
  generic_axes_diagram: ["hline_<i>", "shade"],
  reaction_scheme: ["label_under"],
  lab_apparatus: ["funnel"],
  periodic_table: ["highlight_<i>"],
  pathway: ["title"],
  flower_anatomy: ["label_stamen", "label_pistil"],
  water_cycle: ["snow"],
  survival_curve: ["title"],
  venn_diagram: ["title"],
  number_line: ["hop_<i>"],
  geometry_figure: ["ticks_<i>"],
  truth_table: ["title"],
  argument_map: ["title"],
  plot3d: ["pt_<i>", "pt_label_<i>", "title"],
  ecg_strip: ["label_st", "st_pointer"],
  heart_circulation: ["label_defect"],
  pv_loop: ["edpvr"],
  anatomy: ["marker_<i>", "marker_label_<i>", "label_finding_<part_id>", "missing_note", "title"],
  is_lm: ["lm_shifted"],
  note_sheet: ["bass_key_<i>"],
  violin_anatomy: ["hi_lower_bout_r", "hi_lower_bout_l", "hi_upper_bout_r", "hi_upper_bout_l", "hi_waist_r", "hi_waist_l"],
  sampling_dist: ["normal_overlay"],
  world_map: ["missing_note", "title"],
  bar_chart: ["note"],
  data_table: ["more"],
  line_chart: ["note"],
  scatter_plot: ["point_1"],
  bar_race: ["note"],
  heatmap: ["note"],
  solar_system: ["missing_note", "title"],
  sky_map: ["title"],
  logic_gates: ["title"],
  bubble_sort: ["title"],
};

const specs: Spec[] = [];
beforeAll(async () => {
  await ensureEnabledPacks(Object.keys(PACK_DEFS) as never);
  for (const [name, mod] of Object.entries(scenes)) for (const ex of mod.manifest.examples ?? []) specs.push({ template: name, params: ex.params, commands: [] } as Spec);
  for (const e of examples as { spec?: Spec }[]) if (e.spec?.template) specs.push(expandSpec(e.spec));
  await ensureEnginesForSpecs(specs);
}, 120000);

/** `bar_<i>`, `cell_<Sym>`: a placeholder matches any non-empty run. */
const matcher = (doc: string) => new RegExp("^" + doc.replace(/[.+?^$()|[\]\\]/g, "\\$&").replace(/<[^>]*>|\{[^}]*\}|\*/g, ".+") + "$");

test("every documented template id is drawn by some example (known conditional ones aside)", () => {
  const seen: Record<string, Set<string>> = {};
  for (const s of specs) {
    let l: { drawables: never[]; groups?: Record<string, unknown>; anchors?: Record<string, unknown> };
    try {
      l = layoutSpec(s, heuristicMeasure) as never;
    } catch {
      continue;
    }
    const set = (seen[s.template!] ??= new Set());
    for (const d of flattenDrawables(l.drawables) as { id: string }[]) set.add(d.id);
    for (const g of Object.keys(l.groups ?? {})) set.add(g);
    for (const g of Object.keys(l.anchors ?? {})) set.add(g);
  }
  const missing: Record<string, string[]> = {};
  const stale: string[] = [];
  for (const [name, mod] of Object.entries(scenes)) {
    if (mod.manifest.status !== "ready" || !mod.layout) continue;
    const got = [...(seen[name] ?? [])];
    const docs = Object.keys(mod.manifest.element_ids).flatMap((k) => k.split(/\s*\/\s*/));
    const absent = docs.filter((k) => !got.some((id) => matcher(k).test(id)));
    const known = new Set(CONDITIONAL[name] ?? []);
    const unexpected = absent.filter((k) => !known.has(k));
    if (unexpected.length > 0) missing[name] = unexpected;
    for (const k of known) if (!absent.includes(k)) stale.push(`${name}: ${k}`);
  }
  expect(missing).toEqual({});
  // An id that an example now draws leaves the list.
  expect(stale).toEqual([]);
}, 300000);
