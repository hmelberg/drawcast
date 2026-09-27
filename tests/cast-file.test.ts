import { describe, expect, test } from "vitest";
import { unwrapCastText } from "../src/playlist/cast-file";
import { itemsOf, parsePlaylistText } from "../src/playlist/playlist";
import examples from "../src/examples.json";

type Entry = { request: string; title?: string; spec?: Record<string, unknown>; playlist?: string };
const all = examples as Entry[];
const specEntry = all.find((e) => e.spec && Array.isArray(e.spec.commands) && (e.spec.commands as unknown[]).length > 0)!;
const playlistEntry = all.find((e) => typeof e.playlist === "string")!;

/** What `?open=` does with a file's text: unwrap, then the app's own reader. */
const open = (text: string) => {
  const u = unwrapCastText(text);
  return { title: u.title, items: itemsOf(parsePlaylistText(u.text)) };
};

describe("unwrapCastText (?open= and cast.mjs open)", () => {
  test("a {request, spec} wrapper opens the spec — not a blank page of 0 commands", () => {
    const n = (specEntry.spec!.commands as unknown[]).length;
    const wrapped = open(JSON.stringify({ request: specEntry.request, spec: specEntry.spec }));
    expect(wrapped.items).toHaveLength(1);
    expect(wrapped.items[0]!.spec.commands).toHaveLength(n);
    expect(wrapped.title).toBe(specEntry.request);
    // The bug: the raw wrapper read as a spec plays nothing.
    expect(itemsOf(parsePlaylistText(JSON.stringify({ request: "x", spec: specEntry.spec })))[0]!.spec.commands ?? []).toHaveLength(0);
  });

  test("a bare spec passes through unchanged", () => {
    const text = JSON.stringify(specEntry.spec);
    expect(unwrapCastText(text)).toEqual({ text });
    expect(open(text).items[0]!.spec.commands).toHaveLength((specEntry.spec!.commands as unknown[]).length);
  });

  test("a {request, title, playlist} wrapper opens every part of the playlist", () => {
    const direct = itemsOf(parsePlaylistText(playlistEntry.playlist!));
    const wrapped = open(JSON.stringify({ request: playlistEntry.request, title: "My course", playlist: playlistEntry.playlist }));
    expect(direct.length).toBeGreaterThan(1);
    expect(wrapped.items).toHaveLength(direct.length);
    expect(wrapped.title).toBe("My course");
  });

  test("an array of entries takes the first, as the frames harness does", () => {
    const wrapped = open(JSON.stringify([{ request: "a", spec: specEntry.spec }, { request: "b", spec: {} }]));
    expect(wrapped.title).toBe("a");
    expect(wrapped.items[0]!.spec.commands).toHaveLength((specEntry.spec!.commands as unknown[]).length);
  });

  test("a spec with its own commands is bare, even if it has a `spec` key", () => {
    const text = JSON.stringify({ ...specEntry.spec, spec: { commands: [] } });
    expect(unwrapCastText(text)).toEqual({ text });
  });

  test("playlist YAML and non-JSON text pass through untouched", () => {
    expect(unwrapCastText(playlistEntry.playlist!)).toEqual({ text: playlistEntry.playlist });
    expect(unwrapCastText("title: x\ncommands: []")).toEqual({ text: "title: x\ncommands: []" });
  });
});
