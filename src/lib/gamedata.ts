import raw from "../data/gamedata.json";

export interface Level {
  l: number;
  th: number | null;
  /** Durée en secondes. Sens selon la catégorie : voir `LEVEL_MODE`. */
  t?: number;
  c?: number;
  lab?: number;
  hh?: number;
  ph?: number;
  bs?: number;
  ore?: Record<string, number> | null;
}

export interface Entry {
  id: number;
  name: string;
  nameFr?: string;
  village?: string;
  type?: string;
  resource?: string;
  productionBuilding?: string;
  superchargeable?: boolean;
  superTroop?: boolean;
  seasonal?: boolean;
  hero?: string;
  levels?: Level[];
}

export interface GameData {
  source: { repo: string; license: string; commit: string; commitDate: string; syncedAt: string };
  categories: Record<string, Entry[]>;
  sprites: string[];
  /** HDV le plus haut du jeu. */
  maxTh: number;
  /** Exemplaires de chaque bâtiment ou piège selon l'HDV : `thCounts[id][hdv]`. */
  thCounts: Record<string, number[]>;
}

export const GAME_DATA = raw as unknown as GameData;

/**
 * "toNext" : la ligne N donne le passage de N à N+1 (champs upgrade_* de ClashKing).
 * "toReach" : la ligne N donne le coût pour atteindre N (champs build_*).
 */
export const LEVEL_MODE: Record<string, "toNext" | "toReach"> = {
  heroes: "toNext",
  troops: "toNext",
  spells: "toNext",
  pets: "toNext",
  guardians: "toNext",
  buildings: "toReach",
  traps: "toReach",
};

export interface Found {
  category: string;
  entry: Entry;
}

export interface GameIndex {
  data: GameData;
  byId: Map<number, Found[]>;
  sprites: Set<string>;
}

export function indexGameData(data: GameData = GAME_DATA): GameIndex {
  const byId = new Map<number, Found[]>();
  for (const [category, list] of Object.entries(data.categories)) {
    for (const entry of list) {
      const arr = byId.get(entry.id) ?? [];
      arr.push({ category, entry });
      byId.set(entry.id, arr);
    }
  }
  return { data, byId, sprites: new Set(data.sprites) };
}

let defaultIndex: GameIndex | null = null;
export const gameIndex = () => (defaultIndex ??= indexGameData());

export function findByName(idx: GameIndex, category: string, name: string): Entry | undefined {
  return idx.data.categories[category]?.find((e) => e.name === name);
}

/** Règle de nettoyage du README de ClashKingAssets. */
export function cleanName(s: string): string {
  return s.toLowerCase().replaceAll(" ", "_").replaceAll(".", "").replaceAll("?", "").replaceAll("\\q", "").replaceAll("’", "");
}

/** Chemin du sprite relatif à `sprites/`, ou null si la catégorie n'a pas de modèle connu. */
export function spritePath(category: string, entry: Entry, level?: number): string | null {
  const n = cleanName(entry.name);
  switch (category) {
    case "heroes": return `heroes/${n}/icon.webp`;
    case "troops": return `troops/${n}/icon.webp`;
    case "spells": return `spells/${n}.webp`;
    case "pets": return `pets/${n}/icon.webp`;
    case "equipment": return `equipment/${n}.webp`;
    case "buildings": return `buildings/home-village/${n}/level_${level ?? 1}.webp`;
    case "traps": return `traps/home-village/${n}/level_${level ?? 1}.webp`;
    default: return null;
  }
}

export function levelLine(entry: Entry, level: number): Level | undefined {
  return entry.levels?.find((l) => l.l === level);
}

export interface Gates {
  th: number;
  heroHall?: number;
  lab?: number;
  petHouse?: number;
  blacksmith?: number;
}

/** Une ligne de niveau est-elle accessible avec ces bâtiments ? Un critère absent n'est pas vérifié. */
export function levelAllowed(line: Level, g: Gates): boolean {
  if (line.th != null && line.th > g.th) return false;
  if (line.hh != null && g.heroHall != null && line.hh > g.heroHall) return false;
  if (line.lab != null && g.lab != null && line.lab > g.lab) return false;
  if (line.ph != null && g.petHouse != null && line.ph > g.petHouse) return false;
  if (line.bs != null && g.blacksmith != null && line.bs > g.blacksmith) return false;
  return true;
}

/** Niveau max accessible : plus grand N dont la ligne est autorisée, sans trou depuis le niveau 1. */
export function maxLevel(entry: Entry, g: Gates): number {
  let max = 0;
  for (const line of [...(entry.levels ?? [])].sort((a, b) => a.l - b.l)) {
    if (!levelAllowed(line, g)) break;
    max = line.l;
  }
  return max;
}

/** Niveau max pour l'HDV seul (sans bâtiment de production). */
export const maxLevelForTh = (entry: Entry, th: number) => maxLevel(entry, { th });

/** Durée (s), coût et ressource pour passer de `from` à `from + 1`, selon la convention de la catégorie. */
export function stepCost(category: string, entry: Entry, from: number): { seconds: number; cost: number } | null {
  const mode = LEVEL_MODE[category];
  const line = levelLine(entry, mode === "toNext" ? from : from + 1);
  if (!line || !levelLine(entry, from + 1)) return null;
  return { seconds: line.t ?? 0, cost: line.c ?? 0 };
}

export function displayName(entry: Entry): string {
  return entry.nameFr ?? entry.name;
}

/** Noms courts des héros, comme dans les maquettes. */
export const HERO_SHORT: Record<string, string> = {
  "Barbarian King": "Roi",
  "Archer Queen": "Reine",
  "Grand Warden": "Gardien",
  "Royal Champion": "Championne",
  "Minion Prince": "Prince",
  "Dragon Duke": "Duc dragon",
};
