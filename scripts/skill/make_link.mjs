#!/usr/bin/env node
// Print the drawcast.app link that plays a drawcast.
//
//   node make_link.mjs cast.yaml
//   node make_link.mjs < cast.yaml
//   node make_link.mjs --base http://localhost:5199/ cast.yaml   (another player)
//
// The link is https://drawcast.app/#cast=<data>: <data> is the UTF-8 text of
// the YAML, compressed with raw DEFLATE (level 9, no zlib/gzip header) and
// written as base64url without padding. Node's standard library only.
// make_link.py prints the same link for the same file.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const BASE = "https://drawcast.app/";

export function makeLink(data, base = BASE) {
  let bytes = Buffer.from(data);
  // A byte-order mark is not part of the YAML.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  new TextDecoder("utf-8", { fatal: true }).decode(bytes); // fail loudly on text that is not UTF-8
  const raw = deflateRawSync(bytes, { level: 9 });
  return `${base}#cast=${raw.toString("base64url")}`;
}

/** How many `speak:` fields the drawcast has — its spoken lines, near enough. */
export function spokenLines(text) {
  return (text.match(/(?<![\w-])"?speak"?\s*:/g) ?? []).length;
}

function main(argv) {
  const args = [...argv];
  let base = BASE;
  const at = args.indexOf("--base");
  if (at !== -1) {
    base = args[at + 1];
    args.splice(at, 2);
  }
  const data = args[0] && args[0] !== "-" ? readFileSync(args[0]) : readFileSync(0);
  if (!data.toString("utf8").trim()) {
    console.error("make_link: no YAML given (a file name, or the YAML on stdin)");
    process.exit(1);
  }
  const link = makeLink(data, base);
  console.log(link);
  console.error(`${spokenLines(data.toString("utf8"))} spoken lines (the default brief is 14–20; a length the user asked for wins)`);
  if (link.length > 16000) console.error(`note: the link is ${link.length} characters; if the chat cuts it, give the YAML and https://drawcast.app/#paste instead`);
}

// Run as a script (not imported): compare real paths, since /tmp and the like are symlinks on some systems.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) main(process.argv.slice(2));
