import type { Entry } from "./gamedata";
import type { ResolvedItem } from "./exportParse";

export type BuildingGroup = "defense" | "army" | "resource" | "trap";

export const GROUP_LABEL: Record<BuildingGroup, string> = {
  defense: "Défenses",
  army: "Armée et village",
  resource: "Ressources",
  trap: "Pièges",
};

/** Ordre « défenses d'abord ». Un nom absent de la liste passe après ceux de son groupe. */
export const PRIORITY: Record<BuildingGroup, string[]> = {
  defense: [
    "Eagle Artillery", "Monolith", "Inferno Tower", "Scattershot", "Firespitter", "Super Wizard Tower",
    "Multi-Gear Tower", "Revenge Tower", "Spell Tower", "X-Bow", "Multi-Archer Tower", "Ricochet Cannon",
    "Air Defense", "Bomb Tower", "Wizard Tower", "Hidden Tesla", "Mortar", "Archer Tower", "Cannon",
    "Air Sweeper", "Builder's Hut",
  ],
  army: [
    "Laboratory", "Hero Hall", "Pet House", "Blacksmith", "Clan Castle", "Army Camp", "Spell Factory",
    "Dark Spell Factory", "Barracks", "Dark Barracks", "Workshop", "Town Hall",
  ],
  resource: ["Gold Storage", "Elixir Storage", "Dark Elixir Storage", "Gold Mine", "Elixir Collector", "Dark Elixir Drill"],
  trap: [],
};

const GROUP_ORDER: BuildingGroup[] = ["defense", "army", "resource", "trap"];

export function groupOf(category: string, e: Entry): BuildingGroup {
  if (category === "traps") return "trap";
  if (e.type === "Defense" || e.type === "Worker") return "defense";
  if (e.type === "Resource") return "resource";
  return "army";
}

/**
 * Bâtiment permanent du village principal : il a des niveaux dans les données.
 * Exclut les murs (traités à part) et les bâtiments sans niveaux
 * (défenses artisanales, B.O.B, hutte des assistants, bâtiments d'événement).
 */
export function isPermanentBuilding(i: ResolvedItem): boolean {
  if (i.builderBase) return false;
  if (i.category !== "buildings" && i.category !== "traps") return false;
  if (i.entry.name === "Wall") return false;
  return (i.entry.levels?.length ?? 0) > 0;
}

/** Rang de priorité : plus petit = plus tôt. */
export function priorityRank(category: string, e: Entry): number {
  const g = groupOf(category, e);
  const list = PRIORITY[g];
  const idx = list.indexOf(e.name);
  return GROUP_ORDER.indexOf(g) * 100 + (idx === -1 ? 99 : idx);
}
