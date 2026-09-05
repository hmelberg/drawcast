// Commodore BASIC V2, drawcast's own first cut (src/code/basic.ts): what a
// lesson's program prints, leaves on the screen, and is refused for — and
// how the layout draws the screen it left. Pure end to end.

import { describe, expect, test } from "vitest";
import { formatNumber, run, runBasic } from "../src/code/basic";
import { C64_PALETTE } from "../src/code/c64";
import { cacheTag, LANGUAGES } from "../src/code/languages";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type AreaDrawable, type TextDrawable } from "../src/layout/model";
import type { Spec } from "../src/spec/types";

const out = (src: string) => runBasic(src);
const line = (r: ReturnType<typeof runBasic>, n: number) => r.screen.chars[n].trimEnd();

describe("PRINT, the machine's way", () => {
  test("numbers carry the sign's space and a trailing one; strings do not", () => {
    expect(formatNumber(5)).toBe(" 5 ");
    expect(formatNumber(-5)).toBe("-5 ");
    expect(formatNumber(0.5)).toBe(" .5 ");
    expect(formatNumber(1 / 3)).toBe(" .333333333 ");
    const r = out('10 PRINT "HELLO"\n20 PRINT 5\n30 PRINT "A";"B";3;"C"');
    expect(line(r, 0)).toBe("HELLO");
    expect(line(r, 1)).toBe(" 5");
    expect(line(r, 2)).toBe("AB 3 C");
    expect(r.stdout).toBe("HELLO\n 5 \nAB 3 C");
  });

  test("? is PRINT, ; holds the line, , tabs to the next zone, and the screen scrolls", () => {
    const r = out('10 ? "A";\n20 ? "B"\n30 ? "X","Y"');
    expect(line(r, 0)).toBe("AB");
    expect(r.screen.chars[1].slice(0, 11)).toBe("X         Y");
    const many = out("10 FOR I=1 TO 30\n20 PRINT I\n30 NEXT I");
    // Thirty lines on a 25-row screen: the top scrolled away, the last line
    // sits on row 23 and the cursor waits on an empty row 24 — as on the machine.
    expect(line(many, 23)).toBe(" 30");
    expect(line(many, 24)).toBe("");
    expect(line(many, 0)).toBe(" 7");
  });

  test("CHR$(147) clears, colour codes change the ink, and the printed text is stdout regardless", () => {
    const r = out('10 PRINT "OLD"\n20 PRINT CHR$(147);CHR$(5);"WHITE"');
    expect(line(r, 0)).toBe("WHITE");
    expect(r.screen.colors[0][0]).toBe("1"); // white
    expect(r.stdout).toBe("OLD\nWHITE");
  });
});

describe("control flow and variables", () => {
  test("FOR/NEXT with STEP, nested, and a loop that never runs", () => {
    expect(out("10 S=0\n20 FOR I=10 TO 1 STEP -3\n30 S=S+I\n40 NEXT\n50 PRINT S").stdout).toBe(" 22 ");
    expect(out("10 FOR I=1 TO 2\n20 FOR J=1 TO 2\n30 PRINT I*10+J\n40 NEXT J\n50 NEXT I").stdout).toBe(" 11 \n 12 \n 21 \n 22 ");
    expect(out("10 FOR I=5 TO 1\n20 PRINT I\n30 NEXT\n40 PRINT \"DONE\"").stdout).toBe(" 5 \nDONE"); // the body runs once, as on the machine
  });

  test("GOTO, GOSUB/RETURN, IF/THEN with a line or a statement, and -1 as true", () => {
    expect(out('10 GOSUB 100\n20 PRINT "BACK"\n30 END\n100 PRINT "SUB"\n110 RETURN').stdout).toBe("SUB\nBACK");
    expect(out('10 A=3\n20 IF A>2 THEN 40\n30 PRINT "NO"\n40 PRINT "YES"').stdout).toBe("YES");
    expect(out('10 IF 1=2 THEN PRINT "NO"\n20 PRINT 1=1;1=2').stdout).toBe("-1  0 ");
    expect(out('10 A$="HI":B$=A$+"!":PRINT B$;LEN(B$)').stdout).toBe("HI! 3 ");
  });

  test("functions of the first cut, and a seeded RND that never changes", () => {
    expect(out('10 PRINT INT(3.7);ABS(-2);SGN(-9);LEFT$("HELLO",2);MID$("HELLO",2,3);RIGHT$("HELLO",2);ASC("A");VAL("12.5X");STR$(7)').stdout).toBe(" 3  2 -1 HEELLLO 65  12.5  7");
    const a = out("10 FOR I=1 TO 3:PRINT INT(RND(1)*100):NEXT").stdout;
    expect(a).toBe(out("10 FOR I=1 TO 3:PRINT INT(RND(1)*100):NEXT").stdout);
    expect(a.split("\n")).toHaveLength(3);
  });

  test("unnumbered lines run in order; a repeated number replaces the earlier line", () => {
    expect(out('PRINT "A"\nPRINT "B"').stdout).toBe("A\nB");
    expect(out('10 PRINT "A"\n10 PRINT "B"').stdout).toBe("B");
  });
});

describe("POKE and PEEK reach the screen", () => {
  test("screen RAM, colour RAM, border, background and the cursor colour", () => {
    // Row 1 (1024 + 40), so the PRINT on row 0 does not write over the poke.
    const r = out("10 POKE 53280,0\n20 POKE 53281,1\n30 POKE 1064,1\n40 POKE 55336,2\n50 POKE 646,7\n60 PRINT PEEK(53280);PEEK(1064);PEEK(55336);PEEK(646);PEEK(49152)");
    expect(r.screen.border).toBe(0);
    expect(r.screen.background).toBe(1);
    expect(r.screen.chars[1][0]).toBe("A");
    expect(r.screen.colors[1][0]).toBe("2");
    expect(r.stdout).toBe(" 0  1  2  7  0 ");
    // other addresses remember what was poked
    expect(out("10 POKE 49152,99:PRINT PEEK(49152)").stdout).toBe(" 99 ");
  });
});

describe("what it refuses, in the machine's voice", () => {
  test("errors carry the line and drawcast's reason", () => {
    expect(out("10 PRINT 1/0").error).toBe("?DIVISION BY ZERO ERROR IN 10");
    expect(out("10 GOTO 99").error).toBe("?UNDEF'D STATEMENT ERROR IN 10");
    expect(out("10 RETURN").error).toBe("?RETURN WITHOUT GOSUB ERROR IN 10");
    expect(out('10 A=\"X\"').error).toBe("?TYPE MISMATCH ERROR IN 10");
    expect(out("10 SYS 49152").error).toMatch(/^\?SYNTAX ERROR IN 10 \(there is no machine code here/);
    expect(out("10 DIM A(10)").error).toMatch(/arrays are not in this first cut/);
    expect(out("10 INPUT A").error).toMatch(/ask with a code widget/);
    expect(out("10 PRINT SIN(1)").error).toMatch(/trigonometry/);
    // …and the error lands on the screen, as it would
    const r = out("10 GOTO 99");
    expect(r.screen.chars.some((row) => row.includes("?UNDEF'D STATEMENT ERROR"))).toBe(true);
  });

  test("a runaway loop is stopped, and says so", () => {
    const r = out("10 GOTO 10");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^\?BREAK IN 10 \(the program ran for more than/);
  });
});

describe("the facade", () => {
  test("basic is a language with its own cache tag, and a run harvests variables", async () => {
    expect(LANGUAGES).toContain("basic");
    expect(cacheTag("basic")).toBe("bas1");
    const res = await run({ language: "basic", code: '10 T=0\n20 FOR I=0 TO 9:T=T+I:NEXT\n30 N$="OK"\n40 PRINT T', paths: ["T", "n$", "Z"] });
    expect(res.ok).toBe(true);
    expect(res.stdout).toBe(" 45 ");
    // The screen shows what the machine's would after LIST … RUN: the listing,
    // RUN, then the output — stdout stays the program's own.
    const rows = res.screen!.chars.map((r) => r.trimEnd());
    expect(rows[0]).toBe("10 T=0");
    expect(rows[3]).toBe("40 PRINT T");
    expect(rows[4]).toBe("RUN");
    expect(rows[5]).toBe(" 45");
    expect(res.data).toEqual({ T: 45, n$: "OK" });
    expect(res.dataErrors).toEqual({ Z: "no variable Z" });
  });
});

describe("the layout draws the screen a run left", () => {
  const spec = (code: string): Spec =>
    ({
      elements: [{ id: "b", type: "code", language: "basic", frame: "c64", show: "output", code, code_result: JSON.stringify(run0(code)) }],
      commands: [{ draw: ["b"] }],
    }) as unknown as Spec;
  const run0 = (code: string) => {
    const r = runBasic(code);
    return { ok: r.ok, stdout: r.stdout, stderr: "", figures: [], screen: r.screen, ...(r.error ? { error: r.error } : {}) };
  };

  test("the field takes the program's colours and every run of text is ink in its own colour", () => {
    const l = layoutSpec(spec('10 POKE 53280,0:POKE 53281,5\n20 PRINT "HELLO";CHR$(5);" THERE"'), heuristicMeasure);
    const all = flattenDrawables(l.drawables);
    // The machine's own field (the boot colours) is under the run's, which
    // repaints in the program's colours — the run is its own beat.
    expect((all.find((d) => d.id === "b__border") as AreaDrawable).style.fill).toBe(C64_PALETTE[14]);
    expect((all.find((d) => d.id === "b__run__border") as AreaDrawable).style.fill).toBe(C64_PALETTE[0]);
    expect((all.find((d) => d.id === "b__run__screen") as AreaDrawable).style.fill).toBe(C64_PALETTE[5]);
    const texts = all.filter((d) => d.kind === "text" && d.id.startsWith("b__scr")) as TextDrawable[];
    expect(texts.map((t) => [t.text, t.style.color])).toEqual([
      ["HELLO", C64_PALETTE[14]],
      ["THERE", C64_PALETTE[1]],
    ]);
    expect(all.some((d) => d.id.startsWith("b__boot"))).toBe(false); // a program on the machine: no boot screen
    // The listing is typed onto the screen as its own beats, in the machine's face.
    const line1 = all.find((d) => d.id === "b_line_1") as TextDrawable;
    expect(line1.font).toBe("c64");
    expect(line1.text).toBe("10 POKE 53280,0:POKE 53281,5");
    expect(all.some((d) => d.id === "b__play")).toBe(false); // no game, no play mark
  });
});
