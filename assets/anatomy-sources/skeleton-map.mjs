// Source group → atlas part. Left/right are the BODY's own sides (anterior
// view: the body's left is the viewer's right), exactly as the source names them.
//
// detail 2 = the named bones. detail 3 = the small bones of hands and feet.
// The detail-1 silhouettes are the REGIONS below, built as convex hulls.
//
// The left column of `sources` is the source's OWN group ids (or, for
// `Sternum`, a loose path id). A path belongs to the innermost mapped group in
// its chain, so Mandible and Cranium take their own paths and anything else
// directly under Skull (the teeth) falls to cranium. Six unnamed groups were
// identified by position: g3760 is the right femur, g845 the rib cage with
// g1609 the first ribs above it, g447 the lower pelvis, g801 a vertebra at the
// thoracolumbar junction, and g1753 two grey elbow-cartilage paths (dropped).

export const BONES = [
  { id: "cranium", sources: ["Cranium", "Skull"], parent: "skull", detail: 2, name: { en: "Cranium", nb: "Hjerneskalle", la: "Cranium" }, uberon: "UBERON:0003128" },
  { id: "mandible", sources: ["Mandible"], parent: "skull", detail: 2, name: { en: "Mandible", nb: "Underkjeve", la: "Mandibula" }, uberon: "UBERON:0001684" },
  { id: "cervical_vertebrae", sources: ["CervicalVertebrae"], parent: "spine", detail: 2, name: { en: "Cervical vertebrae", nb: "Halsvirvler", la: "Vertebrae cervicales" } },
  { id: "thoracic_vertebrae", sources: ["ThoracicVertebrae", "g801"], parent: "spine", detail: 2, name: { en: "Thoracic vertebrae", nb: "Brystvirvler", la: "Vertebrae thoracicae" } },
  { id: "lumbar_vertebrae", sources: ["LumbarVertebrae"], parent: "spine", detail: 2, name: { en: "Lumbar vertebrae", nb: "Lendevirvler", la: "Vertebrae lumbales" } },
  { id: "sacrum", sources: ["Sacrum"], parent: "spine", detail: 2, name: { en: "Sacrum", nb: "Korsbein", la: "Os sacrum" } },
  { id: "coccyx", sources: ["Coccyx"], parent: "spine", detail: 2, name: { en: "Coccyx", nb: "Halebein", la: "Os coccygis" } },
  { id: "ribs", sources: ["g845", "g1609"], parent: "rib_cage", detail: 2, name: { en: "Ribs", nb: "Ribbein", la: "Costae" }, uberon: "UBERON:0002228" },
  { id: "sternum", sources: ["Sternum", "Manubrium"], parent: "rib_cage", detail: 2, name: { en: "Sternum", nb: "Brystbein", la: "Sternum" }, uberon: "UBERON:0000975" },
  { id: "clavicle_left", sources: ["ClavicleLeft"], parent: "shoulder_girdle", detail: 2, name: { en: "Left clavicle", nb: "Venstre kragebein", la: "Clavicula sinistra" } },
  { id: "clavicle_right", sources: ["ClavicleRight"], parent: "shoulder_girdle", detail: 2, name: { en: "Right clavicle", nb: "Høyre kragebein", la: "Clavicula dextra" } },
  { id: "scapula", sources: ["Scapula"], parent: "shoulder_girdle", detail: 2, name: { en: "Scapulae", nb: "Skulderblad", la: "Scapulae" } },
  { id: "humerus_left", sources: ["HumerusLeft"], parent: "upper_arm_left", detail: 2, name: { en: "Left humerus", nb: "Venstre overarmsbein", la: "Humerus sinister" } },
  { id: "humerus_right", sources: ["HumerusRight"], parent: "upper_arm_right", detail: 2, name: { en: "Right humerus", nb: "Høyre overarmsbein", la: "Humerus dexter" } },
  { id: "radius_left", sources: ["RadiusLeft"], parent: "forearm_left", detail: 2, name: { en: "Left radius", nb: "Venstre spolebein", la: "Radius sinister" } },
  { id: "ulna_left", sources: ["UlnaLeft"], parent: "forearm_left", detail: 2, name: { en: "Left ulna", nb: "Venstre albuebein", la: "Ulna sinistra" } },
  { id: "radius_right", sources: ["RadiusRight"], parent: "forearm_right", detail: 2, name: { en: "Right radius", nb: "Høyre spolebein", la: "Radius dexter" } },
  { id: "ulna_right", sources: ["UlnaRight"], parent: "forearm_right", detail: 2, name: { en: "Right ulna", nb: "Høyre albuebein", la: "Ulna dextra" } },
  { id: "carpals_left", sources: ["CarpalsLeft"], parent: "hand_left", detail: 3, name: { en: "Left carpals", nb: "Venstre håndrotsbein", la: "Ossa carpi" } },
  { id: "metacarpals_left", sources: ["MetacarpalsLeft"], parent: "hand_left", detail: 3, name: { en: "Left metacarpals", nb: "Venstre mellomhåndsbein", la: "Ossa metacarpi" } },
  { id: "phalanges_hand_left", sources: ["PhalangesLeft"], parent: "hand_left", detail: 3, name: { en: "Left finger bones", nb: "Venstre fingerbein", la: "Phalanges manus" } },
  { id: "carpals_right", sources: ["CarpalsRight"], parent: "hand_right", detail: 3, name: { en: "Right carpals", nb: "Høyre håndrotsbein", la: "Ossa carpi" } },
  { id: "metacarpals_right", sources: ["MetacarpalsRight"], parent: "hand_right", detail: 3, name: { en: "Right metacarpals", nb: "Høyre mellomhåndsbein", la: "Ossa metacarpi" } },
  { id: "phalanges_hand_right", sources: ["PhalangesRight"], parent: "hand_right", detail: 3, name: { en: "Right finger bones", nb: "Høyre fingerbein", la: "Phalanges manus" } },
  { id: "hip_bones", sources: ["PelvicGirdle", "g447"], parent: "pelvis", detail: 2, name: { en: "Hip bones", nb: "Hoftebein", la: "Ossa coxae" }, uberon: "UBERON:0001272" },
  { id: "femur_left", sources: ["FemurLeft"], parent: "thigh_left", detail: 2, name: { en: "Left femur", nb: "Venstre lårbein", la: "Os femoris sinistrum" }, uberon: "UBERON:0000981" },
  { id: "femur_right", sources: ["g3760"], parent: "thigh_right", detail: 2, name: { en: "Right femur", nb: "Høyre lårbein", la: "Os femoris dextrum" }, uberon: "UBERON:0000981" },
  { id: "patella_left", sources: ["PatellaLeft"], parent: "lower_leg_left", detail: 2, name: { en: "Left patella", nb: "Venstre kneskål", la: "Patella sinistra" } },
  { id: "patella_right", sources: ["PatellaRight"], parent: "lower_leg_right", detail: 2, name: { en: "Right patella", nb: "Høyre kneskål", la: "Patella dextra" } },
  { id: "tibia_left", sources: ["TibiaLeft"], parent: "lower_leg_left", detail: 2, name: { en: "Left tibia", nb: "Venstre skinnebein", la: "Tibia sinistra" } },
  { id: "fibula_left", sources: ["FibulaLeft"], parent: "lower_leg_left", detail: 2, name: { en: "Left fibula", nb: "Venstre leggbein", la: "Fibula sinistra" } },
  { id: "tibia_right", sources: ["TibiaRight"], parent: "lower_leg_right", detail: 2, name: { en: "Right tibia", nb: "Høyre skinnebein", la: "Tibia dextra" } },
  { id: "fibula_right", sources: ["FibulaRight"], parent: "lower_leg_right", detail: 2, name: { en: "Right fibula", nb: "Høyre leggbein", la: "Fibula dextra" } },
  { id: "tarsals_left", sources: ["TarsalsLeft"], parent: "foot_left", detail: 3, name: { en: "Left tarsals", nb: "Venstre fotrotsbein", la: "Ossa tarsi" } },
  { id: "metatarsals_left", sources: ["MetatarsalsLeft"], parent: "foot_left", detail: 3, name: { en: "Left metatarsals", nb: "Venstre mellomfotsbein", la: "Ossa metatarsi" } },
  { id: "phalanges_foot_left", sources: ["PhalangesFootLeft"], parent: "foot_left", detail: 3, name: { en: "Left toe bones", nb: "Venstre tåbein", la: "Phalanges pedis" } },
  { id: "tarsals_right", sources: ["TarsalsRight"], parent: "foot_right", detail: 3, name: { en: "Right tarsals", nb: "Høyre fotrotsbein", la: "Ossa tarsi" } },
  { id: "metatarsals_right", sources: ["MetatarsalsRight"], parent: "foot_right", detail: 3, name: { en: "Right metatarsals", nb: "Høyre mellomfotsbein", la: "Ossa metatarsi" } },
  { id: "phalanges_foot_right", sources: ["PhalangesFootRight"], parent: "foot_right", detail: 3, name: { en: "Right toe bones", nb: "Høyre tåbein", la: "Phalanges pedis" } },
];

/** Source groups whose paths are NOT bone: dropped before the union. */
export const IGNORED_SOURCES = ["g1753"];

/** Fills that are outline or label art, never bone. Everything else is painted bone or cartilage. */
export const NON_BONE_FILLS = new Set(["none", "#231f20", "?"]);

/** The detail-1 silhouettes: the convex hull of each region's bones. `of` lists
 *  bone ids. The pelvis hull borrows the sacrum and coccyx, whose parent is the
 *  spine — the hull may borrow geometry; the part-of tree is single-parented. */
export const REGIONS = [
  { id: "skull", of: ["cranium", "mandible"], parent: "head", name: { en: "Skull", nb: "Kranium", la: "Cranium" } },
  { id: "spine", of: ["cervical_vertebrae", "thoracic_vertebrae", "lumbar_vertebrae", "sacrum", "coccyx"], parent: "axial", name: { en: "Spine", nb: "Ryggrad", la: "Columna vertebralis" } },
  { id: "shoulder_girdle", of: ["clavicle_left", "clavicle_right", "scapula"], parent: "axial", name: { en: "Shoulder girdle", nb: "Skulderbelte", la: "Cingulum pectorale" } },
  { id: "rib_cage", of: ["ribs", "sternum"], parent: "axial", name: { en: "Rib cage", nb: "Brystkasse", la: "Cavea thoracis" } },
  { id: "pelvis", of: ["hip_bones", "sacrum", "coccyx"], parent: "axial", name: { en: "Pelvis", nb: "Bekken", la: "Pelvis" }, uberon: "UBERON:0002355" },
  { id: "upper_arm_left", of: ["humerus_left"], parent: "arm_left", name: { en: "Left upper arm", nb: "Venstre overarm", la: "Brachium sinistrum" } },
  { id: "forearm_left", of: ["radius_left", "ulna_left"], parent: "arm_left", name: { en: "Left forearm", nb: "Venstre underarm", la: "Antebrachium sinistrum" } },
  { id: "hand_left", of: ["carpals_left", "metacarpals_left", "phalanges_hand_left"], parent: "arm_left", name: { en: "Left hand", nb: "Venstre hånd", la: "Manus sinistra" } },
  { id: "upper_arm_right", of: ["humerus_right"], parent: "arm_right", name: { en: "Right upper arm", nb: "Høyre overarm", la: "Brachium dextrum" } },
  { id: "forearm_right", of: ["radius_right", "ulna_right"], parent: "arm_right", name: { en: "Right forearm", nb: "Høyre underarm", la: "Antebrachium dextrum" } },
  { id: "hand_right", of: ["carpals_right", "metacarpals_right", "phalanges_hand_right"], parent: "arm_right", name: { en: "Right hand", nb: "Høyre hånd", la: "Manus dextra" } },
  { id: "thigh_left", of: ["femur_left"], parent: "leg_left", name: { en: "Left thigh", nb: "Venstre lår", la: "Femur sinistrum" } },
  { id: "lower_leg_left", of: ["tibia_left", "fibula_left", "patella_left"], parent: "leg_left", name: { en: "Left lower leg", nb: "Venstre legg", la: "Crus sinistrum" } },
  { id: "foot_left", of: ["tarsals_left", "metatarsals_left", "phalanges_foot_left"], parent: "leg_left", name: { en: "Left foot", nb: "Venstre fot", la: "Pes sinister" } },
  { id: "thigh_right", of: ["femur_right"], parent: "leg_right", name: { en: "Right thigh", nb: "Høyre lår", la: "Femur dextrum" } },
  { id: "lower_leg_right", of: ["tibia_right", "fibula_right", "patella_right"], parent: "leg_right", name: { en: "Right lower leg", nb: "Høyre legg", la: "Crus dextrum" } },
  { id: "foot_right", of: ["tarsals_right", "metatarsals_right", "phalanges_foot_right"], parent: "leg_right", name: { en: "Right foot", nb: "Høyre fot", la: "Pes dexter" } },
];

/** Grouping parents that own no geometry — they exist so `focus` can name a
 *  limb ("focus the left arm") and get everything in it. */
export const GROUPS = [
  { id: "head", parent: null, name: { en: "Head", nb: "Hode", la: "Caput" } },
  { id: "axial", parent: null, name: { en: "Trunk skeleton", nb: "Kroppsstammen", la: "Skeleton axiale" } },
  { id: "arm_left", parent: null, name: { en: "Left arm", nb: "Venstre arm", la: "Membrum superius sinistrum" } },
  { id: "arm_right", parent: null, name: { en: "Right arm", nb: "Høyre arm", la: "Membrum superius dextrum" } },
  { id: "leg_left", parent: null, name: { en: "Left leg", nb: "Venstre bein", la: "Membrum inferius sinistrum" } },
  { id: "leg_right", parent: null, name: { en: "Right leg", nb: "Høyre bein", la: "Membrum inferius dextrum" } },
];
