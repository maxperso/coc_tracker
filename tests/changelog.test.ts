import { describe, expect, it } from "vitest";
import { CHANGELOG, LATEST_RELEASE, unseenReleases } from "../src/lib/changelog";

describe("journal des mises à jour", () => {
  it("a des numéros uniques, la plus récente en tête, des dates valides et du contenu", () => {
    const ids = CHANGELOG.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);
    expect(LATEST_RELEASE).toBe(ids[0]);
    for (const r of CHANGELOG) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.changes.length).toBeGreaterThan(0);
    }
  });

  it("ne montre que ce qui n'a pas été vu", () => {
    expect(unseenReleases(LATEST_RELEASE)).toEqual([]);
    const all = unseenReleases(0);
    expect(all.flatMap((r) => r.changes)).toHaveLength(CHANGELOG.flatMap((r) => r.changes).length);
    // Un seul bloc par jour, le plus récent d'abord.
    expect(new Set(all.map((r) => r.date)).size).toBe(all.length);
    expect(all[0].id).toBe(LATEST_RELEASE);
    // Seules les mises à jour après celle déjà vue.
    const sinceFirst = unseenReleases(CHANGELOG.at(-1)!.id).flatMap((r) => r.changes);
    expect(sinceFirst).toHaveLength(CHANGELOG.slice(0, -1).flatMap((r) => r.changes).length);
  });
});
