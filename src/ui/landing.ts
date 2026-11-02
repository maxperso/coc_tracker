import { findByName, gameIndex } from "../lib/gamedata";
import { JAM } from "../lib/rules";
import { fmtDayLong, fmtHour } from "../lib/time";
import { h } from "./dom";
import { sprite } from "./sprite";

const HEROES = ["Barbarian King", "Archer Queen", "Grand Warden", "Royal Champion", "Minion Prince", "Dragon Duke"];

function icon(category: string, name: string, size: "md" | "sm" = "md"): HTMLElement | null {
  const e = findByName(gameIndex(), category, name);
  if (!e) return null;
  return sprite(category, e, category === "buildings" ? e.levels?.at(-1)?.l : undefined, size);
}

const potion = (file: string) => h("img", { class: "sprite sprite-md", src: `sprites/magic_items/${file}.webp`, alt: "" });

/** Temps restant avant la fin du Jam, ou null s'il est terminé. */
function countdown(): string | null {
  const ms = Date.parse(JAM.end) - Date.now();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86_400_000);
  const hrs = Math.floor((ms % 86_400_000) / 3_600_000);
  return d > 0 ? `${d} j ${hrs} h` : `${hrs} h`;
}

/** Page d'accueil publique, avant connexion. */
export function landingView(a: { onLogin: () => void; onRegister: () => void }): HTMLElement {
  const left = countdown();
  const end = new Date(JAM.end);
  const features: [HTMLElement | null, string, string][] = [
    [potion("builder_potion"), "Un plan jour par jour", "Quoi relancer, à quelle heure, et quand boire tes potions. Rien ne reste à l'arrêt, même la nuit."],
    [icon("heroes", "Barbarian King"), "Héros et bâtiments", "Le calendrier de chaque héros, les niveaux atteints à la fin du Jam et les ressources à prévoir."],
    [potion("research_potion"), "Tes médailles bien dépensées", "Combien de potions d'ouvrier, de recherche ou de marteaux acheter selon ta stratégie."],
    [icon("buildings", "Town Hall"), "Le classement entre amis", "Compare ton avancement à celui de tes amis et regarde leur plan."],
  ];
  const steps: [string, string][] = [
    ["Crée ton compte", "Un pseudo, un email confirmé, et le code d'invitation de ton groupe."],
    ["Colle ton export", "Dans le jeu : Réglages, Plus de réglages, Data Export, Copier."],
    ["Suis ton plan", "Choisis héros, bâtiments ou hybride : le plan s'adapte."],
  ];

  return h(
    "main",
    { class: "landing" },
    h(
      "section",
      { class: "landing-hero" },
      h(
        "div",
        { class: "landing-copy" },
        h("p", { class: "badge" }, left ? `Hammer Jam : encore ${left}` : "Hammer Jam terminé"),
        h("h1", { class: "landing-title" }, "Profite du Hammer Jam jusqu'à la dernière minute"),
        h(
          "p",
          { class: "lead" },
          `COC Tracker lit l'export de ton village Clash of Clans et te dit quoi améliorer avant le ${fmtDayLong(end)} à ${fmtHour(end)}, avec -50 % sur le temps et le coût.`,
        ),
        h(
          "div",
          { class: "button-row" },
          h("button", { type: "button", class: "btn btn-primary btn-lg", onClick: a.onRegister }, "Créer mon compte"),
          h("button", { type: "button", class: "btn btn-ghost btn-lg", onClick: a.onLogin }, "J'ai déjà un compte"),
        ),
      ),
      h(
        "div",
        { class: "landing-visual", "aria-hidden": "true" },
        h(
          "div",
          { class: "hero-strip" },
          HEROES.map((n) => icon("heroes", n)),
        ),
        h(
          "div",
          { class: "preview card" },
          h("p", { class: "tile-label" }, "Exemple de plan"),
          [
            ["Roi", 103, 110, 0.62],
            ["Reine", 102, 110, 0.75],
            ["Gardien", 76, 85, 0.9],
          ].map(([name, from, to, w]) =>
            h(
              "div",
              { class: "preview-row" },
              h("span", { class: "preview-name" }, `${name} ${from} → ${to}`),
              h("span", { class: "bar" }, h("span", { style: { width: `${Number(w) * 100}%` } })),
            ),
          ),
        ),
      ),
    ),
    h(
      "section",
      { class: "landing-section" },
      h("h2", { class: "section-title center" }, "Tout ce qu'il faut pour le Jam"),
      h(
        "div",
        { class: "feature-grid" },
        features.map(([img, title, text]) => h("div", { class: "card feature" }, img, h("h3", { class: "card-title" }, title), h("p", { class: "muted" }, text))),
      ),
    ),
    h(
      "section",
      { class: "landing-section" },
      h("h2", { class: "section-title center" }, "Comment ça marche"),
      h(
        "ol",
        { class: "steps-grid" },
        steps.map(([title, text]) => h("li", { class: "card step" }, h("strong", null, title), h("span", { class: "muted" }, text))),
      ),
      h(
        "div",
        { class: "button-row center-row" },
        h("button", { type: "button", class: "btn btn-primary btn-lg", onClick: a.onRegister }, "Commencer"),
      ),
    ),
  );
}
