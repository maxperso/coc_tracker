import { builderForecast, hammerTimes, labForecast, type Settings } from "./plan";
import { JAM, type JamConfig } from "./rules";
import { hoursBetween } from "./time";
import type { Village } from "./village";

export interface Purchase {
  builder: number;
  research: number;
  hammers: number;
  medalsUsed: number;
  heroes: number;
  buildings: number;
  lab: number;
  /** Phrase courte qui explique le choix. */
  reason: string;
}

function withPurchase(s: Settings, builder: number, research: number, hammers: number): Settings {
  return {
    ...s,
    heroHammers: hammers,
    potions: {
      ...s.potions,
      builder: { owned: s.potions.builder.owned, purchases: builder },
      research: { owned: s.potions.research.owned, purchases: research },
    },
  };
}

/**
 * Meilleure façon de dépenser les médailles pour la stratégie choisie.
 * - Héros : le minimum de potions d'ouvrier qui donne le maximum de niveaux de héros
 *   (recherche dichotomique), le reste en potions de recherche. Les marteaux sont testés.
 * - Hybride et Perso : le plus de niveaux au total (héros + bâtiments), les héros départagent ; marteaux testés.
 *   Un niveau de héros ne vaut pas vingt niveaux de bâtiments : un marteau n'est pris que s'il rapporte plus.
 * - Bâtiments : tout en potions d'ouvrier (les ouvriers ont toujours du travail).
 */
export function recommendPurchases(v: Village, s: Settings, cfg: JamConfig = JAM): Purchase {
  const M = Math.max(0, s.medals);
  const pb = cfg.potions.builder.medalPrice;
  const pr = cfg.potions.research.medalPrice;
  const ph = cfg.hammers.heroes.medalPrice;
  const tHours = hoursBetween(v.timestamp, cfg.end);
  const maxHammers = s.focus === "buildings" ? 0 : Math.min(hammerTimes(99, tHours, cfg).length, Math.floor(M / ph));

  const builderLevels = (b: number, h: number) => {
    const f = builderForecast(v, withPurchase(s, b, 0, h), cfg);
    return { heroes: f.heroes.gainedLaunched, buildings: f.buildings.gainedLaunched };
  };

  const candidates: Purchase[] = [];
  for (let h = 0; h <= maxHammers; h++) {
    const budget = M - h * ph;
    const bMax = Math.floor(budget / pb);
    let b = bMax;
    const top = builderLevels(bMax, h);
    if (s.focus === "heroes") {
      // Plus petit nombre de potions d'ouvrier qui garde le maximum de niveaux de héros.
      let lo = 0;
      let hi = bMax;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (builderLevels(mid, h).heroes >= top.heroes) hi = mid;
        else lo = mid + 1;
      }
      b = lo;
    }
    const levels = b === bMax ? top : builderLevels(b, h);
    const research = Math.floor((budget - b * pb) / pr);
    const lab = labForecast(v, withPurchase(s, b, research, h), "shortest", cfg).gainedLaunched;
    candidates.push({
      builder: b,
      research,
      hammers: h,
      medalsUsed: b * pb + research * pr + h * ph,
      heroes: levels.heroes,
      buildings: levels.buildings,
      lab,
      reason: "",
    });
  }

  const key = (c: Purchase) =>
    s.focus === "heroes" ? [c.heroes, c.lab, -c.medalsUsed]
    : s.focus === "buildings" ? [c.buildings, c.lab, -c.medalsUsed]
    : [c.heroes + c.buildings, c.heroes, c.lab, -c.medalsUsed];
  const better = (a: Purchase, b: Purchase) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] > kb[i];
    return false;
  };
  const best = candidates.reduce((a, c) => (better(c, a) ? c : a));
  best.reason = explain(best, s, M, pb, pr);
  return best;
}

function explain(p: Purchase, s: Settings, M: number, pb: number, pr: number): string {
  const builders = s.builders + (s.goblinBuilder ? 1 : 0);
  const hammer = p.hammers ? ` ${p.hammers > 1 ? `Les ${p.hammers} marteaux de héros rapportent` : "Le marteau de héros rapporte"} plus que les potions au même prix.` : "";
  if (M < pb) return "Pas assez de médailles pour une potion d'ouvrier.";
  if (s.focus === "heroes") {
    if (p.research > 0) {
      return `${p.builder} potions d'ouvrier suffisent pour tes héros : au-delà, elles ne rapportent plus de niveau de héros. Le reste va au labo.${hammer}`;
    }
    return `Chaque potion d'ouvrier rapporte encore des niveaux de héros : tout va aux potions d'ouvrier.${hammer}`;
  }
  return (
    `Une potion d'ouvrier (${pb} médailles) donne ${9 * builders} h de chantier à tes ${builders} ouvriers, ` +
    `contre 23 h de labo pour une potion de recherche (${pr} médailles) : tout va aux ouvriers.${hammer}`
  );
}

/** Réglages utilisés pour le plan : achats recommandés si le mode automatique est actif. */
export function effectiveSettings(v: Village, s: Settings, cfg: JamConfig = JAM): { settings: Settings; purchase: Purchase | null } {
  if (!s.autoPurchases) return { settings: s, purchase: null };
  const purchase = recommendPurchases(v, s, cfg);
  return { settings: withPurchase(s, purchase.builder, purchase.research, purchase.hammers), purchase };
}
