// The figure's own look (.cs-stage/.cs-svg/.cs-caption/.cs-title), injected
// as a <style> tag by render() — a host page needs no stylesheet for figures
// to look right. Single source: styles.css no longer carries these base
// rules (it keeps only app chrome and overrides like :fullscreen sizes).
// The var() fallbacks are the app's own :root values, so the rules are
// self-contained outside drawcast while the app's variables still win inside.
const FIGURE_CSS = `
.cs-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  background: #fffefb;
  border: 1px solid #eee8da;
  border-radius: 4px;
  overflow: hidden;
}
.cs-svg { width: 100%; height: 100%; display: block; }
.cs-caption {
  position: relative;
  min-height: 3.1rem;
  padding: 0.35rem 0.8rem 0.15rem;
  font-family: var(--sketch-font, "Patrick Hand", "Segoe Print", "Comic Sans MS", cursive);
  font-size: 1.15rem;
  line-height: 1.3;
  text-align: center;
  color: var(--ink, #3d3833);
}
.cs-caption-empty::before { content: "\\00a0"; }
/* Selecting a phrase in the caption offers to look it up — the viewer draws
   the boundary, which no phrase detector does reliably. */
.cs-lookup {
  position: absolute;
  z-index: 7;
  transform: translate(-50%, -100%);
  padding: 0.08rem 0.5rem;
  font-family: inherit;
  font-size: 0.8rem;
  line-height: 1.4;
  color: #b5482e;
  background: #fffefb;
  border: 1.5px solid #eee8da;
  border-radius: 999px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.cs-lookup:hover { border-color: #b5482e; }
.cs-title {
  font-family: var(--sketch-font, "Patrick Hand", "Segoe Print", "Comic Sans MS", cursive);
  font-size: 1.3rem;
  color: var(--ink, #3d3833);
  text-align: center;
  width: fit-content;
  padding: 0 0.4rem;
  margin: 0.05rem auto 0.1rem;
  max-width: 90%;
}
`;

let injected = false;

export function ensureFigureStyles(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.dataset.drawcastFigureStyles = "";
  style.textContent = FIGURE_CSS;
  document.head.appendChild(style);
}
