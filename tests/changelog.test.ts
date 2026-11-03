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
    expect(unseenReleases(0).map((r) => r.id)).toEqual(CHANGELOG.map((r) => r.id));
  });
});
