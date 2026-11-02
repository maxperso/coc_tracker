import { HOUR, parisDayKey, parisHourOfDay, toDate } from "./time";

/** Plage de sommeil en heures locales de Paris, ex. { start: 23, end: 7 }. */
export interface Sleep {
  start: number;
  end: number;
}

/** Heure de Paris par minute Unix : Intl est lent et la simulation pose souvent la même question. */
const hourCache = new Map<number, number>();
function cachedParisHour(exportUnix: number, h: number): number {
  const minute = Math.floor(exportUnix / 60 + h * 60);
  let x = hourCache.get(minute);
  if (x === undefined) {
    if (hourCache.size > 200_000) hourCache.clear();
    x = parisHourOfDay(new Date(minute * 60_000));
    hourCache.set(minute, x);
  }
  return x;
}

export function isAsleep(exportUnix: number, h: number, sleep: Sleep | null): boolean {
  if (!sleep || sleep.start === sleep.end) return false;
  const x = cachedParisHour(exportUnix, h);
  return sleep.start < sleep.end ? x >= sleep.start && x < sleep.end : x >= sleep.start || x < sleep.end;
}

/** Premier instant ≥ h où le joueur est réveillé (pas de 5 minutes). */
export function nextAwake(exportUnix: number, h: number, sleep: Sleep | null): number {
  if (!sleep) return h;
  let t = h;
  for (let i = 0; i < 24 * 12 + 1 && isAsleep(exportUnix, t, sleep); i++) t = Math.ceil((t + 1e-9) * 12) / 12;
  return t;
}

export interface DayPlan {
  day: string;
  /** Heures depuis l'export du début de chaque potion. */
  starts: number[];
  bought: number;
  stockAfter: number;
}

export interface PotionPlan {
  starts: number[];
  days: DayPlan[];
  unplaced: number;
  owned: number;
  /** Potions retirées du planning car aucun chantier ne tournait pendant leur heure. */
  wasted: number;
}

/** Retire les potions qui ne tombent sur aucun chantier actif et recalcule achats et stock. */
export function prunePlan(plan: PotionPlan, isUseful: (start: number) => boolean): PotionPlan {
  let stock = plan.owned;
  let wasted = 0;
  const days = plan.days.map((d) => {
    const starts = d.starts.filter((s) => isUseful(s) || (wasted++, false));
    const bought = Math.max(0, starts.length - stock);
    stock = stock + bought - starts.length;
    return { ...d, starts, bought, stockAfter: stock };
  });
  return { ...plan, days, starts: days.flatMap((d) => d.starts), wasted: plan.wasted + wasted };
}

/**
 * Répartit `owned + purchases` potions sur les jours restants avant `endH`, à parts égales,
 * bues d'affilée au réveil (ou à `defaultHour` sans plage de sommeil).
 * Les achats se font au moment de boire, donc le stock ne dépasse jamais `maxStock`.
 */
export function planPotions(opts: {
  exportUnix: number;
  endH: number;
  owned: number;
  purchases: number;
  maxStock: number;
  sleep: Sleep | null;
  defaultHour?: number;
}): PotionPlan {
  const { exportUnix, endH, sleep, maxStock } = opts;
  const owned = Math.min(Math.max(0, Math.floor(opts.owned)), maxStock);
  const total = owned + Math.max(0, Math.floor(opts.purchases));
  const firstHour = sleep ? sleep.end : (opts.defaultHour ?? 9);

  // Jours de Paris entre l'export et la fin, avec l'instant (h) où l'on commence à boire.
  const days: { day: string; from: number }[] = [];
  for (let h = 0; h < endH; ) {
    const key = parisDayKey(toDate(exportUnix, h));
    const local = parisHourOfDay(toDate(exportUnix, h));
    // Instant `firstHour` heure locale de ce jour.
    const target = h + (firstHour - local);
    if (!days.some((d) => d.day === key)) days.push({ day: key, from: nextAwake(exportUnix, Math.max(0, target), sleep) });
    // Minuit local suivant ; un changement d'heure décale d'une heure, corrigé au tour suivant.
    let next = h + (24 - local);
    const drift = parisHourOfDay(toDate(exportUnix, next));
    if (drift > 12) next += 24 - drift;
    else next -= drift;
    h = Math.max(next, h + 1);
  }

  const usable = days.filter((d) => d.from + 1 <= endH);
  const result: DayPlan[] = [];
  const starts: number[] = [];
  let stock = owned;
  let remaining = total;
  usable.forEach((d, i) => {
    const share = Math.ceil(remaining / (usable.length - i));
    const dayStarts: number[] = [];
    let t = d.from;
    while (dayStarts.length < share) {
      t = nextAwake(exportUnix, t, sleep);
      if (t + 1 > endH || parisDayKey(toDate(exportUnix, t)) !== d.day) break;
      dayStarts.push(t);
      t += 1;
    }
    const bought = Math.max(0, dayStarts.length - stock);
    stock = stock + bought - dayStarts.length;
    remaining -= dayStarts.length;
    starts.push(...dayStarts);
    result.push({ day: d.day, starts: dayStarts, bought, stockAfter: stock });
  });
  return { starts, days: result, unplaced: remaining, owned, wasted: 0 };
}

export const hoursToUnix = (exportUnix: number, h: number) => exportUnix + h * HOUR;
