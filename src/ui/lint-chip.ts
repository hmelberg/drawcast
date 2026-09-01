// Decides what the lint chip shows. Non-developers see only error-severity
// issues (a genuinely broken layout, e.g. out-of-canvas); warn-severity lint
// is renderer-quality signal the author cannot fix by editing YAML, so it is
// developer-only. Ruling: review of ROADMAP-2026-09 §F.1(3) → D2 option 2.
export interface LintIssueLike { rule: string; message: string; severity: "warn" | "error" }
export interface LintChipModel { hidden: boolean; className: string; text: string; title: string; items: { text: string; className: string }[] }

export function lintChipModel(issues: LintIssueLike[], warnings: string[], developerMode: boolean): LintChipModel {
  const errors = issues.filter((i) => i.severity === "error");
  if (!developerMode) {
    if (errors.length === 0) return { hidden: true, className: "lint-chip clean", text: "", title: "", items: [] };
    return {
      hidden: false,
      className: "lint-chip error",
      text: `⚠ ${errors.length}`,
      title: `${errors.length} layout ${errors.length === 1 ? "error" : "errors"} — click for details`,
      items: errors.map((i) => ({ text: `${i.rule}: ${i.message}`, className: i.severity })),
    };
  }
  const total = issues.length + warnings.length;
  if (total === 0) return { hidden: false, className: "lint-chip clean", text: "✓ Lint clean", title: "Layout warnings — click for details", items: [] };
  const worst = errors.length > 0 ? "error" : "warn";
  return {
    hidden: false,
    className: `lint-chip ${worst}`,
    text: `⚠ ${total}`,
    title: `${total} layout ${total === 1 ? "warning" : "warnings"} — click for details`,
    items: [...issues.map((i) => ({ text: `${i.rule}: ${i.message}`, className: i.severity })), ...warnings.map((w) => ({ text: w, className: "" }))],
  };
}
