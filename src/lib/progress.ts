import { isPermanentBuilding } from "./buildings";
import { maxLevel, type Entry } from "./gamedata";
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

export function progress(v: Village): CategoryProgress[] {
  return GROUPS.map((g) => {
    const out: CategoryProgress = { key: g.key, label: g.label, current: 0, max: 0, remaining: 0, idle: [] };
    for (const i of v.items) {
      if (!g.match(i)) continue;
      const max = maxLevel(i.entry, i.category === "buildings" || i.category === "traps" ? { th: v.th } : v.gates);
      if (max === 0) continue;
      const n = i.cnt ?? 1;
      const lvl = Math.min(i.lvl ?? 0, max);
      out.current += lvl * n;
      out.max += max * n;
      out.remaining += (max - lvl) * n;
      if (lvl < max && !(i.timer && i.timer > 0)) out.idle.push({ entry: i.entry, lvl, max, cnt: n });
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
