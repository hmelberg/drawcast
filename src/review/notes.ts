// Notes taken while watching a drawcast, and the single instruction they turn
// into.
//
// Two things make these worth more than free-text feedback. They carry WHERE
// you were — a note that says "the axis is wrong" is useless without the part
// and the line it was said over — and they are applied TOGETHER: six notes sent
// one at a time are six calls and six chances to break something, where one
// call lets the model reconcile notes that interact ("make it shorter" and
// "add a quiz" have to be solved against each other, not in sequence).

export interface ReviewNote {
  text: string;
  /** 1-based part number, when the drawcast has parts. */
  part?: number;
  /** Title of the part playing when the note was written. */
  item?: string;
  /** The narration line on screen at that moment. */
  caption?: string;
}

/** One note as the model should read it: the position first, then the ask. */
export function describeNote(note: ReviewNote): string {
  const where: string[] = [];
  if (note.part !== undefined) where.push(note.item ? `Part ${note.part} "${note.item}"` : `Part ${note.part}`);
  else if (note.item) where.push(`"${note.item}"`);
  if (note.caption) where.push(`at "${note.caption}"`);
  return where.length > 0 ? `${where.join(", ")}: ${note.text}` : note.text;
}

/**
 * The whole set as one revision instruction. The closing line is the point of
 * batching — without it the model tends to apply the notes in order and let a
 * later one undo an earlier one.
 */
export function formatNotes(notes: ReviewNote[]): string {
  const usable = notes.filter((n) => n.text.trim().length > 0);
  if (usable.length === 0) return "";
  if (usable.length === 1) return describeNote(usable[0]);
  return [
    "Apply these notes from watching the drawcast:",
    "",
    ...usable.map((note, i) => `${i + 1}. ${describeNote(note)}`),
    "",
    "Apply all of them together, reconciling any that pull against each other.",
  ].join("\n");
}

/** Short label for the note list in the UI. */
export function noteLabel(note: ReviewNote): string {
  if (note.part !== undefined) return note.item ? `${note.part}. ${note.item}` : `Part ${note.part}`;
  return note.item ?? "";
}
