import { describe, expect, test } from "vitest";
import bodiesJson from "../src/scenes/space/bodies.json";
import type { BodiesTable } from "../src/scenes/space/types";
import { indexBodies } from "../src/scenes/space/rules";
import {
  DATE_CHOICES, NAME_CHOICES, ROOT_LABEL, SCALE_CHOICES, bodyLabel, bodyOfElement, breadcrumbFor, cardFacts, dateChoiceIso, focusTargetFor, isoDate,
  phaseLine, positionNote, readWikiSummary, wikiSummaryUrl,
} from "../src/ui/space-model";

const bodies = indexBodies(bodiesJson as unknown as BodiesTable);
/** The pack writes U+202F between thousands; compare with plain spaces. */
const plain = (s: string): string => s.replace(new RegExp("\\u202f", "g"), " ");
const fact = (id: string, lang: "en" | "nb", label: string): string => plain(cardFacts(bodies[id], bodies, lang).find((f) => plain(f.label) === label)!.value);

describe("focusTargetFor", () => {
  test("a body, its orbit or its name focuses that body", () => {
    expect(focusTargetFor(bodies, "mars", null)).toBe("mars");
    expect(focusTargetFor(bodies, "orbit_mars", null)).toBe("mars");
    expect(focusTargetFor(bodies, "label_io", "jupiter")).toBe("io");
    expect(bodyOfElement(bodies, "label_ganymede")).toBe("ganymede");
  });
  test("the Sun is the way out; the current focus, the notes and unknown ids change nothing", () => {
    expect(focusTargetFor(bodies, "sun", null)).toBeNull();
    expect(focusTargetFor(bodies, "sun", "jupiter")).toBeNull();
    expect(focusTargetFor(bodies, "label_sun", "io")).toBeNull();
    expect(focusTargetFor(bodies, "jupiter", "jupiter")).toBe("jupiter");
    expect(focusTargetFor(bodies, "scale_note", "jupiter")).toBe("jupiter");
    expect(focusTargetFor(bodies, "frame", "jupiter")).toBe("jupiter");
    expect(focusTargetFor(bodies, "axis", null)).toBeNull();
    expect(focusTargetFor(bodies, "nope", "mars")).toBe("mars");
    expect(bodyOfElement(bodies, "scale_bar")).toBeNull();
  });
});

describe("breadcrumbFor", () => {
  test("is the parent chain, root first, with the Sun left to the root crumb", () => {
    expect(breadcrumbFor(bodies, null)).toEqual([]);
    expect(breadcrumbFor(bodies, "jupiter")).toEqual(["jupiter"]);
    expect(breadcrumbFor(bodies, "io")).toEqual(["jupiter", "io"]);
    expect(breadcrumbFor(bodies, "moon")).toEqual(["earth", "moon"]);
    expect(breadcrumbFor(bodies, "charon")).toEqual(["pluto", "charon"]);
    expect(breadcrumbFor(bodies, "sun")).toEqual(["sun"]);
    expect(breadcrumbFor(bodies, "nope")).toEqual([]);
    expect(ROOT_LABEL.nb).toBe("Solsystemet");
  });
});

describe("labels and choices", () => {
  test("bodyLabel speaks the language and falls back to the id", () => {
    expect(bodyLabel(bodies, "earth", "nb")).toBe("Jorden");
    expect(bodyLabel(bodies, "earth", "en")).toBe("Earth");
    expect(bodyLabel(bodies, "nope", "nb")).toBe("nope");
  });
  test("the pills offer the four scales, three name settings and three dates", () => {
    expect(SCALE_CHOICES.map((c) => c.value)).toEqual(["schematic", "sizes", "distances", "log"]);
    expect(NAME_CHOICES.map((c) => c.value)).toEqual(["en", "nb", "none"]);
    expect(DATE_CHOICES.map((c) => c.value)).toEqual([0, -365, 365]);
    expect(DATE_CHOICES[0].label.nb).toBe("I dag");
  });
});

describe("cardFacts", () => {
  test("Earth, in English", () => {
    expect(fact("earth", "en", "Type")).toBe("Planet");
    expect(fact("earth", "en", "Radius")).toBe("6 371 km");
    expect(fact("earth", "en", "Distance from Sun")).toBe("1.00 AU (149.6 million km)");
    expect(fact("earth", "en", "Orbital period")).toBe("365 days");
    expect(fact("earth", "en", "Rotation")).toBe("23.9 h");
    expect(fact("earth", "en", "Axial tilt")).toBe("23.4°");
    expect(fact("earth", "en", "Mass")).toBe("5.97 × 10^24 kg");
  });
  test("years for long periods, days for rotations, retrograde flagged, unknown tilt a dash", () => {
    expect(fact("jupiter", "en", "Orbital period")).toBe("11.9 years");
    expect(fact("venus", "en", "Rotation")).toBe("243.0 days (retrograde)");
    expect(fact("triton", "en", "Orbital period")).toBe("5.88 days (retrograde)");
    expect(fact("haumea", "en", "Axial tilt")).toBe("—");
  });
  test("Charon is tidally locked in prograde step with its own (prograde) orbit, unlike retrograde Triton", () => {
    expect(fact("charon", "en", "Rotation")).toBe("6.4 days");
  });
  test("the Moon, in Norwegian: a moon of Earth, km not AU, decimal commas", () => {
    expect(fact("moon", "nb", "Type")).toBe("Måne rundt Jorden");
    expect(fact("moon", "nb", "Avstand fra Jorden")).toBe("384 400 km");
    expect(fact("moon", "nb", "Omløpstid")).toBe("27,3 dager");
    expect(fact("moon", "nb", "Rotasjon")).toBe("27,3 dager");
  });
  test("the Sun has no distance or period lines", () => {
    const labels = cardFacts(bodies.sun, bodies, "en").map((f) => f.label);
    expect(labels).toEqual(["Type", "Radius", "Rotation", "Axial tilt", "Mass"]);
    expect(fact("sun", "en", "Type")).toBe("Star");
  });
});

describe("notes, phase, Wikipedia", () => {
  test("a schematic position says so; an ephemeris does not", () => {
    expect(positionNote(true, "en")).toBe("Position schematic — a circular orbit, not an ephemeris.");
    expect(positionNote(true, "nb")).toBe("Posisjonen er skjematisk — en sirkelbane, ikke en efemeride.");
    expect(positionNote(false, "en")).toBeNull();
  });
  test("the phase line rounds the lit fraction", () => {
    const p = { fraction: 0.724, waxing: true, angle: 120, name: "waxing gibbous", name_nb: "voksende måne" };
    expect(phaseLine(p, "en")).toBe("Phase: waxing gibbous, 72 % lit");
    expect(phaseLine(p, "nb")).toBe("Fase: voksende måne, 72 % opplyst");
  });
  test("the summary URL goes to no. for Norwegian, en. otherwise, with the title URL-encoded", () => {
    expect(wikiSummaryUrl("nb", "Io (måne)")).toBe("https://no.wikipedia.org/api/rest_v1/page/summary/Io_(m%C3%A5ne)");
    expect(wikiSummaryUrl("en", "Mercury (planet)")).toBe("https://en.wikipedia.org/api/rest_v1/page/summary/Mercury_(planet)");
  });
  test("readWikiSummary keeps the extract, thumbnail and page link, and rejects a page without an extract", () => {
    const full = { title: "Io (moon)", extract: "Io is the innermost…", thumbnail: { source: "https://upload.wikimedia.org/x.jpg" }, content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Io_(moon)" } } };
    expect(readWikiSummary(full)).toEqual({ title: "Io (moon)", extract: "Io is the innermost…", thumb: "https://upload.wikimedia.org/x.jpg", page: "https://en.wikipedia.org/wiki/Io_(moon)" });
    expect(readWikiSummary({ title: "Io (moon)", extract: " Io. " })).toEqual({ title: "Io (moon)", extract: "Io.", thumb: null, page: null });
    expect(readWikiSummary({ title: "Nope", type: "https://mediawiki.org/wiki/HyperSwitch/errors/not_found" })).toBeNull();
    expect(readWikiSummary(null)).toBeNull();
  });
  test("isoDate is the UTC day", () => {
    expect(isoDate(new Date(Date.UTC(2026, 8, 6, 23, 59)))).toBe("2026-09-06");
  });
  test("dateChoiceIso is the UTC day offset from now, injectable for a deterministic test", () => {
    const now = new Date(Date.UTC(2026, 8, 6, 12, 0));
    expect(dateChoiceIso(0, now)).toBe("2026-09-06");
    expect(dateChoiceIso(-365, now)).toBe("2025-09-06");
    expect(dateChoiceIso(365, now)).toBe("2027-09-06");
  });
});
