import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPermanentBuilding } from "../src/lib/buildings";
import { parseExport } from "../src/lib/exportParse";
import { gameIndex, maxLevel } from "../src/lib/gamedata";
import { buildingChains, DEFAULT_SETTINGS, forecast } from "../src/lib/plan";
import { simulate, type Chain } from "../src/lib/sim";
import { buildVillage, type Village } from "../src/lib/village";
import { WorkClock } from "../src/lib/workclock";

const EXPORT_TS = 1793617920;

describe("niveaux débloqués au fil du plan", () => {
  const chain = (key: string, hours: number[], extra: Partial<Chain> = {}, th: number[] = []): Chain => ({
    key,
    category: "buildings",
    entry: { id: key.length, name: key },
    startLevel: 1,
    steps: hours.map((h, i) => ({ toLevel: 2 + i, baseSeconds: h * 3600, baseCost: 1, line: { l: 2 + i, th: th[i] ?? 1 } })),
    scope: "builder",
    ...extra,
  });
  /** HDV 15 → 16 en 20 h de base (10 h pendant le Jam). */
  const hdv = (): Chain => ({
    key: "hdv",
    category: "buildings",
    entry: { id: 99, name: "Town Hall" },
    startLevel: 15,
    steps: [{ toLevel: 16, baseSeconds: 20 * 3600, baseCost: 1, line: { l: 16, th: 15 } }],
    scope: "builder",
    unlocks: "th",
  });
  const run = (chains: Chain[], slots = 2) =>
    simulate({
      exportUnix: EXPORT_TS, jamEndH: 200, slots, clock: new WorkClock([], 9), chains,
      pass: { builder: 0, research: 0 }, policy: "mostRemaining", sleep: null, gates: { th: 15 },
    }).results;

  it("un niveau qui demande l'HDV 16 attend la fin de la montée d'HDV", () => {
    const [hall, tour] = run([hdv(), chain("tour", [4, 4], {}, [15, 16])]);
    expect(hall.segments[0].end).toBe(10);
    expect(tour.segments.map((s) => s.start)).toEqual([0, 10]);
  });

  it("un exemplaire pas encore construit attend l'HDV qui l'autorise", () => {
    const [, nouveau] = run([hdv(), chain("nouveau", [4], { unlockTh: 16, startLevel: 0 })]);
    expect(nouveau.segments[0].start).toBe(10);
  });

  it("sans montée d'HDV, rien de bloqué ne part", () => {
    const [tour] = run([chain("tour", [4, 4], {}, [15, 16])]);
    expect(tour.segments).toHaveLength(1);
  });
});

describe("HDV en dessous du max", () => {
  const r = parseExport(readFileSync(new URL("./fixtures/valid.json", import.meta.url), "utf8"));
  if (!r.ok) throw new Error(r.error);
  const v18 = buildVillage(r.value, gameIndex());
  // Le village de test ramené à l'HDV 15 : niveaux au max de l'HDV 15.
  const data = gameIndex().data;
  const hall = (name: string) => maxLevel(data.categories.buildings.find((e) => e.name === name)!, { th: 15 });
  const gates = { th: 15, heroHall: hall("Hero Hall"), lab: hall("Laboratory"), petHouse: hall("Pet House"), blacksmith: hall("Blacksmith") };
  const v15: Village = {
    ...v18,
    th: 15,
    gates,
    items: v18.items.map((i) => {
      const b = i.category === "buildings" || i.category === "traps";
      return { ...i, timer: undefined, lvl: i.entry.name === "Town Hall" ? 15 : Math.min(i.lvl ?? 0, maxLevel(i.entry, b ? { th: 15 } : gates)) };
    }),
  };

  it("propose de construire les bâtiments manquants, chacun quand l'HDV l'autorise", () => {
    const fresh = buildingChains(v15).filter((c) => c.startLevel === 0);
    expect(fresh.length).toBeGreaterThan(0);
    for (const c of fresh) expect(c.unlockTh).toBeGreaterThanOrEqual(15);
    const built = v18.items.filter(isPermanentBuilding).length;
    expect(built).toBeGreaterThan(0);
  });

  it("monte l'HDV pendant le Jam et compare les deux ordres", () => {
    const f = forecast(v15, { ...DEFAULT_SETTINGS, focus: "hybrid" });
    const th = f.buildings.results.find((x) => x.chain.entry.name === "Town Hall")!;
    expect(th.segments.some((s) => s.toLevel === 16)).toBe(true);
    expect(f.unlockChoice).toBeDefined();
    expect(f.gateEvents.some((e) => e.key === "th" && e.level === 16)).toBe(true);
    // Aucun niveau d'HDV 16 n'est lancé avant la fin de la montée.
    const up = th.segments.find((s) => s.toLevel === 16)!;
    for (const res of f.buildings.results) {
      for (const s of res.segments) {
        const line = res.chain.steps.find((x) => x.toLevel === s.toLevel)?.line;
        if (line?.th && line.th >= 16 && !s.inProgressAtExport) expect(s.start).toBeGreaterThanOrEqual(up.end - 1e-6);
      }
    }
  });
});
