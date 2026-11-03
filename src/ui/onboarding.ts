import { findByName, gameIndex } from "../lib/gamedata";
import type { Focus, Settings } from "../lib/plan";
import { GOLD_PASS_STEPS, JAM } from "../lib/rules";
import { fmtDateTime, toDate } from "../lib/time";
import type { Village } from "../lib/village";
import { h } from "./dom";
import { icon as svgIcon } from "./icons";
import { sleepControl } from "./sleep";
import { stockFields, withStock } from "./stockFields";
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
    icons: [["buildings", "Cannon"]],
  },
  {
    focus: "hybrid",
    title: "Hybride",
    text: "Chaque héros garde un ouvrier. Les ouvriers libres passent aux bâtiments.",
    icons: [["heroes", "Barbarian King"], ["buildings", "Cannon"]],
  },
  {
    focus: "custom",
    title: "Perso",
    text: "Tu classes tout toi-même, de A à Z : héros, bâtiments, labo, animaux. Tu pars de l'ordre hybride.",
    icons: [["heroes", "Barbarian King"], ["buildings", "Laboratory"]],
  },
];

/** Sprite dans un cadre de taille fixe : héros et bâtiments ont le même encombrement. */
function icon(category: string, name: string): HTMLElement {
  const e = findByName(gameIndex(), category, name);
  if (!e) return h("span");
  const lvl = category === "buildings" ? (e.levels?.at(-1)?.l ?? 1) : undefined;
  return h("span", { class: "choice-icon" }, sprite(category, e, lvl));
}

function segmented<T>(id: string, values: readonly T[], current: T, label: (v: T) => string, pick: (v: T) => void, cls = "segmented"): HTMLElement {
  const buttons = values.map((v) => {
    const b = h("button", { type: "button", role: "radio", class: "seg-btn", "aria-checked": String(v === current) }, label(v));
    b.addEventListener("click", () => {
      buttons.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      pick(v);
    });
    return b;
  });
  return h("div", { class: cls, role: "radiogroup", "aria-labelledby": id }, buttons);
}

const STEPS = ["Priorité", "Ton village", "Ton rythme"];

export function onboardingView(opts: {
  village: Village;
  settings: Settings;
  canCancel: boolean;
  /** Nouvel export : le champ des médailles est vide et obligatoire. */
  askMedals: boolean;
  onDone: (s: Settings) => void;
  onCancel: () => void;
}): HTMLElement {
  const draft: Settings = structuredClone(opts.settings);
  const v = opts.village;
  let step = 0;

  /* Étape 1 : priorité */
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
      h("span", { class: "choice-check", "aria-hidden": "true" }, svgIcon("check", 16)),
    ),
  );

  /* Étape 2 : Pass d'or, ouvriers, médailles */
  const medals = h("input", {
    id: "ob-medals",
    class: "input input-num",
    type: "number",
    inputmode: "numeric",
    min: 0,
    max: JAM.medalCap,
    step: 1,
    required: true,
    placeholder: opts.askMedals ? `ex. ${opts.settings.medals}` : "",
    value: opts.askMedals ? "" : String(draft.medals),
    "aria-describedby": "ob-medals-hint",
  });
  const stock = stockFields("ob-stock", draft);
  const goblin = h("input", { type: "checkbox", id: "ob-goblin", class: "checkbox", checked: draft.goblinBuilder });
  goblin.addEventListener("change", () => (draft.goblinBuilder = goblin.checked));

  const panels = [
    h("fieldset", { class: "plain" }, h("legend", { class: "visually-hidden" }, "Priorité"), h("div", { class: "choices" }, focusCards)),
    h(
      "div",
      { class: "card form-card" },
      h(
        "div",
        { class: "form-row" },
        h("span", { class: "form-label", id: "ob-pass" }, "Pass d'or"),
        segmented("ob-pass", GOLD_PASS_STEPS, draft.pass.builder, (g) => (g === 0 ? "Aucun" : `${Math.round(g * 100)} %`), (g) => (draft.pass = { builder: g, research: g })),
      ),
      h(
        "div",
        { class: "form-row" },
        h("span", { class: "form-label", id: "ob-builders" }, "Ouvriers"),
        segmented("ob-builders", [5, 6], draft.builders, (n) => `${n} ouvriers`, (n) => (draft.builders = n), "segmented seg-2"),
      ),
      h("div", { class: "field-check" }, goblin, h("label", { for: "ob-goblin" }, "J'ai aussi un ouvrier gobelin")),
      h("div", { class: "form-row" }, h("label", { class: "form-label", for: "ob-medals" }, "Médailles de ligue sur ton compte"), medals),
      h("p", { class: "hint", id: "ob-medals-hint" }, `Au moment de l'export, ${JAM.medalCap} au plus. Le plan te dira quoi acheter avec.`),
      stock.el,
    ),
    h(
      "div",
      { class: "card form-card" },
      sleepControl("ob-sleep", draft.sleep, (sl) => {
        draft.sleep = sl;
      }),
    ),
  ];

  const dots = h("ol", { class: "stepper", "aria-label": "Étapes" }, STEPS.map((label) => h("li", null, h("span", { class: "stepper-dot" }), h("span", { class: "stepper-label" }, label))));
  const back = h("button", { type: "button", class: "btn btn-ghost" }, svgIcon("arrowLeft", 18), "Retour");
  const next = h("button", { type: "submit", class: "btn btn-primary" });
  const cancel = opts.canCancel ? h("button", { type: "button", class: "btn btn-ghost", onClick: opts.onCancel }, "Annuler") : null;

  const show = () => {
    panels.forEach((p, i) => (p.hidden = i !== step));
    [...dots.children].forEach((li, i) => {
      li.className = i < step ? "done" : i === step ? "current" : "";
      if (i === step) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    back.hidden = step === 0;
    if (cancel) cancel.hidden = step !== 0;
    next.replaceChildren(step === STEPS.length - 1 ? "Voir mon plan" : "Suivant", svgIcon("arrowRight", 18));
  };
  back.addEventListener("click", () => {
    step = Math.max(0, step - 1);
    show();
  });

  const form = h(
    "form",
    {
      class: "onboarding-form",
      // Validation à la main, étape par étape : les champs des étapes masquées ne bloquent pas.
      novalidate: true,
      onSubmit: (e: Event) => {
        e.preventDefault();
        if (step === 1 && !medals.reportValidity()) return;
        if (step < STEPS.length - 1) {
          step++;
          show();
          window.scrollTo(0, 0);
          return;
        }
        draft.medals = Math.min(JAM.medalCap, Math.max(0, Math.floor(Number(medals.value) || 0)));
        opts.onDone(withStock(draft, stock.read()));
      },
    },
    dots,
    panels,
    h("div", { class: "form-actions" }, cancel, back, next),
  );
  show();

  return h(
    "main",
    { class: "page onboarding" },
    h("p", { class: "eyebrow" }, `${v.tag} · HDV ${v.th} · export du ${fmtDateTime(toDate(v.timestamp, 0))}`),
    h("h1", { class: "title" }, "Que veux-tu monter pendant le Jam ?"),
    h("p", { class: "lead" }, "Trois questions, et le plan s'adapte. Tu pourras tout changer ensuite."),
    form,
  );
}
