import type { Sleep } from "../lib/potionPlan";
import { h } from "./dom";

const DEFAULT_SLEEP: Sleep = { start: 23, end: 7 };

/**
 * Plage de sommeil : « Je dors » avec heures de coucher et de réveil (heure de Paris),
 * ou « Chu » pour qui ne dort pas et relance à toute heure.
 */
export function sleepControl(id: string, value: Sleep | null, onChange: (s: Sleep | null) => void): HTMLElement {
  let range: Sleep = value ?? DEFAULT_SLEEP;
  let sleeping = value != null;

  const hourSelect = (sub: string, label: string, current: number, pick: (v: number) => void) => {
    const sel = h(
      "select",
      { id: `${id}-${sub}`, class: "input" },
      Array.from({ length: 24 }, (_, i) => h("option", { value: String(i), selected: i === current }, `${i} h`)),
    );
    sel.addEventListener("change", () => pick(Number(sel.value)));
    return h("div", { class: "field" }, h("label", { for: `${id}-${sub}` }, label), sel);
  };

  const hours = h(
    "div",
    { class: "grid-2 sleep-hours" },
    hourSelect("start", "Coucher", range.start, (v) => {
      range = { ...range, start: v };
      onChange(range);
    }),
    hourSelect("end", "Réveil", range.end, (v) => {
      range = { ...range, end: v };
      onChange(range);
    }),
    h("p", { class: "hint span-2" }, "Heure de Paris. Pendant ton sommeil, aucun chantier n'est relancé et aucune potion n'est bue."),
  );
  const chuHint = h("p", { class: "hint" }, "Tu ne dors pas : le plan relance à toute heure, même à 3 h du matin.");

  const buttons = [
    { chu: false, label: "Je dors" },
    { chu: true, label: "Chu" },
  ].map(({ chu, label }) => {
    const b = h("button", { type: "button", role: "radio", class: "seg-btn", "aria-checked": String(chu !== sleeping) }, label);
    b.addEventListener("click", () => {
      sleeping = !chu;
      sync();
      onChange(sleeping ? range : null);
    });
    return b;
  });

  const sync = () => {
    buttons.forEach((b, i) => b.setAttribute("aria-checked", String((i === 1) !== sleeping)));
    hours.hidden = !sleeping;
    chuHint.hidden = sleeping;
  };
  sync();

  return h(
    "div",
    { class: "sleep" },
    h(
      "div",
      { class: "form-row" },
      h("span", { class: "form-label", id: `${id}-label` }, "Sommeil"),
      h("div", { class: "segmented seg-2", role: "radiogroup", "aria-labelledby": `${id}-label` }, buttons),
    ),
    hours,
    chuHint,
  );
}

export function sleepLabel(s: Sleep | null): string {
  return s ? `sommeil ${s.start} h - ${s.end} h` : "Chu, pas de sommeil";
}
