// The one link on a published course page that is the DOOR (src/course/page.ts):
// `<a class="door" href="…/#<name>">`, carrying the course's registered name.
//
// A course page is full of links into the app — every lecture points at
// `…/#gh=…`, and that is the page doing its job — so "no href into the app"
// forbids the page's own contents, not the door (it did, once: fix round 3 of
// the identity round, four assertions across two files). Look for the door
// itself: its class, or an href ending in a bare, name-shaped `#<name>` with
// no `=` in it — the shape names.ts reads.
//
// Pair every `hasDoor(page) === false` with a `hasDoor(withDoor) === true` on
// a page that has one, so a detector that has gone blind cannot pass.
//
// The door's own href ends `&join` (Task 8: courseHref appends it, so the
// link opens straight to the join step rather than bouncing back to this
// very page — see runNamed's page redirect, src/viewer.ts) — the fallback
// shape below allows that optional suffix too.
export function hasDoor(html: string): boolean {
  return /class="door"/.test(html) || /href="[^"]*\/#[a-z0-9-]+(?:\/\d+)?(?:&join)?"/.test(html);
}
