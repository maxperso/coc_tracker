import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExport } from "../src/lib/exportParse";
import { gameIndex } from "../src/lib/gamedata";
import { builderForecast, DEFAULT_SETTINGS, forecast, type Settings } from "../src/lib/plan";
import { effectiveSettings, recommendPurchases } from "../src/lib/recommend";
import { JAM } from "../src/lib/rules";
import { isAsleep } from "../src/lib/potionPlan";
import { byDay, finalWave, longestRemaining, planEvents } from "../src/lib/schedule";
import { buildVillage } from "../src/lib/village";

const village = () => {
  const r = parseExport(readFileSync(new URL("./fixtures/valid.json", import.meta.url), "utf8"));
  if (!r.ok) throw new Error(r.error);
  return buildVillage(r.value, gameIndex());
};
const s = (focus: Settings["focus"], medals = 2500): Settings => ({ ...DEFAULT_SETTINGS, focus, medals });
const cost = (b: number, r: number, h: number) =>
  b * JAM.potions.builder.medalPrice + r * JAM.potions.research.medalPrice + h * JAM.hammers.heroes.medalPrice;

describe("achats recommandés", () => {
  it("ne dépasse jamais les médailles", () => {
    for (const focus of ["heroes", "buildings", "hybrid"] as const) {
      for (const medals of [0, 25, 700, 2500]) {
        const p = recommendPurchases(village(), s(focus, medals));
        expect(p.medalsUsed).toBe(cost(p.builder, p.research, p.hammers));
        expect(p.medalsUsed).toBeLessThanOrEqual(medals);
      }
    }
  });
  it("héros : autant de niveaux de héros qu'en mettant tout en potions d'ouvrier", () => {
    const v = village();
    const p = recommendPurchases(v, s("heroes"));
    const allIn = builderForecast(v, {
      ...s("heroes"),
      potions: { ...DEFAULT_SETTINGS.potions, builder: { owned: 5, purchases: Math.floor(2500 / JAM.potions.builder.medalPrice) } },
    }).heroes.gainedLaunched;
    expect(p.heroes).toBeGreaterThanOrEqual(allIn);
    expect(p.reason.length).toBeGreaterThan(10);
  });
  it("bâtiments : tout en potions d'ouvrier, sans marteau de héros", () => {
    const p = recommendPurchases(village(), s("buildings"));
    expect(p.builder).toBe(Math.floor(2500 / JAM.potions.builder.medalPrice));
    expect(p.hammers).toBe(0);
  });
  it("hybride et perso : jamais un niveau de héros payé par plus de niveaux de bâtiments", () => {
    const v = village();
    for (const focus of ["hybrid", "custom"] as const) {
      for (const sleep of [{ start: 23, end: 7 }, null]) {
        const p = recommendPurchases(v, { ...s(focus), sleep });
        // Tout en potions d'ouvrier, sans marteau : le total choisi n'est jamais inférieur.
        const allIn = builderForecast(v, {
          ...s(focus),
          sleep,
          potions: { ...DEFAULT_SETTINGS.potions, builder: { owned: 5, purchases: Math.floor(2500 / JAM.potions.builder.medalPrice) } },
          heroHammers: 0,
        });
        expect(p.heroes + p.buildings).toBeGreaterThanOrEqual(allIn.heroes.gainedLaunched + allIn.buildings.gainedLaunched);
      }
    }
  });
  it("le mode manuel garde les achats saisis", () => {
    const manual = { ...s("heroes"), autoPurchases: false };
    expect(effectiveSettings(village(), manual)).toEqual({ settings: manual, purchase: null });
  });
});

describe("calendrier et dernière vague", () => {
  const f = forecast(village(), s("hybrid"));
  it("liste les relances dans l'ordre, toutes avant la fin du Jam", () => {
    const ev = planEvents(f);
    for (let i = 1; i < ev.length; i++) expect(ev[i].t).toBeGreaterThanOrEqual(ev[i - 1].t);
    for (const e of ev.filter((x) => x.kind === "launch")) expect(e.t).toBeLessThan(f.heroes.tHours);
    expect(ev.filter((e) => e.kind === "potion").reduce((n, e) => n + (e.kind === "potion" ? e.count : 0), 0)).toBe(
      f.heroes.plan.starts.length + f.labBest.plan.starts.length + f.pets.plan.starts.length,
    );
  });
  it("à instant égal, relancer avant de boire", () => {
    const ev = planEvents(f).filter((e) => e.t === 0);
    const firstPotion = ev.findIndex((e) => e.kind === "potion");
    if (firstPotion >= 0) expect(ev.slice(firstPotion).every((e) => e.kind === "potion")).toBe(true);
  });
  it("groupe par jour de Paris", () => {
    const days = byDay(planEvents(f), village().timestamp);
    expect(days[0][0]).toBe("2026-11-02");
    expect(days.length).toBeGreaterThan(5);
  });
  it("la dernière vague ne contient que des chantiers lancés avant la fin et finis après, avec un gain", () => {
    for (const w of finalWave(f)) {
      expect(w.seg.start).toBeLessThan(f.heroes.tHours);
      expect(w.seg.end).toBeGreaterThan(f.heroes.tHours);
      expect(w.savedHours).toBeGreaterThan(0);
    }
  });
  it("les chantiers restants les plus longs sont triés et sans doublon", () => {
    const l = longestRemaining(f, { builder: 0, research: 0 });
    for (let i = 1; i < l.length; i++) expect(l[i].baseHours).toBeLessThanOrEqual(l[i - 1].baseHours);
    expect(new Set(l.map((x) => x.result.chain.entry.id)).size).toBe(l.length);
  });
});

describe("sommeil", () => {
  it("par défaut, une plage 23 h - 7 h est réglée", () => {
    expect(DEFAULT_SETTINGS.sleep).toEqual({ start: 23, end: 7 });
  });
  it("aucune relance ni potion pendant le sommeil", () => {
    const v = village();
    const sleep = { start: 23, end: 7 };
    const ev = planEvents(forecast(v, { ...s("hybrid"), sleep }));
    for (const e of ev) expect(isAsleep(v.timestamp, e.t, sleep)).toBe(false);
  });
  it("« Chu » : pas de sommeil, donc au moins autant de niveaux", () => {
    const v = village();
    const slept = forecast(v, { ...s("heroes"), sleep: { start: 23, end: 7 } });
    const chu = forecast(v, { ...s("heroes"), sleep: null });
    expect(chu.heroes.gainedLaunched).toBeGreaterThanOrEqual(slept.heroes.gainedLaunched);
    expect(chu.heroes.idleAsleepHours).toBe(0);
  });
});
