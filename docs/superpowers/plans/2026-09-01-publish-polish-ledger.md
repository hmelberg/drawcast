# Ledger — publish polish round, started 2026-09-01

- 2026-09-01: Task 1 (`#gdrive=` viewer route). The brief's stated normalization
  collision ("the existing `/gh-/` replace would otherwise not collide but keep
  it explicit") doesn't actually arise — `gdrive-` doesn't contain the
  substring `gh-`, and `#gdrive=…` doesn't match the `gdoc` literal either — so
  no id ever crosses into the wrong branch even without ordering. Kept the
  brief's instructed order anyway (gdrive-normalize, then gdoc-normalize, then
  gh-normalize) since it's harmless and matches the brief's intent explicitly
  rather than relying on the absence of a collision holding forever.
