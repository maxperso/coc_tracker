import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExport, resolveIds, MAX_EXPORT_CHARS, type ParsedExport } from "../src/lib/exportParse";
import { cleanName, gameIndex, spritePath } from "../src/lib/gamedata";
import { buildVillage } from "../src/lib/village";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const parsed = (name: string): ParsedExport => {
  const r = parseExport(fixture(name));
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("lecture de l'export", () => {
  it("lit un export valide", () => {
    const e = parsed("valid.json");
    expect(e.tag).toBe("#ANON0001");
    expect(e.timestamp).toBe(1793617920);
    expect(e.sections.heroes).toHaveLength(6);
  });
  it("refuse un JSON invalide", () => {
    const r = parseExport("{ pas du json");
    expect(r.ok).toBe(false);
  });
  it("refuse un export incomplet", () => {
    const r = parseExport(fixture("incomplete.json"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/buildings/);
  });
  it("refuse un texte trop long", () => {
    expect(parseExport(" ".repeat(MAX_EXPORT_CHARS + 1)).ok).toBe(false);
  });
  it("refuse un objet sans tag", () => {
    expect(parseExport('{"timestamp":1}').ok).toBe(false);
  });
  it("liste les champs non interprétés sans les lire", () => {
    const { report } = resolveIds(parsed("valid.json"), gameIndex());
    expect(report.uninterpretedFields).toMatchObject({
      "buildings.weapon": 1,
      "buildings.gear_up": 1,
      "helpers.helper_cooldown": 1,
    });
    expect(report.otherTopFields).toContain("boosts");
  });
});

describe("identifiants", () => {
  it("reconnaît tous les ID de l'export valide", () => {
    const { report, items } = resolveIds(parsed("valid.json"), gameIndex());
    expect(report.unknown).toEqual([]);
    expect(report.wrongCategory).toEqual([]);
    expect(report.unknownSections).toEqual([]);
    expect(items.length).toBe(report.checked);
  });

  it("signale un ID inconnu sans le deviner", () => {
    const { report, items } = resolveIds(parsed("unknown-id.json"), gameIndex());
    expect(report.unknown).toContainEqual({ section: "units", id: 4999999 });
    expect(items.find((i) => i.data === 4999999)).toBeUndefined();
  });

  it("signale un ID connu rangé dans la mauvaise section", () => {
    const { report } = resolveIds(parsed("unknown-id.json"), gameIndex());
    expect(report.wrongCategory).toContainEqual({ section: "spells", id: 28000000, foundIn: ["heroes"] });
  });

  it("signale une section inconnue", () => {
    const { report } = resolveIds(parsed("unknown-id.json"), gameIndex());
    expect(report.unknownSections).toEqual(["mystery"]);
  });

  it("les ID des héros correspondent aux bons noms", () => {
    const idx = gameIndex();
    const name = (id: number) => idx.byId.get(id)?.map((f) => f.entry.name);
    expect(name(28000000)).toEqual(["Barbarian King"]);
    expect(name(28000002)).toEqual(["Grand Warden"]);
    expect(name(28000007)).toEqual(["Dragon Duke"]);
    expect(name(1000071)).toEqual(["Hero Hall"]);
  });

  it("lit l'HDV et les bâtiments de production", () => {
    const v = buildVillage(parsed("valid.json"), gameIndex());
    expect(v.gates).toEqual({ th: 18, heroHall: 12, lab: 16, petHouse: 11, blacksmith: 9 });
  });

  it("accepte un HDV sans héros", () => {
    const v = buildVillage(parsed("no-heroes.json"), gameIndex());
    expect(v.th).toBe(6);
    expect(v.items.filter((i) => i.category === "heroes")).toEqual([]);
  });
});

describe("sprites", () => {
  it("nettoie les noms comme ClashKing", () => {
    expect(cleanName("Builder's Hut")).toBe("builder's_hut");
    expect(cleanName("L.A.S.S.I")).toBe("lassi");
    expect(cleanName("B.O.T.O’s Shack")).toBe("botos_shack");
    expect(cleanName("P.E.K.K.A")).toBe("pekka");
  });
  it("construit les chemins et repère les sprites manquants connus", () => {
    const idx = gameIndex();
    const find = (cat: string, name: string) => idx.data.categories[cat].find((e) => e.name === name)!;
    expect(spritePath("heroes", find("heroes", "Barbarian King"))).toBe("heroes/barbarian_king/icon.webp");
    expect(idx.sprites.has("heroes/barbarian_king/icon.webp")).toBe(true);
    expect(idx.sprites.has(spritePath("buildings", find("buildings", "Blacksmith"), 9)!)).toBe(true);
    expect(idx.sprites.has(spritePath("buildings", find("buildings", "Blacksmith"), 10)!)).toBe(false);
    expect(idx.sprites.has(spritePath("buildings", find("buildings", "Helper Hut"), 1)!)).toBe(false);
    expect(idx.sprites.has(spritePath("buildings", find("buildings", "B.O.B's Hut"), 1)!)).toBe(false);
  });
});
