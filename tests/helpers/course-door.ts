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
export function hasDoor(html: string): boolean {
  return /class="door"/.test(html) || /href="[^"]*\/#[a-z0-9-]+(?:\/\d+)?"/.test(html);
}
