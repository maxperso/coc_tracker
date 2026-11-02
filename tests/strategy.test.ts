import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPermanentBuilding, priorityRank } from "../src/lib/buildings";
import { parseExport } from "../src/lib/exportParse";
import { findByName, gameIndex } from "../src/lib/gamedata";
import { buildingChains, DEFAULT_SETTINGS, forecast, type Settings } from "../src/lib/plan";
import { globalPct, progress, progressCurve } from "../src/lib/progress";
import { buildVillage } from "../src/lib/village";

const village = () => {
  const r = parseExport(readFileSync(new URL("./fixtures/valid.json", import.meta.url), "utf8"));
  if (!r.ok) throw new Error(r.error);
  return buildVillage(r.value, gameIndex());
};
const s = (focus: Settings["focus"]): Settings => ({ ...DEFAULT_SETTINGS, focus });

describe("bâtiments permanents", () => {
  it("exclut murs, bâtiments sans niveaux et base des ouvriers", () => {
    const v = village();
    const names = v.items.filter(isPermanentBuilding).map((i) => i.entry.name);
    expect(names).not.toContain("Wall");
    expect(names).toContain("Cannon");
    expect(names).toContain("Bomb");
  });
  it("crée une chaîne par exemplaire", () => {
    const cannons = buildingChains(village()).filter((c) => c.entry.name === "Cannon");
    expect(cannons).toHaveLength(7);
    expect(cannons.filter((c) => c.inProgress)).toHaveLength(1);
  });
  it("classe les défenses avant l'armée, les ressources et les pièges", () => {
    const idx = gameIndex();
    const rank = (cat: string, n: string) => priorityRank(cat, findByName(idx, cat, n)!);
    expect(rank("buildings", "Eagle Artillery")).toBeLessThan(rank("buildings", "Cannon"));
    expect(rank("buildings", "Cannon")).toBeLessThan(rank("buildings", "Laboratory"));
    expect(rank("buildings", "Laboratory")).toBeLessThan(rank("buildings", "Gold Mine"));
    expect(rank("buildings", "Gold Mine")).toBeLessThan(rank("traps", "Bomb"));
  });
});

describe("stratégie", () => {
  it("héros : aucun bâtiment relancé, seuls les chantiers en cours finissent", () => {
    const f = forecast(village(), s("heroes"));
    expect(f.buildings.gainedLaunched).toBe(1);
    expect(f.heroes.gainedLaunched).toBeGreaterThan(40);
  });
  it("bâtiments : les héros finissent seulement leur chantier en cours", () => {
    const f = forecast(village(), s("buildings"));
    expect(f.heroes.gainedLaunched).toBe(1);
    expect(f.buildings.gainedLaunched).toBeGreaterThan(1);
  });
  it("hybride : autant de niveaux de héros qu'en focus héros", () => {
    const v = village();
    expect(forecast(v, s("hybrid")).heroes.gainedLaunched).toBe(forecast(v, s("heroes")).heroes.gainedLaunched);
  });
});

describe("courbe d'avancement", () => {
  it("part de l'avancement actuel et ne redescend jamais", () => {
    const v = village();
    const pts = progressCurve(v, forecast(v, s("hybrid")));
    expect(pts[0].t).toBe(0);
    expect(pts[0].global).toBeCloseTo(globalPct(progress(v)), 10);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].global).toBeGreaterThanOrEqual(pts[i - 1].global - 1e-12);
      expect(pts[i].heroes).toBeGreaterThanOrEqual(pts[i - 1].heroes - 1e-12);
    }
    expect(pts.at(-1)!.global).toBeLessThanOrEqual(1);
  });
});
