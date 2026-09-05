# Skip unchanged files on republish — report (2026-09-05)

The production change (`commitFiles` reads the branch's tree once, hashes each
file the way git does, uploads and lists only files whose blob SHA differs, and
returns the current head when nothing is sent and nothing is deleted) was
already written. This round finished the tests around it and answered the
retry question. Tests could not be run from this session; see "Unverified".

## What changed

### `tests/publish-commit.test.ts`

The one added request — `GET /repos/o/r/git/trees/<sha>?recursive=1`, made
between reading the head commit and the first blob upload — broke eight tests.
Every one was a selector or a count that now met the bodiless GET, not a
semantic change:

| Test | Why it failed | Fix |
|---|---|---|
| writes everything in ONE commit | method sequence gained a third `GET` | expects `GET GET GET POST POST POST PATCH`, checks that call 2 is the tree read, and says what the sequence protects (the write tail; no write before the reads that decide it) |
| the tree carries blob SHAs | `find("/git/trees")` hit the GET, whose body is `null` | `find(isTreeWrite)` |
| bases the tree on the current one | same | same |
| deletes a dropped path | same | same |
| empty repo: commits the rest on the ordinary path | same | same |
| empty repo: ignores deletions | same | same |
| rebuilds on whatever is there now | `trees[1]` was the FIRST write once the GET took index 0 | filter tree WRITES, assert `[0]` = `old-tree` and `[1]` = `moved-tree`; the semantics are untouched |
| a 502 on the tree call | `/git/trees` count included the GET | `flaky` gained an optional `method`; the failure targets the POST (Hans's live 502 was on the write) and the count is of writes |

Two module-level helpers make the distinction explicit for the next reader:
`isTreeRead(url, method)` (GET, and only the read has a slash after `trees`)
and `isTreeWrite(call)` (POST to `…/git/trees`). `listing(entries)` builds
the read's answer.

Every fake in the file (recorder, emptyRepo, large-files, racing, alwaysStale,
the no-cache probe, flaky) now answers the tree read explicitly. Before this,
six of them answered it with `{ sha: "…" }`, `remoteBlobShas` threw a
`TypeError` on `tree.tree.filter`, and the `catch` swallowed it — the suite
passed by accident. Narrowing that `catch` to `PublishError` later would have
broken six tests for no visible reason.

New tests:

- **`unchanged files are not re-uploaded`** (the test the change deserves)
  - `gitBlobSha` against four vectors produced by `git hash-object --stdin` on
    this machine: `""`, `"hello\n"`, `"title: a"`, and `"æøå"` (three
    characters, six bytes — pins that the header counts UTF-8 bytes).
  - Two files, the tree read reports A's real SHA and a different SHA for B:
    exactly one blob request and it decodes to B; the tree write carries only
    B; A's path is absent; `base_tree` is the tree that was read; progress
    reports `0/1, 1/1` (the denominator is what is sent, not the plan).
  - Every file already there: resolves to `{ commitSha: "refsha" }` (the
    current head) and the whole call sequence is `GET GET GET` — no write.
  - Every file unchanged but a deletion pending: one tree write carrying only
    the `sha: null` entry, then commit and ref move.
  - A path missing from the listing, or listed with other bytes, is sent.
  - The tree read answers 404: the publish still lands and both files go up.
- **`transient failures`**: a tree READ that keeps throwing is retried like
  any call (three attempts), then given up quietly; every file is sent.
- **`a branch that moved under us`**: "keeps the skip decided against the tree
  it read once; the retry does not re-read" — see the retry answer below.
- **`a repository with no commits yet`**, two faithful-listing tests — see
  "A behaviour change on the empty-repo path".

### `src/publish/github.ts`

Doc comments only. The diff had inserted `gitBlobSha` between the "One atomic
commit" JSDoc and `commitFiles`, leaving that JSDoc orphaned above another
JSDoc. It now sits on `commitFiles` again and describes the current sequence
(ref, commit, tree; blobs for changed files only; one tree; commit; ref).

### `tests/source-save.test.ts`, `tests/course-publish.test.ts`

These drive `commitFiles` through `saveSource` and `publishCourse`. Their
fakes passed for the same accidental reason (a swallowed `TypeError`). Each
now answers the tree read with `{ tree: [] }` explicitly — one clause per fake,
three fakes, no assertion changed. `tests/cast-publish.test.ts` does not fake
the Git Data API and needed nothing.

## The retry question

`remoteBlobShas` reads `state.baseTree` once, before the retry loop. After a
non-fast-forward the commit is rebuilt on the moved branch with the SAME
`tree` array, so the skip decisions were made against the old tree.

**First attempt: the map is never stale.** It comes from the exact tree the
commit is based on. A missing or differing entry always sends the file; the
only way to skip is a byte-identical blob already at that path. There is no
window here — anything pushed between the read and our PATCH is what makes the
PATCH fail, and that is the retry path.

**Retry: the map is stale, and the claim "stale can only over-send, never
under-send" is not quite true.** If the concurrent commit changed or deleted a
path we skipped, our rebuilt tree asserts nothing about that path, so
`base_tree = moved-tree` supplies THEIR version (or its absence). We did skip a
file that now differs from the branch.

**Acceptable, for three reasons.**

1. It is git's own merge outcome: paths we did not change carry whatever the
   other side did to them; paths we changed carry ours. The old behaviour —
   every file in every tree — silently overwrote a concurrent human edit of
   the same lecture with a copy identical to the one they had just edited
   away from. Neither is authoritative, but the new one loses no one's work.
2. It self-heals. The next publish reads the moved tree, sees the mismatch,
   and sends the file.
3. The window is the few seconds between the tree read and the PATCH, and the
   trigger is someone else editing the very lecture being republished in
   those seconds. The alternative — re-reading the tree inside the retry,
   recomputing `sending`, uploading any newly-differing blobs, rebuilding the
   entries — moves the blob loop into the retry for a case that has never
   occurred.

The `trees[1]` index had shifted because of the added GET; the fix filters
tree writes and leaves the semantics alone. The new racing test pins the
decision: with A unchanged and B changed, exactly one tree read, one blob,
two tree writes both carrying only B, the second on `moved-tree`.

## A behaviour change on the empty-repo path

Seeding an empty repository writes `files[0]` through the Contents API, then
`readHead` and now `remoteBlobShas` read the seed commit's tree — which really
does hold `files[0]` under the SHA git gives its bytes. So:

- A **single-file** publish into an empty repo now stops at the seed commit
  and returns its SHA: one commit, not two. Previously the second commit
  re-wrote the same file.
- A **multi-file** publish uploads the seeded file no second time.

Both are correct and both are pinned by new tests with a faithful listing.
The existing empty-repo tests keep an empty listing so the ordinary path is
still exercised with the file in it. Flagging it because it was not in the
description of the change.

## Unverified

- **No test run and no type-check.** `npx vitest run` and `npx tsc --noEmit`
  are blocked in this session. The eight failures and every new assertion were
  traced against the code by hand. Most likely residue if something is off:
  a type nit in the test helpers (`listing`'s spread of an optional `type`).
- **The git vectors are real** — produced by `git hash-object --stdin` here —
  but `gitBlobSha` running under Node's `crypto.subtle` in the vitest `node`
  environment is inferred from other tests using Web globals, not observed.
- **`deletions` vs `wasEmpty` in the nothing-to-do check.** The early return
  tests `deletions.length === 0`, but the tree later drops deletions when
  `wasEmpty`. An empty repo with a single file AND a non-empty `deletions`
  would post a tree with `tree: []`. No caller can produce it (an empty repo
  has no manifest, so `removedPaths` is empty), so left as is. One line —
  `const removing = wasEmpty ? [] : deletions` used in both places — would
  close it.
- **GitHub truncates a recursive listing** past 100 000 entries / 7 MB and
  sets `truncated: true`. Paths missing from a truncated listing are treated
  as changed and sent — the safe direction — so nothing checks the flag.
- **File mode.** A file already in the repo as `100755` with identical bytes
  is skipped and keeps its mode; sending it would have set `100644`. Cosmetic.
