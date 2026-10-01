// Copy the bundled books (docs/examples/books/*.yaml) into src/examples.json
// as playlist examples. Idempotent: an entry is found again by its request
// and replaced, so editing a book's YAML and re-running updates the app.
//
//   node scripts/add-book-examples.mjs
//
// A book's request is the YAML's `# request:` comment line (first line), or
// "A book: <playlist title>".
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const DIR = "docs/examples/books";
const FILE = "src/examples.json";
const examples = JSON.parse(readFileSync(FILE, "utf8"));
let added = 0;
let updated = 0;
for (const name of readdirSync(DIR).filter((f) => f.endsWith(".yaml")).sort()) {
  const text = readFileSync(`${DIR}/${name}`, "utf8");
  const fromComment = /^#\s*request:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const title = /^\s+title:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const request = fromComment ?? `A book: ${title ?? name.replace(/\.yaml$/, "")}`;
  // The comment line is the example's metadata, not part of the cast.
  const playlist = text.replace(/^#\s*request:.*\n/m, "");
  const entry = { request, title: `${title ?? request} — a book`, playlist };
  const i = examples.findIndex((e) => e.request === request);
  if (i >= 0) {
    examples[i] = entry;
    updated++;
  } else {
    examples.push(entry);
    added++;
  }
}
writeFileSync(FILE, JSON.stringify(examples, null, 2) + "\n");
console.log(`books: ${added} added, ${updated} updated (${examples.length} examples)`);
