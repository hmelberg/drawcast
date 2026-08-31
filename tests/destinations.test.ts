// Pins WHICH Open/Save destinations a credential state offers and in what
// order — the part of the "menus must reflect Settings changed mid-session"
// fix (Task 7 fix round 1) that is expressible purely. The actual DOM rebuild
// that applies this lives in main.ts and is not unit-testable here.
import { describe, expect, it } from "vitest";
import { openDestinations, saveDestinations, type CredentialState } from "../src/ui/destinations";

const none: CredentialState = { drivePicker: false, driveSave: false, github: false };
const all: CredentialState = { drivePicker: true, driveSave: true, github: true };

describe("openDestinations", () => {
  it("offers only disk with no credentials", () => {
    expect(openDestinations(none)).toEqual(["From disk…"]);
  });
  it("adds GitHub once the repo AND token are both configured", () => {
    expect(openDestinations({ ...none, github: true })).toEqual(["From disk…", "From GitHub…"]);
  });
  it("adds Drive once the picker key is configured", () => {
    expect(openDestinations({ ...none, drivePicker: true })).toEqual(["From disk…", "From Google Drive…"]);
  });
  it("offers every destination once every credential is present, disk first", () => {
    expect(openDestinations(all)).toEqual(["From disk…", "From Google Drive…", "From GitHub…"]);
  });
});

describe("saveDestinations", () => {
  it("offers only disk with no credentials", () => {
    expect(saveDestinations(none)).toEqual(["To disk…"]);
  });
  it("adds GitHub once the repo AND token are both configured", () => {
    expect(saveDestinations({ ...none, github: true })).toEqual(["To disk…", "To GitHub…"]);
  });
  it("adds Drive once the client id is configured (Save needs no picker key)", () => {
    expect(saveDestinations({ ...none, driveSave: true })).toEqual(["To disk…", "To Google Drive…"]);
  });
  it("offers every destination once every credential is present, disk first", () => {
    expect(saveDestinations(all)).toEqual(["To disk…", "To Google Drive…", "To GitHub…"]);
  });
});
