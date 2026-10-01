// src/ui/share-box.ts
// The Share box (spec 2026-10-02-share-design §6): the card as a feed will
// show it, the link, an optional comment, and where to send it — the
// device's own share sheet where there is one, a short list of platforms
// everywhere. Nothing is posted by drawcast: every button opens the
// platform's own share page, or the mail app, with the link filled in.
// Built only when opened — vitest imports this file with no DOM.
import { COMMENT_MAX, platformUrl, TAKES_TEXT, type Platform, type ShareLink } from "../share/link";
import { h } from "./dom";
import { icon } from "./icons";
import { createModal } from "./modal";

export interface ShareInfo {
  link: ShareLink;
  title: string;
  subtitle?: string;
  /** Absolute /card/… URL; absent where only a plain card is possible. */
  image?: string;
}

export const DESKTOP_PLATFORMS: Platform[] = ["email", "facebook", "linkedin", "x", "bluesky", "whatsapp"];

const LABEL: Record<Platform, string> = { email: "Email", facebook: "Facebook", linkedin: "LinkedIn", x: "X", bluesky: "Bluesky", whatsapp: "WhatsApp" };

/** netlify/lib/share-card.mts cardPathFor's rule, on a full /c/ URL. */
export function cardImageUrl(link: ShareLink): string | undefined {
  if (!link.card) return undefined;
  const u = new URL(link.url);
  if (!u.pathname.startsWith("/c/")) return undefined;
  const rest = u.pathname.slice("/c/".length);
  const png = rest.startsWith("gh/") ? `${rest.replace(/\.ya?ml$/i, "")}.png` : `${rest}.png`;
  return `${u.origin}/card/${png}`;
}

let current: HTMLDialogElement | null = null;

function flash(btn: HTMLElement, text: string, back: string): void {
  btn.textContent = text;
  window.setTimeout(() => (btn.textContent = back), 1600);
}

export function openShareBox(info: ShareInfo): void {
  current?.remove();
  const note = h("p", { class: "share-note", role: "status" });
  const say = (s: string): void => {
    note.textContent = s;
  };

  const preview = h(
    "div",
    { class: "share-card" },
    ...(info.image ? [h("img", { src: info.image, alt: "" })] : [h("p", { class: "share-plain" }, "Links to this cast show a plain card.")]),
    h("strong", {}, info.title),
    ...(info.subtitle ? [h("span", {}, info.subtitle)] : []),
  );

  const linkField = h("input", { type: "text", readonly: "", value: info.link.url, "aria-label": "Link" });
  const copyLink = h("button", { type: "button" }, "Copy link");
  copyLink.addEventListener("click", () => {
    void navigator.clipboard?.writeText(info.link.url).then(
      () => flash(copyLink, "Copied", "Copy link"),
      () => linkField.select(),
    );
  });

  const comment = h("textarea", { rows: "2", maxlength: String(COMMENT_MAX), placeholder: "Add a comment (optional)", "aria-label": "Comment" });
  const state = () => ({ url: info.link.url, title: info.title, comment: comment.value });

  const items = DESKTOP_PLATFORMS.map((p) => {
    const a = h("a", { href: platformUrl(p, state()), target: "_blank", rel: "noopener" }, LABEL[p]);
    a.addEventListener("click", () => {
      if (!TAKES_TEXT[p] && comment.value.trim()) {
        const failed = () => say("Copy your comment yourself — it was not copied.");
        if (!navigator.clipboard) failed();
        else navigator.clipboard.writeText(comment.value.trim()).then(() => say("Your comment is copied — paste it into the post."), failed);
      }
    });
    return { p, a };
  });
  comment.addEventListener("input", () => {
    for (const { p, a } of items) a.href = platformUrl(p, state());
  });
  const list = h("ul", { class: "share-list" }, ...items.map(({ a }) => h("li", {}, a)));

  // Fetched now so the Share… click is still a user gesture when it fires.
  let file: File | null = null;
  if (info.image) {
    void fetch(info.image)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b) file = new File([b], "drawcast.png", { type: b.type || "image/png" });
      })
      .catch(() => undefined);
  }

  const native: HTMLElement[] = [];
  if (typeof navigator.share === "function") {
    const btn = h("button", { type: "button", class: "share-native" }, icon("share"), " Share…");
    btn.addEventListener("click", () => {
      const data: ShareData = { title: info.title, text: comment.value.trim() || info.title, url: info.link.url };
      if (file && navigator.canShare?.({ files: [file] })) data.files = [file];
      navigator.share(data).catch(() => undefined);
    });
    native.push(btn, h("p", { class: "share-or" }, "Or share to"));
  }

  const extra: HTMLElement[] = [];
  if (info.image && "ClipboardItem" in window) {
    const copyImage = h("button", { type: "button" }, "Copy image");
    copyImage.addEventListener("click", () => {
      // clipboard.write must start inside the click (Safari, Firefox), so the
      // item takes a promise of the blob rather than waiting for it here.
      const blob = fetch(info.image!).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      });
      try {
        navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(
          () => flash(copyImage, "Copied", "Copy image"),
          () => say("Could not copy the picture"),
        );
      } catch {
        say("Could not copy the picture");
      }
    });
    extra.push(copyImage);
  }

  const modal = createModal("Share", { size: "s", class: "share-box" });
  const dlg = modal.dialog;
  dlg.setAttribute("aria-label", "Share this drawcast");
  modal.body.append(preview, h("div", { class: "share-row" }, linkField, copyLink), comment, ...native, list, ...extra, note);
  dlg.addEventListener("close", () => {
    dlg.remove();
    if (current === dlg) current = null;
  });
  document.body.appendChild(dlg);
  current = dlg;
  modal.open();
  copyLink.focus();
}
