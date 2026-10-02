# Private → public — design

2026-10-03. Status: spec, not built. Repos: `drawcast` (app, `scripts/cast.mjs`) and `drawcast-anvil` (server).

## 1. What this is for

An owner can make a private course or cast public again, for free. Afterwards it behaves like any public item: lectures in plain text, a link-card picture next to each one, its own card on `drawcast.app/c/<name>`, and no key needed to watch it.

The registry spec (`2026-09-29-registry-private-names-design.md`, "Changing switches later") already promises "private → public: free". Nothing implements it. The first real use is the test course `understanding-the-qaly` (name `skill-publish-test`) in `hmelberg/drawcast-skill-test`.

## 2. What exists today

- **Anvil cannot turn private off.** `_apply_private` (`server_code/api.py` ~1743) sets `courses.private=True` and `access="enrolled"`, mints `item_key` if empty, and sets every run's `join="approval"`. Nothing ever sets `private` back to False. `/register` writes `private=False` only for a new row. `/register/pay` with `private:false` answers 409 `nothing-due` and writes nothing. `set_run` (`dashboard_server.py` ~366) refuses `join="anyone"` while the course is private.
- **The app's "Make public" is half-built.** Unticking Private on a server-private item (`src/ui/share.ts` ~1153) asks "Make public: the next publish will be readable by anyone" and then publishes plain files: a cast in `src/main.ts`, a course in `src/ui/course.ts` (which removes `private:` from course.md). The server flag stays true, so the next quote or probe ticks Private again.
- **`cast.mjs push` re-locks.** When signed in it quotes the server, and a server `private: true` overrides `origin.private=false` (~1134–1157). A private push rewrites course.md with `private: true` and the Join door (`privateCourseText`). There is no un-private command.
- **What private changes in the files:**
  - course.md carries `private: true` and `enroll:` (the Join door).
  - Every lecture or cast file is an envelope starting `drawcast-encrypted: 1`.
  - There is no `<file>.png`; private publishes delete them.
  - `cast.mjs pull` already unlocks with the owner's key (`/key`) into plain YAML, and records `origin.private = true`.
- **Learners.** Course enrolments hang off the course folder key either way, so they survive a flip. A **single private cast** is its own enrolment unit (`_course_key_of_cast`, api.py ~1292: the cast's item key, only while the row is private). Once public, its events map to the folder, so enrolments under the cast's key would silently stop recording progress.

## 3. Rules

1. **Free and owner-only.**
2. **Keep what was paid for.** `item_key`, `paid_lectures` and `listed` are kept, so going private again pays only for new lectures (the registry spec's rule). Each run's `join` is kept too. The owner can now set "anyone" in the dashboard, because the course is no longer private.
3. **A cast with learners refuses.** If any **active or pending** enrolment exists in a run of a private **cast**'s own row, the switch is refused: `"N learners are enrolled in this cast; making it public would stop recording their progress."` Courses have no such limit.
4. **Files first, flag last.** The plain-text files go to GitHub before the server flag changes.
   - If the flag flipped first and the publish then failed, the lectures would still be encrypted while `/key` answered `not-private`, and nobody could watch.
   - In this order, the worst case is a public course whose server flag lags until a retry. The retry is printed or shown.
5. **The Join door stays.** `enroll:` is kept in course.md, so learners can still join to have their progress tracked. Only `private: true` is removed.
6. **GitHub-hosted items only.** Private items can't be published to the drawcast server today (`PRIVATE_ELSEWHERE`), so there is nothing to switch there.

## 4. Anvil: `POST /_/api/register/public`

Next to `/register/listing`, and shaped like it.

```
POST /_/api/register/public
{ "key": <session key>, "item": <registry item key>, "dry": true|false }
```

- **Rate:** `_allowed("quote")`, else 429 `{error:"rate"}`.
- **Request parsing:** `rq.parse_register_public` gives `{key, item, dry}`. `item` is a non-empty string and `dry` a boolean defaulting to false; anything else is 400.
- **Session:** `_author(key)`, else 401 `{error:"key"}`.
- **Ownership:** the row is `courses.search(key=item)`. If it is missing or not owned by the caller: 403 `{error:"owner"}`.
- **Already public:** if `row["private"]` is false, answer 200 `{private:false, changed:false}` and write nothing. This makes retries safe.
- **Cast with learners:** if `row["kind"] == "cast"`, count the enrolments with `state in ("active","pending")` in runs whose `course == row`. If the count is above 0: 409 `{error:"enrolled", count}`. Write nothing.
- **Dry:** if `dry` is true, answer 200 `{private:true, ok:true}` and write nothing.
- **Otherwise:** `row.update(private=False, access="open")` and answer 200 `{private:false, changed:true}`. `item_key`, `paid_lectures`, `listed` and the runs are untouched.

`_course_key_of_cast` needs no change: it already keys a cast by its folder once the row is not private.

The tests live in `drawcast-anvil/tests/`, in the style already used for `/register/listing` (source-shape tests in `test_api_source.py`, behaviour through the request parsers in `test_parsers.py`). They cover:
- owner versus non-owner;
- a missing row;
- already public (no write);
- a cast with one active enrolment (409), and with only rejected ones (allowed);
- a course with enrolments (allowed);
- `dry` (no write);
- the success write (only `private` and `access` change).

## 5. App: `src/registry.ts`

```ts
export type MakePublicOutcome =
  | { ok: true; changed: boolean }            // done, or already public
  | { ok: false; reason: "enrolled"; count: number }
  | { ok: false; reason: "owner" | "key" | "rate" | "network" | "server" };
export async function makePublic(api: string, key: string, item: string, dry: boolean, fetchImpl?: typeof fetch): Promise<MakePublicOutcome>;
```

Shaped like `setListing`. `item` is the same registry item key the private quote uses (`privateCastTarget(...).item` for a cast, the course key for a course).

## 6. App: "Make public" finished

The confirmation the Share panel already shows stays. The publish around it changes, for casts (`src/main.ts`, GitHub publish) and courses (`src/ui/course.ts`):

1. **Before anything is written:** `makePublic(..., dry: true)`.
   - `enrolled` → stop with the rule-3 message (Private stays ticked).
   - `owner`, `key`, `rate`, `network` or `server` → stop with a short message.
2. **Publish as today's public path does.** The files are plain and have pictures, and course.md drops `private: true` but keeps `enroll:`.
3. **After the commit:** `makePublic(..., dry: false)`.
   - On success, the document's `private` is false and its library row is cleared.
   - On failure, the files are already public. The status line says so and offers **"Finish making it public"**, which retries step 3 only.
4. **Stop the re-ticking.** The probe that re-ticks Private (`probeServerPrivate`, `inPrivateCourse`) now sees the server's `private:false` and leaves it unticked. No other change is needed there.

## 7. `cast.mjs public <workdir> [--direct]`

```
node scripts/cast.mjs public <workdir> --direct
```

- **Workdir:** a `pull`ed workdir, which is plain YAML already, with `origin.private` true. If `origin.private` is false: "Already public."
- **Session:** signed in as the owner, else "Sign in (cast.mjs login) as its owner."
- **`--direct` is required.** A pull request would leave the encrypted files live until it is merged, so the flag must not flip before then. Without `--direct` the command stops: "Making it public publishes directly to <branch>; run again with --direct."

Steps:

1. `makePublic(dry: true)`. On `enrolled`, stop with the rule-3 message. Other failures stop with their message.
2. Mark the workdir going public: `origin.private = false` and `origin.goingPublic = true`, written to `origin.json`.
   - While `goingPublic` is set, `push` does not let the server quote's `private:true` turn `origin.private` back on.
   - It removes `private: true` from course.md (keeping `enroll:`).
   - Everything else is an ordinary public push, which draws and commits the pictures (delivery 3).
3. `push <workdir> --direct`.
4. `makePublic(dry: false)`.
   - On success, delete `origin.goingPublic` and print "Public: <link>".
   - On failure, keep `goingPublic` and print "The files are public; the server still says private. Run `cast.mjs public <workdir> --direct` again to finish." Re-running skips the push when nothing differs and only finishes step 4.

`cast.mjs pull` of an item the server already reports as public leaves `origin.private` false, as today.

## 8. Testing

- **Anvil:** the cases in §4.
- **`src/registry.ts`:** `makePublic` maps each server answer (200 changed or unchanged, 409 enrolled, 403, 401, 429, a network failure, 5xx) to its outcome. The test uses an injected fetch, like the existing `setListing` tests.
- **`cast.mjs`:** pure helpers carry the decisions, each tested in `tests/cast-account.test.ts` or `tests/cast-github.test.ts`:
  - `goingPublicCourseText(text)` removes `private:` and keeps `enroll:`;
  - `serverPrivateWins(origin, quote)` is false while `goingPublic`;
  - `publicPreflight(origin, args)` checks the direct, signed-in and already-public cases.
- **App:** the Share and course publish wiring is checked by eye, as the Share panel's other publish paths are.
- **Live, with the user's go-ahead**, on `understanding-the-qaly`:
  1. pull it;
  2. run `public --direct`;
  3. its lectures on GitHub are plain YAML, each with a `.png`;
  4. course.md has no `private:` line;
  5. `drawcast.app/c/skill-publish-test` shows the course title and its first lecture's picture;
  6. a second `public` run says "Already public."

## 9. Order of work

1. **Anvil endpoint and tests** (drawcast-anvil). Push it to Anvil before the app side can be checked live.
2. **`makePublic` in `src/registry.ts`.**
3. **`cast.mjs public`**, with its helpers and their tests.
4. **The app's "Make public" wiring** (casts and courses).
5. **The live switch of `understanding-the-qaly`**, with the user's go-ahead.

## 10. Not in this version

- Moving a private cast's learners to its folder key, so a cast with enrolments could go public.
- Casts on the drawcast server.
- Public → private, which already exists and is paid.
- Re-keying or clearing `item_key` on going public. Keeping it is what makes going private again free for paid lectures.
