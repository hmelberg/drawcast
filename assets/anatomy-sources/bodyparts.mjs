// Every atlas part and where its geometry comes from in BodyParts3D 3.0.
// `fma` lists leaf element ids; `composite` names a row set in
// composite_parts.txt, narrowed by `side` (element name carries "right"/"left"),
// `filter` (a regex on the element name) and `exclude`. Sided hand and foot
// bones come from the laterality-neutral sets this way.
//
// detail: 1 = the region silhouettes (built as hulls of these bones) and the big
// organs, 2 = named bones, joints and the smaller organs, 3 = the small bones
// and the fine organs. layer: "superficial" parts are lifted away by
// `layer: deep`; behind: drawn dashed under a superficial layer.
//
// Left/right are the BODY's sides, as the dataset names them. Not in this
// dataset, and so not here: the coccyx and the thyroid gland.

export const SKIN = { fma: ["FMA7163"] };

export const BONES = [
  { id: "cranium", composite: "FMA46565", exclude: ["FMA52748"], parent: "skull", detail: 2, name: { en: "Cranium", nb: "Hjerneskalle", la: "Cranium" }, uberon: "UBERON:0003128" },
  { id: "mandible", fma: ["FMA52748"], parent: "skull", detail: 2, name: { en: "Mandible", nb: "Underkjeve", la: "Mandibula" }, uberon: "UBERON:0001684" },
  // The vertebra "sets" have no files of their own; the vertebrae do (atlas, axis, C3–C7; T1–T12; L1–L5).
  { id: "cervical_vertebrae", fma: ["FMA12519", "FMA12520", "FMA12521", "FMA12522", "FMA12523", "FMA12524", "FMA12525"], parent: "spine", detail: 2, name: { en: "Cervical vertebrae", nb: "Halsvirvler", la: "Vertebrae cervicales" } },
  { id: "thoracic_vertebrae", fma: ["FMA9165", "FMA9187", "FMA9209", "FMA9248", "FMA9922", "FMA9945", "FMA9968", "FMA9991", "FMA10014", "FMA10037", "FMA10059", "FMA10081"], parent: "spine", detail: 2, name: { en: "Thoracic vertebrae", nb: "Brystvirvler", la: "Vertebrae thoracicae" } },
  { id: "lumbar_vertebrae", fma: ["FMA13072", "FMA13073", "FMA13074", "FMA13075", "FMA13076"], parent: "spine", detail: 2, name: { en: "Lumbar vertebrae", nb: "Lendevirvler", la: "Vertebrae lumbales" } },
  { id: "sacrum", fma: ["FMA16202"], parent: "spine", detail: 2, name: { en: "Sacrum", nb: "Korsbein", la: "Os sacrum" } },
  { id: "ribs", composite: "FMA71331", parent: "rib_cage", detail: 2, name: { en: "Ribs", nb: "Ribbein", la: "Costae" }, uberon: "UBERON:0002228" },
  { id: "sternum", composite: "FMA7485", parent: "rib_cage", detail: 2, name: { en: "Sternum", nb: "Brystbein", la: "Sternum" }, uberon: "UBERON:0000975" },
  { id: "clavicle_left", fma: ["FMA13323"], parent: "shoulder_girdle", detail: 2, name: { en: "Left clavicle", nb: "Venstre kragebein", la: "Clavicula sinistra" } },
  { id: "clavicle_right", fma: ["FMA13322"], parent: "shoulder_girdle", detail: 2, name: { en: "Right clavicle", nb: "Høyre kragebein", la: "Clavicula dextra" } },
  { id: "scapula_left", fma: ["FMA13396"], parent: "shoulder_girdle", detail: 2, name: { en: "Left scapula", nb: "Venstre skulderblad", la: "Scapula sinistra" } },
  { id: "scapula_right", fma: ["FMA13395"], parent: "shoulder_girdle", detail: 2, name: { en: "Right scapula", nb: "Høyre skulderblad", la: "Scapula dextra" } },
  { id: "humerus_left", fma: ["FMA23131"], parent: "upper_arm_left", detail: 2, name: { en: "Left humerus", nb: "Venstre overarmsbein", la: "Humerus sinister" } },
  { id: "humerus_right", fma: ["FMA23130"], parent: "upper_arm_right", detail: 2, name: { en: "Right humerus", nb: "Høyre overarmsbein", la: "Humerus dexter" } },
  { id: "radius_left", fma: ["FMA23465"], parent: "forearm_left", detail: 2, name: { en: "Left radius", nb: "Venstre spolebein", la: "Radius sinister" } },
  { id: "ulna_left", fma: ["FMA23468"], parent: "forearm_left", detail: 2, name: { en: "Left ulna", nb: "Venstre albuebein", la: "Ulna sinistra" } },
  { id: "radius_right", fma: ["FMA23464"], parent: "forearm_right", detail: 2, name: { en: "Right radius", nb: "Høyre spolebein", la: "Radius dexter" } },
  { id: "ulna_right", fma: ["FMA23467"], parent: "forearm_right", detail: 2, name: { en: "Right ulna", nb: "Høyre albuebein", la: "Ulna dextra" } },
  { id: "carpals_left", composite: "FMA71335", side: "left", parent: "hand_left", detail: 3, name: { en: "Left carpals", nb: "Venstre håndrotsbein", la: "Ossa carpi" } },
  { id: "metacarpals_left", composite: "FMA71336", side: "left", parent: "hand_left", detail: 3, name: { en: "Left metacarpals", nb: "Venstre mellomhåndsbein", la: "Ossa metacarpi" } },
  { id: "phalanges_hand_left", composite: "FMA231315", side: "left", filter: /finger|thumb/, parent: "hand_left", detail: 3, name: { en: "Left finger bones", nb: "Venstre fingerbein", la: "Phalanges manus" } },
  { id: "carpals_right", composite: "FMA71335", side: "right", parent: "hand_right", detail: 3, name: { en: "Right carpals", nb: "Høyre håndrotsbein", la: "Ossa carpi" } },
  { id: "metacarpals_right", composite: "FMA71336", side: "right", parent: "hand_right", detail: 3, name: { en: "Right metacarpals", nb: "Høyre mellomhåndsbein", la: "Ossa metacarpi" } },
  { id: "phalanges_hand_right", composite: "FMA231315", side: "right", filter: /finger|thumb/, parent: "hand_right", detail: 3, name: { en: "Right finger bones", nb: "Høyre fingerbein", la: "Phalanges manus" } },
  { id: "hip_bones", fma: ["FMA16586", "FMA16587"], parent: "pelvis", detail: 2, name: { en: "Hip bones", nb: "Hoftebein", la: "Ossa coxae" }, uberon: "UBERON:0001272" },
  { id: "femur_left", fma: ["FMA24475"], parent: "thigh_left", detail: 2, name: { en: "Left femur", nb: "Venstre lårbein", la: "Os femoris sinistrum" }, uberon: "UBERON:0000981" },
  { id: "femur_right", fma: ["FMA24474"], parent: "thigh_right", detail: 2, name: { en: "Right femur", nb: "Høyre lårbein", la: "Os femoris dextrum" }, uberon: "UBERON:0000981" },
  { id: "patella_left", fma: ["FMA24487"], parent: "lower_leg_left", detail: 2, name: { en: "Left patella", nb: "Venstre kneskål", la: "Patella sinistra" } },
  { id: "patella_right", fma: ["FMA24486"], parent: "lower_leg_right", detail: 2, name: { en: "Right patella", nb: "Høyre kneskål", la: "Patella dextra" } },
  { id: "tibia_left", fma: ["FMA24478"], parent: "lower_leg_left", detail: 2, name: { en: "Left tibia", nb: "Venstre skinnebein", la: "Tibia sinistra" } },
  { id: "fibula_left", fma: ["FMA24481"], parent: "lower_leg_left", detail: 2, name: { en: "Left fibula", nb: "Venstre leggbein", la: "Fibula sinistra" } },
  { id: "tibia_right", fma: ["FMA24477"], parent: "lower_leg_right", detail: 2, name: { en: "Right tibia", nb: "Høyre skinnebein", la: "Tibia dextra" } },
  { id: "fibula_right", fma: ["FMA24480"], parent: "lower_leg_right", detail: 2, name: { en: "Right fibula", nb: "Høyre leggbein", la: "Fibula dextra" } },
  { id: "tarsals_left", composite: "FMA71339", side: "left", parent: "foot_left", detail: 3, name: { en: "Left tarsals", nb: "Venstre fotrotsbein", la: "Ossa tarsi" } },
  { id: "metatarsals_left", composite: "FMA71340", side: "left", parent: "foot_left", detail: 3, name: { en: "Left metatarsals", nb: "Venstre mellomfotsbein", la: "Ossa metatarsi" } },
  { id: "phalanges_foot_left", composite: "FMA231315", side: "left", filter: /toe/, parent: "foot_left", detail: 3, name: { en: "Left toe bones", nb: "Venstre tåbein", la: "Phalanges pedis" } },
  { id: "tarsals_right", composite: "FMA71339", side: "right", parent: "foot_right", detail: 3, name: { en: "Right tarsals", nb: "Høyre fotrotsbein", la: "Ossa tarsi" } },
  { id: "metatarsals_right", composite: "FMA71340", side: "right", parent: "foot_right", detail: 3, name: { en: "Right metatarsals", nb: "Høyre mellomfotsbein", la: "Ossa metatarsi" } },
  { id: "phalanges_foot_right", composite: "FMA231315", side: "right", filter: /toe/, parent: "foot_right", detail: 3, name: { en: "Right toe bones", nb: "Høyre tåbein", la: "Phalanges pedis" } },
];

/** detail-1 silhouettes: convex hulls of these bones. */
export const REGIONS = [
  { id: "skull", of: ["cranium", "mandible"], parent: "head", name: { en: "Skull", nb: "Kranium", la: "Cranium" } },
  { id: "spine", of: ["cervical_vertebrae", "thoracic_vertebrae", "lumbar_vertebrae", "sacrum"], parent: "axial", name: { en: "Spine", nb: "Ryggrad", la: "Columna vertebralis" } },
  { id: "shoulder_girdle", of: ["clavicle_left", "clavicle_right", "scapula_left", "scapula_right"], parent: "axial", name: { en: "Shoulder girdle", nb: "Skulderbelte", la: "Cingulum pectorale" } },
  { id: "rib_cage", of: ["ribs", "sternum"], parent: "axial", name: { en: "Rib cage", nb: "Brystkasse", la: "Cavea thoracis" } },
  { id: "pelvis", of: ["hip_bones", "sacrum"], parent: "axial", name: { en: "Pelvis", nb: "Bekken", la: "Pelvis" }, uberon: "UBERON:0002355" },
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

export const GROUPS = [
  { id: "head", parent: null, name: { en: "Head", nb: "Hode", la: "Caput" } },
  { id: "axial", parent: null, name: { en: "Trunk skeleton", nb: "Kroppsstammen", la: "Skeleton axiale" } },
  { id: "arm_left", parent: null, name: { en: "Left arm", nb: "Venstre arm", la: "Membrum superius sinistrum" } },
  { id: "arm_right", parent: null, name: { en: "Right arm", nb: "Høyre arm", la: "Membrum superius dextrum" } },
  { id: "leg_left", parent: null, name: { en: "Left leg", nb: "Venstre bein", la: "Membrum inferius sinistrum" } },
  { id: "leg_right", parent: null, name: { en: "Right leg", nb: "Høyre bein", la: "Membrum inferius dextrum" } },
];

export const VISCERA = [
  { id: "brain", composite: "FMA50801", parent: "head", detail: 1, color: "#c9a3ae", uberon: "UBERON:0000955", name: { en: "Brain", nb: "Hjerne", la: "Encephalon" } },
  { id: "trachea", fma: ["FMA7394"], parent: "thorax", detail: 2, color: "#a8b0b8", name: { en: "Trachea", nb: "Luftrør", la: "Trachea" } },
  { id: "esophagus", fma: ["FMA7131"], parent: "thorax", detail: 3, behind: true, color: "#b59a8c", name: { en: "Oesophagus", nb: "Spiserør", la: "Oesophagus" } },
  { id: "lung_right", composite: "FMA7309", parent: "thorax", detail: 1, color: "#c98f9b", uberon: "UBERON:0002168", name: { en: "Right lung", nb: "Høyre lunge", la: "Pulmo dexter" } },
  { id: "lung_left", composite: "FMA7310", parent: "thorax", detail: 1, color: "#c98f9b", uberon: "UBERON:0002167", name: { en: "Left lung", nb: "Venstre lunge", la: "Pulmo sinister" } },
  { id: "heart", composite: "FMA7088", parent: "thorax", detail: 1, color: "#b8524f", uberon: "UBERON:0000948", name: { en: "Heart", nb: "Hjerte", la: "Cor" } },
  { id: "aorta", composite: "FMA3734", parent: "thorax", detail: 3, behind: true, color: "#c0655f", uberon: "UBERON:0000947", name: { en: "Aorta", nb: "Hovedpulsåre", la: "Aorta" } },
  // No diaphragm: in frontal projection its dome and crura are a sheet that
  // covers the whole upper abdomen (measured: every point of the liver, most
  // of the stomach and the kidneys), so as a filled silhouette it hides what
  // it should sit between. A dome LINE is the right drawing — roadmap.
  { id: "liver", fma: ["FMA7197"], parent: "abdomen", detail: 1, layer: "superficial", color: "#8a5a3c", uberon: "UBERON:0002107", name: { en: "Liver", nb: "Lever", la: "Hepar" } },
  { id: "gallbladder", fma: ["FMA7202"], parent: "abdomen", detail: 3, color: "#7f9a5c", name: { en: "Gallbladder", nb: "Galleblære", la: "Vesica biliaris" } },
  { id: "stomach", fma: ["FMA7148"], parent: "abdomen", detail: 1, layer: "superficial", color: "#c9a15f", uberon: "UBERON:0000945", name: { en: "Stomach", nb: "Magesekk", la: "Gaster" } },
  { id: "spleen", fma: ["FMA7196"], parent: "abdomen", detail: 2, behind: true, color: "#7d5a86", uberon: "UBERON:0002106", name: { en: "Spleen", nb: "Milt", la: "Splen" } },
  { id: "pancreas", composite: "FMA7198", parent: "abdomen", detail: 2, behind: true, color: "#c9b06a", uberon: "UBERON:0001264", name: { en: "Pancreas", nb: "Bukspyttkjertel", la: "Pancreas" } },
  { id: "kidney_right", fma: ["FMA7204"], parent: "urinary", detail: 2, behind: true, color: "#8a5f4a", uberon: "UBERON:0004539", name: { en: "Right kidney", nb: "Høyre nyre", la: "Ren dexter" } },
  { id: "kidney_left", fma: ["FMA7205"], parent: "urinary", detail: 2, behind: true, color: "#8a5f4a", uberon: "UBERON:0004538", name: { en: "Left kidney", nb: "Venstre nyre", la: "Ren sinister" } },
  { id: "adrenal_right", fma: ["FMA15629"], parent: "urinary", detail: 3, behind: true, color: "#c9a25f", name: { en: "Right adrenal gland", nb: "Høyre binyre", la: "Glandula suprarenalis dextra" } },
  { id: "adrenal_left", fma: ["FMA15630"], parent: "urinary", detail: 3, behind: true, color: "#c9a25f", name: { en: "Left adrenal gland", nb: "Venstre binyre", la: "Glandula suprarenalis sinistra" } },
  { id: "small_intestine", composite: "FMA7200", parent: "abdomen", detail: 1, layer: "superficial", color: "#d8a679", uberon: "UBERON:0002108", name: { en: "Small intestine", nb: "Tynntarm", la: "Intestinum tenue" } },
  { id: "large_intestine", composite: "FMA7201", parent: "abdomen", detail: 1, layer: "superficial", color: "#c08a5c", uberon: "UBERON:0000059", name: { en: "Large intestine", nb: "Tykktarm", la: "Intestinum crassum" } },
  { id: "bladder", fma: ["FMA15900"], parent: "urinary", detail: 2, color: "#c9c47f", uberon: "UBERON:0001255", name: { en: "Urinary bladder", nb: "Urinblære", la: "Vesica urinaria" } },
  { id: "prostate", fma: ["FMA9600"], parent: "pelvis_organs", detail: 2, sex: "male", color: "#a08a70", uberon: "UBERON:0002367", name: { en: "Prostate", nb: "Prostata", la: "Prostata" } },
];

/** The one part with no mesh: BodyParts3D 3.0 is one adult male. A blob
 *  placed against the projected pelvis — the build computes `c` from the hip
 *  bones' box (centre x, 62 % of the way down) and uses these radii. */
export const AUTHORED = [
  { id: "uterus", parent: "pelvis_organs", detail: 2, sex: "female", color: "#b07f95", uberon: "UBERON:0000995", name: { en: "Uterus", nb: "Livmor", la: "Uterus" }, shape: { rx: 30, ry: 26, wobble: 0.1, seed: 18 }, place: "pelvis" },
];

export const VISCERA_GROUPS = [
  { id: "thorax", parent: null, name: { en: "Chest organs", nb: "Brystorganer", la: "Viscera thoracis" } },
  { id: "abdomen", parent: null, name: { en: "Abdomen", nb: "Buk", la: "Abdomen" } },
  { id: "urinary", parent: null, name: { en: "Urinary system", nb: "Urinveier", la: "Systema urinarium" } },
  { id: "pelvis_organs", parent: null, name: { en: "Pelvic organs", nb: "Bekkenorganer", la: "Organa pelvis" } },
];
