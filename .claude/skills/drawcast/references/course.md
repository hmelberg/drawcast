# A course

Read this when the user asks for a course (several lectures). Each part is staged with the loop in SKILL.md.

A course is what the app's course panel makes: a plan (`course.md`), and per
lecture a storyboard (the whole lecture's narration, written at once) whose
parts are each staged as a drawcast. `scripts/cast.mjs` gives every step the
app's OWN prompt and code, in a folder shaped like a published course:
`dev-casts/courses/<slug>/` with `course.md`, `lecture-NN/` (working files)
and one `NN-<title>.yaml` per built lecture.

0. **The brief, asked.** A course costs hours, so settle its brief with the
   user before planning: who the learners are (nurses, first-year
   economists…), level, language, and how many lectures. One message, with
   your proposal for each; wait for the answer. The answers go into the
   request you give `course-prompt` and into the plan's shared context, so
   every storyboard sees them. Audience and level are also tags
   (`#for=nurses`, `#students`, `#professionals`, `#children`; `#basic`,
   `#advanced`): typed in the request, `course-prompt` takes them as the
   course's brief, and `course-new --brief` stores them as the tag line under
   `course.md`'s title — the app's Audience/Level controls write the same
   line, and every `lecture-prompt`/`part-prompt` carries it (a lecture's own
   tag of the same group wins).
1. **Plan.** `node scripts/cast.mjs course-prompt "<request>" [--lectures N]`
   → `dev-casts/_course-prompt.md`. Write the JSON it asks for (questions,
   not topics; the shared context; tags such as `parts=4`) to
   `dev-casts/courses/<slug>/plan.json`, then
   `node scripts/cast.mjs course-new dev-casts/courses/<slug>/plan.json dev-casts/courses/<slug> [--brief "#for=nurses #basic"]`
   (the command `course-prompt` prints includes `--brief` when there is one).
2. **Show the user `course.md` and wait.** The plan is a draft the teacher edits
   (that is how the app works too); the lectures cost hours. Take their edits
   into `course.md` directly — its format is what the course panel shows.
3. **Each lecture** (in parallel: one subagent per lecture, each given SKILL.md,
   this file and its lecture number; lectures do not depend on each other):
   - `node scripts/cast.mjs lecture-prompt <dir> <n>` → write the storyboard
     JSON it asks for to `<dir>/lecture-NN/storyboard.json`. This is where
     the lecture's narration is written, for all its parts at once.
   - **Check its facts** (SKILL.md step 3) on the storyboard, before any
     part is staged: every checkable claim in its lines, fixed in the
     storyboard. Each source goes into the `sources` of the part whose lines
     rely on it, with `cites` on the element that shows it.
   - For each part i (numbered from 1): `node scripts/cast.mjs part-prompt <dir> <n> <i>` →
     read the prompt — in a course, `references/rule-card.md` in place of
     the prompt's rules and its "## Examples" section (grep those for a
     detail when needed); the catalogue, exemplars, templates and the
     part's request in full (the part's request, with its already-written lines, is
     at the end), write `<dir>/lecture-NN/part-<i>.json` as
     `{"request": …, "spec": …}`, then the loop in SKILL.md: check,
     frames, look, fix (steps 5–7). The lines are written; the job is to
     STAGE them.
   - Both use the v2 storyboard prompt by default (the app's default since
     2026-09-28: the storyline rules, templates with "Viewer can", and a
     per-part staging note); `--storyboard v1` gives the previous prompt. Use
     the same version for a lecture's storyboard and its parts.
   - `node scripts/cast.mjs lecture-build <dir> <n>` → the lecture's YAML,
     exactly as the course runner assembles it (titles, level, the
     "Next: …" card), and `status: done` in `course.md`. Frames the YAML
     once more for a last look across the parts.
   - The lecture's subagent reports its frames folder and spoken lines; YOU
     (the session that started it) run SKILL.md step 8 — the fresh eyes —
     on the whole lecture, since a subagent cannot start one, and send the
     real problems back to that subagent to fix.
4. **Open it:** `node scripts/cast.mjs course-open <dir> --launch` imports
   the course into the app (built lectures only; opening again refreshes
   it) and opens the course panel. From there the user watches, edits, and
   publishes as with any course.

Report per lecture as it lands (title, parts, one line on what it shows);
a lecture whose part will not come right is worth a line to the user rather
than a silent compromise.
