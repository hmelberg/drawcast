// The plans as three cards side by side (2026-10-06, Hans: "describe the
// plans briefly … like three cards next to each other that briefly compare
// the plans"). One piece, shown on the front page's Credit & plan and in the
// editor's Settings → Credits — credit lives in both places, one code.
//
// The plans differ only in price and storage; what every plan gives is said
// once, under the cards. Light: subscription.ts and ui/dom.ts only.

import { PLAN_INTRO, PLAN_EVERY, planStatus, type SubStatus } from "./subscription";
import { h } from "./ui/dom";

export interface PlanActions {
  subscribe: (plan: string, button: HTMLButtonElement) => void;
  manage: (button: HTMLButtonElement) => void;
}

export function planCards(sub: SubStatus, act: PlanActions): HTMLElement {
  // Admins count as Business (plans.py), so that card reads as theirs.
  const mine = sub.admin ? "business" : sub.active ? sub.plan : null;
  const cards = Object.entries(sub.plans).map(([id, p]) => {
    const current = id === mine;
    const foot: HTMLElement = current
      ? h("div", { class: "plan-mine" }, "Your plan")
      : (() => {
          const b = h("button", { type: "button", class: "plan-go" }, mine ? "Switch" : "Subscribe") as HTMLButtonElement;
          // Switching is Stripe's Customer Portal; a first plan is a Checkout.
          b.addEventListener("click", () => (mine && sub.manageable ? act.manage(b) : act.subscribe(id, b)));
          return b;
        })();
    return h(
      "div",
      { class: current ? "plan-card current" : "plan-card" },
      h("div", { class: "plan-name" }, p.label),
      h("div", { class: "plan-price" }, `$${p.cents / 100}`, h("span", {}, " / month")),
      h("div", { class: "plan-store" }, `${p.quotaMb.toLocaleString("en-US")} MB on the drawcast server`),
      foot,
    );
  });
  const status = planStatus(sub);
  const manage = h("button", { type: "button", class: "plan-manage" }, "Manage subscription") as HTMLButtonElement;
  manage.addEventListener("click", () => act.manage(manage));
  return h(
    "div",
    { class: "plans" },
    h("p", { class: "plan-intro" }, PLAN_INTRO),
    h("div", { class: "plan-cards" }, ...cards),
    h("p", { class: "plan-every" }, PLAN_EVERY),
    ...(status || sub.manageable ? [h("div", { class: "plan-status" }, ...(status ? [h("span", {}, status)] : []), ...(sub.manageable ? [manage] : []))] : []),
  );
}
