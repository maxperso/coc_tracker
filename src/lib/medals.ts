import { forecast, hammerTimes, type Settings } from "./plan";
import { JAM, type JamConfig } from "./rules";
import { hoursBetween } from "./time";
import type { Village } from "./village";

export interface Allocation {
  label: string;
  builderPotions: number;
  researchPotions: number;
  heroHammers: number;
}

export interface AllocationResult extends Allocation {
  medalsUsed: number;
  heroesByEnd: number;
  heroesLaunched: number;
  buildingsLaunched: number;
  labMin: number;
  labMax: number;
}

export function allocations(medals: number, tHours: number, cfg: JamConfig = JAM): Allocation[] {
  const pb = cfg.potions.builder.medalPrice;
  const pr = cfg.potions.research.medalPrice;
  const ph = cfg.hammers.heroes.medalPrice;
  const maxHammers = Math.min(hammerTimes(99, tHours, cfg).length, Math.floor(medals / ph));
  const half = Math.floor(medals / 2);
  return [
    { label: "Tout en potions d'ouvrier", builderPotions: Math.floor(medals / pb), researchPotions: 0, heroHammers: 0 },
    { label: "Tout en potions de recherche", builderPotions: 0, researchPotions: Math.floor(medals / pr), heroHammers: 0 },
    { label: "Moitié ouvrier, moitié recherche", builderPotions: Math.floor(half / pb), researchPotions: Math.floor((medals - half) / pr), heroHammers: 0 },
    {
      label: `${maxHammers} marteau${maxHammers > 1 ? "x" : ""} de héros, reste en potions d'ouvrier`,
      builderPotions: Math.floor((medals - maxHammers * ph) / pb),
      researchPotions: 0,
      heroHammers: maxHammers,
    },
  ];
}

export function compareAllocations(v: Village, base: Settings, cfg: JamConfig = JAM): AllocationResult[] {
  const tHours = hoursBetween(v.timestamp, cfg.end);
  return allocations(base.medals, tHours, cfg).map((a) => {
    const s: Settings = {
      ...base,
      heroHammers: a.heroHammers,
      potions: {
        ...base.potions,
        builder: { owned: base.potions.builder.owned, purchases: a.builderPotions },
        research: { owned: base.potions.research.owned, purchases: a.researchPotions },
      },
    };
    const f = forecast(v, s, cfg);
    return {
      ...a,
      medalsUsed:
        a.builderPotions * cfg.potions.builder.medalPrice +
        a.researchPotions * cfg.potions.research.medalPrice +
        a.heroHammers * cfg.hammers.heroes.medalPrice,
      heroesByEnd: f.heroes.gainedByEnd,
      heroesLaunched: f.heroes.gainedLaunched,
      buildingsLaunched: f.buildings.gainedLaunched,
      labMin: f.labWorst.gainedLaunched,
      labMax: f.labBest.gainedLaunched,
    };
  });
}
