// Commodore BASIC V2, the first cut — as `language: "basic"` in the runtime
// facade. Written from the C64 Programmer's Reference Guide, not from any
// emulator's source (basic64-js is GPL-3 and off limits), and deliberately
// small: what a lesson needs to switch the machine on and do a few simple
// things (Hans, 2026-09-05: "ikke ta med alle mulige kommandoer med en
// gang"). Every statement and function it does NOT have is refused by name,
// in the machine's own voice with drawcast's explanation in parentheses.
//
// Why an interpreter of our own and not the emulator: a run here leaves a
// SCREEN behind (code/c64.ts), and the layout draws that screen as ink — so
// a BASIC lesson scrubs, exports to video, takes the marker pen, and `ask`
// can ask a viewer to write it. The emulator is a canvas and can do none of
// those. Pure, dependency-free, node-tested: no DOM, no timers, no randomness
// that is not seeded (a figure must render the same every time).
//
// The surface (first cut):
//   statements  PRINT ? LET GOTO GOSUB RETURN IF/THEN FOR/NEXT/STEP REM
//               END STOP POKE
//   functions   INT RND LEN CHR$ ASC STR$ VAL LEFT$ MID$ RIGHT$ PEEK ABS SGN
//   screen      PRINT writes through a 40 × 25 screen that scrolls; CHR$(147)
//               clears, CHR$(13) is a newline, the sixteen colour codes set
//               the text colour; POKE/PEEK reach screen RAM (1024–2023),
//               colour RAM (55296–56295), border (53280), background
//               (53281), cursor colour (646); other addresses are a sparse
//               store so PEEK gives back what was POKEd.
//   refused     DATA READ RESTORE DIM ON INPUT GET OPEN CLOSE SYS WAIT USR
//               DEF FN TAB SPC and the trigonometry — each with the reason.

import { C64_BACKGROUND, C64_BORDER, C64_COLS, C64_ROWS, C64_TEXT, PETSCII_COLOR, blankScreen, screenChar, screenCode, type C64Screen } from "./c64";
import type { CodeRunResult } from "./envelope";
import type { CodeRunRequest } from "./run";

// ---- values ----------------------------------------------------------------

type Value = number | string;

class BasicError extends Error {
  constructor(
    public kind: string,
    public line: number | null,
    public why?: string,
  ) {
    super(kind);
  }
  /** `?SYNTAX ERROR IN 20` — the machine's own sentence, then ours. */
  text(): string {
    const at = this.line === null ? "" : ` IN ${this.line}`;
    return `?${this.kind}${at}${this.why ? ` (${this.why})` : ""}`;
  }
}

const NOT_YET: Record<string, string> = {
  DATA: "DATA/READ/RESTORE are not in this first cut of drawcast's BASIC — put the numbers in the code",
  READ: "DATA/READ/RESTORE are not in this first cut of drawcast's BASIC — put the numbers in the code",
  RESTORE: "DATA/READ/RESTORE are not in this first cut of drawcast's BASIC",
  DIM: "arrays are not in this first cut of drawcast's BASIC",
  ON: "ON…GOTO is not in this first cut of drawcast's BASIC — use IF…THEN",
  INPUT: "a figure cannot wait for typing — use ask with a code widget instead",
  GET: "a figure cannot wait for typing — use ask with a code widget instead",
  OPEN: "files and devices are not in drawcast's BASIC",
  CLOSE: "files and devices are not in drawcast's BASIC",
  SYS: "there is no machine code here — this BASIC runs on paper, not on a 6510",
  WAIT: "there is no machine code here — this BASIC runs on paper, not on a 6510",
  USR: "there is no machine code here — this BASIC runs on paper, not on a 6510",
  DEF: "DEF FN is not in this first cut of drawcast's BASIC",
  TAB: "TAB( and SPC( are not in this first cut — pad with spaces in the string",
  SPC: "TAB( and SPC( are not in this first cut — pad with spaces in the string",
  SIN: "trigonometry is not in this first cut of drawcast's BASIC",
  COS: "trigonometry is not in this first cut of drawcast's BASIC",
  TAN: "trigonometry is not in this first cut of drawcast's BASIC",
  ATN: "trigonometry is not in this first cut of drawcast's BASIC",
  EXP: "EXP/LOG/SQR are not in this first cut of drawcast's BASIC",
  LOG: "EXP/LOG/SQR are not in this first cut of drawcast's BASIC",
  SQR: "EXP/LOG/SQR are not in this first cut of drawcast's BASIC",
  LOAD: "there is no tape or disk here",
  SAVE: "there is no tape or disk here",
  VERIFY: "there is no tape or disk here",
  LIST: "LIST is what the panel already shows",
  RUN: "the program runs by itself — leave RUN out",
  NEW: "NEW is not in this first cut",
  CLR: "CLR is not in this first cut",
  CONT: "CONT is not in this first cut",
  FRE: "FRE is not in this first cut — there are 38911 bytes free, as always",
  POS: "POS is not in this first cut",
};

// ---- tokens ------------------------------------------------------------------

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "kw"; v: string }
  | { t: "op"; v: string };

/** Keywords the scanner recognises even without spaces (FORI=1TO10), longest
 *  first so PRINT beats PR and NEXT beats NE. */
const KEYWORDS = [
  "RESTORE", "RETURN", "VERIFY", "PRINT", "INPUT", "GOSUB", "CLOSE", "RIGHT$", "LEFT$", "CHR$", "STR$", "MID$",
  "GOTO", "THEN", "STEP", "NEXT", "DATA", "READ", "POKE", "PEEK", "STOP", "WAIT", "OPEN", "LOAD", "SAVE",
  "LIST", "CONT", "SPC(", "TAB(", "LET", "FOR", "REM", "END", "DIM", "AND", "NOT", "INT", "RND", "LEN",
  "ASC", "VAL", "ABS", "SGN", "SYS", "USR", "DEF", "GET", "NEW", "CLR", "RUN", "FRE", "POS", "SIN", "COS",
  "TAN", "ATN", "EXP", "LOG", "SQR", "IF", "TO", "OR", "ON", "FN",
];

function tokenize(src: string, line: number | null): Tok[] {
  const out: Tok[] = [];
  const s = src.toUpperCase();
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (ch === '"') {
      const j = s.indexOf('"', i + 1);
      const end = j === -1 ? s.length : j;
      out.push({ t: "str", v: src.slice(i + 1, end) }); // strings keep their case
      i = end + 1;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || (ch === "." && s[i + 1] >= "0" && s[i + 1] <= "9")) {
      const m = /^\d*\.?\d*(E[+-]?\d+)?/.exec(s.slice(i))!;
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    const kw = KEYWORDS.find((k) => s.startsWith(k, i));
    if (kw) {
      out.push({ t: "kw", v: kw });
      i += kw.length;
      if (kw === "REM") {
        return out; // the rest of the line is a remark
      }
      continue;
    }
    if (ch === "?") {
      out.push({ t: "kw", v: "PRINT" });
      i++;
      continue;
    }
    if (ch >= "A" && ch <= "Z") {
      const m = /^[A-Z][A-Z0-9]*[$%]?/.exec(s.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>" || two === "=<" || two === "=>" || two === "><") {
      out.push({ t: "op", v: two === "=<" ? "<=" : two === "=>" ? ">=" : two === "><" ? "<>" : two });
      i += 2;
      continue;
    }
    if ("+-*/^=<>(),;:".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    throw new BasicError("SYNTAX ERROR", line, `unexpected "${src[i]}"`);
  }
  return out;
}

// ---- the program -------------------------------------------------------------

interface Line {
  num: number;
  toks: Tok[];
}

/** Numbered lines sort themselves; an unnumbered line follows the one before
 *  it (so a lesson may write plain statements without the ceremony). */
function parseProgram(src: string): Line[] {
  const lines: Line[] = [];
  let last = 0;
  for (const raw of src.split("\n")) {
    const text = raw.trim();
    if (text === "") continue;
    const m = /^(\d+)\s*(.*)$/.exec(text);
    const num = m ? Number(m[1]) : last + 1;
    const body = m ? m[2] : text;
    if (m) {
      // a duplicated number replaces the earlier line, as typing it would
      const at = lines.findIndex((l) => l.num === num);
      if (at >= 0) lines.splice(at, 1);
    }
    lines.push({ num, toks: tokenize(body, num) });
    last = num;
  }
  return lines.sort((a, b) => a.num - b.num);
}

// ---- the screen --------------------------------------------------------------

class Screen {
  chars: string[][] = Array.from({ length: C64_ROWS }, () => Array(C64_COLS).fill(" "));
  colors: number[][] = Array.from({ length: C64_ROWS }, () => Array(C64_COLS).fill(C64_TEXT));
  border = C64_BORDER;
  background = C64_BACKGROUND;
  color = C64_TEXT;
  row = 0;
  col = 0;
  /** What PRINT wrote, as lines — the envelope's stdout and the ask's answer. */
  printed: string[] = [""];
  /** Every POKE/PEEK to an address that is not the screen's: what was poked. */
  memory = new Map<number, number>();

  clear(): void {
    for (const r of this.chars) r.fill(" ");
    for (const r of this.colors) r.fill(this.color);
    this.row = 0;
    this.col = 0;
  }
  newline(): void {
    this.col = 0;
    this.row++;
    this.printed.push("");
    if (this.row >= C64_ROWS) {
      this.chars.shift();
      this.colors.shift();
      this.chars.push(Array(C64_COLS).fill(" "));
      this.colors.push(Array(C64_COLS).fill(this.color));
      this.row = C64_ROWS - 1;
    }
  }
  putChar(ch: string): void {
    if (this.col >= C64_COLS) this.newline();
    this.chars[this.row][this.col] = ch;
    this.colors[this.row][this.col] = this.color;
    this.col++;
    this.printed[this.printed.length - 1] += ch;
  }
  /** What the OPERATOR typed — the listing and RUN — shown on the screen but
   *  never part of what the program printed. */
  type(text: string): void {
    this.write(text);
    this.printed = [""];
  }
  write(text: string): void {
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code === 147) this.clear();
      else if (code === 13 || ch === "\n") this.newline();
      else if (code in PETSCII_COLOR) this.color = PETSCII_COLOR[code];
      else if (code < 32) continue; // other control codes: silently nothing
      else this.putChar(ch);
    }
  }
  poke(addr: number, value: number): void {
    const v = value & 0xff;
    if (addr >= 1024 && addr < 2024) {
      const i = addr - 1024;
      this.chars[Math.floor(i / C64_COLS)][i % C64_COLS] = screenChar(v);
    } else if (addr >= 55296 && addr < 56296) {
      const i = addr - 55296;
      this.colors[Math.floor(i / C64_COLS)][i % C64_COLS] = v & 0x0f;
    } else if (addr === 53280) this.border = v & 0x0f;
    else if (addr === 53281) this.background = v & 0x0f;
    else if (addr === 646) this.color = v & 0x0f;
    else this.memory.set(addr, v);
  }
  peek(addr: number): number {
    if (addr >= 1024 && addr < 2024) {
      const i = addr - 1024;
      return screenCode(this.chars[Math.floor(i / C64_COLS)][i % C64_COLS]);
    }
    if (addr >= 55296 && addr < 56296) {
      const i = addr - 55296;
      return this.colors[Math.floor(i / C64_COLS)][i % C64_COLS];
    }
    if (addr === 53280) return this.border;
    if (addr === 53281) return this.background;
    if (addr === 646) return this.color;
    return this.memory.get(addr) ?? 0;
  }
  snapshot(): C64Screen {
    const s = blankScreen();
    s.chars = this.chars.map((r) => r.join(""));
    s.colors = this.colors.map((r) => r.map((c) => c.toString(16)).join(""));
    s.border = this.border;
    s.background = this.background;
    return s;
  }
}

// ---- the interpreter ---------------------------------------------------------

/** A seeded generator — RND(1) on a real C64 is not reproducible, and a
 *  figure has to be. */
function lcg(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/** The C64's own way of printing a number: a leading space for a positive
 *  sign that is not there, a trailing space always. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return " OVERFLOW ";
  let body: string;
  if (Number.isInteger(n) && Math.abs(n) < 1e9) body = String(n);
  else {
    body = Number(n.toPrecision(9)).toString();
    if (body.includes("e")) body = body.toUpperCase().replace("E+", "E+").replace(/^(-?)0?\./, "$1.");
    else body = body.replace(/^(-?)0\./, "$1.");
  }
  return (n < 0 ? "" : " ") + body + " ";
}

interface Frame {
  variable: string;
  end: number;
  step: number;
  /** Where NEXT goes back to: the line index and token index after FOR. */
  line: number;
  tok: number;
}

class Interpreter {
  vars = new Map<string, Value>();
  screen = new Screen();
  rnd = lcg(0x5eed);
  gosub: { line: number; tok: number }[] = [];
  loops: Frame[] = [];
  steps = 0;
  static MAX_STEPS = 400000;

  constructor(private lines: Line[]) {}

  run(): void {
    let li = 0;
    let ti = 0;
    while (li < this.lines.length) {
      const line = this.lines[li];
      const toks = line.toks;
      if (ti >= toks.length) {
        li++;
        ti = 0;
        continue;
      }
      if (++this.steps > Interpreter.MAX_STEPS) {
        throw new BasicError("BREAK", line.num, "the program ran for more than 400 000 statements — a figure's program has to finish");
      }
      const jump = this.statement(line, toks, ti);
      if (jump === "end") return;
      if (typeof jump === "object") {
        li = jump.line;
        ti = jump.tok;
        continue;
      }
      ti = jump;
    }
  }

  private lineIndex(num: number, at: number): number {
    const i = this.lines.findIndex((l) => l.num === num);
    if (i < 0) throw new BasicError("UNDEF'D STATEMENT ERROR", at);
    return i;
  }

  /** Runs one statement starting at toks[ti]; returns where to go next. */
  private statement(line: Line, toks: Tok[], ti: number): number | "end" | { line: number; tok: number } {
    const at = line.num;
    const t = toks[ti];
    if (t.t === "op" && t.v === ":") return ti + 1;
    if (t.t === "kw") {
      switch (t.v) {
        case "REM":
          return toks.length;
        case "END":
        case "STOP":
          return "end";
        case "PRINT": {
          let i = ti + 1;
          let newline = true;
          while (i < toks.length && !(toks[i].t === "op" && toks[i].v === ":")) {
            const tk = toks[i];
            if (tk.t === "op" && tk.v === ";") {
              newline = false;
              i++;
              continue;
            }
            if (tk.t === "op" && tk.v === ",") {
              // the next 10-column zone, as the machine does it
              const pad = 10 - (this.screen.col % 10);
              this.screen.write(" ".repeat(pad));
              newline = false;
              i++;
              continue;
            }
            const [v, next] = this.expr(toks, i, at);
            this.screen.write(typeof v === "number" ? formatNumber(v) : v);
            newline = true;
            i = next;
          }
          if (newline) this.screen.write("\n");
          return i;
        }
        case "LET": {
          return this.assign(toks, ti + 1, at);
        }
        case "GOTO": {
          const [n, next] = this.expr(toks, ti + 1, at);
          void next;
          return { line: this.lineIndex(this.num(n, at), at), tok: 0 };
        }
        case "GOSUB": {
          const [n, next] = this.expr(toks, ti + 1, at);
          this.gosub.push({ line: this.lines.indexOf(line), tok: next });
          return { line: this.lineIndex(this.num(n, at), at), tok: 0 };
        }
        case "RETURN": {
          const back = this.gosub.pop();
          if (!back) throw new BasicError("RETURN WITHOUT GOSUB ERROR", at);
          return back;
        }
        case "IF": {
          const [cond, next] = this.expr(toks, ti + 1, at);
          let i = next;
          if (toks[i]?.t === "kw" && toks[i].v === "THEN") i++;
          else if (!(toks[i]?.t === "kw" && toks[i].v === "GOTO")) throw new BasicError("SYNTAX ERROR", at, "IF needs THEN");
          if (this.num(cond, at) === 0) return toks.length; // false: the rest of the line is skipped
          // THEN 100 is a GOTO; THEN <statement> runs it in place.
          if (toks[i]?.t === "num") return { line: this.lineIndex(toks[i].v as number, at), tok: 0 };
          return i;
        }
        case "FOR": {
          const v = toks[ti + 1];
          if (v?.t !== "id" || !(toks[ti + 2]?.t === "op" && toks[ti + 2].v === "=")) throw new BasicError("SYNTAX ERROR", at, "FOR needs a variable and =");
          const [start, i1] = this.expr(toks, ti + 3, at);
          if (!(toks[i1]?.t === "kw" && toks[i1].v === "TO")) throw new BasicError("SYNTAX ERROR", at, "FOR needs TO");
          const [end, i2] = this.expr(toks, i1 + 1, at);
          let step = 1;
          let i3 = i2;
          if (toks[i2]?.t === "kw" && toks[i2].v === "STEP") {
            const [s, i4] = this.expr(toks, i2 + 1, at);
            step = this.num(s, at);
            i3 = i4;
          }
          this.vars.set(v.v, this.num(start, at));
          // A FOR on the same variable replaces the old loop, as the machine does.
          this.loops = this.loops.filter((f) => f.variable !== v.v);
          this.loops.push({ variable: v.v, end: this.num(end, at), step, line: this.lines.indexOf(line), tok: i3 });
          return i3;
        }
        case "NEXT": {
          let i = ti + 1;
          let name: string | undefined;
          if (toks[i]?.t === "id") {
            name = (toks[i] as { v: string }).v;
            i++;
          }
          const frame = name ? this.loops.find((f) => f.variable === name) : this.loops[this.loops.length - 1];
          if (!frame) throw new BasicError("NEXT WITHOUT FOR ERROR", at);
          const cur = this.num(this.vars.get(frame.variable) ?? 0, at) + frame.step;
          this.vars.set(frame.variable, cur);
          const done = frame.step >= 0 ? cur > frame.end : cur < frame.end;
          if (done) {
            this.loops = this.loops.filter((f) => f !== frame);
            return i;
          }
          return { line: frame.line, tok: frame.tok };
        }
        case "POKE": {
          const [a, i1] = this.expr(toks, ti + 1, at);
          if (!(toks[i1]?.t === "op" && toks[i1].v === ",")) throw new BasicError("SYNTAX ERROR", at, "POKE needs address, value");
          const [v, i2] = this.expr(toks, i1 + 1, at);
          const addr = this.num(a, at);
          const val = this.num(v, at);
          if (addr < 0 || addr > 65535 || val < 0 || val > 255) throw new BasicError("ILLEGAL QUANTITY ERROR", at);
          this.screen.poke(Math.floor(addr), Math.floor(val));
          return i2;
        }
        default:
          if (t.v in NOT_YET) throw new BasicError("SYNTAX ERROR", at, NOT_YET[t.v]);
          throw new BasicError("SYNTAX ERROR", at);
      }
    }
    if (t.t === "id") return this.assign(toks, ti, at);
    throw new BasicError("SYNTAX ERROR", at);
  }

  private assign(toks: Tok[], ti: number, at: number): number {
    const v = toks[ti];
    if (v?.t !== "id" || !(toks[ti + 1]?.t === "op" && toks[ti + 1].v === "=")) throw new BasicError("SYNTAX ERROR", at);
    if (toks[ti + 2]?.t === "op" && (toks[ti + 2] as { v: string }).v === "(") throw new BasicError("SYNTAX ERROR", at, NOT_YET.DIM);
    const [val, next] = this.expr(toks, ti + 2, at);
    const isStr = v.v.endsWith("$");
    if (isStr !== (typeof val === "string")) throw new BasicError("TYPE MISMATCH ERROR", at);
    this.vars.set(v.v, v.v.endsWith("%") ? Math.trunc(this.num(val, at)) : val);
    return next;
  }

  private num(v: Value, at: number): number {
    if (typeof v !== "number") throw new BasicError("TYPE MISMATCH ERROR", at);
    return v;
  }
  private str(v: Value, at: number): string {
    if (typeof v !== "string") throw new BasicError("TYPE MISMATCH ERROR", at);
    return v;
  }

  // Expressions: OR < AND < NOT < comparisons < + - < * / < ^ < unary -.
  private expr(toks: Tok[], i: number, at: number): [Value, number] {
    return this.orExpr(toks, i, at);
  }
  private orExpr(toks: Tok[], i: number, at: number): [Value, number] {
    let [l, j] = this.andExpr(toks, i, at);
    while (toks[j]?.t === "kw" && toks[j].v === "OR") {
      const [r, k] = this.andExpr(toks, j + 1, at);
      l = this.int(l, at) | this.int(r, at);
      j = k;
    }
    return [l, j];
  }
  private andExpr(toks: Tok[], i: number, at: number): [Value, number] {
    let [l, j] = this.notExpr(toks, i, at);
    while (toks[j]?.t === "kw" && toks[j].v === "AND") {
      const [r, k] = this.notExpr(toks, j + 1, at);
      l = this.int(l, at) & this.int(r, at);
      j = k;
    }
    return [l, j];
  }
  private notExpr(toks: Tok[], i: number, at: number): [Value, number] {
    if (toks[i]?.t === "kw" && toks[i].v === "NOT") {
      const [v, j] = this.notExpr(toks, i + 1, at);
      return [~this.int(v, at), j];
    }
    return this.compare(toks, i, at);
  }
  private int(v: Value, at: number): number {
    const n = this.num(v, at);
    if (n < -32768 || n > 32767) throw new BasicError("ILLEGAL QUANTITY ERROR", at);
    return Math.trunc(n);
  }
  private compare(toks: Tok[], i: number, at: number): [Value, number] {
    let [l, j] = this.sum(toks, i, at);
    while (toks[j]?.t === "op" && ["=", "<", ">", "<=", ">=", "<>"].includes((toks[j] as { v: string }).v)) {
      const op = (toks[j] as { v: string }).v;
      const [r, k] = this.sum(toks, j + 1, at);
      if (typeof l !== typeof r) throw new BasicError("TYPE MISMATCH ERROR", at);
      const c = typeof l === "string" ? (l < (r as string) ? -1 : l > (r as string) ? 1 : 0) : l < (r as number) ? -1 : l > (r as number) ? 1 : 0;
      const truth = op === "=" ? c === 0 : op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : op === ">=" ? c >= 0 : c !== 0;
      l = truth ? -1 : 0; // true is -1 on this machine
      j = k;
    }
    return [l, j];
  }
  private sum(toks: Tok[], i: number, at: number): [Value, number] {
    let [l, j] = this.term(toks, i, at);
    while (toks[j]?.t === "op" && ((toks[j] as { v: string }).v === "+" || (toks[j] as { v: string }).v === "-")) {
      const op = (toks[j] as { v: string }).v;
      const [r, k] = this.term(toks, j + 1, at);
      if (op === "+" && typeof l === "string" && typeof r === "string") l = l + r;
      else if (op === "+") l = this.num(l, at) + this.num(r, at);
      else l = this.num(l, at) - this.num(r, at);
      j = k;
    }
    return [l, j];
  }
  private term(toks: Tok[], i: number, at: number): [Value, number] {
    let [l, j] = this.power(toks, i, at);
    while (toks[j]?.t === "op" && ((toks[j] as { v: string }).v === "*" || (toks[j] as { v: string }).v === "/")) {
      const op = (toks[j] as { v: string }).v;
      const [r, k] = this.power(toks, j + 1, at);
      const b = this.num(r, at);
      if (op === "/" && b === 0) throw new BasicError("DIVISION BY ZERO ERROR", at);
      l = op === "*" ? this.num(l, at) * b : this.num(l, at) / b;
      j = k;
    }
    return [l, j];
  }
  private power(toks: Tok[], i: number, at: number): [Value, number] {
    const [l, j] = this.unary(toks, i, at);
    if (toks[j]?.t === "op" && (toks[j] as { v: string }).v === "^") {
      const [r, k] = this.power(toks, j + 1, at);
      return [Math.pow(this.num(l, at), this.num(r, at)), k];
    }
    return [l, j];
  }
  private unary(toks: Tok[], i: number, at: number): [Value, number] {
    if (toks[i]?.t === "op" && (toks[i] as { v: string }).v === "-") {
      const [v, j] = this.unary(toks, i + 1, at);
      return [-this.num(v, at), j];
    }
    if (toks[i]?.t === "op" && (toks[i] as { v: string }).v === "+") return this.unary(toks, i + 1, at);
    return this.atom(toks, i, at);
  }
  private args(toks: Tok[], i: number, at: number, n: number): [Value[], number] {
    if (!(toks[i]?.t === "op" && (toks[i] as { v: string }).v === "(")) throw new BasicError("SYNTAX ERROR", at, "a function needs (");
    const out: Value[] = [];
    let j = i + 1;
    for (let k = 0; k < n; k++) {
      if (k > 0) {
        if (!(toks[j]?.t === "op" && (toks[j] as { v: string }).v === ",")) {
          if (k >= 2) break; // MID$ may stop after two
          throw new BasicError("SYNTAX ERROR", at);
        }
        j++;
      }
      const [v, next] = this.expr(toks, j, at);
      out.push(v);
      j = next;
    }
    if (!(toks[j]?.t === "op" && (toks[j] as { v: string }).v === ")")) throw new BasicError("SYNTAX ERROR", at, "a ) is missing");
    return [out, j + 1];
  }
  private atom(toks: Tok[], i: number, at: number): [Value, number] {
    const t = toks[i];
    if (!t) throw new BasicError("SYNTAX ERROR", at, "the line ends where a value should be");
    if (t.t === "num") return [t.v, i + 1];
    if (t.t === "str") return [t.v, i + 1];
    if (t.t === "op" && t.v === "(") {
      const [v, j] = this.expr(toks, i + 1, at);
      if (!(toks[j]?.t === "op" && (toks[j] as { v: string }).v === ")")) throw new BasicError("SYNTAX ERROR", at, "a ) is missing");
      return [v, j + 1];
    }
    if (t.t === "id") {
      if (toks[i + 1]?.t === "op" && (toks[i + 1] as { v: string }).v === "(") throw new BasicError("SYNTAX ERROR", at, NOT_YET.DIM);
      return [this.vars.get(t.v) ?? (t.v.endsWith("$") ? "" : 0), i + 1];
    }
    if (t.t === "kw") {
      switch (t.v) {
        case "INT": {
          const [[a], j] = this.args(toks, i + 1, at, 1);
          return [Math.floor(this.num(a, at)), j];
        }
        case "ABS": {
          const [[a], j] = this.args(toks, i + 1, at, 1);
          return [Math.abs(this.num(a, at)), j];
        }
        case "SGN": {
          const [[a], j] = this.args(toks, i + 1, at, 1);
          return [Math.sign(this.num(a, at)), j];
        }
        case "RND": {
          const [, j] = this.args(toks, i + 1, at, 1);
          return [this.rnd(), j];
        }
        case "LEN": {
          const [[a], j] = this.args(toks, i + 1, at, 1);
          return [this.str(a, at).length, j];
        }
        case "ASC": {
          const [[a], j] = this.args(toks, i + 1, at, 1);
          const s = this.str(a, at);
          if (s === "") throw new BasicError("ILLEGAL QUANTITY ERROR", at);
          return [s.charCodeAt(0), j];
        }
        case "CHR$": {
          const [[a], j] = this.args(toks, i + 1, at, 1);
          const n = this.num(a, at);
          if (n < 0 || n > 255) throw new BasicError("ILLEGAL QUANTITY ERROR", at);
          return [String.fromCharCode(Math.floor(n)), j];
        }
        case "STR$": {
          const [[a], j] = this.args(toks, i + 1, at, 1);
          return [formatNumber(this.num(a, at)).replace(/ $/, ""), j];
        }
        case "VAL": {
          const [[a], j] = this.args(toks, i + 1, at, 1);
          const m = /^\s*[-+]?\d*\.?\d*(E[+-]?\d+)?/.exec(this.str(a, at).toUpperCase());
          const n = m && m[0].trim() !== "" ? Number(m[0]) : 0;
          return [Number.isFinite(n) ? n : 0, j];
        }
        case "LEFT$": {
          const [[s, n], j] = this.args(toks, i + 1, at, 2);
          return [this.str(s, at).slice(0, Math.max(0, this.num(n, at))), j];
        }
        case "RIGHT$": {
          const [[s, n], j] = this.args(toks, i + 1, at, 2);
          const k = Math.max(0, this.num(n, at));
          return [k === 0 ? "" : this.str(s, at).slice(-k), j];
        }
        case "MID$": {
          const [vals, j] = this.args(toks, i + 1, at, 3);
          const s = this.str(vals[0], at);
          const start = Math.max(1, this.num(vals[1], at));
          const len = vals.length > 2 ? Math.max(0, this.num(vals[2], at)) : s.length;
          return [s.slice(start - 1, start - 1 + len), j];
        }
        case "PEEK": {
          const [[a], j] = this.args(toks, i + 1, at, 1);
          return [this.screen.peek(Math.floor(this.num(a, at))), j];
        }
        default:
          if (t.v in NOT_YET) throw new BasicError("SYNTAX ERROR", at, NOT_YET[t.v]);
          throw new BasicError("SYNTAX ERROR", at);
      }
    }
    throw new BasicError("SYNTAX ERROR", at);
  }
}

// ---- the facade's contract --------------------------------------------------

export interface BasicRun {
  ok: boolean;
  screen: C64Screen;
  stdout: string;
  error?: string;
  vars: Map<string, Value>;
}

/** The program as the operator typed it: uppercase outside quotes, wrapped at
 *  the screen's edge, RUN under it — so the run's screen shows what a real
 *  machine would after LIST … RUN. */
function typeListing(screen: Screen, source: string): void {
  for (const line of source.replace(/\s+$/, "").split("\n")) {
    if (line.trim() === "") continue;
    screen.type(line.replace(/"[^"]*"|[^"]+/g, (m) => (m.startsWith('"') ? m : m.toUpperCase())) + "\n");
  }
  screen.type("RUN\n");
}

/** Run a program to completion (or to its first error). Pure. With
 *  `listing`, the screen first shows the program and RUN, as the machine's
 *  would; without it the program owns the whole screen (the tests' view). */
export function runBasic(source: string, opts: { listing?: boolean } = {}): BasicRun {
  const it = new Interpreter([]);
  if (opts.listing) typeListing(it.screen, source);
  try {
    const lines = parseProgram(source);
    const interp = new Interpreter(lines);
    if (opts.listing) typeListing(interp.screen, source);
    interp.run();
    return { ok: true, screen: interp.screen.snapshot(), stdout: interp.screen.printed.join("\n").replace(/\n$/, ""), vars: interp.vars };
  } catch (err) {
    const e = err instanceof BasicError ? err : new BasicError("SYNTAX ERROR", null, (err as Error).message);
    // The error lands on the screen too, as it would on the machine.
    it.screen.write(`\n${e.text().split(" (")[0]}\n`);
    return { ok: false, screen: it.screen.snapshot(), stdout: "", error: e.text(), vars: it.vars };
  }
}

/** The runtime module run.ts reaches lazily, like every other language. */
export async function run(req: CodeRunRequest): Promise<CodeRunResult> {
  req.onStatus?.("running", "Running…");
  const r = runBasic(req.code, { listing: true });
  const result: CodeRunResult = { ok: r.ok, stdout: r.stdout, stderr: "", figures: [], screen: r.screen, ...(r.error ? { error: r.error } : {}) };
  // The data bridge: a requested path is a variable name (A, A$, N%).
  if (req.paths && req.paths.length > 0) {
    result.data = {};
    result.dataErrors = {};
    for (const p of req.paths) {
      const v = r.vars.get(p.toUpperCase());
      if (v === undefined) result.dataErrors[p] = `no variable ${p.toUpperCase()}`;
      else result.data[p] = v;
    }
  }
  return result;
}
