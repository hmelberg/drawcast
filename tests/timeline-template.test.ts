// The timeline template, rewritten 2026-09-29: dates, scales, era bands,
// label lanes with no overlaps, level of detail by priority, and the old
// `milestones` form still drawing with its old ids.
import { describe, expect, test } from "vitest";
import { agoOf, formatAgo, formatDate, fromAxis, parseDate, PRESENT, ticks, toAxis } from "../src/scenes/timeline/dates";
import { eventIds, layoutTimeline, placeLabels, viewOf, type TimelineParams } from "../src/scenes/timeline/layout";
import { flattenDrawables, type Drawable, type TextDrawable } from "../src/layout/model";
import { heuristicMeasure } from "../src/layout/measure";
import { bboxOfText } from "../src/layout/geometry";
import { scenes } from "../src/scenes/registry";

describe("parseDate", () => {
  test("numbers are calendar years; negative is BCE", () => {
    expect(parseDate(1963)).toBe(1963);
    expect(parseDate(-3300)).toBe(-3300);
    expect(parseDate("1963")).toBe(1963);
    expect(parseDate("-3300")).toBe(-3300);
  });
  test("BCE / BC / CE / AD", () => {
    expect(parseDate("3300 BCE")).toBe(-3300);
    expect(parseDate("44 BC")).toBe(-44);
    expect(parseDate("800 CE")).toBe(800);
    expect(parseDate("AD 800")).toBe(800);
    expect(parseDate("c. 1500")).toBe(1500);
  });
  test("deep time: Ga, Ma, ka, years ago, BP count back from the present", () => {
    expect(parseDate("66 Ma")).toBe(PRESENT - 66e6);
    expect(parseDate("4.5 Ga")).toBe(PRESENT - 4.5e9);
    expect(parseDate("10 ka")).toBe(PRESENT - 10000);
    expect(parseDate("12,000 years ago")).toBe(PRESENT - 12000);
    expect(parseDate("300 BP")).toBe(PRESENT - 300);
    expect(parseDate("66 Ma", 1950)).toBe(1950 - 66e6);
  });
  test("months, decades and now", () => {
    expect(parseDate("1969-07-20")).toBeCloseTo(1969 + 6 / 12 + 19 / 365, 6);
    expect(parseDate("1969-07")).toBeCloseTo(1969.5, 6);
    expect(parseDate("Jul 1969")).toBeCloseTo(1969.5, 6);
    expect(parseDate("1960s")).toBe(1965);
    expect(parseDate("now")).toBe(PRESENT);
  });
  test("garbage is null", () => {
    expect(parseDate("soon")).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate(NaN)).toBeNull();
  });
});

describe("scales", () => {
  test("linear is the identity", () => {
    expect(toAxis("linear", 1963)).toBe(1963);
    expect(fromAxis("linear", 1963)).toBe(1963);
  });
  test("log_ago gives every factor of ten the same width, later to the right", () => {
    const u = (s: string) => toAxis("log_ago", parseDate(s)!);
    expect(u("4.5 Ga")).toBeLessThan(u("66 Ma"));
    expect(u("66 Ma")).toBeLessThan(u("10 ka"));
    expect(u("1 Ma") - u("10 Ma")).toBeCloseTo(u("10 ka") - u("100 ka"), 9);
    expect(fromAxis("log_ago", toAxis("log_ago", -66e6))).toBeCloseTo(-66e6, 0);
    // The present is clamped one year back, never at infinity.
    expect(Number.isFinite(toAxis("log_ago", PRESENT))).toBe(true);
    expect(agoOf(PRESENT + 5)).toBe(1);
  });
  test("labels: ages for deep time, years for the recent past", () => {
    expect(formatAgo(4.5e9)).toBe("4.5 Ga");
    expect(formatAgo(66e6)).toBe("66 Ma");
    expect(formatAgo(2.6e6)).toBe("2.6 Ma");
    expect(formatAgo(12000)).toBe("12 ka");
    expect(formatDate("log_ago", PRESENT - 66e6)).toBe("66 Ma");
    expect(formatDate("log_ago", -3300)).toBe("3300 BCE");
    expect(formatDate("linear", 1963)).toBe("1963");
    expect(formatDate("linear", -12000)).toBe("12,000 BCE");
  });
  test("ticks: log ticks at powers of ten over deep time, nice steps on linear", () => {
    const lt = ticks("log_ago", PRESENT - 4.5e9, PRESENT - 1000);
    const labels = lt.map((t) => t.label);
    expect(labels).toContain("1 Ga");
    expect(labels).toContain("1 Ma");
    const li = ticks("linear", 1958, 2002).map((t) => t.year);
    expect(li).toContain(1960);
    expect(li).toContain(2000);
  });
});

// ---------------------------------------------------------------------------

const texts = (ds: Drawable[]): TextDrawable[] => flattenDrawables(ds).filter((d): d is TextDrawable => d.kind === "text");
type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box, pad = 0): boolean => a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad;
const top = (ds: Drawable[], id: string) => ds.find((d) => d.id === id)!;
const kidsOf = (ds: Drawable[], id: string) => flattenDrawables([top(ds, id)]).filter((d) => d.id !== id);

/** Every pair of label texts belonging to different events is apart. */
function labelOverlaps(ds: Drawable[]): string[] {
  const ts = texts(ds).filter((t) => /^event_.*__(label|date|sub)$/.test(t.id) && (t.style.opacity ?? 1) > 0);
  const bad: string[] = [];
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      const ei = ts[i].id.split("__")[0];
      const ej = ts[j].id.split("__")[0];
      if (ei === ej) continue;
      if (overlap(bboxOfText(ts[i], heuristicMeasure), bboxOfText(ts[j], heuristicMeasure), 1)) bad.push(`${ts[i].id} × ${ts[j].id}`);
    }
  }
  return bad;
}

const dense = (n: number): TimelineParams => ({
  title: "Dense",
  events: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, date: 1950 + (i * 50) / n, label: `Event ${i}`, sublabel: "sublabel", priority: 1 + (i % 3) })),
});

describe("layout", () => {
  test("events are placed by date: equal gaps in time are equal gaps on the axis", () => {
    const r = layoutTimeline({ events: [{ date: 1960, label: "A" }, { date: 1970, label: "B" }, { date: 1990, label: "C" }] });
    const x = (i: number) => r.anchors[`event_${i}`][0];
    expect(x(2) - x(1)).toBeCloseTo(2 * (x(1) - x(0)), 6);
  });

  test("stable ids: event_<id> when given, event_<i> otherwise; eras, axis, title", () => {
    expect(eventIds([{ id: "arrow" }, {}, { id: "bad id" }, { id: "arrow" }])).toEqual(["event_arrow", "event_1", "event_2", "event_3"]);
    const r = layoutTimeline({ title: "T", events: [{ id: "arrow", date: 1963, label: "Arrow" }, { date: 1972, label: "Grossman" }], eras: [{ from: 1960, to: 1970, label: "Sixties" }] });
    expect(r.order).toEqual(["title", "axis", "era_0", "event_arrow", "event_1"]);
    expect(r.groups).toEqual({ events: ["event_arrow", "event_1"], eras: ["era_0"] });
  });

  test("a dense decade never overlaps: the rest become dots", () => {
    for (const n of [10, 25, 60]) {
      const r = layoutTimeline(dense(n));
      expect(labelOverlaps(r.drawables)).toEqual([]);
      // Every event still has a part (a dot at least).
      for (let i = 0; i < n; i++) expect(r.order).toContain(`event_e${i}`);
    }
  });

  test("labels stay on the canvas and above the caption band", () => {
    const r = layoutTimeline(dense(40));
    for (const t of texts(r.drawables)) {
      const b = bboxOfText(t, heuristicMeasure);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(1000);
      expect(b.y).toBeGreaterThanOrEqual(40);
      expect(b.y + b.h).toBeLessThanOrEqual(750);
    }
  });

  test("level of detail: priority 1 is labelled first; zooming in labels more", () => {
    const P = dense(40);
    const labelled = (p: TimelineParams) => texts(layoutTimeline(p).drawables).filter((t) => t.id.endsWith("__label")).map((t) => t.id.split("__")[0]);
    const wide = labelled(P);
    const pr1 = (P.events ?? []).filter((e) => e.priority === 1).map((e) => `event_${e.id}`);
    const pr3 = (P.events ?? []).filter((e) => e.priority === 3).map((e) => `event_${e.id}`);
    const shownPr1 = pr1.filter((id) => wide.includes(id)).length / pr1.length;
    const shownPr3 = pr3.filter((id) => wide.includes(id)).length / pr3.length;
    expect(shownPr1).toBeGreaterThan(shownPr3);
    // Zoom into the first decade: every event there gets a label.
    const zoomed = labelled({ ...P, view: { from: 1949, to: 1961 } });
    const inDecade = (P.events ?? []).filter((e) => (e.date as number) < 1960).map((e) => `event_${e.id}`);
    for (const id of inDecade) expect(zoomed).toContain(id);
  });

  test("events outside the view draw nothing but keep their part", () => {
    const r = layoutTimeline({ events: [{ date: 1900, label: "Old" }, { date: 2000, label: "New" }], view: { from: 1990, to: 2010 } });
    expect(kidsOf(r.drawables, "event_0")).toEqual([]);
    expect(kidsOf(r.drawables, "event_1").length).toBeGreaterThan(0);
  });

  test("placeLabels: the most important label wins the lowest lane", () => {
    const items = [
      { key: "a", x: 500, w: 200, h: 40, rank: 3, emph: false, index: 0 },
      { key: "b", x: 510, w: 200, h: 40, rank: 1, emph: false, index: 1 },
    ];
    const p = placeLabels(items, 300, 60, 3, "flag");
    expect(p.get("b")!.lane).toBe(0);
    const a = p.get("a")!;
    const b = p.get("b")!;
    expect(a.lane > 0 || a.x1 + 18 <= b.x0 || b.x1 + 18 <= a.x0).toBe(true);
  });

  test("log_ago: deep time from 4.5 Ga to now spreads the eons and the last ten thousand years", () => {
    const r = layoutTimeline({
      scale: "log_ago",
      events: [{ date: "4.5 Ga", label: "Earth" }, { date: "66 Ma", label: "Dinosaurs end" }, { date: "300 ka", label: "Homo sapiens" }, { date: "3300 BCE", label: "Writing" }],
      eras: [{ from: "4.5 Ga", to: "2.5 Ga", label: "Archean" }, { from: "541 Ma", to: "now", label: "Phanerozoic" }, { from: "66 Ma", to: "now", label: "Cenozoic", level: 1 }],
    });
    const x = (i: number) => r.anchors[`event_${i}`][0];
    expect(x(0)).toBeLessThan(x(1));
    expect(x(2) - x(1)).toBeGreaterThan(100);
    expect(x(3) - x(2)).toBeGreaterThan(100);
    expect(labelOverlaps(r.drawables)).toEqual([]);
  });

  test("era labels fit, are shortened, or are left out", () => {
    const r = layoutTimeline({ events: [{ date: 1900, label: "x" }], eras: [{ from: 1000, to: 2000, label: "A very long era name indeed" }, { from: 1000, to: 1003, label: "Tiny" }], view: { from: 1000, to: 2000 } });
    const t0 = texts(kidsOf(r.drawables, "era_0"));
    expect(t0.length).toBe(1);
    const t1 = texts(kidsOf(r.drawables, "era_1"));
    expect(t1.length).toBe(0);
  });

  test("view defaults to everything; strings are read", () => {
    const P: TimelineParams = { events: [{ date: 1960, label: "a" }, { date: 2000, label: "b" }] };
    const [a, b] = viewOf(P);
    expect(a).toBeLessThan(1960);
    expect(b).toBeGreaterThan(2000);
    expect(viewOf({ ...P, view: { from: "1970", to: 1980 } })).toEqual([1970, 1980]);
  });

  test("pictures: a resolved photo draws a framed thumbnail beside the label", () => {
    const photo = "img1:" + "Ah" + ":data:image/jpeg;base64,AAAA";
    const r = layoutTimeline({ events: [{ date: 1963, label: "Arrow", portrait: "Kenneth Arrow", strokes: photo }] });
    const kids = kidsOf(r.drawables, "event_0");
    expect(kids.some((d) => d.kind === "image")).toBe(true);
    expect(kids.some((d) => d.id === "event_0__frame")).toBe(true);
  });
});

describe("the old milestones form", () => {
  test("keeps its ids and evenly spaced dots", () => {
    const r = layoutTimeline({ milestones: [{ label: "A" }, { label: "B" }, { label: "C" }] });
    const xs = [0, 1, 2].map((i) => r.anchors[`dot_${i}`][0]);
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1], 6);
    expect(r.order).toEqual(["line", "dot_0", "label_0", "dot_1", "label_1", "dot_2", "label_2"]);
  });
  test("the QALY course's five milestones draw without overlaps", () => {
    const r = layoutTimeline({
      milestones: [
        { label: "1968", sublabel: "Klarman" },
        { label: "1970", sublabel: "Fanshel & Bush" },
        { label: "1976", sublabel: "the name", emphasize: true },
        { label: "1985", sublabel: "Williams" },
        { label: "1999", sublabel: "NICE" },
      ],
    });
    const ts = texts(r.drawables);
    for (let i = 0; i < ts.length; i++)
      for (let j = i + 1; j < ts.length; j++) {
        if (ts[i].id.split("__")[0] === ts[j].id.split("__")[0]) continue;
        expect(overlap(bboxOfText(ts[i], heuristicMeasure), bboxOfText(ts[j], heuristicMeasure))).toBe(false);
      }
  });
  test("eight long milestones all get labels", () => {
    const r = layoutTimeline({ milestones: Array.from({ length: 8 }, (_, i) => ({ label: `Milestone number ${i}` })) });
    for (let i = 0; i < 8; i++) expect(texts(kidsOf(r.drawables, `label_${i}`)).length).toBeGreaterThan(0);
  });
});

describe("the machinery around the template", () => {
  test("a date inside a year is written as that year", () => {
    expect(formatDate("linear", 1972.6)).toBe("1972");
  });
  test("log tween: equal factors of years-ago per step", async () => {
    const { tweenValue } = await import("../src/render/tween-space");
    const sp = { kind: "log" as const, origin: 2000, sign: -1 as const };
    const mid = tweenValue(2000 - 1e9, 2000 - 1e3, 0.5, sp);
    expect((2000 - mid) / 1e6).toBeCloseTo(1, 6);
    expect(tweenValue(0, 10, 0.5, null)).toBe(5);
    expect(scenes.timeline.tweenSpace!("view.from", { scale: "log_ago" })).toEqual(sp);
    expect(scenes.timeline.tweenSpace!("view.from", {})).toBeNull();
  });
  test("cards: events carry name, links, details, cites and the portrait's person", async () => {
    const { cardTargets } = await import("../src/ui/card-model");
    const params = { events: [{ id: "arrow", date: 1963, label: "Arrow", sublabel: "uncertainty", portrait: "Kenneth Arrow", links: ["https://www.jstor.org/stable/1812044"], details: "Why care is not a market.", cites: ["a63"] }] };
    const spec = { template: "timeline", params, sources: [{ id: "a63", title: "Uncertainty and the welfare economics of medical care" }], commands: [] } as never;
    const t = cardTargets(spec, { order: ["axis", "event_arrow"], sceneCards: scenes.timeline.cards!(params) }).get("event_arrow")!;
    expect(t.name).toBe("Arrow — uncertainty (1963)");
    expect(t.links).toEqual(["https://www.jstor.org/stable/1812044"]);
    expect(t.details).toBe("Why care is not a market.");
    expect(t.cites?.[0].id).toBe("a63");
    expect(t.wikiName).toBe("Kenneth Arrow");
  });
  test("pictures: portraits by name and images by URL resolve into strokes before layout", async () => {
    const { resolveTemplatePictures } = await import("../src/render/template-pictures");
    const spec = {
      template: "timeline",
      params: { events: [{ date: 1963, label: "Arrow", portrait: "Kenneth Arrow" }, { date: 1970, label: "Pic", image: "https://upload.wikimedia.org/x.jpg" }, { date: 1980, label: "None" }] },
    } as unknown as { params: { events: { strokes?: string }[] } };
    const fetched: string[] = [];
    await resolveTemplatePictures(spec as never, {
      fetch: (async (u: string) => {
        fetched.push(u);
        return { ok: true, json: async () => ({ thumbnail: { source: "https://img/arrow.jpg" } }) };
      }) as never,
      trace: async (u: string) => `img1:Ah:data:image/jpeg;base64,${u.length}`,
      cacheGet: async () => null,
      cachePut: async () => {},
    });
    expect(spec.params.events[0].strokes).toMatch(/^img1:/);
    expect(spec.params.events[1].strokes).toMatch(/^img1:/);
    expect(spec.params.events[2].strokes).toBeUndefined();
    expect(fetched[0]).toContain("Kenneth_Arrow");
  });
  test("widget: zoom narrows the view about the pointer; drag pans it", async () => {
    const { timelineWidget, axisView } = await import("../src/scenes/timeline/widget");
    const params = { events: [{ date: 1960, label: "a" }, { date: 2000, label: "b" }], view: { from: 1960, to: 2000 } };
    const w = timelineWidget();
    const scene = { params, ids: [], boxes: new Map(), rings: new Map(), lines: new Map(), vars: {}, toDomain: () => null, toLogical: (p: [number, number]) => p } as never;
    const st = w.init(scene);
    const z = w.on({ type: "zoom", point: [500, 300], domain: [1980, 0], factor: 2 }, st, scene).effects as { patch: { view: { from: number; to: number } } }[];
    expect(z[0].patch.view).toEqual({ from: 1970, to: 1990 });
    const d = w.on({ type: "drag_move", id: "__surface", from: [0, 0], fromDomain: [1980, 0], point: [0, 0], domain: [1970, 0] }, st, scene).effects as { patch: { view: { from: number; to: number } } }[];
    expect(d[0].patch.view).toEqual({ from: 1970, to: 2010 });
    expect(axisView(params)).toEqual([1960, 2000]);
  });
});

describe("registry", () => {
  test("timeline is registered with a live widget", () => {
    expect(scenes.timeline.widget).toBeTypeOf("function");
  });
});
