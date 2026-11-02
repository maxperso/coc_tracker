import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExport } from "../src/lib/exportParse";
import { gameIndex } from "../src/lib/gamedata";
import { DEFAULT_SETTINGS, forecast } from "../src/lib/plan";
import { isAsleep } from "../src/lib/potionPlan";
import { eventKey, exportReminder, planReminders } from "../src/lib/reminders";
import { JAM } from "../src/lib/rules";
import { planEvents } from "../src/lib/schedule";
import { buildVillage } from "../src/lib/village";

const village = () => {
  const r = parseExport(readFileSync(new URL("./fixtures/valid.json", import.meta.url), "utf8"));
  if (!r.ok) throw new Error(r.error);
  return buildVillage(r.value, gameIndex());
};
const sleep = { start: 23, end: 7 };
const jamEnd = Date.parse(JAM.end) / 1000;

describe("actions cochées", () => {
  it("chaque action du plan a un identifiant unique et stable", () => {
    const v = village();
    const keys = (s = DEFAULT_SETTINGS) => planEvents(forecast(v, s)).map((e) => eventKey(e, v.timestamp));
    const a = keys();
    expect(new Set(a).size).toBe(a.length);
    expect(keys()).toEqual(a);
    for (const k of a) expect(k.length).toBeLessThanOrEqual(160);
  });
});

describe("rappels", () => {
  it("ne garde que les actions à venir, regroupées, dans l'ordre", () => {
    const v = village();
    const f = forecast(v, { ...DEFAULT_SETTINGS, sleep });
    const now = v.timestamp + 48 * 3600;
    const r = planReminders(f, v.timestamp, now);
    expect(r.length).toBeGreaterThan(5);
    for (let i = 0; i < r.length; i++) {
      expect(r[i].at).toBeGreaterThan(now);
      if (i) expect(r[i].at - r[i - 1].at).toBeGreaterThan(600);
      expect(r[i].body).toMatch(/Relance|Bois/);
    }
    expect(new Set(r.map((x) => x.key)).size).toBe(r.length);
  });
  it("aucun rappel pendant le sommeil", () => {
    const v = village();
    const r = planReminders(forecast(v, { ...DEFAULT_SETTINGS, sleep }), v.timestamp, v.timestamp);
    for (const x of r) expect(isAsleep(v.timestamp, (x.at - v.timestamp) / 3600, sleep)).toBe(false);
  });
  it("rappel d'export : 24 h après, au réveil, jamais après la fin du Jam", () => {
    const v = village();
    const r = exportReminder(v.timestamp, sleep, jamEnd)!;
    expect(r.at).toBeGreaterThanOrEqual(v.timestamp + 24 * 3600);
    expect(isAsleep(v.timestamp, (r.at - v.timestamp) / 3600, sleep)).toBe(false);
    expect(exportReminder(jamEnd - 3600, null, jamEnd)).toBeNull();
  });
});
