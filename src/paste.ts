// The paste page, drawcast.app/#paste: a standalone page — no editor, no AI,
// no account, like #browse — with one textarea for a drawcast an AI wrote
// (the portable drawcast skill, in claude.ai, ChatGPT, …) and a Play button.
// Play does not play here: it packs the text into a #cast= link
// (links/inline-cast.ts) and goes there, so the viewer plays it with every
// guard a shared link gets, and the address bar ends up holding a link the
// person can keep or send on. entry.ts reloads on the hash change.
//
// What was pasted is kept for this tab (sessionStorage), so Back from the
// viewer — to fix one line and try again — finds it still there.

import "./styles.css";
import { encodeCast } from "./links/inline-cast";
import { h } from "./ui/dom";

const DRAFT_KEY = "drawcast.paste.draft";

function readDraft(): string {
  try {
    return sessionStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(text: string): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, text);
  } catch {
    /* private mode: the draft is simply not kept */
  }
}

/** The hash Play goes to: the pasted text inside a #cast= link. */
export async function pasteHash(text: string): Promise<string> {
  return `#cast=${await encodeCast(text)}`;
}

export function runPaste(): void {
  document.body.classList.add("catalogue-body");
  document.title = "Paste a drawcast — drawcast";
  const heading = h("h1", { class: "cat-heading" }, "Paste a drawcast");
  const lead = h(
    "p",
    { class: "paste-lead" },
    "An AI using the drawcast skill (in Claude, ChatGPT or another assistant) writes a drawcast as YAML or JSON. Paste it here and press Play — nothing is uploaded; the drawcast travels inside the link.",
  );
  const area = h("textarea", {
    class: "paste-text",
    "aria-label": "Paste a drawcast (YAML or JSON)",
    placeholder: "Paste a drawcast (YAML or JSON)",
    spellcheck: "false",
    autocapitalize: "off",
    autocomplete: "off",
  }) as HTMLTextAreaElement;
  area.value = readDraft();
  const play = h("button", { type: "submit", class: "primary paste-play" }, "Play") as HTMLButtonElement;
  const status = h("p", { class: "cat-status", role: "status" });
  const form = h("form", { class: "paste-form" }, area, h("div", { class: "paste-row" }, play, status));
  const root = h("div", { class: "catalogue" }, heading, lead, form);
  document.body.append(root);
  area.focus();

  area.addEventListener("input", () => writeDraft(area.value));
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = area.value;
    if (text.trim() === "") {
      status.textContent = "Paste the drawcast first.";
      status.classList.add("error");
      return;
    }
    writeDraft(text);
    play.disabled = true;
    status.classList.remove("error");
    status.textContent = "";
    void pasteHash(text).then(
      (hash) => {
        // A new history entry, so Back returns here with the draft.
        location.assign(hash);
      },
      (err) => {
        play.disabled = false;
        status.textContent = (err as Error).message;
        status.classList.add("error");
      },
    );
  });
}
