// The object a layout sees as `engines.space` and the ⊕ Space section reads:
// the table's bodies, the ephemeris, and the scale rules, behind one interface.
// Built by engines.ts's loadSpace from the dynamically imported table; this
// module is the lazy chunk (it is what pulls astronomy-engine in).

import { AU_KM, drawnRadii, expandBodies, indexBodies, labelTiers, logRadius, moonsOf, orbitRadii, satellitesFor, scaleBar, scaleNote, sunSegment } from "./rules";
import { EPHEMERIS_IDS, helioPositions, moonPhase, moonPositionsKm, resolveDate } from "./ephemeris";
import type { BodiesTable, SpaceEngine } from "./types";

export function makeSpaceEngine(table: BodiesTable): SpaceEngine {
  const all = indexBodies(table);
  const toBodies = (r: { ids: string[]; missing: string[] }) => ({ bodies: r.ids.map((id) => all[id]), missing: r.missing });
  return {
    all: () => all,
    body: (id) => all[id],
    bodies: (sel) => toBodies(expandBodies(all, sel)),
    moonsOf: (parentId) => moonsOf(all, parentId),
    satellites: (focus, moons) => toBodies(satellitesFor(all, focus, moons)),
    resolveDate,
    positions: (ids, d) => helioPositions(all, ids, d),
    moonPositions: (parentId, ids, d) => moonPositionsKm(all, parentId, ids, d),
    phase: moonPhase,
    schematic: (id) => !EPHEMERIS_IDS.has(id),
    au: (km) => km / AU_KM,
    km: (au) => au * AU_KM,
    orbitRadii,
    logRadius,
    drawnRadii,
    sunSegment,
    scaleNote,
    scaleBar,
    labelTiers,
  };
}
