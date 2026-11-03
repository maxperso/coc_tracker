import { HOUR, parisDayKey, toDate } from "./time";

/**
 * Ce que le joueur a confirmé en cochant une action du plan : l'heure réelle (secondes Unix) et,
 * pour des potions, combien il en a bu. Le plan se recalcule à partir de ces faits.
 */
export interface Fact {
  at: number;
  count?: number;
}

export type Facts = Readonly<Record<string, Fact>>;

export const MAX_POTIONS_FACT = 50;

/** Lancements confirmés : « chaîne:niveau » → heures depuis l'export. */
export function launchFacts(facts: Facts, exportUnix: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, f] of Object.entries(facts)) {
    const m = key.match(/^L:(.+):(\d+)$/);
    if (m) out.set(`${m[1]}:${m[2]}`, Math.max(0, (f.at - exportUnix) / HOUR));
  }
  return out;
}

/** Potions confirmées d'un groupe (« builder », « lab », « pet ») : jour de Paris → début (h) et nombre bu. */
export function potionFacts(facts: Facts, pool: string, exportUnix: number): Map<string, { start: number; count: number }> {
  const out = new Map<string, { start: number; count: number }>();
  for (const [key, f] of Object.entries(facts)) {
    const m = key.match(/^P:([a-z]+):(\d{4}-\d{2}-\d{2})$/);
    if (!m || m[1] !== pool || f.count == null) continue;
    out.set(m[2], { start: Math.max(0, (f.at - exportUnix) / HOUR), count: Math.max(0, Math.min(MAX_POTIONS_FACT, Math.floor(f.count))) });
  }
  return out;
}

/** Jour de Paris d'un instant en heures depuis l'export. */
export const dayOf = (exportUnix: number, h: number) => parisDayKey(toDate(exportUnix, h));
