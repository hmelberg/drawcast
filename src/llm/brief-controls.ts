// The brief controls: who watches, how deep, how long — three quiet choices
// beside the request box (Hans, 2026-09-30: "visible, but discrete"). They
// add nothing new to the vocabulary: each choice IS a tag from tags.ts, so the
// parser, the chips, the course runner and a stored prompt all read them the
// same way. A tag typed in the box wins over the control for its group;
// generation appends the controls' choices for the groups the text leaves open.
//
// Pure on purpose: main.ts is DOM-bound and untestable in the node suite.

import { parseTags, TAG_RE, tagGroupOf, type TagGroup } from "./tags";

export type BriefGroup = Extract<TagGroup, "audience" | "level" | "length">;

export interface BriefOption {
  /** The tag, "" for the untagged default, "for" for "Other…" (a #for=<who>). */
  value: string;
  label: string;
  hint: string;
}

export interface BriefControl {
  group: BriefGroup;
  label: string;
  options: BriefOption[];
}

export const BRIEF_CONTROLS: BriefControl[] = [
  {
    group: "audience",
    label: "Audience",
    options: [
      { value: "", label: "General audience", hint: "Curious adults with good general knowledge, no special knowledge of the topic" },
      { value: "students", label: "Students", hint: "Meeting the topic in a course" },
      { value: "professionals", label: "Professionals", hint: "Work with the topic in practice" },
      { value: "children", label: "Children", hint: "About 10–14" },
      { value: "for", label: "Other…", hint: "Name the audience, e.g. nurses" },
    ],
  },
  {
    group: "level",
    label: "Level",
    options: [
      { value: "basic", label: "Basic", hint: "No jargon; every term defined" },
      { value: "", label: "Standard level", hint: "A field's own terms, defined once in passing" },
      { value: "advanced", label: "Advanced", hint: "Technical terms; prior knowledge assumed" },
    ],
  },
  {
    group: "length",
    label: "Length",
    options: [
      { value: "veryshort", label: "Very short", hint: "5–7 spoken lines" },
      { value: "short", label: "Short", hint: "8–12 spoken lines" },
      { value: "", label: "Standard length", hint: "14–20 spoken lines" },
      { value: "long", label: "Long", hint: "22–30 spoken lines" },
      { value: "verylong", label: "Very long", hint: "30–40 spoken lines" },
    ],
  },
];

export type BriefDefaults = Record<BriefGroup, string>;

/** The tag the text itself sets for this group (canonical name, or "for=…"), or null. */
export function briefTagInText(text: string, group: BriefGroup): string | null {
  const parsed = parseTags(text);
  return parsed.tags.find((t) => tagGroupOf(t) === group) ?? null;
}

/** The request as sent: the text, plus a control's tag for each group the text leaves open. */
export function withBriefDefaults(text: string, defaults: BriefDefaults): string {
  const add = BRIEF_CONTROLS.map((c) => c.group)
    .filter((g) => defaults[g] && briefTagInText(text, g) === null)
    .map((g) => `#${defaults[g]}`);
  return add.length ? `${text.trim()} ${add.join(" ")}` : text;
}

/** The text without any typed tag of this group — the control has taken it over. */
export function clearBriefTag(text: string, group: BriefGroup): string {
  return text
    .replace(new RegExp(TAG_RE.source, TAG_RE.flags), (whole, lead: string, word: string) => (tagGroupOf(word) === group ? lead : whole))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** "intensive care nurses" → "for=intensive-care-nurses"; "" when nothing is left. */
export function forTag(words: string): string {
  const w = words.replace(/#/g, "").trim().replace(/\s+/g, "-");
  return w ? `for=${w}` : "";
}
