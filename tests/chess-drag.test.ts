// Dragging a chess piece to its square, the pure half.
//
// Four surfaces move a piece by naming two squares — the ask gate, the
// openings drill, the play-the-computer session and free play on a paused
// board — and each one has its own idea of what a named square MEANS
// (legality, whose turn it is, what counts as a miss). What they share is
// the gesture: press a piece, carry it, let it go. That gesture lives here,
// DOM-free, with the renderer's per-element offset injected as `nudge` —
// exactly the seam ui/widget-host.ts drags a widget part through.
//
// The rule that makes drag and click ONE thing: a press names its square
// immediately, so a press-and-release is the click-click flow untouched,
// and a release somewhere else names the second square. Nothing in the four
// state machines has to learn a new verb.
import { describe, expect, test } from "vitest";
import { DRAG_MIN, pieceElementId, squareDrag, type SquareDragDeps } from "../src/ui/chess-drag-model";
import gamesYaml from "../src/scenes/packs/games.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { ensureEngines } from "../src/scenes/engines";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { rendererFor, type RenderStyle } from "../src/render/svg-backend";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

const STYLES: RenderStyle[] = ["clean", "sketchy"];

/** Every live node an ELEMENT draws itself with: its own leaf when it is one
 *  shape, and every `<id>__part` leaf when it is a group — which a drawn chess
 *  piece is (a fill, an outline and its trim), so an offset that reached only
 *  one of them would tear the piece apart as it moved. */
function livePartsOf(root: FakeNode, id: string): FakeNode[] {
  const out: FakeNode[] = [];
  const walk = (n: FakeNode) => {
    const leaf = n.dataset.leafId;
    if (leaf === id || leaf?.startsWith(`${id}__`)) out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

type Pt = [number, number];

/** A board where every square is 100 wide, a1 at the origin — the geometry
 *  under test is the gesture's, not chessSquareAt's (tested in widgets). */
const squareAt = (p: Pt): string | null => {
  const col = Math.floor(p[0] / 100);
  const row = Math.floor(p[1] / 100);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return `${String.fromCharCode(97 + col)}${row + 1}`;
};
/** Centre of a square, so a small wobble stays inside it. */
const at = (sq: string): Pt => [(sq.charCodeAt(0) - 97) * 100 + 50, (Number(sq[1]) - 1) * 100 + 50];

interface Harness {
  named: { sq: string; p: Pt }[];
  ghost: { id: string; dx: number; dy: number }[];
  /** Deliveries and ghost calls in ONE list, to assert their order. */
  log: string[];
}

function harness(pieces: string[] = ["e2"], over: Partial<SquareDragDeps> = {}) {
  const h: Harness = { named: [], ghost: [], log: [] };
  const drag = squareDrag({
    squareAt,
    grabbable: (sq) => pieces.includes(sq),
    nudge: (id, dx, dy) => {
      h.ghost.push({ id, dx, dy });
      h.log.push(`nudge ${id} ${dx},${dy}`);
    },
    deliver: (sq, p) => {
      h.named.push({ sq, p });
      h.log.push(`name ${sq}`);
    },
    ...over,
  });
  return { drag, h };
}

describe("pieceElementId", () => {
  test("names the template's drawn piece on a square", () => {
    // games.yaml: `piece_<file><rank>` is the piece standing on that square.
    expect(pieceElementId("e2")).toBe("piece_e2");
    expect(pieceElementId("h8")).toBe("piece_h8");
  });

  test("is null for anything that is not a square", () => {
    expect(pieceElementId("")).toBeNull();
    expect(pieceElementId("j9")).toBeNull();
    expect(pieceElementId("e2e4")).toBeNull();
  });
});

describe("the square drag gesture", () => {
  test("a press names its square at once — the click flow, untouched", () => {
    const { drag, h } = harness();
    expect(drag.down(at("e2"))).toBe(true);
    expect(h.named.map((n) => n.sq)).toEqual(["e2"]);
  });

  test("a press off the board names nothing and takes no gesture", () => {
    const { drag, h } = harness();
    expect(drag.down([900, 50])).toBe(false);
    expect(h.named).toEqual([]);
    drag.up([900, 50]);
    expect(h.named).toEqual([]);
  });

  test("a press and release in place names the square once, not twice", () => {
    const { drag, h } = harness();
    drag.down(at("e2"));
    drag.up(at("e2"));
    expect(h.named.map((n) => n.sq)).toEqual(["e2"]);
  });

  test("a wobble under the threshold never ghosts and never names a second square", () => {
    const { drag, h } = harness();
    const [x, y] = at("e2");
    drag.down([x, y]);
    drag.move([x + DRAG_MIN - 1, y]);
    drag.up([x + DRAG_MIN - 1, y]);
    expect(h.ghost).toEqual([]);
    expect(h.named.map((n) => n.sq)).toEqual(["e2"]);
  });

  test("carrying a piece past the threshold ghosts it under the pointer", () => {
    const { drag, h } = harness();
    const [x, y] = at("e2");
    drag.down([x, y]);
    drag.move([x + 40, y + 120]);
    expect(h.ghost).toEqual([{ id: "piece_e2", dx: 40, dy: 120 }]);
  });

  test("a dropped piece is home before the square it landed on is named", () => {
    // The widget host's lesson (tests/widget-drag-ghost.test.ts): the ghost is
    // cleared BEFORE the real move, or a piece left on an offset nobody owns
    // rides along with the repaint.
    const { drag, h } = harness();
    drag.down(at("e2"));
    drag.move(at("e4"));
    drag.up(at("e4"));
    expect(h.log).toEqual(["name e2", "nudge piece_e2 0,200", "nudge piece_e2 0,0", "name e4"]);
  });

  test("a drag let go off the board names nothing and sends the piece home", () => {
    const { drag, h } = harness();
    drag.down(at("e2"));
    drag.move([900, 400]);
    drag.up([900, 400]);
    expect(h.named.map((n) => n.sq)).toEqual(["e2"]);
    expect(h.ghost.at(-1)).toEqual({ id: "piece_e2", dx: 0, dy: 0 });
  });

  test("a piece carried back to its own square names nothing — a move taken back", () => {
    const { drag, h } = harness();
    const [x, y] = at("e2");
    drag.down([x, y]);
    drag.move([x + 60, y]);
    drag.up([x + 1, y]);
    expect(h.named.map((n) => n.sq)).toEqual(["e2"]);
    expect(h.ghost.at(-1)).toEqual({ id: "piece_e2", dx: 0, dy: 0 });
  });

  test("an empty square carries nothing, but still names the squares it is given", () => {
    // Click-click's second half: the target square is usually empty, and a
    // press there must still name it — it just has no piece to drag.
    const { drag, h } = harness();
    drag.down(at("e4"));
    drag.move(at("e6"));
    drag.up(at("e6"));
    expect(h.ghost).toEqual([]);
    expect(h.named.map((n) => n.sq)).toEqual(["e4"]);
  });

  test("a cancelled gesture sends the piece home and names nothing more", () => {
    const { drag, h } = harness();
    drag.down(at("e2"));
    drag.move(at("e4"));
    drag.cancel();
    expect(h.ghost.at(-1)).toEqual({ id: "piece_e2", dx: 0, dy: 0 });
    drag.up(at("e4"));
    expect(h.named.map((n) => n.sq)).toEqual(["e2"]);
  });

  test("dragging() is the cursor's one source of truth", () => {
    const { drag } = harness();
    expect(drag.dragging()).toBe(false);
    drag.down(at("e2"));
    expect(drag.dragging()).toBe(false); // a press alone is not a drag
    drag.move(at("e4"));
    expect(drag.dragging()).toBe(true);
    drag.up(at("e4"));
    expect(drag.dragging()).toBe(false);
  });

  test("one gesture at a time — a second finger is refused", () => {
    const { drag, h } = harness(["e2", "d2"]);
    drag.down(at("e2"));
    expect(drag.down(at("d2"))).toBe(false);
    expect(h.named.map((n) => n.sq)).toEqual(["e2"]);
  });

  test("the point a square was named at comes with it, for the mark", () => {
    const { drag, h } = harness();
    drag.down(at("e2"));
    drag.move(at("e4"));
    drag.up([410, 340]);
    expect(h.named.at(-1)).toEqual({ sq: "e4", p: [410, 340] });
  });
});

// ---------------------------------------------------------------------------
// The one thing the gesture rests on that it cannot check for itself: that
// `piece_<square>` is an id the RENDERER can offset. The chess template draws
// a piece as a kit.group (src/scenes/packs/games.yaml), and if a group's id
// never reaches the backend's leaf map, nudge() is a silent no-op — the drag
// would still work, perfectly, with nothing following the pointer.
//
// Driven against the real backend and the minimal DOM shim, like
// tests/widget-drag-ghost.test.ts, whose helpers these are.
describe("the piece a gesture carries", () => {
  for (const style of STYLES) {
    test(`is an element the renderer can offset and put back (${style})`, async () => {
      await ensureEngines(["chess"]);
      registerPack("games", gamesYaml);
      const spec = {
        title: "The opening position",
        template: "chess_board",
        params: { coords: false },
        commands: [{ draw: ["board", "piece_e2"] }],
      };
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(spec as never, heuristicMeasure);
        const container = new FakeNode("div", doc as never);
        const mounted = await rendererFor(style).mount(layout, spec as never, container as never);
        const svg = container.children[0];
        for (const el of mounted.elements.values()) el.finish();
        const id = pieceElementId("e2")!;
        const parts = () => livePartsOf(svg, id);
        expect(parts().length).toBeGreaterThan(0);

        // Carried: a y-up dy, SVG's y-down translate — the same composition
        // the widget ghost makes, and it reaches EVERY part of the piece.
        mounted.effects!.setOffset!(id, 0, 40);
        expect(parts().map((n) => n.getAttribute("transform"))).toEqual(parts().map(() => "translate(0.0 -40.0)"));

        // Home again: exactly what was there before the press.
        mounted.effects!.setOffset!(id, 0, 0);
        expect(parts().some((n) => n.hasAttribute("transform"))).toBe(false);
      } finally {
        restore();
      }
    });
  }
});
