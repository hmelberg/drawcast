// <drawcast-figure> — declarative wrapper around the embed render(). Light
// DOM on purpose: the injected .cs-* styles are namespaced, and light DOM
// keeps document-level fonts working. The spec is the element's text content:
//
//   <drawcast-figure look="clean" mode="silent" speed="1.5" autoplay>
//     title: Demand increase
//     template: supply_demand
//     ...
//   </drawcast-figure>
//
// "look", not "style" — style is the HTML style attribute. The render handle
// is exposed as el.handle once el.ready resolves.
import { render, loadSpecText } from "./engine-render";
import type { RenderHandle } from "./render";

export interface FigureAttrs {
  look: "sketchy" | "clean";
  mode: "narrated" | "silent" | "instant";
  speed: number;
  autoplay: boolean;
}

/** Pure attribute parsing, exported for tests. */
export function parseFigureAttrs(get: (name: string) => string | null): FigureAttrs {
  const mode = get("mode");
  return {
    look: get("look") === "clean" ? "clean" : "sketchy",
    mode: mode === "silent" || mode === "instant" ? mode : "narrated",
    speed: parseFloat(get("speed") ?? "") || 1,
    autoplay: get("autoplay") !== null,
  };
}

// Node-import safety (the build smoke script imports this module without a
// DOM): fall back to a dummy base class when HTMLElement is absent.
const Base = (typeof HTMLElement !== "undefined" ? HTMLElement : (class {} as unknown)) as typeof HTMLElement;

export class DrawcastFigure extends Base {
  handle: RenderHandle | null = null;
  ready: Promise<void> = Promise.resolve();

  connectedCallback(): void {
    const text = this.textContent ?? "";
    this.textContent = "";
    this.ready = this.mount(text);
  }

  private async mount(text: string): Promise<void> {
    const attrs = parseFigureAttrs((n) => this.getAttribute(n));
    try {
      const loaded = await loadSpecText(text);
      if (loaded.errors.length > 0) throw new Error(loaded.errors.join("; "));
      const handle = await render(loaded.spec, this, { style: attrs.look, mode: attrs.mode, speed: attrs.speed });
      // The element may have been disconnected while the awaits above were
      // pending. disconnectedCallback ran while `handle` was still null (a
      // no-op), so without this guard the fresh handle would be assigned to
      // a torn-down element and its timeline/effects would never be
      // destroyed. Destroy it immediately instead and skip autoplay.
      if (!this.isConnected) {
        handle.destroy();
        return;
      }
      this.handle = handle;
      if (attrs.autoplay) void this.handle.timeline.play().catch(() => {});
    } catch (err) {
      const pre = document.createElement("pre");
      pre.style.cssText = "color:#b91c1c;font-size:0.85rem;white-space:pre-wrap;";
      pre.textContent = "drawcast-figure: " + (err instanceof Error ? err.message : String(err));
      this.appendChild(pre);
    }
  }

  disconnectedCallback(): void {
    this.handle?.destroy();
    this.handle = null;
  }
}

export function defineDrawcastFigure(): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get("drawcast-figure")) customElements.define("drawcast-figure", DrawcastFigure);
}
