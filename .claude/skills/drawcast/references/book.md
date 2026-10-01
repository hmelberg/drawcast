# A book (#book, #book_row)

A book is a multi-part drawcast with a **written text pane** beside each
figure (`#book`, text left) or under it (`#book_row`). Spec:
`docs/superpowers/specs/2026-10-01-book-layout-design.md`. Bundled books to
copy from: `docs/examples/books/*.yaml` (copied into the app's examples by
`node scripts/add-book-examples.mjs`).

## Shape

- A playlist (`playlist:` header, `---` between parts, `chapter: …`
  documents). Every part carries `book: { layout: columns | rows, look: mixed }`.
- The book writes its own title (`#`), chapters (`##`) and part titles as
  headings — start each part with content, not a heading.
- Each part is an ordinary figure: any element or template works there.

## The text verbs

- `write: "…markdown…"` on its OWN command (a command has one action), with
  the `speak` it belongs to. Markdown: `**bold**`, `*italic*`, `- lists`,
  `> quote`, tables, `$inline$`, `$$display$$` on its own line, and a
  ```python listing with an ```output block under it.
- Name a block you will come back to: `write: { id: formula, text: … }`.
  Never aim at the automatic `w1, w2` (lint warns: they move).
- `highlight: { target: formula }` — a mark until the next block (effect
  `underline`, `circle`, `box`; `keep: true` stays; `effect: strike`
  crosses out). `part:` marks one piece (verbatim text, or a formula's TeX).
- `point: { at: { ref: formula } }` — scroll back and flash it, also from a
  later part. `erase: [formula]` — remove it.
- `write: { text: …, temp: true }` — a scratch note, gone before the next block.
- `view: figure` / `view: both` — give the figure the whole book for a
  moment (keep something moving there); `clear: { pane: notes | both }`.

## Taste

- What to write: definitions, key terms, formulas, short statements, quotes,
  small tables — about 12 words a block, 3–7 blocks a part. The voice
  explains; the text keeps what to remember. Never write out the sentence.
- At most two marks a part, mostly temporary.
- On the figure: words a word or three; a point whose numbers the voice says
  gets `guides: { values: true }`.
- Connect the spoken sentences (so, but, now, back in our formula…).

## Check

`npx vitest run tests/examples.test.ts -t "A book"` holds bundled books to
the examples gate (validates, lays out, plans with no warning, lints clean);
`tests/book.test.ts` lints the text. Look at it in the app (Examples →
"… — a book"); seek around — the text pane must rebuild to match.
