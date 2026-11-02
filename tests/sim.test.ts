import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExport } from "../src/lib/exportParse";
import { gameIndex } from "../src/lib/gamedata";
import { DEFAULT_SETTINGS, forecast, hammerTimes, heroChains, wallSummary, type Settings } from "../src/lib/plan";
import { isAsleep, planPotions } from "../src/lib/potionPlan";
import { levelAt, simulate, type Chain } from "../src/lib/sim";
import { parisHourOfDay, toDate } from "../src/lib/time";
import { buildVillage } from "../src/lib/village";
import { WorkClock } from "../src/lib/workclock";

const EXPORT_TS = 1793617920;
const T = 332.8;

const village = () => {
  const r = parseExport(readFileSync(new URL("./fixtures/valid.json", import.meta.url), "utf8"));
  if (!r.ok) throw new Error(r.error);
  return buildVillage(r.value, gameIndex());
};

describe("horloge de travail", () => {
  it("une potion d'ouvrier ajoute 9 h de travail", () => {
    const c = new WorkClock([10], 9);
    expect(c.work(10)).toBe(10);
    expect(c.work(11)).toBe(20);
    expect(c.work(20)).toBe(29);
  });
  it("timeAt est l'inverse de work", () => {
    const c = new WorkClock([2, 3, 50], 23);
    for (const t of [0, 1.5, 2.5, 3.2, 10, 50.5, 80]) expect(c.timeAt(c.work(t))).toBeCloseTo(t, 9);
  });
  it("deux potions bues en même temps s'enchaînent", () => {
    const c = new WorkClock([5, 5], 9);
    expect(c.potionWindows).toEqual([{ start: 5, end: 6 }, { start: 6, end: 7 }]);
  });
  it("capacité à la fin du Jam = T + 9 × potions", () => {
    const plan = planPotions({ exportUnix: EXPORT_TS, endH: T, owned: 5, purchases: 50, maxStock: 5, sleep: null });
    expect(plan.unplaced).toBe(0);
    expect(plan.starts).toHaveLength(55);
    expect(new WorkClock(plan.starts, 9).work(T) / 24).toBeCloseTo(34.49, 2);
  });
});

describe("planning des potions", () => {
  it("respecte le stock max de 5 et n'achète que le nécessaire", () => {
    const plan = planPotions({ exportUnix: EXPORT_TS, endH: T, owned: 5, purchases: 50, maxStock: 5, sleep: null });
    for (const d of plan.days) expect(d.stockAfter).toBeLessThanOrEqual(5);
    expect(plan.days.reduce((s, d) => s + d.bought, 0)).toBe(50);
  });
  it("plafonne le stock de départ à 5", () => {
    const plan = planPotions({ exportUnix: EXPORT_TS, endH: T, owned: 9, purchases: 0, maxStock: 5, sleep: null });
    expect(plan.starts).toHaveLength(5);
  });
  it("ne place aucune potion pendant le sommeil", () => {
    const sleep = { start: 23, end: 7 };
    const plan = planPotions({ exportUnix: EXPORT_TS, endH: T, owned: 5, purchases: 50, maxStock: 5, sleep });
    for (const s of plan.starts) {
      expect(isAsleep(EXPORT_TS, s, sleep)).toBe(false);
      expect(parisHourOfDay(toDate(EXPORT_TS, s))).toBeGreaterThanOrEqual(7);
    }
  });
});

describe("chantiers", () => {
  const chain = (steps: number[], extra: Partial<Chain> = {}): Chain => ({
    key: "x",
    category: "heroes",
    entry: { id: 1, name: "X" },
    startLevel: 1,
    steps: steps.map((h, i) => ({ toLevel: 2 + i, baseSeconds: h * 3600, baseCost: 100 })),
    scope: "builder",
    ...extra,
  });
  const run = (c: Chain[], slots = 1, jamEndH = 100, potions: number[] = []) =>
    simulate({
      exportUnix: EXPORT_TS, jamEndH, slots, clock: new WorkClock(potions, 9), chains: c,
      pass: { builder: 0, research: 0 }, policy: "mostRemaining", sleep: null,
    });

  it("enchaîne sans temps mort avec durée réduite pendant le Jam", () => {
    const r = run([chain([10, 10])]).results[0];
    expect(r.segments.map((s) => [s.start, s.end])).toEqual([[0, 5], [5, 10]]);
    expect(r.segments[0].cost).toBe(50);
  });
  it("un chantier lancé avant la fin garde sa durée réduite", () => {
    const r = run([chain([100, 100])], 1, 60).results[0];
    expect(r.segments).toHaveLength(2);
    expect(r.segments[1]).toMatchObject({ start: 50, end: 100, launchedDuringJam: true });
  });
  it("aucun chantier n'est lancé après la fin du Jam", () => {
    const r = run([chain([100, 100, 100])], 1, 60).results[0];
    expect(r.segments).toHaveLength(2);
  });
  it("le minuteur de l'export est utilisé tel quel, sans réduction", () => {
    const r = run([chain([10], { inProgress: { remainingH: 7, toLevel: 2 }, steps: [{ toLevel: 3, baseSeconds: 36000, baseCost: 0 }] })]).results[0];
    expect(r.segments[0]).toMatchObject({ start: 0, end: 7, inProgressAtExport: true });
    expect(r.segments[1]).toMatchObject({ start: 7, end: 12 });
  });
  it("les potions accélèrent un chantier en cours", () => {
    const r = run([chain([20])], 1, 100, [0]).results[0];
    // 10 h de travail : 1 h de potion vaut 10 h.
    expect(r.segments[0].end).toBeCloseTo(1, 9);
  });
  it("un ouvrier occupé retarde le héros suivant", () => {
    const res = run([chain([10], { key: "a" }), chain([10], { key: "b" })], 1).results;
    expect(res[1].segments[0].start).toBe(5);
  });
  it("un marteau de héros termine le chantier en cours le plus long", () => {
    const sim = simulate({
      exportUnix: EXPORT_TS, jamEndH: 100, slots: 1, clock: new WorkClock([], 9),
      chains: [chain([40, 40], { hammerable: true })], pass: { builder: 0, research: 0 }, policy: "mostRemaining", sleep: null, hammers: [0],
    });
    const segs = sim.results[0].segments;
    expect(segs[0]).toMatchObject({ end: 0, hammered: true });
    expect(segs[1]).toMatchObject({ start: 0, end: 20 });
  });
  it("hammerTimes respecte le délai de 7 jours", () => {
    expect(hammerTimes(5, T)).toEqual([0, 168]);
  });
});

describe("prévision sur l'export anonymisé", () => {
  const s: Settings = { ...DEFAULT_SETTINGS };
  it("construit les chaînes de héros du village principal uniquement", () => {
    const chains = heroChains(village());
    expect(chains.map((c) => c.entry.name).sort()).toEqual(
      ["Archer Queen", "Barbarian King", "Dragon Duke", "Grand Warden", "Minion Prince", "Royal Champion"],
    );
    const king = chains.find((c) => c.entry.name === "Barbarian King")!;
    expect(king.inProgress).toEqual({ remainingH: 300000 / 3600, toLevel: 104 });
    expect(king.steps[0].toLevel).toBe(105);
    expect(king.steps.at(-1)!.toLevel).toBe(110);
  });
  it("plus de Pass d'or ne fait jamais perdre de niveaux", () => {
    const n = [0, 0.1, 0.15, 0.2].map((g) => forecast(village(), { ...s, pass: { builder: g, research: g } }).heroes.gainedLaunched);
    for (let i = 1; i < n.length; i++) expect(n[i]).toBeGreaterThanOrEqual(n[i - 1]);
  });
  it("le niveau atteint ne dépasse jamais le max", () => {
    const f = forecast(village(), s);
    for (const r of f.heroes.results) expect(levelAt(r, 1e6)).toBeLessThanOrEqual(110);
  });
  it("retire les potions qui tombent sans chantier actif", () => {
    const f = forecast(village(), s);
    // Animaux de la fixture : L.A.S.S.I au max, Greedy Raven bloqué par l'animalerie 11.
    expect(f.pets.results.every((r) => r.segments.length === 0)).toBe(true);
    expect(f.pets.plan.starts).toEqual([]);
    expect(f.pets.plan.wasted).toBe(5);
    expect(f.pets.plan.days.every((d) => d.bought === 0)).toBe(true);
  });
  it("garde les 55 potions d'ouvrier quand les héros travaillent tout le Jam", () => {
    const f = forecast(village(), s);
    expect(f.heroes.plan.starts).toHaveLength(55);
    expect(f.heroes.capacityHours / 24).toBeCloseTo(34.49, 2);
  });
  it("compte les murs restants", () => {
    expect(wallSummary(village(), { builder: 0, research: 0 })).toMatchObject({ total: 325, atMax: 110, remaining: 215, max: 19 });
  });
});
