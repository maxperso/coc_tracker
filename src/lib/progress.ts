import { isPermanentBuilding } from "./buildings";
import { gameIndex, maxLevel, type Entry } from "./gamedata";
import type { ResolvedItem } from "./exportParse";
import type { Forecast } from "./plan";
import { levelAt, type ChainResult } from "./sim";
import type { Village } from "./village";

export type CategoryKey = "heroes" | "buildings" | "walls" | "lab" | "pets" | "equipment";

export interface CategoryProgress {
  key: CategoryKey;
  label: string;
  current: number;
  max: number;
  /** Niveaux restants jusqu'au max de l'HDV actuel. */
  remaining: number;
  /** Éléments sous le max et sans chantier en cours. */
  idle: { entry: Entry; lvl: number; max: number; cnt: number }[];
}

const GROUPS: { key: CategoryKey; label: string; match: (i: ResolvedItem) => boolean }[] = [
  { key: "heroes", label: "Héros", match: (i) => i.category === "heroes" && i.entry.village === "home" && i.section === "heroes" },
  { key: "buildings", label: "Bâtiments", match: isPermanentBuilding },
  { key: "walls", label: "Murs", match: (i) => i.category === "buildings" && i.entry.name === "Wall" },
  {
    key: "lab",
    label: "Labo",
    match: (i) =>
      (i.category === "troops" && i.entry.village === "home" && !i.entry.superTroop && !i.entry.seasonal) ||
      (i.category === "spells" && !i.entry.seasonal),
  },
  { key: "pets", label: "Animaux", match: (i) => i.category === "pets" },
  { key: "equipment", label: "Équipements", match: (i) => i.category === "equipment" },
];

/** HDV : au max de l'HDV du joueur. Jeu : au max du jeu (HDV le plus haut, tout débloqué). */
export type Scope = "th" | "game";

/** Ce qui compte au max du jeu, y compris ce que le joueur n'a pas encore débloqué. */
const GAME_ENTRY: Partial<Record<CategoryKey, (category: string, e: Entry) => boolean>> = {
  heroes: (c, e) => c === "heroes" && e.village === "home" && e.productionBuilding === "Hero Hall",
  lab: (c, e) => (c === "troops" && e.village === "home" && !e.superTroop && !e.seasonal) || (c === "spells" && !e.seasonal),
  pets: (c) => c === "pets",
  equipment: (c) => c === "equipment",
};

const isBuildingEntry = (category: string, e: Entry) =>
  (category === "buildings" || category === "traps") && e.village === "home" && e.name !== "Wall" && (e.levels?.length ?? 0) > 0;
const isWallEntry = (category: string, e: Entry) => category === "buildings" && e.village === "home" && e.name === "Wall";

/**
 * Avancement par catégorie.
 * - Bâtiments et murs : autant d'exemplaires que l'HDV visé en permet (ceux pas encore construits comptent
 *   au niveau 0), au niveau max de cet HDV.
 * - Héros, labo, animaux, équipements : à l'échelle de l'HDV, ce que le joueur possède, au max qu'il peut
 *   atteindre ; à l'échelle du jeu, tout ce qui existe, au niveau le plus haut.
 */
export function progress(v: Village, scope: Scope = "th"): CategoryProgress[] {
  const data = gameIndex().data;
  const targetTh = scope === "game" ? data.maxTh : v.th;
  return GROUPS.map((g) => {
    const out: CategoryProgress = { key: g.key, label: g.label, current: 0, max: 0, remaining: 0, idle: [] };
    // Niveaux du joueur, un par exemplaire, regroupés par élément.
    const mine = new Map<number, { entry: Entry; lvls: number[] }>();
    for (const i of v.items) {
      if (!g.match(i)) continue;
      const m = mine.get(i.entry.id) ?? { entry: i.entry, lvls: [] };
      for (let n = 0; n < (i.cnt ?? 1); n++) m.lvls.push(i.lvl ?? 0);
      mine.set(i.entry.id, m);
      // À lancer : sous le max de l'HDV et sans chantier en cours.
      const max = maxLevel(i.entry, i.category === "buildings" || i.category === "traps" ? { th: v.th } : v.gates);
      const lvl = Math.min(i.lvl ?? 0, max);
      if (scope === "th" && lvl < max && !(i.timer && i.timer > 0)) out.idle.push({ entry: i.entry, lvl, max, cnt: i.cnt ?? 1 });
    }
    const add = (lvls: number[], count: number, max: number) => {
      if (max === 0 || count === 0) return;
      // Les exemplaires les plus avancés d'abord ; ceux qui manquent comptent au niveau 0.
      const sorted = [...lvls].sort((a, b) => b - a).slice(0, count);
      while (sorted.length < count) sorted.push(0);
      for (const l of sorted) out.current += Math.min(l, max);
      out.max += max * count;
      out.remaining += sorted.reduce((n, l) => n + Math.max(0, max - l), 0);
    };

    if (g.key === "buildings" || g.key === "walls") {
      const match = g.key === "walls" ? isWallEntry : isBuildingEntry;
      const ids = new Set(mine.keys());
      for (const [category, list] of Object.entries(data.categories)) {
        for (const e of list) if (match(category, e) && (data.thCounts[e.id]?.[targetTh] ?? 0) > 0) ids.add(e.id);
      }
      for (const id of ids) {
        const found = gameIndex().byId.get(id)?.find((f) => match(f.category, f.entry));
        if (!found) continue;
        const m = mine.get(id);
        const count = Math.max(data.thCounts[id]?.[targetTh] ?? 0, m?.lvls.length ?? 0);
        add(m?.lvls ?? [], count, maxLevel(found.entry, { th: targetTh }));
      }
    } else if (scope === "game" && GAME_ENTRY[g.key]) {
      for (const [category, list] of Object.entries(data.categories)) {
        for (const e of list) {
          if (!GAME_ENTRY[g.key]!(category, e)) continue;
          const top = Math.max(0, ...(e.levels ?? []).map((l) => l.l));
          const m = mine.get(e.id);
          add(m?.lvls ?? [], Math.max(1, m?.lvls.length ?? 0), top);
        }
      }
    } else {
      for (const m of mine.values()) add(m.lvls, m.lvls.length, maxLevel(m.entry, v.gates));
    }
    return out;
  }).filter((p) => p.max > 0);
}

export const pct = (c: { current: number; max: number }) => (c.max ? c.current / c.max : 1);

/** Avancement global : moyenne des catégories, pour que les 325 murs n'écrasent pas les 6 héros. */
export function globalPct(cats: CategoryProgress[]): number {
  return cats.length ? cats.reduce((s, c) => s + pct(c), 0) / cats.length : 0;
}

export interface CurvePoint {
  /** Heures depuis l'export. */
  t: number;
  global: number;
  heroes: number;
  buildings: number;
}

function gainedAt(results: ChainResult[], t: number): number {
  return results.reduce((n, r) => n + Math.max(0, levelAt(r, t) - r.chain.startLevel), 0);
}

/** Courbe prévue de l'avancement, d'après les chantiers simulés. */
export function progressCurve(v: Village, f: Forecast, step = 6): CurvePoint[] {
  const cats = progress(v);
  const sources: Partial<Record<CategoryKey, ChainResult[]>> = {
    heroes: f.heroes.results,
    buildings: f.buildings.results,
    lab: f.labBest.results,
    pets: f.pets.results,
  };
  const lastEnd = Math.max(
    f.heroes.tHours,
    ...Object.values(sources).flatMap((rs) => rs!.flatMap((r) => r.segments.map((s) => s.end))),
  );
  const end = Math.min(lastEnd, f.heroes.tHours + 7 * 24);
  const at = (t: number) => {
    const shifted = cats.map((c) => {
      const src = sources[c.key];
      return { ...c, current: Math.min(c.max, c.current + (src ? gainedAt(src, t) : 0)) };
    });
    const by = (k: CategoryKey) => {
      const c = shifted.find((x) => x.key === k);
      return c ? pct(c) : NaN;
    };
    return { t, global: globalPct(shifted), heroes: by("heroes"), buildings: by("buildings") };
  };
  const points: CurvePoint[] = [];
  for (let t = 0; t < end; t += step) points.push(at(t));
  points.push(at(end));
  return points;
}
