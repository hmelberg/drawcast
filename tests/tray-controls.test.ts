// Source-level pins for the tray's controls group (no DOM in this repo):
// the rows must rewrite the AUTHORED script (tuples intact) and run through
// runEdited, values must die with the preview, and the group must be built
// from the tray plan's `controls`. Since 2026-09-15 the DRAWN panel is the
// other live copy (ui/controls-host.ts) — there is no HTML card any more.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/ui/tray.ts", "utf8");
const css = readFileSync("src/styles.css", "utf8");

describe("tray controls (pins)", () => {
  test("controls parse the authored element, not the resolved clone", () => {
    expect(src).toMatch(/parseControls\(\s*[^)]*authoredEl\.code/);
  });
  test("a control change runs the rewritten script through runEdited", () => {
    expect(src).toMatch(/const code = applyControls\([^)]*authoredCode[\s\S]{0,200}?runEdited\(el, code, "controls"\)/);
  });
  test("control values are cleared with the preview", () => {
    expect(src).toMatch(/const clearPreview[\s\S]*?controlValues\.clear\(\)/);
  });
  test("a control move never overwrites a script the viewer took over", () => {
    expect(src).toMatch(/takenOver\.add\(el\.id\)[\s\S]{0,200}?cs-tray-controls-quiet/);
  });
  test("the group is built from plan.controls", () => {
    expect(src).toContain("plan.controls");
    expect(src).toContain("controlIds:");
  });
  test("a click during playback on a control-bearing panel pauses first, then opens that script (spec §2.6)", () => {
    const i = src.indexOf("hd.timeline.state === \"playing\"", src.indexOf("const screenAt"));
    const region = src.slice(i, i + 1200);
    expect(region).toContain("hd.timeline.pause()");
    expect(region).toMatch(/open\(\{ onCode: /);
    expect(region.indexOf("hd.timeline.pause()")).toBeLessThan(region.indexOf("open({ onCode:"));
  });
  test("the drawn panel is the live control: the tray builds the host from its own closures and attaches it (spec 2026-09-15 §3)", () => {
    expect(src).toMatch(/import \{ attachControlsHost, controlsHostFor \} from "\.\/controls-host";/);
    expect(src).toMatch(/const controlsHost = controlsHostFor\(\{/);
    expect(src).toMatch(/attachControlsHost\(stage, controlsHost, \{/);
    expect(src).not.toMatch(/controls-card/);
    expect(src).not.toMatch(/syncControlsGroup/);
    expect(src).not.toMatch(/controlsCards/);
  });
  test("the host is disabled while the tray is open (one live copy at a time)", () => {
    expect(src).toMatch(/enabled: \(\) => tray\.hidden/);
  });
  test("a commit relays the panel from the rewritten script at once (the knob follows the pointer), then the run follows the debounce", () => {
    const i = src.indexOf("const previewKnobs");
    expect(i).toBeGreaterThan(-1);
    const body = src.slice(i, i + 900);
    expect(body).toContain("applyControls(");
    expect(body).toContain("patches.set(el.id, { code");
    expect(body).toContain("requestAnimationFrame");
    const commit = src.slice(src.indexOf("commit: (c, raw, immediate) =>"), src.indexOf("run: () => runControls"));
    expect(commit.indexOf("previewKnobs(")).toBeLessThan(commit.indexOf("runControls("));
  });
  test("a paused click on a pane: controls panel is the host's, not the editor's or the tray's", () => {
    // Anchored in the stage click handler AND ordered: the guard must come
    // BEFORE openInPlace, or the editor card opens on the panel first and the
    // guard below it never runs (fix round 1).
    const region = src.slice(src.indexOf("const screenAt"));
    const guard = region.search(/if \(el\?\.pane === "controls"\) \{\s*e\.stopPropagation\(\);\s*return;\s*\}/);
    const opener = region.indexOf("if (el && openInPlace(el)) return;");
    expect(guard).toBeGreaterThan(-1);
    expect(opener).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(opener);
  });
  test("the explore beat on a pane: controls script holds the run with the tray SHUT: pause, hook Continue, no open()", () => {
    const i = src.indexOf("hd.timeline.exploreGate =");
    const region = src.slice(i, i + 3000);
    expect(region).toMatch(/const shut = [\s\S]{0,200}pane === "controls"/);
    expect(region).toMatch(/if \(shut\) \{[\s\S]{0,400}hd\.timeline\.pause\(\);[\s\S]{0,400}\}/);
    expect(region).toMatch(/if \(!shut\) open\(\{ filter: step\.params, gated: true/);
  });
  test("Continue through the play gesture: the hook resolves the gate and resumes the paused timeline", () => {
    expect(src).toMatch(/registerContinue\(stage, \(\) => \{[\s\S]{0,300}gateResolve !== null && tray\.hidden[\s\S]{0,300}continueNow\(\);[\s\S]{0,100}return true;/);
    const i = src.indexOf("const continueNow");
    const body = src.slice(i, i + 900);
    expect(body).toMatch(/if \(hd\.timeline\.state === "paused"\) void hd\.timeline\.play\(\);/);
  });
  test("the tray's cursor rule leaves pane: controls panels to the host", () => {
    expect(src).toMatch(/cs-editable[\s\S]{0,300}pane !== "controls"/);
  });
  test("the shut-tray gate hides the centred ▶ with a class of its own: on while it holds, off on Continue and on abort (fix round 1)", () => {
    const i = src.indexOf("hd.timeline.exploreGate =");
    const region = src.slice(i, i + 3000);
    expect(region).toMatch(/if \(shut\) \{[\s\S]{0,500}classList\.add\("cs-gated"\)/);
    // From `const shut`, so the GAME gate's own onAbort a few lines above
    // (which closes the emulator) cannot stand in for the explore one.
    const from = region.indexOf("const shut =");
    const abort = region.slice(region.indexOf("const onAbort", from), region.indexOf('signal.addEventListener("abort"', from));
    expect(abort).toMatch(/classList\.remove\("cs-gated"\)/);
    const cont = src.slice(src.indexOf("const continueNow"), src.indexOf("const paneBoxOf"));
    expect(cont).toMatch(/classList\.remove\("cs-gated"\)/);
    // NOT cs-exploring: its freezeClick guard would swallow the very
    // figure-click that IS Continue while the tray is shut.
    expect(region).not.toMatch(/if \(shut\) \{[\s\S]{0,500}classList\.add\("cs-exploring"\)/);
    expect(css).toMatch(/\.cs-stage\.cs-gated \.cs-bigplay \{ display: none; \}/);
  });
  test("controls used OUTSIDE the tray settle too: a live preview patch when the run resumes is thrown away and the boundary settled (fix round 1)", () => {
    expect(src).toMatch(/s === "playing" && \(!tray\.hidden \|\| editors\.size > 0 \|\| patches\.size > 0\)/);
    const body = src.slice(src.indexOf('s === "playing" && (!tray.hidden'), src.length).slice(0, 500);
    expect(body).toContain("clearPreview();");
    expect(body).toContain("hd.timeline.settleParams();");
  });
  test("a knob frame scheduled in the same tick as Continue never re-dirties the settled geometry (fix round 1)", () => {
    const body = src.slice(src.indexOf("const clearPreview"), src.indexOf("const draftOf"));
    expect(body).toMatch(/if \(knobFrame !== null\) cancelAnimationFrame\(knobFrame\);/);
    expect(body).toMatch(/knobFrame = null;/);
  });
});
