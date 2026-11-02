import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExport } from "../src/lib/exportParse";
import { gameIndex } from "../src/lib/gamedata";
import { builderForecast, customOrder, DEFAULT_SETTINGS, forecast, typeKey, type Settings, type UpgradeOrder } from "../src/lib/plan";
import { parseSettings } from "../src/lib/settingsSchema";
import { buildVillage } from "../src/lib/village";

const village = () => {
  const r = parseExport(readFileSync(new URL("./fixtures/valid.json", import.meta.url), "utf8"));
  if (!r.ok) throw new Error(r.error);
  return buildVillage(r.value, gameIndex());
};
const custom = (order: Partial<UpgradeOrder>): Settings => ({
  ...DEFAULT_SETTINGS,
  focus: "custom",
  order: { ...DEFAULT_SETTINGS.order, ...order },
});

describe("ordre perso", () => {
  const v = village();

  it("propose par défaut les héros puis les défenses, sans les types déjà au max", () => {
    const order = customOrder(v, custom({}), "builder");
    expect(order[0]).toMatch(/^heroes:/);
    expect(order.findIndex((k) => !k.startsWith("heroes:"))).toBeGreaterThan(0);
    expect(new Set(order).size).toBe(order.length);
    const f = builderForecast(v, custom({}));
    const upgradable = new Set([...f.heroes.results, ...f.buildings.results].filter((r) => r.chain.steps.length).map((r) => typeKey(r.chain)));
    expect(new Set(order)).toEqual(upgradable);
  });

  it("place les types choisis en premier et garde les autres à la suite", () => {
    const base = customOrder(v, custom({}), "builder");
    const last = base.at(-1)!;
    const order = customOrder(v, custom({ builder: [last, "buildings:999999"] }), "builder");
    expect(order[0]).toBe(last);
    expect(order).not.toContain("buildings:999999");
    expect(order).toHaveLength(base.length);
  });

  it("donne le premier ouvrier libre au premier de la liste", () => {
    const base = customOrder(v, custom({}), "builder");
    const firstBuilding = base.find((k) => !k.startsWith("heroes:"))!;
    const heroes = base.filter((k) => k.startsWith("heroes:"));
    // Le bâtiment passe devant tous les héros : il part dès l'export.
    const f = builderForecast(v, custom({ builder: [firstBuilding, ...heroes] }));
    const launched = f.buildings.results.filter((r) => typeKey(r.chain) === firstBuilding).flatMap((r) => r.segments.filter((s) => !s.inProgressAtExport));
    expect(launched.length).toBeGreaterThan(0);
    expect(Math.min(...launched.map((s) => s.start))).toBe(0);
  });

  it("ne lance jamais un type en pause", () => {
    const heroes = customOrder(v, custom({}), "builder").filter((k) => k.startsWith("heroes:"));
    const f = forecast(v, custom({ off: heroes }));
    for (const r of f.heroes.results) expect(r.segments.filter((s) => !s.inProgressAtExport)).toEqual([]);
    expect(f.buildings.gainedLaunched).toBeGreaterThan(0);
  });

  it("ordonne aussi le labo et les animaux", () => {
    const lab = customOrder(v, custom({}), "lab");
    const last = lab.at(-1)!;
    const f = forecast(v, custom({ lab: [last] }));
    const first = f.labBest.results.flatMap((r) => r.segments.filter((s) => !s.inProgressAtExport).map((s) => ({ k: typeKey(r.chain), t: s.start }))).sort((a, b) => a.t - b.t)[0];
    expect(first.k).toBe(last);
    expect(customOrder(v, custom({}), "pet").every((k) => k.startsWith("pets:"))).toBe(true);
  });

  it("relit des réglages sans ordre (ancienne version)", () => {
    const { order: _, ...old } = DEFAULT_SETTINGS;
    expect(parseSettings({ ...old, focus: "custom" }).order).toEqual(DEFAULT_SETTINGS.order);
    expect(parseSettings({ ...old, focus: "custom" }).focus).toBe("custom");
  });
});
