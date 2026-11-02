import { describe, expect, it } from "vitest";
import { passwordStrength } from "../src/lib/passwordStrength";

describe("force du mot de passe", () => {
  it("trop court sous 8 caractères", () => {
    expect(passwordStrength("abc").level).toBe(0);
    expect(passwordStrength("Ab1!xyz").level).toBe(0);
  });
  it("faible pour les mots et suites courants", () => {
    expect(passwordStrength("password").level).toBe(1);
    expect(passwordStrength("azerty123").level).toBe(1);
    expect(passwordStrength("12345678").level).toBe(1);
    expect(passwordStrength("aaaaaaaa").level).toBe(1);
  });
  it("faible s'il contient le pseudo", () => {
    expect(passwordStrength("Maxime2026!", "maxime").level).toBeLessThan(passwordStrength("Maxime2026!").level);
  });
  it("moyen puis solide avec longueur et variété", () => {
    expect(passwordStrength("tigrebleu7").level).toBe(2);
    expect(passwordStrength("Tigre-Bleu-Fusee-78").level).toBe(3);
    expect(passwordStrength("correct horse battery staple").level).toBeGreaterThanOrEqual(2);
  });
});
