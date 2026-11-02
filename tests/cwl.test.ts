import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cwlHeroKeys, cwlWindows, overlaps, type Cwl } from "../src/lib/cwl";
import { parseExport } from "../src/lib/exportParse";
import { gameIndex } from "../src/lib/gamedata";
import { builderForecast, DEFAULT_SETTINGS, forecast, heroChains, type Settings } from "../src/lib/plan";
import { eventKey, planReminders } from "../src/lib/reminders";
import { planEvents } from "../src/lib/schedule";
import { parseSettings } from "../src/lib/settingsSchema";
import { addDays, parisDayKey, parisTimeToUnix, toDate } from "../src/lib/time";
import { buildVillage } from "../src/lib/village";

const village = () => {
  const r = parseExport(readFileSync(new URL("./fixtures/valid.json", import.meta.url), "utf8"));
  if (!r.ok) throw new Error(r.error);
  return buildVillage(r.value, gameIndex());
};

describe("heure de Paris", () => {
  it("convertit une heure pleine, en heure d'hiver comme d'été", () => {
    expect(new Date(parisTimeToUnix("2026-11-03", 20) * 1000).toISOString()).toBe("2026-11-03T19:00:00.000Z");
    expect(new Date(parisTimeToUnix("2026-07-14", 20) * 1000).toISOString()).toBe("2026-07-14T18:00:00.000Z");
  });
  it("ajoute des jours en changeant de mois", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
});

describe("Ligue de clans", () => {
  const v = village();
  const firstDay = addDays(parisDayKey(toDate(v.timestamp, 0)), 2);
  const cwl: Cwl = { enabled: true, firstDay, days: 7, hour: 20, heroes: [] };
  const settings = (c: Cwl, focus: Settings["focus"] = "heroes"): Settings => ({ ...DEFAULT_SETTINGS, focus, cwl: c });

  it("place une fenêtre d'une heure par jour d'attaque", () => {
    const w = cwlWindows(cwl, v.timestamp);
    expect(w).toHaveLength(7);
    expect(w[1].start - w[0].start).toBeCloseTo(24);
    expect(w[0].end - w[0].start).toBe(1);
    expect(cwlWindows({ ...cwl, enabled: false }, v.timestamp)).toEqual([]);
  });

  it("garde par défaut les 4 premiers héros, sinon ceux choisis", () => {
    const heroes = heroChains(v);
    expect(cwlHeroKeys(cwl, heroes)).toEqual(heroes.slice(0, 4).map((h) => h.key));
    expect(cwlHeroKeys({ ...cwl, heroes: [heroes[5].key, "heroes:inconnu"] }, heroes)).toEqual([heroes[5].key]);
  });

  for (const focus of ["heroes", "hybrid"] as const) {
    it(`${focus} : aucun héros emmené n'est lancé pendant une attaque`, () => {
      const windows = cwlWindows(cwl, v.timestamp);
      const keys = cwlHeroKeys(cwl, heroChains(v));
      const f = builderForecast(v, settings(cwl, focus));
      for (const r of f.heroes.results.filter((r) => keys.includes(r.chain.key))) {
        for (const s of r.segments.filter((s) => !s.inProgressAtExport)) {
          expect(windows.some((w) => overlaps(s.start, s.end, w)), `${r.chain.key} ${s.toLevel}`).toBe(false);
        }
      }
    });
  }

  it("coûte des niveaux de héros, jamais plus qu'aucune contrainte", () => {
    const off = builderForecast(v, settings({ ...cwl, enabled: false }));
    const on = builderForecast(v, settings(cwl));
    expect(on.heroes.gainedLaunched).toBeLessThanOrEqual(off.heroes.gainedLaunched);
  });

  it("ajoute une attaque à cocher par jour, et un rappel", () => {
    const f = forecast(v, settings(cwl));
    const attacks = planEvents(f).filter((e) => e.kind === "attack");
    expect(attacks).toHaveLength(7);
    expect(new Set(attacks.map((e) => eventKey(e, v.timestamp))).size).toBe(7);
    const reminders = planReminders(f, v.timestamp, v.timestamp);
    const first = reminders.find((r) => r.title.includes("LDC"));
    expect(first?.at).toBeCloseTo(v.timestamp + cwlWindows(cwl, v.timestamp)[0].start * 3600, -1);
    expect(first?.body).toContain("Attaque de LDC avec");
  });

  it("relit des réglages sans LDC (ancienne version) avec la LDC désactivée", () => {
    const { cwl: _, ...old } = DEFAULT_SETTINGS;
    expect(parseSettings(old).cwl.enabled).toBe(false);
    expect(parseSettings({ ...DEFAULT_SETTINGS, cwl: { ...cwl, firstDay: "demain" } }).cwl.enabled).toBe(false);
  });
});
