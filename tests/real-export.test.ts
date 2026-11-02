// Contrôles sur un export réel, jamais commité. Lancement :
//   COC_EXPORT=my_village.json npm test
// Sans la variable, ces tests sont ignorés.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExport } from "../src/lib/exportParse";
import { gameIndex } from "../src/lib/gamedata";
import { DEFAULT_SETTINGS, forecast, type Settings } from "../src/lib/plan";
import { hoursBetween } from "../src/lib/time";
import { JAM } from "../src/lib/rules";
import { buildVillage } from "../src/lib/village";

const path = process.env.COC_EXPORT;
// Chiffres de référence : chantiers enchaînés sans temps mort, donc sans sommeil (« Chu »).
const NO_SLEEP: Settings = { ...DEFAULT_SETTINGS, sleep: null };
const enabled = !!path && existsSync(path);

describe.skipIf(!enabled)("export réel", () => {
  const load = () => {
    const r = parseExport(readFileSync(path!, "utf8"));
    if (!r.ok) throw new Error(r.error);
    return buildVillage(r.value, gameIndex());
  };

  it("tous les ID sont reconnus", () => {
    const v = load();
    // Échoue en listant les ID inconnus : ils doivent être vérifiés, pas devinés.
    expect(v.report.unknown).toEqual([]);
    expect(v.report.wrongCategory).toEqual([]);
  });

  it("niveaux visibles en jeu : Roi 103, Gardien 76, Duc 15", () => {
    const lvl = (name: string) => load().items.find((i) => i.category === "heroes" && i.entry.name === name)?.lvl;
    expect(lvl("Barbarian King")).toBe(103);
    expect(lvl("Grand Warden")).toBe(76);
    expect(lvl("Dragon Duke")).toBe(15);
  });

  it("T = 332,8 h et 34,5 jours par ouvrier avec 55 potions", () => {
    const v = load();
    expect(hoursBetween(v.timestamp, JAM.end)).toBeCloseTo(332.8, 1);
    const f = forecast(v, NO_SLEEP);
    expect(f.heroes.plan.starts).toHaveLength(55);
    expect(f.heroes.capacityHours / 24).toBeCloseTo(34.5, 1);
  });

  it.each([
    [0, 50],
    [0.1, 51],
    [0.15, 52],
    [0.2, 52],
  ])("Pass %s : %s niveaux de héros, chantiers en cours inclus", (g, expected) => {
    const f = forecast(load(), { ...NO_SLEEP, pass: { builder: g, research: g } });
    expect(f.heroes.gainedLaunched).toBe(expected);
  });
});
