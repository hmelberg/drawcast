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

Task 1: dispatched (sonnet). ANVIL BASE e98cbb1.
Tasks 9+10: dispatched as one batch (sonnet) — Task 10 consumes Task 9's interfaces and both edit viewer.ts. DRAWCAST BASE 0650fbf.
Task 1: implemented (anvil e98cbb1..8588989, pytest 351 exit 0). Task review dispatched (sonnet).
Task 1: complete (anvil e98cbb1..8588989, review clean). ⚠️ resolved by me: `columns()`/`load()` in test_schema.py are the file's own helpers, read at setup. Minor noted: the README's pull paragraph names `use_email` OFF ahead of Task 8 — true at the push, which is the only moment Hans reads it.
Task 2: dispatched (haiku — complete code in the brief, two files).
Task 2: implemented (anvil 8588989..aea7b8d, pytest 363 exit 0). Task review dispatched (sonnet).
Task 2: complete (anvil 8588989..aea7b8d, review clean).
Task 2: minor (routed to Task 3's dispatch): the comment above `ACCESS` in access.py still describes round 0's owner-only gate.
Task 3: dispatched (sonnet — api.py integration; carries FINDING 3's simplified pin and the access.py comment).
Tasks 9+10: implemented (drawcast 0650fbf..73bd3ad, 2 commits; vitest 4630, tsc clean). Implementer re-aimed four pre-existing pins outside the briefs' file lists (learn, names-entry, learn-viewer, viewer-anvil) — the same plan gap round 0 recorded; the reviewer is asked whether each re-aim kept its intent. Task review dispatched (opus — the client's whole round-1b behaviour, and moved pins to judge).
Tasks 9+10: complete (drawcast 0650fbf..73bd3ad, review clean; all five re-aimed pins judged KEPT INTENT — the narrow one in viewer-anvil is backstopped by the brief's new learn-viewer pins).
Tasks 9+10: minor (deferred): `reporter.stopped` is per page load while `firstOpenInSession` is per sessionStorage — two "session" scopes; matches the brief.
Ruling: three of the review's minors are routed into Task 11's dispatch rather than deferred, because Task 11 is the last client task and each is a few lines on the page this round builds: (a) `joinNote`'s distinctness pin must enumerate `pending`/`rejected`; (b) the refused-cast door renders NESTED inside the viewer chrome (`status.replaceWith` inside `.viewer-wrap` — doubled padding, a second h1, an empty figure host and a Share button under a door) where `runNamed`'s door replaces the whole body — the catch must replace the app's children, not the status line; (c) the 401 door does not `deps.forget()` a dead token before the handshake, unlike `courseDoor`'s `key` path. Cost if wrong: Task 11's diff touches viewer.ts and a test it did not own.
Task 11: dispatched (sonnet — share.ts/main.ts/server.ts, plus the three routed minors).
Task 11: implemented (drawcast 73bd3ad..f61c563, 2 commits; vitest 4632, tsc clean). Task review dispatched (sonnet).
Task 11: complete (drawcast 73bd3ad..f61c563, review clean; the three routed minors from 9+10 verified addressed).
Task 11: minor (deferred to the final wave): `ShareDeps.publishServer`'s doc comment in share.ts still says "two of spec §5's three values in this round".

Task 3: implemented (anvil aea7b8d..10e55b3, pytest 365 exit 0) — DONE_WITH_CONCERNS. The implementer found a defect in MY plan: naming the new parameter `access` inside `_claim_course_in_tx` and `_cast_write` shadows the `access` MODULE for the whole function body, so `access.claim_outcome(...)` and `access.slug_owner_conflict(...)` would raise AttributeError on every claim and every publish — invisible to every source pin, and unreachable by pytest since api.py imports anvil. It fixed it by importing `claim_outcome` and `slug_owner_conflict` by name and re-aimed two pre-existing pins that spelled the dotted form.
Ruling: the shadowing is a plan defect, mine, of the class round 0 recorded (glue that no test executes). Accepted the fix's substance; the reviewer is asked whether importing by name or renaming the parameter is the better shape, and whether the two re-aimed pins kept intent — I do not pre-judge either. Cost if wrong: one fix round. Standing note for Tasks 4–8's dispatches: no parameter or local may be named `access`, `mail`, `tokens`, `names`, `limits`, `dash`, `progress` in api.py or dashboard_server.py — every one is a module imported there.
Task 3: task review dispatched (opus — the gate, and a judgment call on the fix's shape).
Task 3: complete (anvil aea7b8d..10e55b3, review clean). The gate traced through eight cases, all fail closed; both named risks (stale call sites, surviving casts.access reads) clean; all three re-aimed pins kept intent. ⚠️ "does the client still send access on every publish" resolved by me: Task 11 made it optional and omits the key when unchosen, which is the whole point.
Ruling: the reviewer's Minor 1 — the parameter is still named `access`, so the shadowing is documented rather than removed — is routed into Task 4's dispatch as its FIRST commit: rename to `level` in `_claim_course_in_tx` and `_cast_write`, revert the two re-aimed pins to the dotted form, and re-aim the Task 3 pins that spell the parameter. Task 4 edits api.py anyway, and every later Anvil task edits it too; a dormant hazard in the file five more tasks touch is not "later". Cost if wrong: one extra commit in Task 4's diff.
Task 3: minor (deferred to the final wave): "is this account a teacher of this course" is derived twice — api._standing and dashboard_server._course_access — same scan, two copies.
Task 3: minor (routed to Task 4, which edits README): one short line in the re-wrapped `POST /cast` paragraph.
Task 3: minor (noted): the simplified pin `"access=" not in write` also forbids a keyword call `access=access`; the call is positional today.
Task 4: dispatched (sonnet — carries the rename commit, the README wrap, and the standing no-shadowing rule).
Task 4: the first dispatch died on a session rate limit (429, reset 02:10) before writing anything — anvil still clean at 10e55b3, no report file. Re-dispatched at 02:13 with the same brief (sonnet), on Hans's "fortsett".
Task 4: implemented (anvil 10e55b3..ef4bd6a, 2 commits — the `level` rename with the no-shadowing pin, then the enrol work; pytest 372 exit 0). Implementer's two notes: `new_run` writes no `join` (Task 5's), and one README sentence about `/enroll` auto-creating unowned rows is now GitHub-only (the next paragraph says so). Task review dispatched (opus — the door into private courses).
Hans, mid-round: a published GitHub course for the smoke — https://hmelberg.github.io/dcast/taylor-series-and-the-economics-of/ (course key hmelberg/dcast/taylor-series-and-the-economics-of). Task 12 uses it for the GitHub-side join and the 403 door's contrast case.
Task 4: task review (opus) — spec PASS, quality Approved, ONE Important: README's `POST /cast` paragraph still says "(a learner's `/enroll` creates it ownerless)" and a later sentence says `/enroll` "still auto-creates an unowned course row" — both falsified by this very task for `anvil/` keys, in Hans's pull checklist. Fix round 1/5 dispatched (resume implementer) with that plus two cheap minors: `_mail_teachers`' composition (`get_app_origin`) sits outside its try, so a raise there 500s a request whose row is already written; and the replaced parser test dropped the whole-segment assert (`anvilx/spanish1` is not the namespace) that now decides which branch of `http_enroll` runs.
Task 4: minor (deferred): the shadowing pin misses annotated/star parameters and hardcodes six names rather than deriving them from the import block. "Only active counts" is spelled inline in /event and _standing rather than in access.py.
Task 4: NOTE FOR HANS (a reachable consequence, by design, not a defect): a freshly published server course starts `enrolled` with an auto-created default run whose `join` is `anyone` — so until the owner sets approval in the dashboard, "enrolled" means any signed-in account that knows the slug, one click. Spec §3/§5 defaults say exactly this; naming it so it is a decision, not a discovery.
Task 4: fix round 1/5 (3 addressed, 0 open — README parenthetical + GitHub-only sentence, mail composition inside the try, whole-segment parser assert; commit ef4bd6a..c61b5c6, pytest 372 exit 0). Scoped re-review dispatched (sonnet).
Task 4: complete (anvil 10e55b3..c61b5c6, 3 commits, 1 fix round, re-review all addressed, no new breakage).
Task 5: dispatched (sonnet — dashboard_server/dash/RunForm/Form1; carries FINDING 1's pin correction and the no-shadowing rule).
Task 5: implemented (anvil c61b5c6..9665b82, pytest 379 pass + the one expected red callables pin). Implementer's note: `decide_enrollment` admits any teacher of any run under the course — `_run_for`'s pre-existing gate, shared by every run-scoped callable. Task review dispatched (sonnet).
Task 5: complete (anvil c61b5c6..9665b82, review clean; decide_enrollment traced through five adversarial cases, set_course_access refuses a non-owner teacher). ⚠️ resolved by me: "teacher of the run" is course-wide in `_course_access` (any run's teacher sees every run of the course) — pre-existing teachers-round behaviour, unchanged here.
Task 5: minor (routed to Task 6, which edits dashboard_server.py): `_mail_decision`'s composition (`mail.join_decision`, `_course_link`) sits outside its try, after the row was updated — the same shape Task 4 fixed in `_mail_teachers`.
Task 5: minor (deferred): `list_runs` scans enrolments twice per run; `_course_link` and `_lectures` both search names for the course.
Task 6: dispatched (sonnet — the account home; carries the `_mail_decision` try).
Task 6: implemented (anvil 9665b82..b13805c, pytest 385 exit 0, the callables pin green again). One deviation: the brief's `my_course_html` used single-quoted `href` while the brief's own test expects double quotes — the implementer followed the test. Task review dispatched (sonnet).
Task 6: complete (anvil 9665b82..b13805c, review clean; leave/forget/my_enrollments traced through own row, another account's id, unknown id, deleted run, deleted course — no leak, no cross-account delete).
Task 7: dispatched (sonnet — the link signs up, lands on the server too, sweeps expired once rows).
Task 7: implemented (anvil b13805c..c498e3a, pytest 392 exit 0) — DONE_WITH_CONCERNS: two pre-existing pins re-aimed (the old literal "no account" refusal print, and a "never stamps confirmed_email" pin) because the brief's required code makes their text false; the reviewer is asked whether both kept intent. The README First-time-setup paragraph that says `/login` "just signs in accounts that exist" is Task 8's to retire (its brief rewrites that section). Task review dispatched (opus — signup by link, force_login, the existence oracle).
Task 7: complete (anvil b13805c..c498e3a, review clean; oracle, landing, single use, no confirmed_email stamp, no revived planted row — all traced and holding; one re-aimed pin judged narrowly LOOSENED, the other KEPT INTENT).
Ruling: the two one-line minors are routed into Task 8 as its first commit rather than the final wave — Task 8 is the last commit before the push Hans pulls: (a) `list(...)` around the once-row sweep's search so a delete-while-iterating cannot skip rows; (b) the loosened pin becomes `source.count("confirmed_email=") == source.count("confirmed_email=False")`. Cost if wrong: two lines in Task 8's diff outside its files.
Task 7: minor (deferred, spec §14 names it): passwordless rows whose link was never redeemed are never swept.
Task 8: dispatched (sonnet — the sign-in chooser, Form1's landing, use_email off; carries the two one-liners).
Task 8: implemented (anvil c498e3a..a135117, 2 commits, pytest 394 exit 0). One pre-existing pin re-aimed (`target` → `self.target` in the mint_once call, forced by the brief's own code). Task review dispatched (opus — the sign-in page nobody can run under pytest, and the last commit before the push).
Task 8: complete (anvil c498e3a..a135117, review clean; eleven traces through SignIn and Form1 all terminate right, the mailed link's two landings never loop). The reviewer's list of ELEVEN Anvil-runtime assumptions only the pull can test is copied into Task 12's smoke; the one to watch first: `anvil.users.force_login` on a passwordless row with `confirmed_email=False` under `confirm_email: true`.
Task 8: minors routed to the final wave: the cancelled-popup None branch says nothing (comment says it does); a duplicated `login_with_form` assert; the session-gate ordering pin finds the first `open_form("SignIn")` only; README step 2 packs four actions into one paragraph (split into steps). Deferred: `redeem_here` unguarded at form load (file style); `replaceState` erases the query too; the template-binding pin scans SignIn only.

ANVIL SIDE OF ROUND 1b COMPLETE: Tasks 1–8, e98cbb1..a135117 (11 commits), pytest 394 exit 0 (re-verified by the controller). Held at the push.
Final whole-branch reviews dispatched (fable, both): drawcast 0650fbf..f61c563, anvil e98cbb1..a135117. One fix wave follows, then the push is asked of Hans.
FINAL REVIEW, drawcast (fable) — "With fixes": no behavioural defect, no broken invariant, no security hole; every trace holds and the cross-repo bodies satisfy the server's parser (the reviewer grepped api.py's /enroll to check, and said so). ONE Important: the select→`access` mapping in share.ts is guarded only by a type-annotation pin, so a regression to round 0's `: "enrolled"` fallback would pass every test and reinstate the bug this round removes — a defect in MY Task 11 pin. Client fix wave (queued until the Anvil review lands): pin `? serverAccess.value : undefined`; pin `app.replaceChildren(deniedDoor(`; spec §5's TABLE cell says `access` defaults to `open` while its prose and the server say `enrolled` — fix the cell; the "for the session" comment becomes "this page load"; the stale `ShareDeps.publishServer` doc line.
  Deferred-minor triage: "two session scopes" MAY WAIT and must NOT be widened (a sessionStorage-scoped stop would silence a learner who joins in another tab); the ShareDeps comment FIX BEFORE MERGE.
  Noted for later rounds: `firstOpenInSession` marks before the send's outcome is known (round 1a, GitHub casts with enroll:); the 403 door's heading is the slug, not the course title (the 403 body carries none — round 3); `page:` in the door is a drawcast.app literal a self-hosted viewer contradicts (harmless: the server ignores it for anvil/ courses); "author key" survives in a comment at store.ts:308, pre-existing — the pin covers running code, not comments.
  Smoke addition for Task 12: refused on `opened` in tab A, join in tab B, answer in tab A — dropped by design until A reloads; write it down so nobody files it as a bug.
Final fix wave, drawcast: implemented (f61c563..f438ad0, one commit; vitest 4632, tsc clean). Both new pins MUTATION-TESTED by the implementer — each regression fails its file — and restored clean. Scoped re-review dispatched (sonnet).
Final fix wave, drawcast: re-review PASS — all five addressed, no new breakage; the two negative pins verified non-vacuous (no other `: "enrolled";` in share.ts; the only other `status.replaceWith(` is courseDoor's, outside the sliced handler). Cosmetic: the spec table's row-2 default cell is bold where rows 3/4 use a code span. CLIENT SIDE MERGE-READY at f438ad0, pending the Anvil review and Hans's smoke.
FINAL REVIEW, anvil (fable) — "With fixes": nothing raises, widens a door or breaks a round-0/1a invariant; the gate and sign-in traces terminate right; every cross-task seam clean; all sixteen callables slice whole under the CALLABLES regex. FIVE Important, three of them defects in MY plan:
  I1 `_course_link` returns the app root for every SERVER course — a course-kind name can never point at anvil/, and /enroll never writes page_url — so the approval mail's "Start here" and the account home's link point nowhere for exactly the courses this round is about. Ruling: for an `anvil/` key prefer a CAST-kind name whose target starts with `<slug>/` (round 0's `#navn`), else the first casts row under the slug as `https://drawcast.app/#anvil=<slug>/<file>`, else the root. Cost if wrong: a wrong link in a mail, visible on the first smoke.
  I2 on a fresh server course the owner cannot set approval before the first learner: the runs row is created by the first /enroll, `join="anyone"`, and `new_run` has no caller. Ruling: `_claim_course_in_tx`'s CREATE branch also adds the default run (slug default, default True, open True, join anyone, drip none, teachers []) in the same transaction — `_run_row` then finds it; a GitHub course claimed through /course or /name gets one too, harmlessly. Cost if wrong: one extra run row per claimed course.
  I3 the users-row get-then-create in send_sign_in_link runs outside any transaction: two first requests for one unknown address (a double click; five per hour per address allows it) both insert, and Anvil's own users service `.get(email=)` then raises on that address's social sign-in until Hans dedupes — an attacker can do it to any unregistered address. My plan broke its own Global Constraint. Ruling: the create moves to rows.py as a transactional `user_for_link(email, now)` with the lookup inside, plus a deterministic post-create dedupe (a scan matching nothing does not conflict, so both may insert; the row with the smallest id wins and the other task deletes its own). api.py keeps no users scan (pin). Cost if wrong: one more function in rows.py.
  I4 `redeem_here` silently overwrites a live session of a DIFFERENT user, and Form1 never says who is signed in — login-CSRF by a forwarded `#t=` link: a teacher lands as the attacker and publishes for them. Ruling: `redeem_here` refuses (False) when a different enabled user is already signed in, Form1 says "log out first"; Form1's title shows the signed-in address. The drawcast-side analogue (`redeemFromAddress` overwrites `drawcast.token`) is NOTED FOR ROUND 2, not this wave. Cost if wrong: a teacher who is signed in as A and opens a link for B must log out first — the honest cost.
  I5 README not sufficient for the pull: name the columns this pull adds/drops; say how HANS'S OWN row signs in (a password-era row: the link only if confirmed_email is ticked, else Google); the smoke's `/login nobody@example.org` now CREATES a row; the NOTE FOR HANS goes beside the pull paragraph; line 6 names the 1a plan.
  Also FIX BEFORE PUSH from the triage: SignIn's cancelled-popup None branch says nothing; README step 2 split into steps.
  Plan-level notes for round 2, not this wave: leave_course on a rejected row deletes it, so leave+rejoin is a fresh pending (a conscious act, bounded by the budget — kept); a decline cannot be reversed from the UI; `_lectures` never consults casts, so a server course's axis is events-driven until round 3.
  Minor pins (deferred unless the fixer is already in the file): the create pin slices to `)` and misses a trailing kwarg; the confirmed_email pin misses item-assignment; the sweep pin does not pin the `not`; the shadowing pin's name set.
Final fix wave, anvil: ONE fixer dispatched (opus — I3 is a transaction design, I1 a prefix search).
Final fix wave, anvil: implemented (a135117..8299fc8, one commit; pytest 400 exit 0, six new pins, three MUTATION-TESTED and each failed its own pin). Two departures beyond the list, both accepted: one more pre-existing pin re-aimed (`_user_by_email(email)` → `user_for_link(email, utcnow())` in the proven-address test — its own count assertion is now vacuous, and Item 7's item-assignment pin carries the weight); one README clause added so `request_link`'s paragraph does not claim `redeem_here` always opens a session. `_user_by_email` stays imported-but-uncalled in api.py for a pin (`# noqa`). Scoped re-review dispatched (opus — a transaction and a session guard, on the branch Hans pulls).
Final fix wave, anvil: re-review PASS — all seven addressed, both departures justified, no new Critical/Important; (a)–(f) each checked: no double delete, no winner deleted, the run row is `_run_row`'s exact shape and found by its default=True lookup, the token is spent before the different-user check, `tq` imported and `min` guarded, no shadowing, no truncated callable. Reviewer re-ran the suite: 400 pass, exit 0.
Ruling (residual, parked — no second wave): `user_for_link`'s post-create dedupe is lexicographic on `get_id()` strings and non-transactional, so a scan that lands between two inserts can still leave a pair, and with three or more simultaneous first requests for ONE address a task can mint against a row its holder then deletes (the redeem then just fails; ask for a new link). Strictly narrower than the bug it replaces (every concurrent pair duplicated), bounded by 5/h/address, and closable only with a unique constraint Anvil does not offer. Its docstring says "the second row must go", which is stronger than the code guarantees — one line for round 2. Cost if wrong: a rare duplicate users row, repaired in Data Tables.
Noted for round 2: the client-side analogue of I4 — `redeemFromAddress` overwrites `drawcast.token` on any `t=` link, so a forwarded link signs a drawcast.app browser into the sender's account; the fix is to refuse when a live token exists and say "sign out first".

ANVIL SIDE READY TO PUSH: e98cbb1..8299fc8 (12 commits), pytest 400 exit 0. Held for Hans's go — the branch the live app pulls from.

Ruling: the final whole-branch review is split by repository and the client half runs NOW, in parallel with Task 8's review — the client side has been complete since Task 11 and its reviewer is read-only in a different repository; the Anvil half follows Task 8. One fix wave covers both halves. Cost if wrong: two final reviewers instead of one, each seeing one repo — the cross-repo seams (the body shapes, the status words) are named in each dispatch so neither reviewer is blind to the other side.

CLIENT SIDE OF ROUND 1b COMPLETE: Tasks 9, 10, 11 — drawcast 0650fbf..f61c563, vitest 4632, tsc clean. Nothing here depends on the Anvil pull except the smoke.

PUSHED to drawcast-anvil origin/master: e98cbb1..8299fc8 (12 commits), on Hans's "push" 2026-09-06. Verified origin/master == 8299fc8. Hans pulls in the Anvil editor with "source code"; Task 12 (the smoke) follows the pull.

## Addendum 1b+ — passwords for proven accounts (Hans, 2026-09-06: "ja")

Hans asked why not email+password via Anvil. Answer given: Anvil's password login and its self-service signup are one switch, and open signup is what lets a stranger plant a row under a victim's address with a password of their own. Chosen design (Hans: ja): `use_email: true` + `allow_signup: false` — no self-service password signup exists, every new account is created by the link (proven), Google/Microsoft/Facebook sign in only rows that exist, and a password is set through Anvil's reset mail (an address proof). A spent link now stamps `confirmed_email` on a PASSWORDLESS row — the click is the proof and there is no password to unlock; round 1a's rule stands for rows that carry one. Pull ritual: Hans must NOT flip the flags in the editor (an "Edited settings" commit would collide); the repo sets them.
Addendum: dispatched (sonnet implementer; opus review — the sign-in surface).
Addendum: implemented (anvil 8299fc8..5e0719c, pytest 401 exit 0, two mutation checks). Review (opus): READY TO PUSH — no path to a password on an address someone does not own, no existence oracle, the stamp gated by `not password_hash` and placed after the different-user guard on both redeem paths. Two Important doc-precision findings + one Minor sent as a fix round: `_prove_address` also runs for `mint_once` tokens (safe, but the docstring must say so — the docstring IS the security argument here); `mail_sign_in_refusal`'s premise now belongs in the past tense; `_password` lacked an else branch. Runtime assumptions only the pull can test: `send_password_reset_email` server-side and what it raises for an unknown address; `login_with_email` refused on an unconfirmed row under confirm_email; `allow_signup: false` refusing an unknown address on social login rather than creating a row; no MFA configured.
