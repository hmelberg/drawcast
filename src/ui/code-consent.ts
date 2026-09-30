// The consent prompt for code that came with a drawcast (security/code-trust.ts).
// One calm modal in the app's own chrome: what the cast carries, what running
// it means, and two answers. Closing it any other way (✕, ESC, a click
// outside) is "Show without it" — the safe answer is the default.

import { h } from "./dom";
import { createModal } from "./modal";
import { setConsentHandler, type CodeItem } from "../security/code-trust";

const LANGUAGE_NAMES: Record<string, string> = {
  python: "Python",
  r: "R",
  brython: "Python (Brython)",
  microdata: "microdata",
};

/** "a custom template and a Python script" — what the cast carries, in words. Exported for tests. */
export function describeItems(items: CodeItem[]): string {
  const templates = items.filter((i) => i.kind === "template").length;
  const scripts = items.filter((i) => i.kind === "code");
  const langs = [...new Set(scripts.map((s) => LANGUAGE_NAMES[s.language ?? ""] ?? s.language ?? "code"))];
  const parts: string[] = [];
  if (templates > 0) parts.push(templates === 1 ? "a custom template" : `${templates} custom templates`);
  if (scripts.length > 0) {
    const n = new Set(scripts.map((s) => s.name)).size;
    parts.push(`${n === 1 ? "a" : n} ${langs.join(" and ")} script${n === 1 ? "" : "s"}`);
  }
  return parts.join(" and ") || "custom code";
}

export function askToRunCode(items: CodeItem[]): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = createModal("This drawcast contains code", { size: "s", class: "code-consent" });
    let answer = false;
    modal.body.append(
      h("p", {}, `Its author included ${describeItems(items)}. That code would run in this page with the same access drawcast has — including what this browser keeps signed in or saved for drawcast, such as an API key.`),
      h("p", {}, "Run it only if you trust where this drawcast came from. Without it you still see the drawing: scripts show the output their author saved, and a custom template is drawn without its own layout."),
    );
    const without = h("button", {}, "Show without it");
    const run = h("button", { class: "primary" }, "Run it");
    without.addEventListener("click", () => modal.dialog.close());
    run.addEventListener("click", () => {
      answer = true;
      modal.dialog.close();
    });
    modal.footer.append(without, run);
    modal.dialog.addEventListener("close", () => {
      modal.dialog.remove();
      resolve(answer);
    });
    document.body.appendChild(modal.dialog);
    modal.open();
    // The safe answer has the focus: Enter never runs a stranger's code by accident.
    without.focus();
  });
}

/** Install the prompt as this page's consent handler. */
export function installCodeConsent(): void {
  setConsentHandler(askToRunCode);
}
