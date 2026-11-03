import { displayName, maxLevel, type Entry } from "../lib/gamedata";
import type { Forecast } from "../lib/plan";
import { globalPct, pct, progress, progressAt, progressCurve, type CategoryKey, type CategoryProgress } from "../lib/progress";
import { levelLaunched, type ChainResult } from "../lib/sim";
import type { Village } from "../lib/village";
import { progressChart, type HistoryDot } from "./chart";
import { h, nf } from "./dom";
import { sprite } from "./sprite";

type Target = "heroes" | "buildings" | "lab";

export interface ProgressionProps {
  village: Village;
  forecast: Forecast;
  history: HistoryDot[];
  /** Ouvre l'onglet détaillé d'une catégorie. */
  onOpen: (t: Target) => void;
  /** Bloc « Gains depuis le dernier export ». */
  extra?: HTMLElement;
}

const pctText = (x: number) => `${Math.floor(x * 100)} %`;
/** Écart en points, arrondi comme les pourcentages affichés. */
const gainPoints = (a: number, b: number) => Math.floor(b * 100) - Math.floor(a * 100);

const TARGET: Partial<Record<CategoryKey, Target>> = { heroes: "heroes", buildings: "buildings", walls: "buildings", lab: "lab", pets: "lab" };

/** Barre deux tons : plein = aujourd'hui, clair = à la fin du Jam. */
function dualBar(now: number, end: number, label: string, cls = ""): HTMLElement {
  return h(
    "span",
    { class: `bar bar-dual ${cls}`, role: "img", "aria-label": label },
    h("span", { class: "bar-plan", style: { width: `${end * 100}%` } }),
    h("span", { style: { width: `${now * 100}%` } }),
  );
}

/** Chiffre-titre : complétion aujourd'hui, et ce que le Jam y ajoute. */
function headline(title: string, now: number, end: number, hint: string): HTMLElement {
  const gain = gainPoints(now, end);
  return h(
    "section",
    { class: "card pg-headline" },
    h("p", { class: "tile-label" }, title),
    h("p", { class: "pg-big" }, pctText(now), gain > 0 ? h("span", { class: "pg-gain" }, `+${gain} pts pendant le Jam`) : null),
    dualBar(now, end, `${title} : ${pctText(now)} aujourd'hui, ${pctText(end)} à la fin du Jam`, "bar-wide"),
    h("p", { class: "hint" }, hint),
  );
}

function categoryCard(now: CategoryProgress, end: CategoryProgress, onOpen: ProgressionProps["onOpen"]): HTMLElement {
  const a = pct(now);
  const b = pct(end);
  const target = TARGET[now.key];
  const gained = now.remaining - end.remaining;
  const sub =
    now.remaining === 0 ? "Tout est au max de ton HDV."
    : now.key === "equipment" ? `${nf(now.remaining)} niveaux restants, au minerai (pas de Jam).`
    : `${nf(now.remaining)} niveaux restants${gained > 0 ? `, ${nf(gained)} finis pendant le Jam` : ""}.`;
  const body = [
    h("span", { class: "pg-cat-head" }, h("span", { class: "pg-cat-name" }, now.label), h("span", { class: "pg-cat-pct" }, pctText(a), b > a ? h("span", { class: "hint" }, ` → ${pctText(b)}`) : null)),
    dualBar(a, b, `${now.label} : ${pctText(a)} aujourd'hui, ${pctText(b)} à la fin du Jam`),
    h("span", { class: "hint" }, sub),
  ];
  return target
    ? h("button", { type: "button", class: "card pg-cat tile-link", onClick: () => onOpen(target), title: "Voir le détail" }, body)
    : h("div", { class: "card pg-cat" }, body);
}

/* ---------- Labo et animaux, recherche par recherche ---------- */

const LAB_GROUPS: { label: string; match: (category: string, e: Entry) => boolean }[] = [
  { label: "Troupes", match: (c, e) => c === "troops" && e.productionBuilding === "Barracks" },
  { label: "Troupes noires", match: (c, e) => c === "troops" && e.productionBuilding === "Dark Barracks" },
  { label: "Engins de siège", match: (c, e) => c === "troops" && e.productionBuilding === "Workshop" },
  { label: "Sorts", match: (c, e) => c === "spells" && e.productionBuilding === "Spell Factory" },
  { label: "Sorts noirs", match: (c, e) => c === "spells" && e.productionBuilding === "Dark Spell Factory" },
  { label: "Animaux", match: (c) => c === "pets" },
];

interface LabRow {
  entry: Entry;
  category: string;
  now: number;
  end: number;
  max: number;
}

function labRows(v: Village, f: Forecast): LabRow[] {
  const results = new Map<string, ChainResult>();
  for (const r of [...f.labBest.results, ...f.pets.results]) results.set(r.chain.key, r);
  const out: LabRow[] = [];
  for (const i of v.items) {
    const isLab =
      (i.category === "troops" && i.entry.village === "home" && !i.entry.superTroop && !i.entry.seasonal) ||
      (i.category === "spells" && !i.entry.seasonal) ||
      i.category === "pets";
    if (!isLab) continue;
    const max = maxLevel(i.entry, v.gates);
    if (max === 0) continue;
    const now = Math.min(i.lvl ?? 0, max);
    const r = results.get(`${i.category}:${i.entry.id}`);
    // Lancé avant la fin du Jam, même fini après : compté comme dans les autres écrans.
    out.push({ entry: i.entry, category: i.category, now, end: r ? Math.min(max, Math.max(now, levelLaunched(r))) : now, max });
  }
  return out;
}

function labDetail(v: Village, f: Forecast): HTMLElement {
  const rows = labRows(v, f);
  const groups = LAB_GROUPS.map((g) => ({ label: g.label, rows: rows.filter((r) => g.match(r.category, r.entry)) })).filter((g) => g.rows.length);
  return h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", { class: "card-title" }, "Labo et animaux en détail"), h("span", { class: "muted" }, `${rows.filter((r) => r.now >= r.max).length} / ${rows.length} au max`)),
    groups.map((g) => {
      const done = g.rows.filter((r) => r.now >= r.max).length;
      const planned = g.rows.reduce((n, r) => n + r.end - r.now, 0);
      return h(
        "div",
        { class: "pg-lab-group" },
        h("h3", { class: "pg-lab-title" }, g.label, h("span", { class: "hint" }, ` · ${done}/${g.rows.length} au max${planned ? ` · +${planned} pendant le Jam` : ""}`)),
        h(
          "ul",
          { class: "pg-lab-list" },
          g.rows.map((r) =>
            h(
              "li",
              { class: r.now >= r.max ? "pg-lab-row is-max" : "pg-lab-row" },
              sprite(r.category, r.entry, undefined, "sm"),
              h(
                "span",
                { class: "pg-lab-main" },
                h(
                  "span",
                  { class: "pg-lab-head" },
                  h("span", { class: "pg-lab-name" }, displayName(r.entry)),
                  h("span", { class: "muted" }, r.end > r.now ? `${r.now} → ${r.end} / ${r.max}` : `${r.now} / ${r.max}`),
                ),
                dualBar(r.now / r.max, r.end / r.max, `${displayName(r.entry)} : niveau ${r.now}, ${r.end} prévu, sur ${r.max}`),
              ),
              r.now >= r.max ? h("span", { class: "pill pill-max" }, "MAX") : r.end > r.now ? h("span", { class: "pill" }, `+${r.end - r.now}`) : h("span", { class: "pill pill-muted" }, "0"),
            ),
          ),
        ),
      );
    }),
  );
}

/** Page Progression : les deux complétions, la courbe, chaque catégorie, puis le labo en détail. */
export function progressionView(p: ProgressionProps): HTMLElement {
  const v = p.village;
  const f = p.forecast;
  const T = f.heroes.tHours;
  const points = progressCurve(v, f);
  const end = points.reduce((b, q) => (Math.abs(q.t - T) < Math.abs(b.t - T) ? q : b));
  const now = points[0];
  const cats = progress(v);
  const catsEnd = progressAt(cats, f, T);
  const game = progress(v, "game");
  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "pg-headlines" },
      headline("Jeu complet", globalPct(game), globalPct(progressAt(game, f, T)), "Par rapport à l'HDV le plus haut, avec tout ce qui existe."),
      headline(`HDV ${v.th}`, now.global, end.global, `Ce qui reste à faire pour finir ton HDV ${v.th}.`),
    ),
    h("section", { class: "card" }, h("h2", { class: "card-title" }, "D'ici la fin du Jam"), progressChart(points, p.history, v.timestamp, T)),
    h("h2", { class: "section-title" }, "Par catégorie"),
    h("div", { class: "pg-cats" }, cats.map((c) => categoryCard(c, catsEnd.find((x) => x.key === c.key)!, p.onOpen))),
    labDetail(v, f),
    p.extra ?? null,
    h("p", { class: "hint" }, "Le pourcentage de l'HDV et du jeu est la moyenne des six catégories. Les points de la courbe sont tes exports passés."),
  );
}
