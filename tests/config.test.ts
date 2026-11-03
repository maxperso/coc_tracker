import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/config";

const base = { DATABASE_URL: "postgres://x", JWT_SECRET: "x".repeat(40) };

describe("mode dev", () => {
  it("est désactivé par défaut", () => {
    expect(loadConfig(base).devLogin).toBeNull();
  });

  it("s'active hors production avec DEV_LOGIN", () => {
    expect(loadConfig({ ...base, DEV_LOGIN: "dev" }).devLogin).toBe("dev");
  });

  it("est refusé en production : le serveur ne démarre pas", () => {
    const prod = { ...base, NODE_ENV: "production", SMTP_HOST: "smtp.test", MAIL_FROM: "a@b.c" };
    expect(() => loadConfig({ ...prod, DEV_LOGIN: "dev" })).toThrow(/interdit en production/);
    expect(loadConfig(prod).devLogin).toBeNull();
  });

  it("refuse un pseudo invalide", () => {
    expect(() => loadConfig({ ...base, DEV_LOGIN: "a b" })).toThrow();
  });
});
