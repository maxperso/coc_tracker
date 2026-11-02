import { isPermanentBuilding, priorityRank } from "./buildings";
import { DEFAULT_CWL, cwlBlackout, type Blackout, type Cwl } from "./cwl";
import { HERO_SHORT, maxLevel, stepCost, type Gates } from "./gamedata";
import type { ResolvedItem } from "./exportParse";
import { planPotions, prunePlan, type PotionPlan, type Sleep } from "./potionPlan";
import { JAM, type BoostScope, type GoldPass, type JamConfig } from "./rules";
import { levelAt, levelLaunched, simulate, type Chain, type ChainResult, type Policy, type Step } from "./sim";
import { HOUR, capacityHours, hoursBetween } from "./time";
import type { Village } from "./village";
import { WorkClock } from "./workclock";

/** Que font les ouvriers pendant le Jam. « custom » : l'ordre choisi par le joueur, de A à Z. */
export type Focus = "heroes" | "buildings" | "hybrid" | "custom";

export const FOCUS_LABEL: Record<Focus, string> = {
  heroes: "Héros",
  buildings: "Bâtiments",
  hybrid: "Hybride",
  custom: "Perso",
};

/** Groupes qui travaillent en parallèle : chacun a son ordre. */
export type OrderPool = "builder" | "lab" | "pet";

/** Ordre perso : types d'amélioration (« buildings:1000008 ») du premier au dernier, et ceux en pause. */
export interface UpgradeOrder {
  builder: string[];
  lab: string[];
  pet: string[];
  off: string[];
}

export interface Settings {
  focus: Focus;
  pass: GoldPass;
  builders: number;
  goblinBuilder: boolean;
  goblinResearcher: boolean;
  potions: {
    builder: { owned: number; purchases: number };
    research: { owned: number; purchases: number };
    pet: { owned: number; purchases: number };
  };
  heroHammers: number;
  /** Médailles de ligue sur le compte au moment de l'export. */
  medals: number;
  /** Achats de potions et marteaux calculés à partir des médailles (sinon : saisis à la main). */
  autoPurchases: boolean;
  /** Plage de sommeil (heure de Paris) ; null = « Chu », je ne dors pas. */
  sleep: Sleep | null;
  /** Prendre en compte les bâtiments en cours dans l'export (ils occupent un ouvrier). */
  countBuildingTimers: boolean;
  /** Ligue de clans : héros gardés libres à l'heure d'attaque. */
  cwl: Cwl;
  /** Ordre d'amélioration utilisé par la stratégie « Perso ». */
  order: UpgradeOrder;
}

export const DEFAULT_SETTINGS: Settings = {
  focus: "hybrid",
  pass: { builder: 0, research: 0 },
  builders: 6,
  goblinBuilder: false,
  goblinResearcher: false,
  potions: {
    builder: { owned: 5, purchases: 50 },
    research: { owned: 5, purchases: 40 },
    pet: { owned: 5, purchases: 0 },
  },
  heroHammers: 0,
  medals: 2500,
  autoPurchases: true,
  sleep: { start: 23, end: 7 },
  countBuildingTimers: true,
  cwl: DEFAULT_CWL,
  order: { builder: [], lab: [], pet: [], off: [] },
};

export function buildChain(item: ResolvedItem, gates: Gates, scope: BoostScope, hammerable = false): Chain {
  const current = item.lvl ?? 0;
  const cap = maxLevel(item.entry, gates);
  const upgrading = item.timer != null && item.timer > 0;
  const steps: Step[] = [];
  for (let from = upgrading ? current + 1 : current; from < cap; from++) {
    const s = stepCost(item.category, item.entry, from);
    if (!s) break;
    steps.push({ toLevel: from + 1, baseSeconds: s.seconds, baseCost: s.cost });
  }
  return {
    key: `${item.category}:${item.entry.id}`,
    category: item.category,
    entry: item.entry,
    startLevel: current,
    inProgress: upgrading ? { remainingH: item.timer! / HOUR, toLevel: current + 1 } : undefined,
    steps,
    scope,
    hammerable,
  };
}

const isHomeHero = (i: ResolvedItem) => i.category === "heroes" && i.entry.village === "home" && i.section === "heroes";
const keepInProgressOnly = (c: Chain): Chain => ({ ...c, steps: [] });

export function heroChains(v: Village): Chain[] {
  return v.items.filter(isHomeHero).map((i) => buildChain(i, v.gates, "builder", true));
}

/** Une chaîne par exemplaire de bâtiment permanent (ou de piège), avec sa priorité « défenses d'abord ». */
export function buildingChains(v: Village): Chain[] {
  const out: Chain[] = [];
  for (const i of v.items.filter(isPermanentBuilding)) {
    for (let n = 0; n < (i.cnt ?? 1); n++) {
      const c = buildChain(i, { th: v.th }, "builder");
      out.push({ ...c, key: `${c.key}:${i.lvl}:${n}:${out.length}`, priority: 1 + priorityRank(i.category, i.entry) });
    }
  }
  return out;
}

/** Gardiens en cours : ils occupent un ouvrier jusqu'à leur fin (hypothèse), sans relance. */
function guardianChains(v: Village): Chain[] {
  return v.items
    .filter((i) => i.category === "guardians" && (i.timer ?? 0) > 0)
    .map((i, n) => ({ ...keepInProgressOnly(buildChain(i, v.gates, "builder")), key: `guardians:${i.entry.id}:${n}` }));
}

export function labChains(v: Village): Chain[] {
  return v.items
    .filter(
      (i) =>
        (i.category === "troops" && i.entry.village === "home" && !i.entry.superTroop && !i.entry.seasonal) ||
        (i.category === "spells" && !i.entry.seasonal),
    )
    .map((i) => buildChain(i, v.gates, "research"));
}

export function petChains(v: Village): Chain[] {
  return v.items.filter((i) => i.category === "pets").map((i) => buildChain(i, v.gates, "none"));
}

export interface PoolForecast {
  tHours: number;
  capacityHours: number;
  plan: PotionPlan;
  results: ChainResult[];
  idleAsleepHours: number;
  unusedHammers: number;
  /** Niveaux gagnés, chantiers en cours inclus, terminés avant la fin du Jam. */
  gainedByEnd: number;
  /** Niveaux gagnés en comptant les chantiers lancés avant la fin et finis après. */
  gainedLaunched: number;
}

function gains(results: ChainResult[], tHours: number) {
  return {
    gainedByEnd: results.reduce((n, r) => n + levelAt(r, tHours) - r.chain.startLevel, 0),
    gainedLaunched: results.reduce((n, r) => n + levelLaunched(r) - r.chain.startLevel, 0),
  };
}

function runPool(
  v: Village,
  s: Settings,
  chains: Chain[],
  slots: number,
  potions: { owned: number; purchases: number },
  extraHours: number,
  policy: Policy,
  hammers: number[] = [],
  cfg: JamConfig = JAM,
  blackout?: Blackout,
): PoolForecast {
  const tHours = hoursBetween(v.timestamp, cfg.end);
  const plan = planPotions({
    exportUnix: v.timestamp,
    endH: tHours,
    owned: potions.owned,
    purchases: potions.purchases,
    maxStock: cfg.potions.maxStock,
    sleep: s.sleep,
  });
  const run = (starts: number[]) =>
    simulate({ exportUnix: v.timestamp, jamEndH: tHours, slots, clock: new WorkClock(starts, extraHours), chains, pass: s.pass, policy, sleep: s.sleep, hammers, cfg, blackout });
  let sim = run(plan.starts);
  // Une potion n'agit que sur les chantiers actifs : on retire celles qui tombent à vide.
  const clock = new WorkClock(plan.starts, extraHours);
  const useful = (start: number) => {
    const win = clock.potionWindows.find((w) => w.start >= start - 1e-9);
    const [a, b] = win ? [win.start, win.end] : [start, start + 1];
    return sim.results.some((r) => r.segments.some((g) => g.start < b && g.end > a));
  };
  const pruned = prunePlan(plan, useful);
  if (pruned.wasted) sim = run(pruned.starts);
  return {
    tHours,
    capacityHours: capacityHours(tHours, pruned.starts.length, extraHours),
    plan: pruned,
    results: sim.results,
    idleAsleepHours: sim.idleAsleepHours,
    unusedHammers: sim.unusedHammers,
    ...gains(sim.results, tHours),
  };
}

/** Instants (h) d'achat des marteaux de héros : un tout de suite, puis un par délai d'attente. */
export function hammerTimes(count: number, tHours: number, cfg: JamConfig = JAM): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const h = i * cfg.hammers.heroes.cooldownDays * 24;
    if (h < tHours) out.push(h);
  }
  return out;
}

export interface Forecast {
  /** Pool des ouvriers, limité aux héros. */
  heroes: PoolForecast;
  /** Pool des ouvriers, limité aux bâtiments permanents et pièges. */
  buildings: PoolForecast;
  /** Ouvriers occupés dans l'export (tous chantiers confondus) et ouvriers disponibles. */
  builderSlots: number;
  /** Ligue de clans : heures d'attaque à venir et héros gardés libres ; null sans LDC. */
  cwl: Blackout | null;
  busyAtExport: number;
  labBest: PoolForecast;
  labWorst: PoolForecast;
  pets: PoolForecast;
}

/**
 * Chaînes d'ouvriers selon la stratégie :
 * - perso : héros et bâtiments dans l'ordre du joueur ;
 * - héros : seuls les héros sont relancés ; les bâtiments en cours finissent ;
 * - bâtiments : seuls les bâtiments sont relancés ; les héros en cours finissent ;
 * - hybride : un héros libre passe toujours en premier, les ouvriers restants vont aux bâtiments.
 */
export function builderChains(v: Village, s: Settings): { heroes: Chain[]; buildings: Chain[]; other: Chain[] } {
  if (s.focus === "custom") {
    return { heroes: ordered(v, s, "builder", heroChains(v)), buildings: ordered(v, s, "builder", buildingChains(v)), other: guardianChains(v) };
  }
  let heroes: Chain[] = heroChains(v).map((c) => ({ ...c, priority: 0 }));
  let buildings = buildingChains(v);
  if (s.focus === "heroes") buildings = buildings.filter((c) => c.inProgress).map(keepInProgressOnly);
  if (s.focus === "buildings") heroes = heroes.filter((c) => c.inProgress).map(keepInProgressOnly);
  if (!s.countBuildingTimers && s.focus === "heroes") buildings = [];
  return { heroes, buildings, other: guardianChains(v) };
}

/** Type d'une chaîne : tous les canons partagent la même place dans l'ordre. */
export const typeKey = (c: Chain) => `${c.category}:${c.entry.id}`;

export function poolChains(v: Village, pool: OrderPool): Chain[] {
  return pool === "builder" ? [...heroChains(v), ...buildingChains(v)] : pool === "lab" ? labChains(v) : petChains(v);
}

/** Ordre par défaut : héros puis « défenses d'abord » ; au labo et aux animaux, les plus courts d'abord. */
const defaultRank = (pool: OrderPool) => (c: Chain) =>
  pool === "builder" ? (c.category === "heroes" ? -1 : priorityRank(c.category, c.entry)) : (c.steps[0]?.baseSeconds ?? Infinity);

/**
 * Ordre perso d'un groupe : les types qui ont encore un niveau à monter, dans l'ordre choisi,
 * puis ceux que le joueur n'a pas encore placés (nouveaux dans l'export), dans l'ordre par défaut.
 */
export function customOrder(v: Village, s: Settings, pool: OrderPool): string[] {
  const rank = defaultRank(pool);
  const best = new Map<string, number>();
  for (const c of poolChains(v, pool)) {
    if (!c.steps.length) continue;
    const k = typeKey(c);
    best.set(k, Math.min(best.get(k) ?? Infinity, rank(c)));
  }
  const placed = s.order[pool].filter((k) => best.has(k));
  const seen = new Set(placed);
  const rest = [...best].filter(([k]) => !seen.has(k)).sort((a, b) => a[1] - b[1]).map(([k]) => k);
  return [...placed, ...rest];
}

/** Priorité = rang dans l'ordre perso ; un type en pause finit seulement son chantier en cours. */
function applyOrder(chains: Chain[], order: string[], off: ReadonlySet<string>): Chain[] {
  const rank = new Map(order.map((k, i) => [k, i]));
  return chains.map((c) => {
    const k = typeKey(c);
    return off.has(k) ? keepInProgressOnly(c) : { ...c, priority: rank.get(k) ?? order.length };
  });
}

const ordered = (v: Village, s: Settings, pool: OrderPool, chains: Chain[]) =>
  s.focus === "custom" ? applyOrder(chains, customOrder(v, s, pool), new Set(s.order.off)) : chains;

export type BuilderForecast = Pick<Forecast, "heroes" | "buildings" | "builderSlots" | "busyAtExport" | "cwl">;

/** Pool des ouvriers seul : sert aux recherches rapides (recommandation d'achats). */
export function builderForecast(v: Village, s: Settings, cfg: JamConfig = JAM): BuilderForecast {
  const { heroes, buildings, other } = builderChains(v, s);
  const builderSlots = s.builders + (s.goblinBuilder ? 1 : 0);
  const tHours = hoursBetween(v.timestamp, cfg.end);
  const cwl = cwlBlackout(s.cwl, v.timestamp, heroes) ?? null;
  const pool = runPool(
    v, s, [...heroes, ...buildings, ...other], builderSlots, s.potions.builder, cfg.potions.builder.extraHours, "mostRemaining",
    s.focus === "buildings" ? [] : hammerTimes(s.heroHammers, tHours, cfg), cfg,
    cwl ?? undefined,
  );
  const subset = (chains: Chain[]): PoolForecast => {
    const results = pool.results.filter((r) => chains.includes(r.chain));
    return { ...pool, results, ...gains(results, tHours) };
  };

  return {
    heroes: subset(heroes),
    buildings: subset(buildings),
    builderSlots,
    cwl,
    busyAtExport: [...heroes, ...buildings, ...other].filter((c) => c.inProgress).length,
  };
}

/** Labo, ordre « plus courtes d'abord » (le plus de niveaux) ou « plus longues d'abord ». */
export function labForecast(v: Village, s: Settings, policy: Policy = "shortest", cfg: JamConfig = JAM): PoolForecast {
  const labSlots = 1 + (s.goblinResearcher ? 1 : 0);
  return runPool(v, s, ordered(v, s, "lab", labChains(v)), labSlots, s.potions.research, cfg.potions.research.extraHours, policy, [], cfg);
}

export function forecast(v: Village, s: Settings, cfg: JamConfig = JAM): Forecast {
  return {
    ...builderForecast(v, s, cfg),
    labBest: labForecast(v, s, "shortest", cfg),
    labWorst: labForecast(v, s, "longest", cfg),
    pets: runPool(v, s, ordered(v, s, "pet", petChains(v)), 1, s.potions.pet, cfg.potions.pet.extraHours, "shortest", [], cfg),
  };
}

export const heroLabel = (c: Chain) => HERO_SHORT[c.entry.name] ?? c.entry.nameFr ?? c.entry.name;

/** Murs : nombre restant sous le niveau max de l'HDV et coût pour tout monter. */
export function wallSummary(v: Village, pass: GoldPass, cfg: JamConfig = JAM) {
  const walls = v.items.filter((i) => i.category === "buildings" && i.entry.name === "Wall");
  if (!walls.length) return null;
  const entry = walls[0].entry;
  const max = maxLevel(entry, { th: v.th });
  let total = 0;
  let atMax = 0;
  let baseCost = 0;
  for (const w of walls) {
    const n = w.cnt ?? 1;
    total += n;
    const lvl = w.lvl ?? 0;
    if (lvl >= max) atMax += n;
    for (let l = lvl; l < max; l++) baseCost += n * (stepCost("buildings", entry, l)?.cost ?? 0);
  }
  const g = pass.builder;
  const jamCost = baseCost * (1 - cfg.costReduction) * (cfg.goldPassAppliesToCost ? 1 - g : 1);
  return { total, atMax, remaining: total - atMax, max, baseCost, jamCost, resource: entry.resource };
}
