import type { Chain } from "./sim";
import { HOUR, addDays, parisTimeToUnix } from "./time";

/** Ligue de clans : jours et heure des attaques, héros à garder libres. */
export interface Cwl {
  enabled: boolean;
  /** Premier jour d'attaque, « 2026-11-03 » (Paris) ; vide tant qu'il n'est pas choisi. */
  firstDay: string;
  /** Jours d'attaque à partir du premier (7 pour une ligue complète). */
  days: number;
  /** Heure de l'attaque, heure de Paris. */
  hour: number;
  /** Héros emmenés en attaque (clés de chaîne « heroes:<id> ») ; vide = les premiers du village. */
  heroes: string[];
}

export const CWL_MAX_DAYS = 7;
export const CWL_HEROES = 4;
/** Le héros doit être libre une heure à partir de l'heure d'attaque. */
export const ATTACK_HOURS = 1;

export const DEFAULT_CWL: Cwl = { enabled: false, firstDay: "", days: CWL_MAX_DAYS, hour: 20, heroes: [] };

export interface Window {
  /** Heures depuis l'export. */
  start: number;
  end: number;
}

/** Chaînes à garder libres pendant les fenêtres. */
export interface Blackout {
  keys: ReadonlySet<string>;
  windows: Window[];
}

/** Heures d'attaque pas encore passées au moment de l'export. */
export function cwlWindows(c: Cwl, exportUnix: number): Window[] {
  if (!c.enabled || !c.firstDay) return [];
  const out: Window[] = [];
  for (let d = 0; d < c.days; d++) {
    const start = (parisTimeToUnix(addDays(c.firstDay, d), c.hour) - exportUnix) / HOUR;
    if (start + ATTACK_HOURS > 0) out.push({ start, end: start + ATTACK_HOURS });
  }
  return out;
}

/** Héros emmenés : ceux choisis s'ils sont dans le village, sinon les premiers. */
export function cwlHeroKeys(c: Cwl, heroes: readonly { key: string }[]): string[] {
  const chosen = c.heroes.filter((k) => heroes.some((h) => h.key === k));
  return (chosen.length ? chosen : heroes.map((h) => h.key)).slice(0, CWL_HEROES);
}

export function cwlBlackout(c: Cwl, exportUnix: number, heroes: readonly Chain[]): Blackout | undefined {
  const windows = cwlWindows(c, exportUnix);
  if (!windows.length) return undefined;
  return { keys: new Set(cwlHeroKeys(c, heroes)), windows };
}

export const overlaps = (start: number, end: number, w: Window) => start < w.end - 1e-9 && end > w.start + 1e-9;
