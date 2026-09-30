// Revising an existing drawcast: the whole editor document goes out, a whole
// replacement document comes back. Text in, text out — so a single spec and a
// multi-document playlist are ONE path, hand-edits in the textarea ride along,
// and the model can add, drop, reorder and retitle parts rather than only edit
// the ones already there.
//
// Deliberately not a continued conversation: a stateless call also works on a
// document loaded from the library, a bundled example, or a #gdoc= share, and
// its cost does not grow every round.

import type Anthropic from "@anthropic-ai/sdk";
import reviseMd from "./prompts/revise-v1.md?raw";
import { itemsOf, parsePlaylistText, type Playlist, formatPlaylist } from "../playlist/playlist";
import { buildSystemBlocks, stripFence, styleBlock, systemBlocks, wantsC64, wantsCode, wantsSound } from "./prompt";
import { hoistPortraitStrokes, noteForDescribed, restorePortraitStrokes } from "./hoist";
import { lintReportText, type LintIssue } from "../lint/lint";
import { checkPlaylist } from "../lint/check-playlist";
import { callForText, describeApiError, makeClient, type Effort } from "./client";
import { apiSchema, codePromptFor, SOUND_PROMPT_SOURCE, fewshotsText, needsRepair, repairModelFor, type PromptVariant } from "./compile";
import { catalogParts } from "../scenes/catalog";
import { ensureEnginesForSpecs, ensureEnginesForTemplate } from "../scenes/engines";
import { makeBrowserMeasure } from "../render/svg-backend";
import { autoImages, checkMappedPictures, mapNote, withMapCheck, type MapCheck, type MapOptions, type PictureMap } from "./picture-map";

/**
 * The notation card: how to read and write a drawcast document, and the
 * output contract that replaces the compiler prompt's "JSON only". Sent with
 * every revision, in the uncached tail.
 */
export const REVISE_PROMPT_SOURCE = reviseMd;

/**
 * FOUR backticks, not three: a document may itself contain ```python, ```yaml
 * or ```assets fences, and a three-backtick wrapper would be closed by the
 * first of them. The old wrapper also said `yaml`, which the script notation
 * is not — a label that sent the model looking for `key: value` everywhere.
 */
export function buildReviseUser(docText: string, instruction: string): string {
  return [
    "Here is the current drawcast document, in the author's own notation:",
    "````",
    docText,
    "````",
    "",
    `Apply this change: ${instruction}`,
    "",
    "Return the COMPLETE document, in the same notation and the same shape it came in — the same pages, plus or minus any the change calls for.",
    "Change only what the instruction asks for and leave everything else as it is.",
    "Return the document only, with no commentary before or after it.",
  ].join("\n");
}

export function parseReviseReply(text: string): { playlist: Playlist | null; error?: string } {
  try {
    return { playlist: parsePlaylistText(stripFence(text)) };
  } catch (err) {
    return { playlist: null, error: `the reply is not a readable document: ${(err as Error).message}` };
  }
}

// checkPlaylist moved to src/lint/check-playlist.ts (the viewer's Problems box
// uses it too, without this module's SDK imports); re-exported for callers.
export { checkPlaylist };

export interface ReviseConfig {
  apiKey: string;
  model: string;
  /** The active compiler prompt — the same one Generate uses, so the cached prefix is reused. */
  variant: PromptVariant;
  /** The author's active style profile (B5) — appended after everything, so it wins. */
  styleText?: string;
  /** Priority packs from settings; templates in the document are added automatically. */
  priorityIds?: string[];
  maxRepairs?: number;
  /** Effort for the creative round (Settings); repairs always run low. */
  effort?: Effort;
  /** Cancels the revision, whichever round is in flight. */
  signal?: AbortSignal;
  /** Called as the model rewrites the document, once per streamed delta. */
  onProgress?: (progress: { label: ReviseRound["label"]; round: number; text: string }) => void;
  /**
   * Picture mapping (spec 2026-09-30-picture-regions §14), injected by the
   * app (picture-map.ts mapPictures with its deps bound): the pictures whose
   * image says `regions: auto` are mapped before the call, their part names
   * ride the revise message, and the boxes of the names the reply uses are
   * filled in before validation. Absent means no call; a document with no
   * `regions: auto` never calls it.
   */
  mapAuto?: (
    pictures: { picture: string; opts: MapOptions }[],
    signal?: AbortSignal,
  ) => Promise<{ maps: Map<string, PictureMap>; warnings: string[] }>;
}

export interface ReviseRound {
  label: "initial" | "repair";
  text: string;
  errors: string[];
  lintIssues: LintIssue[];
  ms: number;
}

export interface ReviseOutcome {
  playlist: Playlist | null;
  /** The accepted document text, exactly as returned (fence stripped). */
  text: string | null;
  rounds: ReviseRound[];
  error?: string;
  /** Things the author should know about this revision that are not errors —
   *  today, data assets too large to have been given to the model (§5.1). */
  notes?: string[];
}

/**
 * The founding request is provenance, not content: the model may edit anything
 * else in the document, but a reply that comes back without the `playlist:`
 * header must not lose `prompt:` — the next save would write a file with no
 * provenance. Fill-if-absent ONLY: a header the model kept wins, and the
 * revise instruction itself never lands in the field (ruling §F.3.3).
 * Returns true when it filled the prompt in, so the caller knows to reformat.
 */
export function preserveFoundingPrompt(revised: Playlist, previous: Playlist): boolean {
  if (revised.meta.prompt !== undefined || previous.meta.prompt === undefined) return false;
  revised.meta.prompt = previous.meta.prompt;
  return true;
}

/** Template ids used anywhere in the document — they need FULL catalog entries, not index stubs. */
function templatesIn(playlist: Playlist): string[] {
  return [...new Set(itemsOf(playlist).map((i) => i.spec.template).filter((t): t is string => !!t))];
}

export async function reviseDocument(docText: string, instruction: string, cfg: ReviseConfig): Promise<ReviseOutcome> {
  // Portrait strokes never visit the model (llm/hoist.ts) — swapped for a
  // sentinel here, restored onto the winning revision before returning.
  const hoisted = hoistPortraitStrokes(docText);
  docText = hoisted.text;
  const parsedNow = parseReviseReply(docText);
  if (!parsedNow.playlist) {
    // No model call happened yet, so there is no best.playlist.warnings to
    // fold in here — but an over-threshold asset was already decided by the
    // hoist above, and every exit of this function answers the same
    // question about it (design §5.1, round 1 review).
    return { playlist: null, text: null, rounds: [], error: `the current document is unreadable: ${parsedNow.error}`, notes: noteForDescribed(hoisted.described) };
  }

  // Same system blocks as generation, including the cache_control prefix, so a
  // revise right after a generate reuses the warm ~10k-token cached prompt.
  // Exemplars are deliberately empty: pickExemplars teaches request -> spec
  // authoring, and a revision already has a spec in front of it.
  const priorityIds = [...new Set([...(cfg.priorityIds ?? []), ...templatesIn(parsedNow.playlist)])];
  // revise has no router of its own, so this shortlist is keyword-only; a
  // template-less document usually gets an empty variable half, which is
  // right — the whole document is already in front of the model.
  const catalog = catalogParts({ request: instruction, priorityIds });
  // The code block is conditional now (Task 10), and a revision needs it
  // whenever the DOCUMENT already has a code element — the instruction
  // ("make it 1000 draws") rarely says so itself. Same arrangement for the
  // play verb: the instruction ("make the chord richer") rarely names sound,
  // but a document that already plays does. Hoisted so the prose gate and
  // the schema gate (design §3.3) read the same two booleans — getting this
  // wrong would validate a code- or sound-carrying document's revision
  // against a schema with no `code` element or `play` verb in it, a silent
  // corruption of someone's existing work.
  //
  // Structural, not textual (final-review round, 2026-09-22, IMPORTANT 1):
  // docText is the SCRIPT notation (main.ts's specArea.value), where a code
  // element prints as a fence — print.ts puts "type" in its skip set, so the
  // literal text `type: code` never appears — and a `play` command prints as
  // a direction line, `play "C4:q"`, no colon after `play`. The old regexes
  // matched only the YAML escape-hatch form (a ```yaml fence merged into the
  // page), so they were dead on every ordinary script-notation document;
  // reading the PARSED spec instead asks the same question the schema gate
  // below answers, on the shape that is actually there.
  //
  // Guarded, not just typed (scoped re-review, 2026-09-22): parsedNow.playlist
  // is PARSED but never VALIDATED — validateSpec/checkPlaylist run on the
  // model's reply, not on the incoming document — and this is the CURRENT
  // document straight from the textarea, which may carry a hand-edit the
  // author never re-rendered (main.ts). So `elements`/`commands` may be any
  // shape JSON/YAML allows: not an array at all (`elements: not-an-array`),
  // or an array holding a null/blank entry. Array.isArray rules out the
  // former; `e?.type`/`c?.play` the latter. (Each item's `spec` itself is
  // always a plain object here, never null/array — every path that builds a
  // PlaylistItem either checks isPlainObject first (the JSON/YAML/`---`
  // paths in playlist.ts) or constructs the object itself (parseScriptPages,
  // spec/script/parse.ts:500), and a document that parses to anything else
  // at the top level throws inside parsePlaylistText, caught above before
  // this point is ever reached — so only elements/commands need guarding.)
  const specs = itemsOf(parsedNow.playlist).map((i) => i.spec);
  const wantCode = wantsCode(instruction) || specs.some((s) => Array.isArray(s.elements) && s.elements.some((e) => e?.type === "code"));
  const wantSound =
    wantsSound(instruction) ||
    specs.some((s) => (Array.isArray(s.commands) && s.commands.some((c) => c?.play !== undefined)) || (Array.isArray(s.elements) && s.elements.some((e) => e?.type === "music")));
  // A document already on the machine keeps the C64 part, as its code keeps the code block.
  const wantC64 =
    wantsC64(instruction) ||
    specs.some((s) => Array.isArray(s.elements) && s.elements.some((e) => e?.type === "code" && (e.language === "basic" || e.frame === "c64" || e.game !== undefined)));
  const blocks = buildSystemBlocks(cfg.variant.source, {
    schema: apiSchema({ code: wantCode, sound: wantSound, c64: wantC64 }),
    catalog: catalog.stable,
    fewshots: fewshotsText({ code: wantCode }),
    exemplars: "",
    code: codePromptFor(wantCode, wantC64),
    sound: wantSound ? SOUND_PROMPT_SOURCE : "",
  });
  // The revise block comes AFTER the compiler prompt and before the style
  // profile: the compiler prompt ends by declaring "a valid spec, JSON only"
  // the absolute output contract, which is the one rule a revision must not
  // follow — it returns the author's whole document, in the author's own
  // notation, a notation the compiler prompt never mentions. Left to the user
  // message alone, that instruction was arguing with 46k characters of system
  // prompt. In the SUFFIX, so the cached prefix is still the one Generate
  // warms (llm/prompt.ts's split).
  const suffixText = blocks.suffix + (catalog.variable ? "\n\n" + catalog.variable : "") + "\n\n" + REVISE_PROMPT_SOURCE + styleBlock(cfg.styleText);
  // systemBlocks drops a whitespace-only tail. Passing no exemplars leaves the
  // suffix as just the newline after {{EXEMPLARS}}, which the API rejects.
  const system: Anthropic.TextBlockParam[] = systemBlocks(blocks.prefix, suffixText);

  // ---- picture mapping (§14): regions: auto in the document ----
  const mapWarnings: string[] = [];
  let maps: Map<string, PictureMap> | null = null;
  const wanted = cfg.mapAuto ? specs.flatMap((s) => (Array.isArray(s.elements) ? autoImages(s) : [])) : [];
  if (cfg.mapAuto && wanted.length > 0) {
    try {
      const out = await cfg.mapAuto(wanted.map(({ picture, opts }) => ({ picture, opts })), cfg.signal);
      mapWarnings.push(...out.warnings);
      if (out.maps.size > 0) maps = out.maps;
    } catch (err) {
      if (cfg.signal?.aborted) throw err;
      mapWarnings.push(`Could not map the pictures (${describeApiError(err)}); regions: auto is left as it is.`);
    }
  }
  const mapNoteText = maps
    ? "These pictures have been mapped — use these part names; write regions: auto as it is, the app fills the boxes.\n" +
      mapNote([...maps].map(([url, map]) => ({ url: url.startsWith("data:") ? "(embedded picture)" : url, map })))
    : "";
  // ---- end picture mapping ----

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildReviseUser(docText, instruction) + (mapNoteText ? "\n\n" + mapNoteText : "") }];
  const rounds: ReviseRound[] = [];
  const maxRepairs = cfg.maxRepairs ?? 2;
  let repairsUsed = 0;
  let best: { playlist: Playlist; text: string } | null = null;
  const client = makeClient(cfg.apiKey);
  const measure = makeBrowserMeasure();

  try {
    while (true) {
      const label: ReviseRound["label"] = rounds.length === 0 ? "initial" : "repair";
      const model = label === "initial" ? cfg.model : repairModelFor(cfg.model);
      const round = rounds.length + 1;
      const { text: raw, ms } = await callForText(client, model, system, messages, {
        signal: cfg.signal,
        effort: label === "initial" ? cfg.effort : "low",
        onDelta: cfg.onProgress && ((_delta, text) => cfg.onProgress!({ label, round, text })),
      });
      const cleaned = stripFence(raw);
      const parsed = parseReviseReply(raw);

      // Blobs come back BEFORE anything judges this candidate: a hoisted
      // document is not a complete document, and a reply that dropped the
      // `assets:` block would otherwise fail validation on a reference that is
      // perfectly good (design 2026-09-20 §5.2). Restoring into losers as well
      // as the winner costs a map lookup per asset.
      if (parsed.playlist && hoisted.blobs.size > 0) restorePortraitStrokes(parsed.playlist, hoisted.blobs);

      let errors: string[] = [];
      let lintIssues: LintIssue[] = [];
      if (!parsed.playlist) {
        errors = [parsed.error!];
      } else {
        // The mapped boxes of the names this reply uses, before it is judged;
        // a name the map lacks, or one aimed into a picture nothing mapped,
        // is reported for the repair (compile.ts does the same).
        const pics: MapCheck = { errors: [], reported: new Set() };
        const items = itemsOf(parsed.playlist);
        for (const item of items) {
          const c = checkMappedPictures(item.spec, maps, items.length > 1 ? `item ${item.index + 1}: ` : "");
          pics.errors.push(...c.errors);
          for (const k of c.reported) pics.reported.add(k);
        }
        // Engines must be loaded before layout — layoutSpec reads them synchronously.
        for (const id of templatesIn(parsed.playlist)) {
          await ensureEnginesForTemplate(id).catch((err) => {
            errors.push(`engine load failed for "${id}": ${(err as Error).message}`);
          });
        }
        // …and the engines the ELEMENTS need (mathjax for a `math` element),
        // which no template names.
        await ensureEnginesForSpecs(itemsOf(parsed.playlist).map((i) => i.spec)).catch((err) => {
          errors.push(`engine load failed: ${(err as Error).message}`);
        });
        const checked = checkPlaylist(parsed.playlist, measure);
        errors = [...errors, ...withMapCheck(checked.errors, pics)];
        lintIssues = checked.lintIssues;
        if (errors.length === 0) best = { playlist: parsed.playlist, text: cleaned };
      }
      rounds.push({ label, text: cleaned, errors, lintIssues, ms });

      if (!needsRepair(errors, lintIssues) || repairsUsed >= maxRepairs) break;
      repairsUsed++;

      const lintErrors = lintIssues.filter((i) => i.severity === "error");
      const lintWarnings = lintIssues.filter((i) => i.severity === "warn");
      // A repair round never fires for warns alone (needsRepair above), but
      // once one is running for a real problem, warn-severity lint rides
      // along too — free correction, not a reason to spend another round.
      const warningsBlock = lintWarnings.length > 0 ? `\n\nAlso worth fixing while you're at it (non-blocking):\n${lintReportText(lintWarnings)}` : "";
      const feedback =
        errors.length > 0
          ? `The revised document failed validation:\n${errors.join("\n")}${warningsBlock}\n\nReturn the corrected COMPLETE document, in the same shape.`
          : `The revised figure has visual problems:\n${lintReportText(lintErrors)}${warningsBlock}\n\nReturn the corrected COMPLETE document, in the same shape. Typical fixes: different label sides, shorter texts, fewer overlapping elements.`;
      messages.push({ role: "assistant", content: raw }, { role: "user", content: feedback });
    }
  } catch (err) {
    // The error path still adopts `best` when one exists (main.ts checks the
    // playlist, not the error), so the founding prompt is preserved here too.
    if (best && preserveFoundingPrompt(best.playlist, parsedNow.playlist)) {
      best = { playlist: best.playlist, text: formatPlaylist(best.playlist, "script") };
    }
    // Deduped: an asset can be both too large to send (noted here on every
    // round, since hoisting happens once up front) and, separately, flagged
    // by the restore if its stash went missing — no reason to say either
    // thing twice (design §5.1).
    if (best && maps) best = { playlist: best.playlist, text: formatPlaylist(best.playlist, "script") };
    const notes = [...new Set([...noteForDescribed(hoisted.described), ...mapWarnings, ...(best?.playlist.warnings ?? [])])];
    return { playlist: best?.playlist ?? null, text: best?.text ?? null, rounds, error: describeApiError(err), notes };
  }

  const promptFilled = best ? preserveFoundingPrompt(best.playlist, parsedNow.playlist) : false;
  if (best && (hoisted.blobs.size > 0 || promptFilled || maps)) {
    // The winner's `text` is the model's raw reply, which still shows
    // placeholders and descriptors; the playlist has been restored in the loop
    // above, so the document is re-printed from it.
    best = { playlist: best.playlist, text: formatPlaylist(best.playlist, "script") };
  }
  // `notes` carries TWO things, deduped (design §5.1): assets too large to
  // send at all, and — from Task 5's restore — any that came back as a
  // descriptor because its stash went missing. `playlist.warnings` had no
  // reader anywhere in src/ before this; folding it in here gives a failed
  // restoration its first one, alongside existing parse warnings from
  // playlist.ts that were equally silent until now. Showing those too is the
  // point, not a side effect — though it does mean a revise can print a line
  // it never printed before.
  const notes = [...new Set([...noteForDescribed(hoisted.described), ...mapWarnings, ...(best?.playlist.warnings ?? [])])];
  return {
    playlist: best?.playlist ?? null,
    text: best?.text ?? null,
    rounds,
    error: best ? undefined : (rounds[rounds.length - 1]?.errors[0] ?? "The model never produced a usable document."),
    notes,
  };
}
