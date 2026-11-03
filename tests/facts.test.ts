import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExport } from "../src/lib/exportParse";
import { gameIndex } from "../src/lib/gamedata";
import { DEFAULT_SETTINGS, forecast } from "../src/lib/plan";
import { planPotions } from "../src/lib/potionPlan";
import { eventKey } from "../src/lib/reminders";
import { planEvents } from "../src/lib/schedule";
import { simulate, type Chain } from "../src/lib/sim";
import { buildVillage } from "../src/lib/village";
import { WorkClock } from "../src/lib/workclock";

const EXPORT_TS = 1793617920;
const chain = (steps: number[], extra: Partial<Chain> = {}): Chain => ({
  key: "x",
  category: "heroes",
  entry: { id: 1, name: "X" },
  startLevel: 1,
  steps: steps.map((h, i) => ({ toLevel: 2 + i, baseSeconds: h * 3600, baseCost: 100 })),
  scope: "builder",
  ...extra,
});
const run = (c: Chain[], forced: Map<string, number>, slots = 1) =>
  simulate({
    exportUnix: EXPORT_TS, jamEndH: 100, slots, clock: new WorkClock([], 9), chains: c,
    pass: { builder: 0, research: 0 }, policy: "mostRemaining", sleep: null, forced,
  }).results;

describe("lancements confirmés", () => {
  it("un lancement plus tardif que prévu décale la suite", () => {
    // 10 h de base → 5 h pendant le Jam. Prévu à 5 h, lancé en vrai à 8 h.
    const [r] = run([chain([10, 10, 10])], new Map([["x:3", 8]]));
    expect(r.segments.map((s) => [s.start, s.end])).toEqual([[0, 5], [8, 13], [13, 18]]);
  });
  it("un lancement plus tôt que prévu termine le niveau d'avant (potions, marteau…)", () => {
    const [r] = run([chain([10, 10])], new Map([["x:3", 2]]));
    expect(r.segments.map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 7]]);
  });
  it("part à son heure même si le plan croyait tous les ouvriers pris", () => {
    const res = run([chain([10], { key: "a" }), chain([10], { key: "b" })], new Map([["b:2", 1]]));
    expect(res[1].segments[0].start).toBe(1);
  });
});

describe("potions confirmées", () => {
  const base = { exportUnix: EXPORT_TS, endH: 300, owned: 5, purchases: 55, maxStock: 5, sleep: { start: 23, end: 9 } };
  it("garde ce qui a été bu et reporte le reste sur les jours suivants", () => {
    const plan = planPotions(base);
    const first = plan.days.find((d) => d.starts.length)!;
    const confirmed = new Map([[first.day, { start: first.starts[0] + 1.5, count: first.starts.length - 2 }]]);
    const after = planPotions({ ...base, confirmed });
    const day = after.days.find((d) => d.day === first.day)!;
    expect(day.starts).toHaveLength(first.starts.length - 2);
    expect(day.starts[0]).toBeCloseTo(first.starts[0] + 1.5);
    expect(after.starts).toHaveLength(plan.starts.length);
    expect(after.unplaced).toBe(0);
  });
});

describe("plan recalculé avec ce que le joueur a coché", () => {
  const r = parseExport(readFileSync(new URL("./fixtures/valid.json", import.meta.url), "utf8"));
  if (!r.ok) throw new Error(r.error);
  const v = buildVillage(r.value, gameIndex());
  const s = { ...DEFAULT_SETTINGS, focus: "heroes" as const };

  it("un héros lancé 3 h plus tard que prévu : ses relances suivantes aussi", () => {
    const f = forecast(v, s);
    const ev = planEvents(f).find((e) => e.kind === "launch" && e.pool === "builder" && e.t > 1 && e.t < 200)!;
    if (ev.kind !== "launch") throw new Error();
    const key = eventKey(ev, v.timestamp);
    const late = ev.t + 3;
    const g = forecast(v, s, undefined, { [key]: { at: v.timestamp + Math.round(late * 3600) } });
    const res = g.heroes.results.find((x) => x.chain.key === ev.result.chain.key)!;
    const seg = res.segments.find((x) => x.toLevel === ev.seg.toLevel)!;
    expect(seg.start).toBeCloseTo(late, 2);
    const nextBefore = ev.result.segments.find((x) => x.toLevel === ev.seg.toLevel + 1);
    const nextAfter = res.segments.find((x) => x.toLevel === ev.seg.toLevel + 1);
    if (nextBefore && nextAfter) expect(nextAfter.start).toBeGreaterThan(nextBefore.start);
  });

  it("des potions bues en moins : le plan les reporte, sans en perdre", () => {
    const f = forecast(v, s);
    const day = f.heroes.plan.days.find((d) => d.starts.length >= 3)!;
    const g = forecast(v, s, undefined, { [`P:builder:${day.day}`]: { at: v.timestamp + Math.round(day.starts[0] * 3600), count: day.starts.length - 2 } });
    expect(g.heroes.plan.days.find((d) => d.day === day.day)!.starts).toHaveLength(day.starts.length - 2);
    expect(g.heroes.plan.unplaced).toBe(0);
  });
});
