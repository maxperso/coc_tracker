import { GROUP_LABEL, groupOf, isPermanentBuilding, priorityRank, type BuildingGroup } from "../lib/buildings";
import { displayName, gameIndex, HERO_SHORT, maxLevel, type Entry } from "../lib/gamedata";
import type { Forecast } from "../lib/plan";
import { globalPct, pct, progress, progressAt, progressCurve, type CategoryKey, type CategoryProgress } from "../lib/progress";
import type { GoldPass } from "../lib/rules";
import { levelLaunched, type ChainResult, type Segment } from "../lib/sim";
import type { Village } from "../lib/village";
import { progressChart, type HistoryDot } from "./chart";
import { h, nf } from "./dom";
import { sprite } from "./sprite";
import { openUpgradeInfo } from "./upgradeInfo";

type Target = "heroes" | "buildings" | "lab";

export interface ProgressionProps {
  village: Village;
  forecast: Forecast;
  history: HistoryDot[];
  /** Ouvre l'onglet détaillé d'une catégorie. */
  onOpen: (t: Target) => void;
  /** Bloc « Gains depuis le dernier export ». */
  extra?: HTMLElement;
  /** Pass d'or, pour les durées et coûts des fiches. */
  pass: GoldPass;
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

/* ---------- Détail : héros, bâtiments, labo et animaux ---------- */

/** Une ligne du détail : un élément (tous les exemplaires d'un bâtiment ensemble). */
interface Row {
  category: string;
  entry: Entry;
  /** Niveaux des exemplaires construits. */
  lvls: number[];
  /** Niveaux gagnés pendant le Jam (lancés avant la fin), tous exemplaires confondus. */
  gained: number;
  max: number;
  /** Exemplaires possibles à cet HDV (bâtiments) ; absent : un seul. */
  allowed?: number;
  planned: Segment[];
}

interface Group {
  label: string;
  rows: Row[];
}

const LAB_GROUPS: { label: string; match: (category: string, e: Entry) => boolean }[] = [
  { label: "Troupes", match: (c, e) => c === "troops" && e.productionBuilding === "Barracks" },
  { label: "Troupes noires", match: (c, e) => c === "troops" && e.productionBuilding === "Dark Barracks" },
  { label: "Engins de siège", match: (c, e) => c === "troops" && e.productionBuilding === "Workshop" },
  { label: "Sorts", match: (c, e) => c === "spells" && e.productionBuilding === "Spell Factory" },
  { label: "Sorts noirs", match: (c, e) => c === "spells" && e.productionBuilding === "Dark Spell Factory" },
  { label: "Animaux", match: (c) => c === "pets" },
];

const launchedGain = (rs: ChainResult[]) => rs.reduce((n, r) => n + levelLaunched(r) - r.chain.startLevel, 0);
const segmentsOf = (rs: ChainResult[]) => rs.flatMap((r) => r.segments);

function heroRows(v: Village, f: Forecast): Row[] {
  return f.heroes.results.map((r) => ({
    category: "heroes",
    entry: r.chain.entry,
    lvls: [r.chain.startLevel],
    gained: levelLaunched(r) - r.chain.startLevel,
    max: maxLevel(r.chain.entry, v.gates),
    planned: r.segments,
  }));
}

function buildingGroups(v: Village, f: Forecast): Group[] {
  const byId = new Map<number, Row>();
  for (const i of v.items.filter(isPermanentBuilding)) {
    const row = byId.get(i.entry.id) ?? {
      category: i.category,
      entry: i.entry,
      lvls: [],
      gained: 0,
      max: maxLevel(i.entry, { th: v.th }),
      allowed: gameIndex().data.thCounts[i.entry.id]?.[v.th],
      planned: [],
    };
    for (let n = 0; n < (i.cnt ?? 1); n++) row.lvls.push(i.lvl ?? 0);
    byId.set(i.entry.id, row);
  }
  for (const row of byId.values()) {
    const rs = f.buildings.results.filter((r) => r.chain.entry.id === row.entry.id);
    row.gained = launchedGain(rs);
    row.planned = segmentsOf(rs);
  }
  const order: BuildingGroup[] = ["defense", "army", "resource", "trap"];
  return order
    .map((g) => ({
      label: GROUP_LABEL[g],
      rows: [...byId.values()]
        .filter((r) => r.max > 0 && groupOf(r.category, r.entry) === g)
        .sort((a, b) => priorityRank(a.category, a.entry) - priorityRank(b.category, b.entry)),
    }))
    .filter((g) => g.rows.length);
}

function labGroups(v: Village, f: Forecast): Group[] {
  const results = new Map<string, ChainResult>();
  for (const r of [...f.labBest.results, ...f.pets.results]) results.set(r.chain.key, r);
  const rows: Row[] = [];
  for (const i of v.items) {
    const isLab =
      (i.category === "troops" && i.entry.village === "home" && !i.entry.superTroop && !i.entry.seasonal) ||
      (i.category === "spells" && !i.entry.seasonal) ||
      i.category === "pets";
    if (!isLab) continue;
    const max = maxLevel(i.entry, v.gates);
    if (max === 0) continue;
    const r = results.get(`${i.category}:${i.entry.id}`);
    rows.push({ category: i.category, entry: i.entry, lvls: [Math.min(i.lvl ?? 0, max)], gained: r ? launchedGain([r]) : 0, max, planned: r?.segments ?? [] });
  }
  return LAB_GROUPS.map((g) => ({ label: g.label, rows: rows.filter((r) => g.match(r.category, r.entry)) })).filter((g) => g.rows.length);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function detailRow(r: Row, p: ProgressionProps): HTMLElement {
  const lo = Math.min(...r.lvls);
  const hi = Math.max(...r.lvls);
  const total = r.max * r.lvls.length;
  const now = Math.min(sum(r.lvls), total);
  const end = Math.min(total, now + r.gained);
  const atMax = now >= total;
  const name = r.category === "heroes" ? (HERO_SHORT[r.entry.name] ?? displayName(r.entry)) : displayName(r.entry);
  const levels = lo === hi ? `${lo}` : `${lo}-${hi}`;
  const built = r.allowed && r.allowed > r.lvls.length ? ` · ${r.lvls.length}/${r.allowed} construits` : r.lvls.length > 1 ? ` · ×${r.lvls.length}` : "";
  const open = () =>
    openUpgradeInfo({
      category: r.category,
      entry: r.entry,
      level: lo,
      count: r.lvls.filter((l) => l === lo).length,
      max: r.max,
      gates: p.village.gates,
      pass: p.pass,
      planned: r.planned,
      exportUnix: p.village.timestamp,
    });
  return h(
    "li",
    null,
    h(
      "button",
      { type: "button", class: atMax ? "pg-lab-row is-max" : "pg-lab-row", onClick: open, title: "Voir les niveaux à venir" },
      sprite(r.category, r.entry, r.category === "buildings" || r.category === "traps" ? lo || undefined : undefined, "sm"),
      h(
        "span",
        { class: "pg-lab-main" },
        h(
          "span",
          { class: "pg-lab-head" },
          h("span", { class: "pg-lab-name" }, name, h("span", { class: "hint" }, built)),
          h("span", { class: "muted" }, r.gained && r.lvls.length === 1 ? `${lo} → ${lo + r.gained} / ${r.max}` : `${levels} / ${r.max}`),
        ),
        dualBar(now / total, end / total, `${name} : niveau ${levels} sur ${r.max}${r.gained ? `, +${r.gained} pendant le Jam` : ""}`),
      ),
      atMax ? h("span", { class: "pill pill-max" }, "MAX") : r.gained ? h("span", { class: "pill" }, `+${r.gained}`) : h("span", { class: "pill pill-muted" }, "0"),
    ),
  );
}

function detailCard(title: string, groups: Group[], p: ProgressionProps): HTMLElement {
  const rows = groups.flatMap((g) => g.rows);
  const isMax = (r: Row) => sum(r.lvls) >= r.max * r.lvls.length;
  return h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", { class: "card-title" }, title), h("span", { class: "muted" }, `${rows.filter(isMax).length} / ${rows.length} au max`)),
    groups.map((g) => {
      const planned = sum(g.rows.map((r) => r.gained));
      return h(
        "div",
        { class: "pg-lab-group" },
        groups.length > 1 || g.label !== title
          ? h("h3", { class: "pg-lab-title" }, g.label, h("span", { class: "hint" }, ` · ${g.rows.filter(isMax).length}/${g.rows.length} au max${planned ? ` · +${planned} pendant le Jam` : ""}`))
          : null,
        h("ul", { class: "pg-lab-list" }, g.rows.map((r) => detailRow(r, p))),
      );
    }),
  );
}

/** Page Progression : les deux complétions, la courbe, chaque catégorie, puis le détail élément par élément. */
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
    h("h2", { class: "section-title" }, "En détail"),
    h("p", { class: "hint" }, "Touche un élément pour voir ses prochains niveaux : durée, coût, ce qu'il faut pour les débloquer."),
    detailCard("Héros", [{ label: "Héros", rows: heroRows(v, f) }], p),
    detailCard("Bâtiments", buildingGroups(v, f), p),
    detailCard("Labo et animaux", labGroups(v, f), p),
    p.extra ?? null,
    h("p", { class: "hint" }, "Le pourcentage de l'HDV et du jeu est la moyenne des six catégories. Les points de la courbe sont tes exports passés."),
  );
}
