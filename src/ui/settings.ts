import type { Settings } from "../lib/plan";
import { GOLD_PASS_STEPS, JAM } from "../lib/rules";
import { h, nf } from "./dom";
import { sleepControl } from "./sleep";

type Update = (next: Settings) => void;

const passLabel = (g: number) => (g === 0 ? "Aucun" : `${Math.round(g * 100)} %`);

export function medalsSpent(s: Settings): number {
  return (
    s.potions.builder.purchases * JAM.potions.builder.medalPrice +
    s.potions.research.purchases * JAM.potions.research.medalPrice +
    s.heroHammers * JAM.hammers.heroes.medalPrice
  );
}

function select(id: string, value: number, options: [number, string][], onChange: (v: number) => void) {
  const el = h("select", { id, class: "input" }, options.map(([v, l]) => h("option", { value: String(v), selected: v === value }, l)));
  el.addEventListener("change", () => onChange(Number(el.value)));
  return el;
}

function num(id: string, value: number, min: number, max: number, onChange: (v: number) => void) {
  const el = h("input", { id, class: "input", type: "number", inputmode: "numeric", min, max, step: 1, value: String(value) });
  el.addEventListener("change", () => {
    const v = Math.min(max, Math.max(min, Math.floor(Number(el.value) || 0)));
    el.value = String(v);
    onChange(v);
  });
  return el;
}

function check(id: string, checked: boolean, onChange: (v: boolean) => void) {
  const el = h("input", { id, type: "checkbox", class: "checkbox", checked });
  el.addEventListener("change", () => onChange(el.checked));
  return el;
}

const field = (id: string, label: string, control: HTMLElement, hint?: string) =>
  h("div", { class: "field" }, h("label", { for: id }, label), control, hint ? h("p", { class: "hint" }, hint) : null);

const checkField = (id: string, label: string, control: HTMLElement, hint?: string) =>
  h("div", { class: "field field-check" }, control, h("label", { for: id }, label, hint ? h("span", { class: "hint" }, hint) : null));

/** `effective` : réglages réellement utilisés (achats recommandés si le mode automatique est actif). */
export function settingsDialog(s: Settings, effective: Settings, same: boolean, onChange: Update, onSame: (v: boolean) => void): HTMLDialogElement {
  const set = (patch: (d: Settings) => void) => {
    const next = structuredClone(s);
    patch(next);
    onChange(next);
  };
  const passOptions = GOLD_PASS_STEPS.map((g) => [g, passLabel(g)] as [number, string]);
  const spent = medalsSpent(effective);
  const auto = s.autoPurchases;
  const lock = (el: HTMLInputElement) => {
    if (auto) el.disabled = true;
    return el;
  };

  const dlg = h(
    "dialog",
    { class: "settings", "aria-labelledby": "settings-title" },
    h(
      "form",
      { method: "dialog", class: "settings-form" },
      h("div", { class: "settings-head" }, h("h2", { id: "settings-title" }, "Réglages"), h("button", { class: "btn btn-ghost", value: "close" }, "Fermer")),

      h("fieldset", null, h("legend", null, "Pass d'or"),
        field("gp-builder", "Boost ouvrier", select("gp-builder", s.pass.builder, passOptions, (v) => set((d) => { d.pass.builder = v; if (same) d.pass.research = v; }))),
        field("gp-research", "Boost recherche", select("gp-research", s.pass.research, passOptions, (v) => set((d) => { d.pass.research = v; if (same) d.pass.builder = v; }))),
        checkField("gp-same", "Même valeur pour les deux", check("gp-same", same, (v) => { onSame(v); if (v) set((d) => { d.pass.research = d.pass.builder; }); })),
        h("p", { class: "hint" }, "Animaux : boost non confirmé, aucun n'est appliqué."),
      ),

      h("fieldset", null, h("legend", null, "Ouvriers et labo"),
        field("builders", "Ouvriers", select("builders", s.builders, [[5, "5"], [6, "6"]], (v) => set((d) => { d.builders = v; }))),
        checkField("goblin-builder", "Ouvrier gobelin", check("goblin-builder", s.goblinBuilder, (v) => set((d) => { d.goblinBuilder = v; })), "Hypothèse : un ouvrier de plus pendant tout le Jam."),
        checkField("goblin-researcher", "Chercheur gobelin", check("goblin-researcher", s.goblinResearcher, (v) => set((d) => { d.goblinResearcher = v; })), "Hypothèse : une recherche de plus en parallèle."),
        checkField("busy", "Les bâtiments en cours occupent un ouvrier", check("busy", s.countBuildingTimers, (v) => set((d) => { d.countBuildingTimers = v; }))),
      ),

      h("fieldset", null, h("legend", null, "Potions"),
        h("div", { class: "grid-2" },
          field("p-b-own", "Ouvrier en stock", num("p-b-own", s.potions.builder.owned, 0, JAM.potions.maxStock, (v) => set((d) => { d.potions.builder.owned = v; }))),
          field("p-b-buy", "Ouvrier à racheter", lock(num("p-b-buy", effective.potions.builder.purchases, 0, 200, (v) => set((d) => { d.potions.builder.purchases = v; })))),
          field("p-r-own", "Recherche en stock", num("p-r-own", s.potions.research.owned, 0, JAM.potions.maxStock, (v) => set((d) => { d.potions.research.owned = v; }))),
          field("p-r-buy", "Recherche à racheter", lock(num("p-r-buy", effective.potions.research.purchases, 0, 200, (v) => set((d) => { d.potions.research.purchases = v; })))),
          field("p-p-own", "Animaux en stock", num("p-p-own", s.potions.pet.owned, 0, JAM.potions.maxStock, (v) => set((d) => { d.potions.pet.owned = v; }))),
          field("p-p-buy", "Animaux à obtenir", num("p-p-buy", s.potions.pet.purchases, 0, 50, (v) => set((d) => { d.potions.pet.purchases = v; })), "Non vendue en médailles."),
        ),
        field("hammers", "Marteaux de héros", lock(num("hammers", effective.heroHammers, 0, 3, (v) => set((d) => { d.heroHammers = v; }))), "Un tous les 7 jours au plus. Hypothèse : finit le chantier de héros le plus long."),
        h("p", { class: "hint" }, `Stock max : ${JAM.potions.maxStock} de chaque. Les rachats se font au moment de boire.`),
      ),

      h("fieldset", null, h("legend", null, "Médailles de ligue"),
        field("medals", "Médailles sur ton compte", num("medals", s.medals, 0, JAM.medalCap, (v) => set((d) => { d.medals = v; }))),
        checkField("auto-buy", "Calculer les achats pour moi", check("auto-buy", auto, (v) => set((d) => {
          d.autoPurchases = v;
          if (!v) {
            d.potions.builder.purchases = effective.potions.builder.purchases;
            d.potions.research.purchases = effective.potions.research.purchases;
            d.heroHammers = effective.heroHammers;
          }
        })), "Potions et marteaux choisis selon ta stratégie. Décoche pour les saisir toi-même."),
        h("p", { class: spent > s.medals ? "hint error" : "hint" },
          `Rachats prévus : ${nf(spent)} médailles sur ${nf(s.medals)}${spent > s.medals ? " : budget dépassé" : ""}. ` +
          `Prix à vérifier en jeu : ouvrier ${JAM.potions.builder.medalPrice}, recherche ${JAM.potions.research.medalPrice}, marteau de héros ${JAM.hammers.heroes.medalPrice}.`),
      ),

      h("fieldset", null, h("legend", null, "Sommeil"),
        sleepControl("set-sleep", s.sleep, (sl) => set((d) => { d.sleep = sl; })),
      ),
    ),
  );
  return dlg;
}
