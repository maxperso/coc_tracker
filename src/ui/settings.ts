import { CWL_HEROES, CWL_MAX_DAYS, cwlHeroKeys } from "../lib/cwl";
import type { Settings } from "../lib/plan";
import { GOLD_PASS_STEPS, JAM } from "../lib/rules";
import { addDays, fmtDay, parisDayKey, parisTimeToUnix } from "../lib/time";
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

export interface HeroOption {
  /** Clé de chaîne, « heroes:<id> ». */
  key: string;
  label: string;
}

/** Ligue de clans : jours et heure d'attaque, héros à garder libres. */
function cwlFieldset(s: Settings, heroes: HeroOption[], set: (patch: (d: Settings) => void) => void): HTMLElement {
  const c = s.cwl;
  const on = checkField(
    "cwl-on",
    "Je fais la Ligue de clans",
    check("cwl-on", c.enabled, (v) => set((d) => {
      d.cwl.enabled = v;
      if (v && !d.cwl.firstDay) d.cwl.firstDay = parisDayKey(new Date());
    })),
    `Le plan garde ${CWL_HEROES} héros libres à ton heure d'attaque, chaque jour de la ligue.`,
  );
  if (!c.enabled) return h("fieldset", null, h("legend", null, "Ligue de clans"), on);

  const day = h("input", { id: "cwl-day", class: "input", type: "date", value: c.firstDay, required: true });
  day.addEventListener("change", () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day.value)) set((d) => { d.cwl.firstDay = day.value; });
  });
  const hours = Array.from({ length: 24 }, (_, i) => [i, `${i} h`] as [number, string]);
  const days = Array.from({ length: CWL_MAX_DAYS }, (_, i) => [i + 1, i + 1 === CWL_MAX_DAYS ? `${i + 1} (ligue entière)` : String(i + 1)] as [number, string]);

  const chosen = new Set(cwlHeroKeys(c, heroes));
  const heroChecks = heroes.map((hero, i) => {
    const id = `cwl-hero-${i}`;
    const box = check(id, chosen.has(hero.key), (v) => set((d) => {
      d.cwl.heroes = heroes.filter((x) => (x.key === hero.key ? v : chosen.has(x.key))).map((x) => x.key);
    }));
    // Au plus 4 héros, au moins 1.
    if (chosen.has(hero.key) ? chosen.size === 1 : chosen.size >= CWL_HEROES) box.disabled = true;
    return h("div", { class: "field field-check" }, box, h("label", { for: id }, hero.label));
  });

  const first = c.firstDay ? new Date(parisTimeToUnix(c.firstDay, 12) * 1000) : null;
  const last = c.firstDay ? new Date(parisTimeToUnix(addDays(c.firstDay, c.days - 1), 12) * 1000) : null;
  return h(
    "fieldset",
    null,
    h("legend", null, "Ligue de clans"),
    on,
    h("div", { class: "grid-2" },
      field("cwl-day", "Premier jour d'attaque", day),
      field("cwl-hour", "Heure de l'attaque", select("cwl-hour", c.hour, hours, (v) => set((d) => { d.cwl.hour = v; }))),
    ),
    field("cwl-days", "Jours d'attaque", select("cwl-days", c.days, days, (v) => set((d) => { d.cwl.days = v; }))),
    h("div", { class: "field" },
      h("p", { class: "form-label" }, `Héros emmenés (${chosen.size}/${CWL_HEROES})`),
      h("div", { class: "grid-2 cwl-heroes" }, heroChecks),
    ),
    h("p", { class: "hint" },
      first && last
        ? `Du ${fmtDay(first)} au ${fmtDay(last)}, à ${c.hour} h (heure de Paris). Ces héros ne partent en amélioration que si elle finit avant l'attaque suivante ; les autres héros ne changent pas.`
        : "Choisis le premier jour d'attaque."),
  );
}

/** `effective` : réglages réellement utilisés (achats recommandés si le mode automatique est actif). */
export function settingsDialog(
  s: Settings,
  effective: Settings,
  same: boolean,
  onChange: Update,
  onSame: (v: boolean) => void,
  /** Choix de l'apparence, affiché en tête des réglages. */
  appearance?: HTMLElement,
  /** Héros du village, pour choisir ceux de la Ligue de clans. */
  heroes: HeroOption[] = [],
): HTMLDialogElement {
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
      appearance ? h("fieldset", null, h("legend", null, "Apparence"), appearance) : null,

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

      cwlFieldset(s, heroes, set),
    ),
  );
  return dlg;
}
