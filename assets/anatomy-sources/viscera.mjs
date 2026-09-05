// The organs. The public-domain organ SVG on Commons is embedded raster and
// unusable, so these are authored. Schematic on purpose: a teaching figure is
// a diagram, not a dissection.
//
// Shapes are in atlas space (1000 × 2000, y DOWN). Body-right is LOW x (the
// viewer's left). Every number here was placed against the skeleton's
// landmarks as the build prints them, and corrected against the preview.
//   blob: { kind: "blob", c, rx, ry, rot?, wobble?, seed? }
//   poly: { kind: "poly", pts: [[x, y], ...] }        hand-drawn ring
//   tube: { kind: "tube", path: [[x, y], ...], w }     centre line swept to width w

export const VISCERA = [
  { id: "brain", parent: "head", detail: 1, depth: 1, color: "#c9a3ae", uberon: "UBERON:0000955",
    name: { en: "Brain", nb: "Hjerne", la: "Encephalon" },
    shape: { kind: "blob", c: [500, 150], rx: 68, ry: 58, wobble: 0.08, seed: 1 } },
  { id: "thyroid", parent: "neck", detail: 3, depth: 2, color: "#b07f8a",
    name: { en: "Thyroid gland", nb: "Skjoldbruskkjertel", la: "Glandula thyroidea" },
    shape: { kind: "blob", c: [500, 392], rx: 32, ry: 15, wobble: 0.16, seed: 2 } },
  { id: "trachea", parent: "thorax", detail: 2, depth: 1, color: "#a8b0b8",
    name: { en: "Trachea", nb: "Luftrør", la: "Trachea" },
    shape: { kind: "tube", path: [[500, 330], [500, 425]], w: 22 } },
  { id: "lung_right", parent: "thorax", detail: 1, depth: 0, color: "#c98f9b", uberon: "UBERON:0002168",
    name: { en: "Right lung", nb: "Høyre lunge", la: "Pulmo dexter" },
    shape: { kind: "poly", pts: [[430, 395], [395, 415], [372, 460], [354, 540], [360, 630], [385, 695], [430, 710], [470, 706], [478, 640], [470, 540], [458, 450]] } },
  { id: "lung_left", parent: "thorax", detail: 1, depth: 0, color: "#c98f9b", uberon: "UBERON:0002167",
    name: { en: "Left lung", nb: "Venstre lunge", la: "Pulmo sinister" },
    shape: { kind: "poly", pts: [[570, 395], [605, 415], [628, 460], [646, 540], [640, 630], [612, 695], [568, 710], [530, 706], [524, 650], [548, 600], [545, 530], [534, 450]] } },
  { id: "heart", parent: "thorax", detail: 1, depth: 1, color: "#b8524f", uberon: "UBERON:0000948",
    name: { en: "Heart", nb: "Hjerte", la: "Cor" },
    shape: { kind: "poly", pts: [[470, 500], [500, 484], [536, 487], [566, 508], [580, 548], [570, 598], [548, 640], [514, 652], [478, 616], [460, 562]] } },
  { id: "diaphragm", parent: "thorax", detail: 2, depth: 2, color: "#b8877f",
    name: { en: "Diaphragm", nb: "Mellomgulv", la: "Diaphragma" },
    shape: { kind: "tube", path: [[352, 706], [420, 676], [500, 666], [580, 676], [648, 706]], w: 14 } },
  { id: "liver", parent: "abdomen", detail: 1, depth: 1, color: "#8a5a3c", uberon: "UBERON:0002107",
    name: { en: "Liver", nb: "Lever", la: "Hepar" },
    shape: { kind: "poly", pts: [[346, 712], [400, 700], [470, 703], [540, 712], [580, 730], [578, 758], [540, 776], [490, 800], [440, 828], [392, 824], [356, 790], [344, 750]] } },
  { id: "gallbladder", parent: "abdomen", detail: 3, depth: 2, color: "#7f9a5c",
    name: { en: "Gallbladder", nb: "Galleblære", la: "Vesica biliaris" },
    shape: { kind: "blob", c: [452, 802], rx: 20, ry: 13, rot: 20, wobble: 0.1, seed: 9 } },
  { id: "stomach", parent: "abdomen", detail: 1, depth: 2, color: "#c9a15f", uberon: "UBERON:0000945",
    name: { en: "Stomach", nb: "Magesekk", la: "Gaster" },
    shape: { kind: "poly", pts: [[540, 712], [580, 704], [622, 720], [642, 760], [630, 802], [592, 824], [552, 816], [530, 790], [546, 760], [552, 734]] } },
  { id: "spleen", parent: "abdomen", detail: 2, depth: 0, color: "#7d5a86", uberon: "UBERON:0002106",
    name: { en: "Spleen", nb: "Milt", la: "Splen" },
    shape: { kind: "blob", c: [636, 742], rx: 28, ry: 20, rot: 30, wobble: 0.08, seed: 11 } },
  { id: "pancreas", parent: "abdomen", detail: 2, depth: 0, color: "#c9b06a", uberon: "UBERON:0001264",
    name: { en: "Pancreas", nb: "Bukspyttkjertel", la: "Pancreas" },
    shape: { kind: "blob", c: [545, 792], rx: 66, ry: 15, rot: -8, wobble: 0.12, seed: 12 } },
  { id: "kidney_right", parent: "urinary", detail: 2, depth: 0, color: "#8a5f4a", uberon: "UBERON:0004539",
    name: { en: "Right kidney", nb: "Høyre nyre", la: "Ren dexter" },
    shape: { kind: "blob", c: [432, 822], rx: 26, ry: 44, rot: 8, wobble: 0.13, seed: 13 } },
  { id: "kidney_left", parent: "urinary", detail: 2, depth: 0, color: "#8a5f4a", uberon: "UBERON:0004538",
    name: { en: "Left kidney", nb: "Venstre nyre", la: "Ren sinister" },
    shape: { kind: "blob", c: [568, 814], rx: 26, ry: 44, rot: -8, wobble: 0.13, seed: 14 } },
  { id: "small_intestine", parent: "abdomen", detail: 1, depth: 1, color: "#d8a679", uberon: "UBERON:0002108",
    name: { en: "Small intestine", nb: "Tynntarm", la: "Intestinum tenue" },
    shape: { kind: "blob", c: [500, 900], rx: 84, ry: 72, wobble: 0.18, seed: 15 } },
  { id: "large_intestine", parent: "abdomen", detail: 1, depth: 2, color: "#c08a5c", uberon: "UBERON:0000059",
    name: { en: "Large intestine", nb: "Tykktarm", la: "Intestinum crassum" },
    shape: { kind: "tube", path: [[398, 985], [392, 900], [398, 815], [440, 790], [500, 785], [560, 790], [604, 812], [610, 900], [604, 985], [560, 1010], [505, 1005]], w: 34 } },
  { id: "bladder", parent: "urinary", detail: 2, depth: 2, color: "#c9c47f", uberon: "UBERON:0001255",
    name: { en: "Urinary bladder", nb: "Urinblære", la: "Vesica urinaria" },
    shape: { kind: "blob", c: [500, 958], rx: 40, ry: 30, wobble: 0.07, seed: 17 } },
  { id: "uterus", parent: "pelvis_organs", detail: 2, depth: 3, sex: "female", color: "#b07f95", uberon: "UBERON:0000995",
    name: { en: "Uterus", nb: "Livmor", la: "Uterus" },
    shape: { kind: "blob", c: [500, 916], rx: 30, ry: 26, wobble: 0.1, seed: 18 } },
  { id: "prostate", parent: "pelvis_organs", detail: 2, depth: 3, sex: "male", color: "#a08a70", uberon: "UBERON:0002367",
    name: { en: "Prostate", nb: "Prostata", la: "Prostata" },
    shape: { kind: "blob", c: [500, 1000], rx: 20, ry: 15, wobble: 0.06, seed: 19 } },
];

/** Region parents, so `focus: ["abdomen"]` gets everything in it. `head` is
 *  shared with the skeleton atlas (declared there); the rest are viscera. */
export const VISCERA_GROUPS = [
  { id: "neck", parent: null, name: { en: "Neck", nb: "Hals", la: "Collum" } },
  { id: "thorax", parent: null, name: { en: "Chest organs", nb: "Brystorganer", la: "Viscera thoracis" } },
  { id: "abdomen", parent: null, name: { en: "Abdomen", nb: "Buk", la: "Abdomen" } },
  { id: "urinary", parent: null, name: { en: "Urinary system", nb: "Urinveier", la: "Systema urinarium" } },
  { id: "pelvis_organs", parent: null, name: { en: "Pelvic organs", nb: "Bekkenorganer", la: "Organa pelvis" } },
];

/** The body silhouette every whole-body figure draws. Authored against the
 *  skeleton's landmarks (the build prints them); the source figure's right arm
 *  hangs a little further from the body than its left, so this is NOT
 *  mirror-symmetric. Clockwise from the top of the head, viewer's frame. */
export const BODY_OUTLINE = [
  // head and neck
  [500, 36], [548, 48], [586, 95], [600, 160], [596, 235], [572, 290], [548, 322],
  // body's left shoulder and arm (viewer's right), hanging close to the body
  [572, 346], [650, 354], [722, 374], [778, 410],
  [824, 480], [832, 610], [852, 745], [884, 870], [918, 965], [988, 1008], [998, 1095], [984, 1168], [942, 1188], [880, 1170],
  [820, 1140], [770, 1120], [730, 1100], [706, 1060],
  // left leg and foot
  [700, 1150], [690, 1260], [674, 1400], [652, 1550], [642, 1700], [664, 1830],
  [684, 1900], [672, 1962], [560, 1958], [522, 1900],
  // between the legs
  [512, 1800], [506, 1550], [500, 1420], [498, 1300], [500, 1040], [500, 1300], [496, 1420], [492, 1550], [488, 1800], [478, 1900],
  // right foot and leg
  [440, 1958], [318, 1962], [318, 1900], [322, 1830], [352, 1700], [344, 1550], [326, 1400], [300, 1260], [296, 1150],
  // body's right arm (viewer's left), hanging a little further out, hand beside the hip
  [322, 1110], [330, 1160], [300, 1200], [210, 1210], [140, 1180], [126, 1090], [134, 1000],
  [138, 900], [146, 780], [152, 660], [150, 540], [168, 440], [224, 378], [288, 352], [360, 346], [428, 322],
  // back up the neck
  [452, 322], [428, 290], [404, 235], [400, 160], [414, 95], [452, 48],
];
