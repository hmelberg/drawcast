// Joints are DERIVED, not drawn: the closest pair of vertices between the two
// bones, and a small circle at their midpoint. Good enough to click, not an
// anatomical drawing of a joint. The jaw has no clean closest pair (the teeth
// touch along a line), so it takes the mandible's topmost vertex — a condyle.

export const JOINTS = [
  { id: "shoulder_left", between: ["humerus_left", "scapula_left"], parent: "arm_left", name: { en: "Left shoulder", nb: "Venstre skulder", la: "Articulatio humeri sinistra" } },
  { id: "shoulder_right", between: ["humerus_right", "scapula_right"], parent: "arm_right", name: { en: "Right shoulder", nb: "Høyre skulder", la: "Articulatio humeri dextra" } },
  { id: "elbow_left", between: ["humerus_left", "ulna_left"], parent: "arm_left", name: { en: "Left elbow", nb: "Venstre albue", la: "Articulatio cubiti sinistra" } },
  { id: "elbow_right", between: ["humerus_right", "ulna_right"], parent: "arm_right", name: { en: "Right elbow", nb: "Høyre albue", la: "Articulatio cubiti dextra" } },
  { id: "wrist_left", between: ["radius_left", "carpals_left"], parent: "arm_left", name: { en: "Left wrist", nb: "Venstre håndledd", la: "Articulatio radiocarpalis sinistra" } },
  { id: "wrist_right", between: ["radius_right", "carpals_right"], parent: "arm_right", name: { en: "Right wrist", nb: "Høyre håndledd", la: "Articulatio radiocarpalis dextra" } },
  { id: "hip_left", between: ["femur_left", "hip_bones"], parent: "leg_left", name: { en: "Left hip", nb: "Venstre hofte", la: "Articulatio coxae sinistra" } },
  { id: "hip_right", between: ["femur_right", "hip_bones"], parent: "leg_right", name: { en: "Right hip", nb: "Høyre hofte", la: "Articulatio coxae dextra" } },
  { id: "knee_left", between: ["femur_left", "tibia_left"], parent: "leg_left", name: { en: "Left knee", nb: "Venstre kne", la: "Articulatio genus sinistra" } },
  { id: "knee_right", between: ["femur_right", "tibia_right"], parent: "leg_right", name: { en: "Right knee", nb: "Høyre kne", la: "Articulatio genus dextra" } },
  { id: "ankle_left", between: ["tibia_left", "tarsals_left"], parent: "leg_left", name: { en: "Left ankle", nb: "Venstre ankel", la: "Articulatio talocruralis sinistra" } },
  { id: "ankle_right", between: ["tibia_right", "tarsals_right"], parent: "leg_right", name: { en: "Right ankle", nb: "Høyre ankel", la: "Articulatio talocruralis dextra" } },
  { id: "jaw", top: "mandible", parent: "head", name: { en: "Jaw joint", nb: "Kjeveledd", la: "Articulatio temporomandibularis" } },
];

/** Circle radius in atlas units: a share of the longer bone's bbox diagonal, clamped. */
export const jointRadius = (diag) => Math.max(12, Math.min(28, diag * 0.045));
