// Topics (2026-10-06): drawcast.app/#chess and ?topic=chess.
import { describe, expect, test } from "vitest";
import { hasTopic, topicLabel, topicOf, topicSlug } from "../src/home/model";
import { isReservedName, subjectInHash, SUBJECT_NAMES } from "../src/names";

describe("topics", () => {
  test("a subject word in the hash is its topic; anything else is not", () => {
    expect(subjectInHash("#chess")).toBe("chess");
    expect(subjectInHash("#Economics")).toBe("economics");
    expect(subjectInHash("#chess&mode=x")).toBeNull();
    expect(subjectInHash("#moon")).toBeNull();
    expect(subjectInHash("")).toBeNull();
  });
  test("chess is reserved, as every subject is", () => {
    expect(SUBJECT_NAMES).toContain("chess");
    for (const s of SUBJECT_NAMES) expect(isReservedName(s), s).toBe(true);
  });
  test("tags become link words; aliases lead to one topic", () => {
    expect(topicSlug("History of science")).toBe("history-of-science");
    expect(topicOf("maths")).toBe("mathematics");
    expect(topicOf("Health Economics")).toBe("health-economics");
    expect(hasTopic(["health economics", "x"], "health-economics")).toBe(true);
    expect(hasTopic(["economics"], "health-economics")).toBe(false);
    expect(topicLabel("history-of-science")).toBe("History of science");
  });
});
