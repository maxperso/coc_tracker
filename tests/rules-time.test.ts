import { describe, expect, it } from "vitest";
import { costFactor, durationFactor, JAM, reducedSeconds } from "../src/lib/rules";
import { capacityHours, fmtDateTime, fmtDayRange, hoursBetween, parisDayKey, toDate } from "../src/lib/time";
import { findByName, gameIndex, stepCost } from "../src/lib/gamedata";

const EXPORT_TS = 1793617920; // 2026-11-02T11:12:00Z, T = 332,8 h

describe("facteurs du Jam et du Pass d'or", () => {
  it.each([
    [0, 0.5],
    [0.1, 0.45],
    [0.15, 0.425],
    [0.2, 0.4],
  ])("Pass %s → facteur %s pendant le Jam", (g, f) => {
    expect(durationFactor(true, g)).toBeCloseTo(f, 10);
    expect(costFactor(true, g)).toBeCloseTo(f, 10);
  });

  it("hors Jam, seul le Pass d'or s'applique", () => {
    expect(durationFactor(false, 0)).toBe(1);
    expect(durationFactor(false, 0.2)).toBeCloseTo(0.8, 10);
  });

  it("niveau de base de 8 jours : 4 / 3,6 / 3,4 / 3,2 jours", () => {
    const base = 8 * 86400;
    const days = [0, 0.1, 0.15, 0.2].map((g) => reducedSeconds(base, durationFactor(true, g)) / 86400);
    expect(days.map((d) => +d.toFixed(1))).toEqual([4, 3.6, 3.4, 3.2]);
  });

  it("le cumul additif reste disponible comme paramètre", () => {
    expect(durationFactor(true, 0.2, { ...JAM, goldPassStacking: "additive" })).toBeCloseTo(0.3, 10);
  });
});

describe("Roi niveau 103 dans les données ClashKing", () => {
  const king = findByName(gameIndex(), "heroes", "Barbarian King")!;
  it("103 → 104 : 691 200 s (8 jours) et 430 000 d'élixir noir", () => {
    expect(king.id).toBe(28000000);
    expect(stepCost("heroes", king, 103)).toEqual({ seconds: 691200, cost: 430000 });
    expect(king.resource).toBe("Dark Elixir");
  });
  it("4 jours pendant le Jam sans Pass, 3,2 jours avec 20 %", () => {
    const s = stepCost("heroes", king, 103)!.seconds;
    expect(reducedSeconds(s, durationFactor(true, 0)) / 86400).toBe(4);
    expect(reducedSeconds(s, durationFactor(true, 0.2)) / 86400).toBeCloseTo(3.2, 10);
  });
  it("pas d'amélioration au-delà du niveau max", () => {
    expect(stepCost("heroes", king, 110)).toBeNull();
  });
});

describe("conventions de niveau des bâtiments", () => {
  it("la ligne N des bâtiments donne le coût pour atteindre N", () => {
    const cannon = findByName(gameIndex(), "buildings", "Cannon")!;
    // 20 → 21 utilise build_time de la ligne 21 (129 600 s).
    expect(stepCost("buildings", cannon, 20)).toEqual({ seconds: 129600, cost: 3000000 });
  });
});

describe("temps restant et capacité", () => {
  it("T = 332,8 h entre l'export et la fin du Jam", () => {
    expect(hoursBetween(EXPORT_TS, JAM.end)).toBeCloseTo(332.8, 6);
  });
  it("55 potions d'ouvrier : 34,5 jours par ouvrier", () => {
    expect(capacityHours(332.8, 55, 9) / 24).toBeCloseTo(34.49, 2);
  });
  it("45 potions de recherche : 57 jours de labo", () => {
    expect(capacityHours(332.8, 45, 23) / 24).toBeCloseTo(56.99, 2);
  });
  it("5 potions d'animaux : 18,7 jours", () => {
    expect(capacityHours(332.8, 5, 23) / 24).toBeCloseTo(18.66, 2);
  });
});

describe("fuseau de Paris", () => {
  it("l'export de 11 h 12 UTC s'affiche à 12 h 12 à Paris (heure d'hiver)", () => {
    expect(fmtDateTime(toDate(EXPORT_TS, 0))).toBe("2 nov. à 12 h 12");
  });
  it("la fin du Jam tombe le 16 novembre à 9 h à Paris", () => {
    expect(fmtDateTime(new Date(JAM.end))).toBe("16 nov. à 9 h");
  });
  it("change de jour à minuit heure de Paris, pas UTC", () => {
    expect(parisDayKey(new Date("2026-11-02T23:30:00Z"))).toBe("2026-11-03");
  });
  it("formate une plage de jours", () => {
    expect(fmtDayRange(new Date("2026-11-12T10:00:00Z"), new Date("2026-11-14T10:00:00Z"))).toBe("12-14 nov.");
  });
});
