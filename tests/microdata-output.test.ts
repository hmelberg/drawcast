// The microdata output parser: m2py returns ONE string in which figures and
// tables ride as `__micro_transform_start_<type>__` blocks, and errors are
// LOGGED rather than raised. Every fixture below is real output captured from
// m2py.py running the emulator's own example commands.

import { describe, expect, test } from "vitest";
import {
  TABLE_ROW_CAP,
  importedVariables,
  missingModule,
  parseHtmlTable,
  parseMicrodataOutput,
  unknownVariableError,
} from "../src/code/microdata-output";

/** `summarize inntekt` — a framed table: thead (blank index header + stats), one body row. */
const SUMMARIZE = `demo >> summarize inntekt

__micro_transform_start_tablehtml__
<table class="dataframe output-table">
  <thead>
    <tr style="text-align: right;">
      <th></th>
      <th>Gj.snitt</th>
      <th>Antall</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th>inntekt</th>
      <td>759437.13</td>
      <td>133</td>
    </tr>
  </tbody>
</table>
__micro_transform_end__

`;

/** `tabulate kjonn` — a Series, so pandas writes NO thead at all. */
const TABULATE = `demo >> tabulate kjonn

__micro_transform_start_tablehtml__
<table class="dataframe output-table" data-var1="kjonn" data-var2="">
  <tbody>
    <tr>
      <th>1 - Mann</th>
      <td>114</td>
    </tr>
    <tr>
      <th>2 - Kvinne</th>
      <td>86</td>
    </tr>
  </tbody>
</table>
__micro_transform_end__

`;

describe("parseMicrodataOutput — text", () => {
  test("a run with no embeds is stdout, nothing else", () => {
    const raw = ">> create-dataset demo\n  Et tomt datasett, demo, ble opprettet og valgt\n";
    const out = parseMicrodataOutput(raw);
    expect(out.stdout).toBe(">> create-dataset demo\n  Et tomt datasett, demo, ble opprettet og valgt");
    expect(out.tables).toEqual([]);
    expect(out.figures).toEqual([]);
    expect(out.error).toBeUndefined();
  });

  test("a markdown embed stays in stdout as its own text", () => {
    const raw = "__micro_transform_start_markdown__\nEn forklaring\n__micro_transform_end__\n";
    const out = parseMicrodataOutput(raw);
    expect(out.stdout).toBe("En forklaring");
    expect(out.tables).toEqual([]);
  });
});

describe("parseMicrodataOutput — tables", () => {
  test("a tablehtml embed leaves stdout and becomes a CodeTable", () => {
    const out = parseMicrodataOutput(SUMMARIZE);
    expect(out.stdout).toBe("demo >> summarize inntekt");
    expect(out.tables).toEqual([
      {
        columns: ["", "Gj.snitt", "Antall"],
        rows: [["inntekt", "759437.13", "133"]],
      },
    ]);
  });

  test("a table with no thead gets one blank header per column, so the grid still has widths", () => {
    const out = parseMicrodataOutput(TABULATE);
    expect(out.tables).toEqual([
      {
        columns: ["", ""],
        rows: [
          ["1 - Mann", "114"],
          ["2 - Kvinne", "86"],
        ],
      },
    ]);
  });

  test("two commands that both print a table come back as two tables, in order", () => {
    const out = parseMicrodataOutput(TABULATE + SUMMARIZE);
    expect(out.tables.map((t) => t.rows[0][0])).toEqual(["1 - Mann", "inntekt"]);
    expect(out.stdout).toBe("demo >> tabulate kjonn\n\ndemo >> summarize inntekt");
  });
});

describe("parseHtmlTable — pandas to_html only", () => {
  test("entities in a cell are decoded", () => {
    const t = parseHtmlTable("<table><tbody><tr><th>a &amp; b</th><td>&lt;5</td></tr></tbody></table>");
    expect(t?.rows).toEqual([["a & b", "<5"]]);
  });

  test("anything that is not a table is not a table", () => {
    expect(parseHtmlTable("<div>nope</div>")).toBeNull();
  });
});

describe("parseMicrodataOutput — figures", () => {
  test("a figure embed becomes plotly JSON and leaves stdout", () => {
    const fig = '{"data":[{"type":"bar","x":[1],"y":[2]}],"layout":{}}';
    const raw = `demo >> barchart kjonn\n\n__micro_transform_start_figure__\n${fig}\n__micro_transform_end__\n`;
    const out = parseMicrodataOutput(raw);
    expect(out.figures).toEqual([fig]);
    expect(out.stdout).toBe("demo >> barchart kjonn");
  });
});

describe("parseMicrodataOutput — errors are logged, not raised", () => {
  test("a failed command becomes the envelope's error", () => {
    const raw = "demo >> summarize lonn\n  FEIL PÅ KOMMANDO 'summarize' (ValueError): Ingen aktivt datasett.\n";
    expect(parseMicrodataOutput(raw).error).toBe("FEIL PÅ KOMMANDO 'summarize' (ValueError): Ingen aktivt datasett.");
  });

  test("the English message catalog is detected too", () => {
    const raw = "demo >> summarize lonn\n  ERROR ON COMMAND 'summarize' (ValueError): No active dataset.\n";
    expect(parseMicrodataOutput(raw).error).toBe("ERROR ON COMMAND 'summarize' (ValueError): No active dataset.");
  });

  test("only the FIRST error is reported — a script fails where it first went wrong", () => {
    expect(parseMicrodataOutput("  FEIL: en\n>> neste\n  FEIL: to\n").error).toBe("FEIL: en");
  });

  test("a word merely containing 'feil' mid-line is not an error", () => {
    const raw = "demo >> import fd/X as x\n  Importerte X uten feilverdier\n";
    expect(parseMicrodataOutput(raw).error).toBeUndefined();
  });
});

describe("parseMicrodataOutput — a big frame cannot bloat the cached envelope", () => {
  const bigTable = (n: number) =>
    `__micro_transform_start_tablehtml__\n<table><tbody>${Array.from(
      { length: n },
      (_, i) => `<tr><th>k${i}</th><td>${i}</td></tr>`,
    ).join("")}</tbody></table>\n__micro_transform_end__\n`;

  test("rows past the cap are dropped and COUNTED, never silently lost", () => {
    const out = parseMicrodataOutput(bigTable(TABLE_ROW_CAP + 7));
    expect(out.tables[0].rows.length).toBe(TABLE_ROW_CAP);
    expect(out.tables[0].truncated).toBe(7);
  });

  test("a frame that fits carries no truncation note", () => {
    expect(parseMicrodataOutput(bigTable(3)).tables[0].truncated).toBeUndefined();
  });
});

describe("importedVariables — what the script claims exists", () => {
  // The mock-data engine invents a plausible column for ANY name, so a
  // hallucinated variable runs clean and teaches a variable that is not in
  // the real FDB. Nothing downstream can catch that; only the catalogue can.
  test("finds the variable behind each import, whatever the alias", () => {
    const code = [
      "require no.ssb.fdb:54 as fd",
      "create-dataset demo",
      "import fd/BEFOLKNING_KJOENN as kjonn",
      "import fd/INNTEKT_WLONN 2022-01-01 as inntekt",
      "import-event fd/NPR_HOVEDDIAGNOSE 2015-01-01 2020-12-31 as diag",
      "tabulate kjonn",
    ].join("\n");
    expect(importedVariables(code)).toEqual(["BEFOLKNING_KJOENN", "INNTEKT_WLONN", "NPR_HOVEDDIAGNOSE"]);
  });

  test("a commented-out import is not an import", () => {
    expect(importedVariables("// import fd/GAMMEL as g\nimport fd/NY as n")).toEqual(["NY"]);
  });

  test("a script that imports nothing claims nothing", () => {
    expect(importedVariables("create-dataset demo")).toEqual([]);
  });
});

describe("unknownVariableError — the catalogue is the only authority", () => {
  const catalog = new Set(["BEFOLKNING_KJOENN", "INNTEKT_WLONN", "INNTEKT_WLONN_BONUS", "NPR_HOVEDDIAGNOSE"]);

  test("a script that names only real variables is fine", () => {
    expect(unknownVariableError("import fd/INNTEKT_WLONN as i", catalog)).toBeUndefined();
  });

  test("an invented variable is named, so the repair round can fix it", () => {
    expect(unknownVariableError("import fd/INNTEKT_FANTASI as i", catalog)).toContain("INNTEKT_FANTASI");
  });

  test("the message suggests real variables from the same register", () => {
    const msg = unknownVariableError("import fd/INNTEKT_FANTASI as i", catalog) ?? "";
    expect(msg).toContain("INNTEKT_WLONN");
    expect(msg).not.toContain("NPR_HOVEDDIAGNOSE");
  });

  test("every invented variable is reported, not just the first", () => {
    const msg = unknownVariableError("import fd/AAA as a\nimport fd/BBB as b", catalog) ?? "";
    expect(msg).toContain("AAA");
    expect(msg).toContain("BBB");
  });

  test("an empty catalogue judges nothing — a snapshot that failed to load must not condemn the script", () => {
    expect(unknownVariableError("import fd/WHATEVER as w", new Set())).toBeUndefined();
  });
});

describe("missingModule — the emulator asks for a package in its own words", () => {
  test("its own Norwegian message names the package", () => {
    // Live-caught in the browser: a chart command does NOT raise
    // ModuleNotFoundError, it raises ImportError with this sentence — so
    // matching only "No module named" left every chart broken.
    expect(
      missingModule("FEIL PÅ KOMMANDO 'barchart' (ImportError): plotly må være installert for figurkommandoer. Kjør: pip install plotly"),
    ).toBe("plotly");
  });

  test("and its English one", () => {
    expect(missingModule("ERROR: statsmodels must be installed for regression commands. Run: pip install statsmodels")).toBe("statsmodels");
  });

  test("a plain ModuleNotFoundError still works", () => {
    expect(missingModule("ModuleNotFoundError: No module named 'lifelines'")).toBe("lifelines");
  });

  test("a submodule resolves to its distribution", () => {
    expect(missingModule("No module named 'plotly.express'")).toBe("plotly");
  });

  test("an ordinary failure asks for nothing", () => {
    expect(missingModule("FEIL PÅ KOMMANDO 'summarize' (ValueError): Ingen aktivt datasett.")).toBeNull();
  });
});
