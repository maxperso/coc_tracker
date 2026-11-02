import { findByName, gameIndex } from "../lib/gamedata";
import type { Focus, Settings } from "../lib/plan";
import { GOLD_PASS_STEPS } from "../lib/rules";
import { fmtDateTime, toDate } from "../lib/time";
import type { Village } from "../lib/village";
import { h } from "./dom";
import { sprite } from "./sprite";

const CHOICES: { focus: Focus; title: string; text: string; icons: [string, string][] }[] = [
  {
    focus: "heroes",
    title: "Héros",
    text: "Tous les ouvriers sur les héros. Les bâtiments attendent.",
    icons: [["heroes", "Barbarian King"]],
  },
  {
    focus: "buildings",
    title: "Bâtiments",
    text: "Défenses d'abord, puis armée et ressources. Les héros finissent seulement leur chantier en cours.",
    icons: [["buildings", "Eagle Artillery"]],
  },
  {
    focus: "hybrid",
    title: "Hybride",
    text: "Chaque héros garde un ouvrier. Les ouvriers libres passent aux bâtiments.",
    icons: [["heroes", "Barbarian King"], ["buildings", "Eagle Artillery"]],
  },
];

function icon(category: string, name: string): HTMLElement {
  const e = findByName(gameIndex(), category, name);
  if (!e) return h("span");
  const lvl = category === "buildings" ? (e.levels?.at(-1)?.l ?? 1) : undefined;
  return sprite(category, e, lvl);
}

export function onboardingView(opts: {
  village: Village;
  settings: Settings;
  canCancel: boolean;
  onDone: (s: Settings) => void;
  onCancel: () => void;
}): HTMLElement {
  const draft: Settings = structuredClone(opts.settings);
  const v = opts.village;

  const focusCards = CHOICES.map((c) =>
    h(
      "label",
      { class: "choice" },
      h("input", {
        type: "radio",
        name: "focus",
        value: c.focus,
        class: "visually-hidden",
        checked: draft.focus === c.focus,
        onChange: () => {
          draft.focus = c.focus;
        },
      }),
      h("span", { class: "choice-icons" }, c.icons.map(([cat, name]) => icon(cat, name))),
      h("span", { class: "choice-title" }, c.title),
      h("span", { class: "choice-text" }, c.text),
    ),
  );

  const passButtons = GOLD_PASS_STEPS.map((g) => {
    const b = h(
      "button",
      { type: "button", role: "radio", class: "seg-btn", "aria-checked": String(g === draft.pass.builder) },
      g === 0 ? "Aucun" : `${Math.round(g * 100)} %`,
    );
    b.addEventListener("click", () => {
      draft.pass = { builder: g, research: g };
      passButtons.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    });
    return b;
  });

  const builderButtons = [5, 6].map((n) => {
    const b = h("button", { type: "button", role: "radio", class: "seg-btn", "aria-checked": String(n === draft.builders) }, `${n} ouvriers`);
    b.addEventListener("click", () => {
      draft.builders = n;
      builderButtons.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    });
    return b;
  });
  const goblin = h("input", { type: "checkbox", id: "ob-goblin", class: "checkbox", checked: draft.goblinBuilder });
  goblin.addEventListener("change", () => (draft.goblinBuilder = goblin.checked));

  return h(
    "main",
    { class: "page onboarding" },
    h("p", { class: "eyebrow" }, `${v.tag} · HDV ${v.th} · export du ${fmtDateTime(toDate(v.timestamp, 0))}`),
    h("h1", { class: "title" }, "Que veux-tu monter pendant le Jam ?"),
    h("p", { class: "lead" }, "Le plan s'adapte à ton choix. Tu pourras le changer à tout moment."),
    h(
      "form",
      {
        class: "onboarding-form",
        onSubmit: (e: Event) => {
          e.preventDefault();
          opts.onDone(draft);
        },
      },
      h("fieldset", { class: "plain" }, h("legend", { class: "visually-hidden" }, "Priorité"), h("div", { class: "choices" }, focusCards)),
      h(
        "div",
        { class: "card form-card" },
        h("div", { class: "form-row" }, h("span", { class: "form-label", id: "ob-pass" }, "Pass d'or"), h("div", { class: "segmented", role: "radiogroup", "aria-labelledby": "ob-pass" }, passButtons)),
        h("div", { class: "form-row" }, h("span", { class: "form-label", id: "ob-builders" }, "Ouvriers"), h("div", { class: "segmented seg-2", role: "radiogroup", "aria-labelledby": "ob-builders" }, builderButtons)),
        h("div", { class: "field-check" }, goblin, h("label", { for: "ob-goblin" }, "J'ai aussi un ouvrier gobelin")),
      ),
      h(
        "div",
        { class: "form-actions" },
        opts.canCancel ? h("button", { type: "button", class: "btn btn-ghost", onClick: opts.onCancel }, "Annuler") : null,
        h("button", { type: "submit", class: "btn btn-primary" }, "Voir mon plan"),
      ),
    ),
  );
}
