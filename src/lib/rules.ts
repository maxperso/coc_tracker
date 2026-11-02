import jam from "../../config/hammer-jam-2026.json";

export type JamConfig = typeof jam;
export const JAM: JamConfig = jam;

/** Pourcentages proposés par le Pass d'or. */
export const GOLD_PASS_STEPS = [0, 0.1, 0.15, 0.2] as const;

/** Portée du Pass d'or : "builder" et "research" sont documentés, le reste non confirmé. */
export type BoostScope = "builder" | "research" | "none";

export interface GoldPass {
  builder: number;
  research: number;
}

export function boostFor(scope: BoostScope, pass: GoldPass): number {
  if (scope === "builder") return pass.builder;
  if (scope === "research") return pass.research;
  return 0;
}

/**
 * Facteur appliqué à la durée (ou au coût) de base d'un chantier lancé à un instant donné.
 * `duringJam` : le chantier est lancé avant la fin du Jam (la valeur réduite reste figée ensuite).
 */
export function durationFactor(duringJam: boolean, g: number, cfg: JamConfig = JAM): number {
  const jamPart = duringJam ? 1 - cfg.timeReduction : 1;
  if (cfg.goldPassStacking === "additive") return Math.max(0, jamPart - g);
  return jamPart * (1 - g);
}

export function costFactor(duringJam: boolean, g: number, cfg: JamConfig = JAM): number {
  const jamPart = duringJam ? 1 - cfg.costReduction : 1;
  const gp = cfg.goldPassAppliesToCost ? g : 0;
  if (cfg.goldPassStacking === "additive") return Math.max(0, jamPart - gp);
  return jamPart * (1 - gp);
}

/** Durée réduite en secondes. Aucun arrondi tant que la règle du jeu n'est pas connue. */
export function reducedSeconds(baseSeconds: number, factor: number, cfg: JamConfig = JAM): number {
  const v = baseSeconds * factor;
  if (cfg.rounding === "ceil-minute") return Math.ceil(v / 60) * 60;
  return v;
}
