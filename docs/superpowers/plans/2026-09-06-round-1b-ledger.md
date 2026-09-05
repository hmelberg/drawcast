# SDD ledger — plan: docs/superpowers/plans/2026-09-06-round-1b-accounts.md

Spec: docs/superpowers/specs/2026-09-05-private-publishing-and-learner-identity-design.md (amended 20beef8; binding authority).

**This file is committed**, in `docs/superpowers/plans/`, and the SDD
workspace's `progress.md` is a symlink to it — round 1a's ledger died with
its git-ignored worktree, and this one must not.

## Workspaces

- drawcast: worktree `~/Documents/GitHub/drawcast/.claude/worktrees/round-1b`, branch `round-1b` off origin/main (c0d4eb7). node_modules symlinked; vitest 4619 pass, tsc clean at setup.
- drawcast-anvil: `~/Documents/GitHub/drawcast-anvil`, `master`, clean at e98cbb1; pytest 350 pass.

Ruling: drawcast-anvil on `master`, no worktree — the pull ritual pushes there and nowhere else, and no other session shares that repo (round 0's ruling, unchanged). Cost if wrong: a broken push to the branch the live backend pulls from; mitigated because Anvil takes changes only when Hans accepts a pull.

Ruling: drawcast in a worktree under `.claude/worktrees/` — another session is committing to the main checkout (BASIC interpreter, c0d4eb7 landed mid-session). Cost if wrong: one merge at the end.

Ruling: Anvil and client tasks run in parallel, one implementer per repository — round 1a's ruling 11; different repositories cannot conflict. Cost if wrong: none.

## Pre-flight scan

### Cross-task pairs

| Tasks | Produces → consumes | Finding |
|---|---|---|
| 1 → 3 | `courses.access`, no `casts.access` → `_read_denied` reads the course, `_cast_put` writes none on the cast | clean (nothing deploys between them — one push) |
| 1 → 4, 5 | `runs.join` → `run["join"]` in `/enroll`, `run_view`; `_run_row`/`new_run` write `join="anyone"` | clean |
| 2 → 3 | `cast_read(access, owner_id, user_id, enrolled=, teacher=, admin=)` → `_may_read` spreads `**_standing(course, user)` with exactly those keys | clean |
| 2 → 4 | `enrol_outcome(existing_state, join)` → `(None|row["state"], run["join"])` | clean |
| 2 → 5 | `access.JOIN`, `access.ACCESS` → `update_run`, `set_course_access` | clean |
| 4 → 5 | `mail.join_decision(course_title, approved, link)` → `_mail_decision`; needs `import mail`, `import anvil.email` in dashboard_server (named in Task 5) | clean |
| 5 → 6 | `_course_link`, `_lectures(run, [{"progress": prog}])` → `my_enrollments`; the callables pin lists Task 6's three, so Task 5 commits one red pin | clean — stated in both tasks |
| 6 → 8 | both edit `Form1/__init__.py`; 6 keeps the login loop, 8 replaces it; 8's pin `history.replaceState( < self.load_learning()` needs 6's call | clean, sequential |
| 7 → 8 | `request_link(email, return_url)`, `redeem_here(token)` → SignIn, Form1 | clean |
| 3 → 11 | `parse_cast_put.access` None when absent ↔ client omits the key | clean |
| 4 → 9 | `{ok, state}` ↔ `joinCourse` reads `state` | clean |
| 3 → 10 | 401 / 403 ↔ `CastDenied(status)` | clean |
| 9 → 10 | `courseDoor(name, resolved, deps, opts)`, `SendOutcome` → `deniedDoor`, `report` | clean; Task 10's learn-viewer pins match Task 10's `report` shape |

### Per-task self-consistency

| Task | Finding |
|---|---|
| 1, 2, 4, 6, 7, 9, 10, 11, 12 | clean |
| 3 | **FINDING 3** — one pin is convoluted and passes trivially (`write.split(...)...replace(...)`) |
| 5 | **FINDING 1** — the pin `RUNFORM.count('"decide_enrollment"') == 2` contradicts the code, which routes Approve and Decline through one `decide()` (one call) |
| 8 | **FINDING 2** — the pin `"password" not in SIGNIN.lower()` contradicts the SignIn docstring the same task writes ("There is no password") |

### Rulings

**FINDING 1** — Ruling: the pin becomes `RUNFORM.count('"decide_enrollment"') == 1` plus `'"active")' in RUNFORM and '"rejected")' in RUNFORM` (both lambdas). One call site is the better shape; the pin was wrong, not the code. Cost if wrong: none.

**FINDING 2** — Ruling: the pin checks `"password" not in TEMPLATE.lower()` (what a person sees) and `"login_with_form" not in SIGNIN` (what runs); the docstring may name the thing it removed. Cost if wrong: none.

**FINDING 3** — Ruling: the pin becomes `assert "access=" not in write` (the whole `_cast_write` body, docstring included — the docstring uses the word, never `access=`). Cost if wrong: a docstring edit that writes `access=` in prose would trip it, visibly.

All three are carried into the task briefs as the controller's resolution.

## Progress
