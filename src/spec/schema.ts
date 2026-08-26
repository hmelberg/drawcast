// The JSON Schema for the drawing spec. It serves three roles at once:
// 1. output constraint for the LLM (structured outputs),
// 2. ajv validation before rendering (Loop 1.1),
// 3. prompt documentation (embedded verbatim in the compiler prompt).
// Keep it flat and free of oneOf/anyOf so structured-output decoding accepts it;
// per-type requirements are enforced by the semantic checks below and fed back
// to the LLM in the repair round.

import AjvModule, { type ValidateFunction } from "ajv";
import type { Command, Spec, SpecElement } from "./types";
import { notationBeats } from "./notation";
import { parseABC } from "./abc";

// ajv ships CJS; depending on the bundler/runtime the class is the module or its .default.
const AjvCtor = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as typeof AjvModule;

export const SPEC_VERSION = "1";

const styleSchema = {
  type: "object",
  description: "Optional visual style overrides.",
  properties: {
    color: { type: "string", description: "Stroke/text color, CSS color string." },
    fill: { type: "string", description: "Fill color for regions/shapes." },
    stroke_width: { type: "number" },
    dash: { type: "boolean", description: "Dashed stroke (guide lines etc.)." },
    roughness: { type: "number", description: "Hand-drawn sketchiness 0 (clean) to 3 (very rough)." },
    opacity: { type: "number" },
  },
  additionalProperties: false,
};

const drawSchema = {
  type: "object",
  description: "How this element animates when drawn.",
  properties: {
    mode: { type: "string", enum: ["sketch", "instant"], description: "sketch = progressive handwriting-style drawing; instant = appears at once." },
    duration: { type: "number", description: "Animation duration in seconds (sketch mode)." },
  },
  additionalProperties: false,
};

const endRefSchema = {
  type: "object",
  description: "Arrow/edge endpoint: set ref to an element id, OR x+y coordinates (domain coordinates if a domain is declared, else logical).",
  properties: {
    ref: { type: "string" },
    x: { type: "number" },
    y: { type: "number" },
  },
  additionalProperties: false,
};

const elementSchema = {
  type: "object",
  description:
    "One diagram element. The `type` decides which other properties apply. " +
    "Tier 2 (preferred): axes, curve, point, arrow, label, region, node, edge — you describe relations, the renderer computes geometry. " +
    "Tier 3 (escape hatch only): path, text, shape with explicit logical coordinates (1000×750, y-up, origin bottom-left).",
  properties: {
    id: { type: "string", description: "Unique id, referenced by commands and other elements." },
    type: {
      type: "string",
      enum: ["axes", "curve", "point", "arrow", "label", "region", "node", "edge", "annotation", "path", "text", "shape", "portrait"],
    },
    // axes
    x_label: { type: "string", description: "axes: horizontal axis label." },
    y_label: { type: "string", description: "axes: vertical axis label." },
    // curve
    direction: { type: "string", enum: ["increasing", "decreasing", "flat", "vertical"], description: "curve: qualitative slope." },
    curvature: { type: "string", enum: ["linear", "convex", "concave"], description: "curve: qualitative curvature." },
    steepness: { type: "string", enum: ["gentle", "medium", "steep"], description: "curve: qualitative steepness." },
    expr: { type: "string", description: "curve: explicit function of x over the domain, e.g. \"100 - 0.5*x\". Use instead of direction/curvature when you know the function." },
    x_from: { type: "number", description: "curve/region: start of the x interval (domain units). Defaults to the whole domain." },
    x_to: { type: "number", description: "curve/region: end of the x interval (domain units)." },
    // point
    at: {
      type: "object",
      description: "point: location, either x+y in domain units, or intersection_of two curve ids.",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        intersection_of: { type: "array", items: { type: "string" }, description: "Two curve ids (your own or a scene template's); the point is their intersection." },
      },
      additionalProperties: false,
    },
    guides: { type: "boolean", description: "point: draw dashed guide lines from the point to both axes." },
    // arrow / edge
    from: endRefSchema,
    to: endRefSchema,
    curved: { type: "boolean", description: "arrow/edge: bow the line slightly." },
    // label
    text: { type: "string", description: "label/text/node: the text content." },
    attach_to: { type: "string", description: "label: id of the element this label belongs to. The renderer places it (collision-avoiding)." },
    side: {
      type: "string",
      enum: ["above", "below", "left", "right", "above-left", "above-right", "below-left", "below-right"],
      description: "label: preferred side relative to the attached element. The collision solver may move it.",
    },
    // region
    between: {
      type: "array",
      items: { type: "string" },
      description:
        "region: two curve ids — your own curves OR a scene template's (e.g. demand_curve/supply_curve/ceiling_line in supply_demand, curve_<id> in qaly_profiles); the region is shaded between them (use x_from/x_to to limit; 0–100 axis units when no domain is declared).",
    },
    // annotation
    target: { type: "string", description: "annotation: id of the element to mark (declare the annotation AFTER its target)." },
    kind: {
      type: "string",
      enum: ["box", "circle", "strike", "cross"],
      description:
        "annotation: a PERMANENT mark — box or circle the conclusion, strike or cross out a rejected option. Default: box for text targets, circle otherwise. (Temporary attention = the highlight verb with glow, or point; area emphasis = region shading.)",
    },
    // node / shape
    shape: {
      type: "string",
      enum: ["decision", "chance", "terminal", "rect", "circle", "triangle", "person"],
      description: "node/shape: decision=square, chance=circle, terminal=triangle (health-economics conventions); person = stick figure.",
    },
    // tier-3 raw
    points: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, description: "path: polyline points in logical coordinates (y-up)." },
    closed: { type: "boolean", description: "path: close the polyline." },
    x: { type: "number", description: "text/shape: logical x (y-up canvas)." },
    y: { type: "number", description: "text/shape: logical y (y-up canvas)." },
    width: { type: "number", description: "shape rect: width in logical units." },
    height: { type: "number", description: "shape rect: height in logical units." },
    radius: { type: "number", description: "shape circle: radius in logical units." },
    font_size: { type: "number", description: "text: font size in logical units (≥ 14; default 26)." },
    // portrait
    of: {
      type: "string",
      description:
        "portrait: the person's name, e.g. \"John Maynard Keynes\" — the app resolves it to their Wikipedia portrait and traces it into sketch strokes. Use a portrait SPARINGLY, only when the person or history genuinely serves the topic; place it small (width ~150-200) off to a side with x/y, and pair it with a label element for the name. NEVER invent an image url; only copy a url the user's request explicitly provided.",
    },
    url: { type: "string", description: "portrait: direct image URL — ONLY when the user's request supplied one (copy it verbatim; never invent)." },
    strokes: { type: "string", description: "portrait: embedded traced strokes (machine-written; copy VERBATIM if present, never edit or regenerate)." },
    source: { type: "string", description: "portrait: provenance/attribution (machine-written; copy verbatim)." },
    look: {
      type: "string",
      enum: ["halftone", "photo", "poster", "line"],
      description: "portrait: halftone = newspaper-print dots (the default); photo = faithful framed grayscale (most recognizable); poster = posterized solid regions; line = pen-sketch edges (suits line art and engravings).",
    },
    style: styleSchema,
    draw: drawSchema,
  },
  required: ["id", "type"],
  additionalProperties: false,
};

const idListSchema = (description: string) => ({
  type: "array",
  items: { type: "string" },
  description,
});

const commandSchema = {
  type: "object",
  description:
    "One playback command: ONE action verb (draw / pause / wait / show / hide / erase / clear / highlight / point / move / camera / animate), optionally WITH speak to narrate it — voice and action start together and the command ends when BOTH finish. Or speak alone (a rare standalone line, e.g. the closing synthesis). " +
    "Commands run strictly in sequence; each completes before the next begins (except a standalone speak with blocking:false).",
  properties: {
    speak: {
      type: "string",
      description:
        "Narration sentence, spoken aloud and shown as a caption. Alongside an action verb it narrates that action simultaneously (the preferred style: {\"draw\": [\"supply\"], \"speak\": \"This is the supply curve.\"}). Alone, it is a standalone narration line.",
    },
    blocking: {
      type: "boolean",
      description: "With speak: false starts the narration and immediately continues to the next command — use it to talk while pointing, highlighting, or drawing.",
    },
    voice: {
      type: "string",
      enum: ["a", "b"],
      description: 'With speak in a dialogue: which speaker reads this line — "a" (the lead/teacher, the default) or "b" (the second voice).',
    },
    delivery: {
      type: "string",
      enum: ["soft", "grave", "brisk"],
      description:
        "With speak: named delivery nudge — soft = confiding lean-in (slightly slower, lower, quieter); grave = slow and weighty for the key reveal; brisk = lightly quicker for recaps. Mark only the few lines where the meaning warrants it.",
    },
    draw: idListSchema("Element ids to draw. Listed elements animate one after another unless parallel is true."),
    parallel: { type: "boolean", description: "With draw/erase: animate the listed elements simultaneously." },
    pause: { type: "number", description: "Pause for this many seconds." },
    wait: {
      type: "string",
      enum: ["click"],
      description: "Wait until the viewer clicks before continuing — a reveal gate ('study this… now click') or an act boundary. Auto-resolved in video export.",
    },
    show: idListSchema("Element ids to make visible instantly (inverse of hide; no animation)."),
    hide: idListSchema("Element ids to make invisible instantly. Hidden elements still exist and can be shown again."),
    erase: idListSchema("Element ids to remove with a reverse hand-drawn (un-sketch) animation, then keep hidden."),
    clear: {
      type: "object",
      description: "Hide everything currently visible. Use {} to clear all, or keep to leave some ids on screen.",
      properties: {
        keep: idListSchema("Ids to leave visible (e.g. the axes)."),
      },
      additionalProperties: false,
    },
    highlight: {
      type: "object",
      description:
        "Temporarily emphasize visible elements, then return to normal. With a paired speak and no duration, the effect PULSES FOR AS LONG AS THE SENTENCE — the way to talk about one specific element (a curve, an equilibrium) while it glows.",
      properties: {
        target: idListSchema("Element ids to emphasize."),
        effect: { type: "string", enum: ["pulse", "circle", "glow"], description: "pulse = throb (default); circle = hand-drawn ring around them; glow = soft halo (red unless color is set)." },
        duration: { type: "number", description: "Seconds. Omit with a paired speak to let the effect last the whole sentence (default 1.5 otherwise)." },
        color: { type: "string", description: "Emphasis color, CSS color string." },
      },
      required: ["target"],
      additionalProperties: false,
    },
    focus: {
      type: "object",
      description:
        "The inverse spotlight: dim every OTHER visible element while the targets stay at full strength — the way a hand on a whiteboard says 'ignore the rest'. With a paired speak and no duration, the focus HOLDS FOR THE WHOLE SENTENCE. Use it to walk a dense figure region by region.",
      properties: {
        target: idListSchema("Element ids that stay lit; everything else dims."),
        duration: { type: "number", description: "Seconds. Omit with a paired speak to hold for the sentence (default 2 otherwise)." },
      },
      required: ["target"],
      additionalProperties: false,
    },
    point: {
      type: "object",
      description: "A laser pointer travels to the target and gestures at it, then disappears. Combine with speak blocking:false to talk while pointing.",
      properties: {
        at: endRefSchema,
        gesture: { type: "string", enum: ["tap", "circle", "underline"], description: "tap = dip at the spot (default); circle = trace a ring around it; underline = sweep beneath it." },
        duration: { type: "number", description: "Seconds (default 2)." },
      },
      required: ["at"],
      additionalProperties: false,
    },
    move: {
      type: "object",
      description:
        "Translate elements by a delta or along a path of offsets. Moves ONLY the listed elements — attached labels, intersection points, or regions do NOT follow; move them explicitly or redraw derived elements.",
      properties: {
        target: idListSchema("Element ids to move together."),
        by: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "[dx, dy] delta — domain units when a domain is declared, else logical units." },
        path: {
          type: "array",
          items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
          description: "Waypoint offsets from the element's starting position (same units as by); the last waypoint is the final offset. Use instead of by for curved or multi-leg motion.",
        },
        duration: { type: "number", description: "Seconds (default 1)." },
        easing: { type: "string", enum: ["linear", "ease-in", "ease-out", "ease-in-out"], description: "Velocity profile (default ease-in-out)." },
      },
      required: ["target"],
      additionalProperties: false,
    },
    camera: {
      type: "object",
      description: "Zoom/pan the view. Set reset:true to return to the full canvas.",
      properties: {
        center: endRefSchema,
        zoom: { type: "number", description: "Magnification: 1 = whole canvas, 2 = 2× (default 2 when centering)." },
        reset: { type: "boolean", description: "Return to the full canvas." },
        duration: { type: "number", description: "Seconds (default 1.2)." },
      },
      additionalProperties: false,
    },
    animate: {
      type: "object",
      additionalProperties: true,
      description:
        "Smoothly animate NUMERIC template params to these target values while the paired speak lands. Keys are dot paths into params (e.g. {\"demand_shift.amount\": 25} or {\"azimuth\": 240}); the whole figure re-computes every frame, so intersections, guides, and regions move honestly. Always write the STARTING value explicitly in params (e.g. demand_shift: {amount: 0}). Only for template specs.",
    },
    duration: { type: "number", description: "With animate: seconds the animation takes (default 2)." },
    play: {
      description:
        'Play synthesized notes while the paired speak lands (or on their own). Either ONE notation string — space-separated notes "C4:q E4:q G4:h" (pitch letter + optional #/b + octave 1-7, duration w/h/q/e/s = 4/2/1/½/¼ beats, chords joined with + as in C4+E4+G4:h, R for a rest) — up to four parallel voices [{"notes": "...", "instrument": "piano"}] that start together (melody over bass) — or a whole tune as {"abc": "K:C\\nC D E F|…"} in ABC notation. ONLY for figures genuinely about sound or music.',
      oneOf: [
        { type: "string" },
        {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              notes: { type: "string", description: "Notation string for this voice." },
              instrument: { type: "string", enum: ["tone", "piano", "organ", "pluck", "bell"] },
            },
            required: ["notes"],
            additionalProperties: false,
          },
        },
        {
          type: "object",
          properties: {
            abc: {
              type: "string",
              description: "A whole tune in ABC notation (K:/M:/L:/Q: headers, then the music; V: voices become parallel channels). Tempo comes from Q: unless the command sets tempo.",
            },
          },
          required: ["abc"],
          additionalProperties: false,
        },
      ],
    },
    tempo: { type: "number", description: "With play: beats per minute, 30-300 (default 100)." },
    instrument: {
      type: "string",
      enum: ["tone", "piano", "organ", "pluck", "bell"],
      description: "With play: the synthesized instrument (default tone; array voices can override per voice).",
    },
    reveal: idListSchema(
      "With play: element ids revealed IN TIME with the notes and KEPT — id k appears exactly when the k-th sounding note of the first voice starts and stays visible (staff notes accumulating as the tune plays).",
    ),
    press: idListSchema(
      "With play: element ids PRESSED in time with the notes — id k appears when the k-th sounding note starts and DISAPPEARS when it ends, like a piano key going down and back up. Combine with reveal (e.g. reveal staff notes, press piano keys).",
    ),
  },
  additionalProperties: false,
};

export const specSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "ConceptSketchSpec",
  type: "object",
  description:
    "A drawing spec. Coordinate world: logical canvas 1000×750, Cartesian, y-up, origin bottom-left. " +
    "Prefer a scene template (set template+params, see the scene catalog). Otherwise compose tier-2 elements. " +
    "Commands interleave narration (speak) with drawing (draw) for a gradually built, narrated figure.",
  properties: {
    title: { type: "string", description: "Short title of the figure." },
    zoom_from: {
      type: "string",
      description:
        "Playlist items only: the semantic-zoom entrance. Before this item begins, the PREVIOUS figure zooms into this element id (an id of the PREVIOUS item's scene) and fades there — so the new figure feels like the inside of the old one (heart → cell, bins → bell curve). Replaces the chapter card at that junction.",
    },
    level: { type: "string", enum: ["basic", "advanced"], description: "Difficulty of the explanation, when the request states one. Shown as a badge; omit if unspecified." },
    voice: {
      type: "string",
      enum: ["male", "female"],
      description: 'Narrator voice. Usually stamped from the #male/#female tags — omit unless the request states it. In dialogue this is speaker "a"; speaker "b" gets the contrasting voice.',
    },
    template: { type: "string", description: "Scene template name from the catalog. Omit when composing elements directly." },
    params: { type: "object", description: "Scene template parameters, per the catalog's parameter schema.", additionalProperties: true },
    domain: {
      type: "object",
      description: "Domain coordinate ranges for quantitative diagrams, e.g. {\"x\": [0, 1000], \"y\": [0, 50]} for quantity/price. Curve exprs and point coordinates are in these units.",
      properties: {
        x: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
        y: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
      },
      additionalProperties: false,
    },
    elements: { type: "array", items: elementSchema, description: "Tier-2/3 elements (also allowed alongside a template, for annotations)." },
    commands: {
      type: "array",
      items: commandSchema,
      description:
        "The playback sequence: narration (speak), drawing (draw/pause), and gesture verbs (highlight/point/move/show/hide/erase/clear/camera/animate). " +
        "Elements not mentioned in any draw/show/hide/erase command are drawn at the end automatically.",
    },
  },
  required: ["commands"],
  additionalProperties: false,
} as const;

const ajv = new AjvCtor({ allErrors: true, strict: false });
let structural: ValidateFunction | null = null;

/**
 * The wire schema keeps id lists as arrays (structured-output-friendly), but the
 * brief's spec examples also allow a bare string. Normalize before validating.
 */
export function normalizeSpec(spec: unknown): unknown {
  if (typeof spec !== "object" || spec === null) return spec;
  const clone = JSON.parse(JSON.stringify(spec)) as { commands?: Command[] };
  const toList = (v: string[] | string | undefined): string[] | undefined => (typeof v === "string" ? [v] : v);
  for (const cmd of clone.commands ?? []) {
    if (!cmd) continue;
    // YAML-friendly spelling: `pause: click` means the wait verb.
    if ((cmd.pause as unknown) === "click") {
      delete cmd.pause;
      cmd.wait = "click";
    }
    if (cmd.draw !== undefined) cmd.draw = toList(cmd.draw);
    if (cmd.show !== undefined) cmd.show = toList(cmd.show);
    if (cmd.hide !== undefined) cmd.hide = toList(cmd.hide);
    if (cmd.erase !== undefined) cmd.erase = toList(cmd.erase);
    if (cmd.clear?.keep !== undefined) cmd.clear.keep = toList(cmd.clear.keep);
    if (cmd.highlight) cmd.highlight.target = toList(cmd.highlight.target)!;
    if (cmd.focus) cmd.focus.target = toList(cmd.focus.target)!;
    if (cmd.move) cmd.move.target = toList(cmd.move.target)!;
    if (cmd.press !== undefined) cmd.press = toList(cmd.press);
    if (cmd.reveal !== undefined) cmd.reveal = toList(cmd.reveal);
  }
  return clone;
}

function structuralErrors(spec: unknown): string[] {
  structural ??= ajv.compile(specSchema as object);
  if (structural(spec)) return [];
  return (structural.errors ?? []).map(
    (e) => `${e.instancePath || "(root)"} ${e.message ?? "invalid"}${e.params ? " " + JSON.stringify(e.params) : ""}`,
  );
}

function semanticErrors(spec: Spec): string[] {
  const errors: string[] = [];

  if (!spec.template && !(spec.elements && spec.elements.length > 0)) {
    errors.push("spec has neither a template nor any elements — nothing to draw");
  }

  const ACTION_VERBS = ["draw", "pause", "wait", "show", "hide", "erase", "clear", "highlight", "focus", "point", "move", "camera", "animate", "play"] as const;
  for (const [i, cmd] of (spec.commands ?? []).entries()) {
    const actions = ACTION_VERBS.filter((k) => (cmd as Command)[k] !== undefined);
    // One action verb per command; speak may stand alone OR accompany the
    // action (voice and animation then start together and both must finish).
    if (actions.length > 1) {
      errors.push(`commands[${i}] must set at most one action verb of ${ACTION_VERBS.join("/")} (got: ${actions.join(", ")})`);
      continue;
    }
    if (actions.length === 0 && cmd.speak === undefined) {
      errors.push(`commands[${i}] must set a verb: speak, or one of ${ACTION_VERBS.join("/")}`);
      continue;
    }
    const verb: string = actions.length > 0 ? actions[0] : "speak";
    if (cmd.blocking !== undefined && (verb !== "speak" || cmd.speak === undefined)) {
      errors.push(`commands[${i}]: blocking only applies to a standalone speak (a speak paired with an action always joins both)`);
    }
    if ((cmd.voice !== undefined || cmd.delivery !== undefined) && cmd.speak === undefined) {
      errors.push(`commands[${i}]: voice and delivery only apply to a command with speak`);
    }
    if (cmd.parallel !== undefined && verb !== "draw" && verb !== "erase") errors.push(`commands[${i}]: parallel only applies to draw/erase`);
    if (verb === "move" && !cmd.move!.by && !(cmd.move!.path && cmd.move!.path.length > 0)) {
      errors.push(`commands[${i}]: move needs by ([dx, dy]) or a non-empty path`);
    }
    if (verb === "point") {
      const at = cmd.point!.at;
      if (!at || (at.ref === undefined && (at.x === undefined || at.y === undefined))) {
        errors.push(`commands[${i}]: point.at needs ref (an element id) or x+y coordinates`);
      }
    }
    if (verb === "camera" && !cmd.camera!.reset && cmd.camera!.center === undefined && cmd.camera!.zoom === undefined) {
      errors.push(`commands[${i}]: camera needs center, zoom, or reset:true`);
    }
    if (verb === "animate") {
      const entries = Object.entries(cmd.animate!);
      if (entries.length === 0) errors.push(`commands[${i}]: animate needs at least one param target`);
      for (const [k, v] of entries) {
        if (typeof v !== "number" || !Number.isFinite(v)) errors.push(`commands[${i}]: animate "${k}" must be a finite number`);
      }
    }
    if (cmd.duration !== undefined && verb !== "animate") {
      errors.push(`commands[${i}]: duration only applies to animate (other verbs carry their own duration fields)`);
    }
    if ((cmd.tempo !== undefined || cmd.instrument !== undefined || cmd.press !== undefined || cmd.reveal !== undefined) && verb !== "play") {
      errors.push(`commands[${i}]: tempo, instrument, press and reveal only apply to a play command`);
    }
    if (verb === "play") {
      const p = cmd.play!;
      const voices = typeof p === "string" ? [{ notes: p }] : Array.isArray(p) ? p : parseABC(p.abc).voices;
      if (!voices.some((v) => notationBeats(v.notes) > 0)) {
        errors.push(`commands[${i}]: play has no readable notes — notation is space-separated "C4:q E4:q G4+C5:h" (pitch+octave, optional :w/h/q/e/s duration, R for rests), or a tune in {abc: "..."}`);
      }
      if (cmd.tempo !== undefined && (typeof cmd.tempo !== "number" || cmd.tempo < 30 || cmd.tempo > 300)) {
        errors.push(`commands[${i}]: tempo must be a number between 30 and 300 bpm`);
      }
    }
  }

  const seen = new Set<string>();
  for (const el of spec.elements ?? []) {
    if (seen.has(el.id)) errors.push(`duplicate element id "${el.id}"`);
    seen.add(el.id);
    errors.push(...elementErrors(el));
  }

  return errors;
}

function elementErrors(el: SpecElement): string[] {
  const errs: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) errs.push(`element "${el.id}" (${el.type}): ${msg}`);
  };
  switch (el.type) {
    case "curve":
      need(!!el.expr || !!el.direction, "needs either expr or a qualitative direction");
      break;
    case "portrait":
      need(!!el.of || !!el.url || !!el.strokes, "needs of (a person's name), url, or embedded strokes");
      break;
    case "label":
      need(!!el.text, "needs text");
      need(!!el.attach_to, "needs attach_to (id of the element it labels)");
      break;
    case "region":
      need(Array.isArray(el.between) && el.between.length === 2, "needs between: [curveId, curveId]");
      break;
    case "annotation":
      need(!!el.target, "needs target (id of the element it marks)");
      break;
    case "point":
      need(!!el.at, "needs at ({x,y} or {intersection_of})");
      break;
    case "arrow":
    case "edge":
      need(!!el.from && !!el.to, "needs from and to");
      break;
    case "path":
      need(Array.isArray(el.points) && el.points.length >= 2, "needs points (≥ 2)");
      break;
    case "text":
      need(!!el.text, "needs text");
      need(typeof el.x === "number" && typeof el.y === "number", "needs x and y (logical coordinates)");
      break;
    case "shape":
      need(!!el.shape, "needs shape");
      break;
    default:
      break;
  }
  return errs;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateSpec(spec: unknown): ValidationResult {
  const normalized = normalizeSpec(spec);
  const sErrors = structuralErrors(normalized);
  if (sErrors.length > 0) return { ok: false, errors: sErrors };
  const errors = semanticErrors(normalized as Spec);
  return { ok: errors.length === 0, errors };
}
