import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExport } from "../src/lib/exportParse";
import { findByName, gameIndex } from "../src/lib/gamedata";
import { globalPct, pct, progress } from "../src/lib/progress";
import { buildVillage } from "../src/lib/village";

const count = (name: string, th: number) => {
  const e = findByName(gameIndex(), "buildings", name)!;
  return gameIndex().data.thCounts[e.id][th];
};

describe("exemplaires par HDV", () => {
  it("compte les bâtiments débloqués, moins ceux fusionnés", () => {
    expect(count("Cannon", 15)).toBe(7);
    expect(count("Cannon", 16)).toBe(3); // 2 canons ricochet = 4 canons
    expect(count("Cannon", 18)).toBe(0); // + 1 tour multi-armes
    expect(count("Ricochet Cannon", 18)).toBe(3);
    expect(count("Archer Tower", 18)).toBe(2);
    expect(count("Wizard Tower", 17)).toBe(5);
    expect(count("Wizard Tower", 18)).toBe(2);
    expect(count("Eagle Artillery", 16)).toBe(1);
    expect(count("Eagle Artillery", 17)).toBe(0); // absorbé par l'HDV 17
    expect(count("Army Camp", 18)).toBe(4);
    expect(count("Wall", 18)).toBe(325);
  });
});

describe("complétion de l'HDV et du jeu entier", () => {
  const r = parseExport(readFileSync(new URL("./fixtures/valid.json", import.meta.url), "utf8"));
  if (!r.ok) throw new Error(r.error);
  const v = buildVillage(r.value, gameIndex());

  it("le jeu entier n'est jamais plus complet que l'HDV", () => {
    const th = progress(v);
    const game = progress(v, "game");
    expect(globalPct(game)).toBeLessThanOrEqual(globalPct(th));
    for (const c of game) expect(pct(c)).toBeLessThanOrEqual(pct(th.find((x) => x.key === c.key)!) + 1e-9);
  });

  it("à un HDV plus bas, le même village est plus complet pour son HDV que pour le jeu", () => {
    const lower = { ...v, th: 15, gates: { ...v.gates, th: 15 } };
    expect(globalPct(progress(lower, "game"))).toBe(globalPct(progress(v, "game")));
    expect(globalPct(progress(lower))).toBeGreaterThan(globalPct(progress(lower, "game")));
  });

  it("compte au niveau 0 les bâtiments pas encore construits", () => {
    const b = progress(v).find((c) => c.key === "buildings")!;
    const built = v.items.filter((i) => i.category === "buildings" || i.category === "traps").length;
    expect(built).toBeGreaterThan(0);
    expect(pct(b)).toBeLessThan(1);
  });
});
