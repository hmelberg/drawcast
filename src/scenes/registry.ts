// Scene registry: manifests are data (Loop 2 improves them); layout code is
// code (Loop 3 improves it). Stub scenes appear in the catalog so the LLM
// knows to fall through to tier-2 composition.

import type { SceneManifest, SceneModule } from "./types";
export type { SceneModule } from "./types";
import { parseTemplateDoc, docToManifest, type TemplateDoc } from "./doc";
import { compileTemplateDoc } from "./compile";
import cellDiagramYaml from "./cell_diagram/template.yaml?raw";
import molecule3dYaml from "./molecule_3d/template.yaml?raw";
import supplyDemandManifest from "./supply_demand/manifest.json";
import decisionTreeManifest from "./decision_tree/manifest.json";
import cepManifest from "./cost_effectiveness_plane/manifest.json";
import markovManifest from "./markov_model/manifest.json";
import twoByTwoManifest from "./two_by_two_table/manifest.json";
import timelineManifest from "./timeline/manifest.json";
import genericAxesManifest from "./generic_axes_diagram/manifest.json";
import { layoutSupplyDemand, type SupplyDemandParams } from "./supply_demand/layout";
import { layoutDecisionTree, type DecisionTreeParams } from "./decision_tree/layout";
import { layoutQalyProfiles, type QalyParams } from "./qaly_profiles/layout";
import qalyManifest from "./qaly_profiles/manifest.json";
import freeBodyManifest from "./free_body/manifest.json";
import ringMoleculeManifest from "./ring_molecule/manifest.json";
import proteinSecondaryManifest from "./protein_secondary/manifest.json";
import { layoutFreeBody, type FreeBodyParams } from "./free_body/layout";
import { layoutRingMolecule, type RingMoleculeParams } from "./ring_molecule/layout";
import { layoutProteinSecondary, type ProteinSecondaryParams } from "./protein_secondary/layout";
import { layoutTwoByTwoTable, type TwoByTwoParams } from "./two_by_two_table/layout";
import { layoutTimeline, type TimelineParams } from "./timeline/layout";
import { layoutGenericAxes, type GenericAxesParams } from "./generic_axes_diagram/layout";
import { layoutMarkovModel, type MarkovParams } from "./markov_model/layout";
import { layoutCostEffectivenessPlane, type CEParams } from "./cost_effectiveness_plane/layout";

export const scenes: Record<string, SceneModule> = {
  supply_demand: {
    manifest: supplyDemandManifest as SceneManifest,
    layout: (params) => layoutSupplyDemand(params as SupplyDemandParams),
  },
  decision_tree: {
    manifest: decisionTreeManifest as SceneManifest,
    layout: (params) => layoutDecisionTree(params as unknown as DecisionTreeParams),
  },
  qaly_profiles: {
    manifest: qalyManifest as SceneManifest,
    layout: (params) => layoutQalyProfiles(params as QalyParams),
  },
  free_body: {
    manifest: freeBodyManifest as SceneManifest,
    layout: (params) => layoutFreeBody(params as FreeBodyParams),
  },
  ring_molecule: {
    manifest: ringMoleculeManifest as SceneManifest,
    layout: (params) => layoutRingMolecule(params as RingMoleculeParams),
  },
  protein_secondary: {
    manifest: proteinSecondaryManifest as SceneManifest,
    layout: (params) => layoutProteinSecondary(params as ProteinSecondaryParams),
  },
  cost_effectiveness_plane: {
    manifest: cepManifest as SceneManifest,
    layout: (params) => layoutCostEffectivenessPlane(params as unknown as CEParams),
  },
  markov_model: {
    manifest: markovManifest as SceneManifest,
    layout: (params) => layoutMarkovModel(params as unknown as MarkovParams),
  },
  two_by_two_table: {
    manifest: twoByTwoManifest as SceneManifest,
    layout: (params) => layoutTwoByTwoTable(params as unknown as TwoByTwoParams),
  },
  timeline: {
    manifest: timelineManifest as SceneManifest,
    layout: (params) => layoutTimeline(params as unknown as TimelineParams),
  },
  generic_axes_diagram: {
    manifest: genericAxesManifest as SceneManifest,
    layout: (params) => layoutGenericAxes(params as unknown as GenericAxesParams),
  },
};

/**
 * Register a template document (spec §1). Ready docs compile to a working
 * scene; a doc whose body fails to compile degrades to a STUB manifest so
 * the catalog still knows it exists (spec §8) — the errors name the problem.
 */
export function registerTemplateDoc(doc: TemplateDoc): { ok: boolean; errors: string[] } {
  const { module, errors } = compileTemplateDoc(doc);
  if (module) {
    scenes[doc.template] = module;
    return { ok: true, errors: [] };
  }
  scenes[doc.template] = { manifest: { ...docToManifest(doc), status: "stub" } };
  return { ok: false, errors };
}

/** Parse + register in one call — startup, packs (M3), and authoring (M2) use this. */
export function registerTemplateYaml(yamlText: string): { ok: boolean; errors: string[] } {
  const { doc, errors } = parseTemplateDoc(yamlText);
  if (!doc) return { ok: false, errors };
  return registerTemplateDoc(doc);
}

// Bundled document-format templates. A registration failure here is a build
// defect — surface it loudly in dev, and the template degrades to a stub.
for (const yaml of [cellDiagramYaml, molecule3dYaml]) {
  const r = registerTemplateYaml(yaml);
  if (!r.ok) console.warn("bundled template failed to register:", r.errors);
}
