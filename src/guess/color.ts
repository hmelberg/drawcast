// The guess colour on its own, so layout code (a formula blank's box, a
// viewer's fill) can use it without importing the guess handles, which
// import the layout.

/** The viewer's colour — not the ink, not the highlight, not a series colour. */
export const GUESS_COLOR = "#3f6fb5";

/** The word that tags the viewer's own answer on the figure ("You", "Du"):
 *  set from the cast's language when a figure is mounted (render/player.ts
 *  setSourceLang → ui/gate-words.ts `yours`). One figure language at a time. */
let you = "You";

export function setYouWord(word: string): void {
  if (word) you = word;
}

export function youWord(): string {
  return you;
}

/** The tag's size, and how far it stands from what it names. */
export const YOU_SIZE = 18;
