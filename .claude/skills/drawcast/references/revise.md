# Revising what is published (a GitHub link)

Read this when the user gives a link to a published drawcast or course and asks for a change.

Any link to it works: the course page (owner.github.io/repo/<course>/), the
folder or a file on github.com, a player link (drawcast.app/#gh=…), raw, or
owner/repo/path. A link to one lecture pulls its whole course (the course
page, READMEs and end pages hang together) and says which lecture it was.
A drawcast.app/#<name> short link does not say where the files are — ask for
the GitHub one.

1. **Pull.** `node scripts/cast.mjs pull <link>` → a sparse clone in
   `dev-casts/repos/` and a working copy: a course in
   `dev-casts/courses/<slug>/` (course.md and the published lecture YAMLs,
   the same shape as a course made here), a single drawcast in
   `dev-casts/pulled/<slug>/`. `origin.json` records where it came from.
2. **Unpack only what the change touches.** `unpack <course-dir> <n>` →
   `lecture-NN/part-N.json` (N from 1, in playing order) + `outline.json`; `unpack <cast.yaml>` →
   `<name>.parts/`. The parts are ordinary specs: `check`, `frames` and
   `open` take them as they are.
3. **Read the rules.** `revise-prompt <parts-dir> "<the change>"` gives the
   app's prompt with the document's own templates in full (first time in a
   session, read it all, as in SKILL.md's loop).
4. **Edit, then the loop** (SKILL.md steps 5–7: check → frames → look →
   fix) on the parts you changed; step 8 (fresh eyes) only when the change
   redraws something, not for a change of words alone. Change what was asked and nothing else: every spoken line you do
   not need to touch stays word for word — baked narration is keyed by the
   sentence, so an edited line loses its recording. Reorder, drop or add
   parts in `outline.json`'s `entries` (a new part is a new `part-N.json`,
   written with `prompt` as any cast). The last part of a lecture is its
   end page (Previous / Next / Watch again, as `link` elements): push redraws
   it from course.md, keeping any `link` elements you add to it.
   Course-level changes go in `course.md` directly: retitle, reorder, edit
   questions, drop a lecture. Never change a `file:` on a status line — it is
   the published link. A new lecture is made with the steps in references/course.md
   (lecture-prompt … lecture-build), which give it its status line.
5. **Repack** `repack <parts-dir>` → the YAML again, with the meta as it was
   and the recordings of every line still said; it reports lines left with
   no recording. Frame the repacked YAML once (answers stored in one part
   are read in the next). Show it: `course-open <dir> --launch` or
   `open <yaml> --launch`.
6. **Push, after asking.** Always `push <workdir> --dry-run` first and show
   the user the file list. Then, with their yes:
   - default: `push <workdir> -m "<what changed>" --body "<why, per lecture>"`
     → a branch and a pull request. Without push rights on the repo it forks
     first and opens the PR from the fork. Pushing the same workdir again
     updates that PR (`--new-pr` for a separate one).
   - `--direct` commits to the default branch — only when the user has said so
     for THIS push, and only on a repo they can push to. Published links read
     raw.githubusercontent.com, which can lag a few minutes.
   - `--no-push` commits in the clone and stops, to inspect with git.
   Push regenerates what the app's own publish would (the course page with
   its Join door as it was, READMEs, courses.json/casts.json, Next links and
   cards) and refuses if those files changed on GitHub since the pull: pull
   again into a fresh workdir and carry the edit over. A public push also
   commits each cast's link-card picture (`<file>.png`, drawn the way the app
   draws it); to give an older published repo its pictures, `pull` it and
   `push` again.

Report what changed per lecture and the PR link, and say two things when
they apply:
- **The app's own copy is now older than GitHub.** "Load courses from
  GitHub" keeps a local course that is newer than the manifest
  (course/load.ts), so the app will not pick the revision up by itself — and
  publishing the course from the app would put the old lectures back. Before
  publishing from the app again: remove the course there, then load it from
  GitHub.
- Lines that lost their recording play in the browser's voice until the
  course is published with narration from the app (after removing and reloading it, as the bullet above says);
  unchanged lines reuse the published recordings for free.
