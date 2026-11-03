import type { Forecast, PoolForecast } from "./plan";
import { durationFactor, JAM, type GoldPass, type JamConfig } from "./rules";
import type { ChainResult, Segment } from "./sim";
import { parisDayKey, toDate } from "./time";

export type Pool = "builder" | "lab" | "pet";

export type PlanEvent =
  | { t: number; kind: "launch"; pool: Pool; result: ChainResult; seg: Segment }
  /** `stock` : potions en stock juste avant de boire (d'après le stock déclaré et les jours d'avant). */
  | { t: number; kind: "potion"; pool: Pool; count: number; buy: number; stock: number }
  /** Attaque de Ligue de clans : les héros emmenés sont libres. */
  | { t: number; kind: "attack"; pool: Pool; heroes: ChainResult[] };

const POOL_ORDER: Record<Pool, number> = { builder: 0, lab: 1, pet: 2 };
const KIND_ORDER: Record<PlanEvent["kind"], number> = { launch: 0, potion: 1, attack: 2 };

/** Toutes les actions à faire, dans l'ordre : relances de chantiers et prises de potions. */
export function planEvents(f: Forecast): PlanEvent[] {
  const events: PlanEvent[] = [];
  const launches = (results: ChainResult[], pool: Pool) => {
    for (const result of results) {
      for (const seg of result.segments) {
        if (!seg.inProgressAtExport) events.push({ t: seg.start, kind: "launch", pool, result, seg });
      }
    }
  };
  const potions = (pf: PoolForecast, pool: Pool) => {
    for (const d of pf.plan.days) {
      if (d.starts.length) events.push({ t: d.starts[0], kind: "potion", pool, count: d.starts.length, buy: d.bought, stock: d.stockAfter + d.starts.length - d.bought });
    }
  };
  launches([...f.heroes.results, ...f.buildings.results], "builder");
  launches(f.labBest.results, "lab");
  launches(f.pets.results, "pet");
  potions(f.heroes, "builder");
  potions(f.labBest, "lab");
  potions(f.pets, "pet");
  if (f.cwl) {
    const heroes = f.heroes.results.filter((r) => f.cwl!.keys.has(r.chain.key));
    for (const w of f.cwl.windows) events.push({ t: Math.max(0, w.start), kind: "attack", pool: "builder", heroes });
  }
  // À instant égal : d'abord relancer, puis boire (une potion n'agit que sur les chantiers actifs).
  return events.sort((a, b) => a.t - b.t || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || POOL_ORDER[a.pool] - POOL_ORDER[b.pool]);
}

/** Regroupe les actions par jour, en heure de Paris. */
export function byDay(events: PlanEvent[], exportUnix: number): [string, PlanEvent[]][] {
  const map = new Map<string, PlanEvent[]>();
  for (const e of events) {
    const k = parisDayKey(toDate(exportUnix, e.t));
    map.set(k, [...(map.get(k) ?? []), e]);
  }
  return [...map];
}

export interface WaveItem {
  pool: Pool;
  result: ChainResult;
  seg: Segment;
  /** Heures gagnées grâce à la réduction figée au lancement. */
  savedHours: number;
}

/** Derniers chantiers lancés avant la fin du Jam et finis après : la réduction leur reste acquise. */
export function finalWave(f: Forecast): WaveItem[] {
  const T = f.heroes.tHours;
  const pick = (results: ChainResult[], pool: Pool) =>
    results.flatMap((result) =>
      result.segments
        .filter((s) => !s.inProgressAtExport && s.start < T && s.end > T)
        .map((seg) => ({ pool, result, seg, savedHours: seg.baseSeconds / 3600 - seg.workHours })),
    );
  return [
    ...pick([...f.heroes.results, ...f.buildings.results], "builder"),
    ...pick(f.labBest.results, "lab"),
    ...pick(f.pets.results, "pet"),
  ].sort((a, b) => a.seg.start - b.seg.start);
}

export interface LongStep {
  result: ChainResult;
  toLevel: number;
  baseHours: number;
  savedHours: number;
}

/**
 * Chantiers d'ouvrier les plus longs encore à faire après le plan.
 * Les lancer juste avant la fin garde la plus grosse réduction.
 */
export function longestRemaining(f: Forecast, pass: GoldPass, limit = 5, cfg: JamConfig = JAM): LongStep[] {
  const factor = durationFactor(true, pass.builder, cfg);
  const out: LongStep[] = [];
  for (const result of [...f.heroes.results, ...f.buildings.results]) {
    const launched = result.segments.filter((s) => !s.inProgressAtExport).length;
    const next = result.chain.steps[launched];
    if (!next || !next.baseSeconds) continue;
    const baseHours = next.baseSeconds / 3600;
    out.push({ result, toLevel: next.toLevel, baseHours, savedHours: baseHours * (1 - factor) });
  }
  // Un seul exemplaire par bâtiment : la liste reste lisible.
  const seen = new Set<number>();
  return out
    .sort((a, b) => b.baseHours - a.baseHours)
    .filter((x) => !seen.has(x.result.chain.entry.id) && seen.add(x.result.chain.entry.id))
    .slice(0, limit);
}
