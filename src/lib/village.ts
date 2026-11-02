import type { GameIndex, Gates } from "./gamedata";
import { resolveIds, type IdReport, type ParsedExport, type ResolvedItem } from "./exportParse";

export interface Village {
  tag: string;
  timestamp: number;
  th: number;
  gates: Gates;
  /** Éléments du village principal, ID reconnus. */
  items: ResolvedItem[];
  report: IdReport;
  warnings: string[];
}

function buildingLevel(items: ResolvedItem[], name: string): number | undefined {
  const lv = items.filter((i) => i.category === "buildings" && i.entry.name === name).map((i) => i.lvl ?? 0);
  return lv.length ? Math.max(...lv) : undefined;
}

export function buildVillage(exp: ParsedExport, idx: GameIndex): Village {
  const { items, report } = resolveIds(exp, idx);
  const home = items.filter((i) => !i.builderBase);
  const warnings = [...exp.warnings];
  const th = buildingLevel(home, "Town Hall");
  if (th == null) warnings.push("Hôtel de ville introuvable dans l'export : niveau 1 supposé.");
  const gates: Gates = {
    th: th ?? 1,
    heroHall: buildingLevel(home, "Hero Hall"),
    lab: buildingLevel(home, "Laboratory"),
    petHouse: buildingLevel(home, "Pet House"),
    blacksmith: buildingLevel(home, "Blacksmith"),
  };
  return { tag: exp.tag, timestamp: exp.timestamp, th: gates.th, gates, items: home, report, warnings };
}
