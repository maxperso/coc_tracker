// Tests de l'API sur un vrai Postgres. Lancement :
//   DATABASE_URL_TEST=postgres://postgres:test@127.0.0.1:55432/coc_test npm test
// Sans la variable, ces tests sont ignorés. La base indiquée est vidée à chaque lancement.
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../server/app";
import { loadConfig } from "../server/config";
import { createPool, migrate, type Db } from "../server/db";
import { DEFAULT_SETTINGS } from "../src/lib/plan";

const url = process.env.DATABASE_URL_TEST;
const fixture = readFileSync(new URL("./fixtures/valid.json", import.meta.url), "utf8");
const INVITE = "invite-test-123";
const ORIGIN = "https://coc.example.test";

describe.skipIf(!url)("API", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    db = createPool(url!);
    await db.query("drop schema public cascade; create schema public;");
    await migrate(db);
    const cfg = loadConfig({
      DATABASE_URL: url,
      JWT_SECRET: "x".repeat(40),
      INVITE_CODE: INVITE,
      APP_ORIGIN: ORIGIN,
      COOKIE_SECURE: "true",
    });
    app = await buildApp(cfg, db);
  });
  afterAll(async () => {
    await app?.close();
    await db?.end();
  });

  const register = (username: string, password = "motdepasse1", inviteCode = INVITE) =>
    app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password, inviteCode } });
  const cookieOf = (res: { cookies: { name: string; value: string }[] }) => {
    const c = res.cookies.find((x) => x.name === "coc_session");
    return c ? `coc_session=${c.value}` : "";
  };

  it("répond sur /api/health avec les en-têtes de sécurité", async () => {
    const res = await app.inject({ url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("refuse l'inscription sans le bon code d'invitation", async () => {
    expect((await register("alice", "motdepasse1", "mauvais")).statusCode).toBe(403);
  });

  it("valide le pseudo et le mot de passe", async () => {
    expect((await register("a!")).statusCode).toBe(400);
    expect((await register("alice", "court")).statusCode).toBe(400);
  });

  it("inscrit un joueur et pose un cookie de session httpOnly, Secure, SameSite=Lax", async () => {
    const res = await register("Alice");
    expect(res.statusCode).toBe(201);
    const c = res.cookies.find((x) => x.name === "coc_session")!;
    expect(c.httpOnly).toBe(true);
    expect(c.secure).toBe(true);
    expect(c.sameSite).toBe("Lax");
    const me = await app.inject({ url: "/api/auth/me", headers: { cookie: cookieOf(res) } });
    expect(me.json()).toEqual({ username: "Alice" });
  });

  it("refuse un pseudo déjà pris, sans tenir compte des majuscules", async () => {
    expect((await register("alice")).statusCode).toBe(409);
  });

  it("connexion : erreur générique si mauvais mot de passe ou pseudo inconnu", async () => {
    const wrong = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "alice", password: "faux-mdp-123" } });
    const ghost = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "fantome", password: "faux-mdp-123" } });
    expect(wrong.statusCode).toBe(401);
    expect(ghost.statusCode).toBe(401);
    expect(wrong.json()).toEqual(ghost.json());
    const ok = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "ALICE", password: "motdepasse1" } });
    expect(ok.statusCode).toBe(200);
    expect(cookieOf(ok)).not.toBe("");
  });

  it("refuse l'accès sans session, ou avec un jeton falsifié", async () => {
    expect((await app.inject({ url: "/api/players" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/players", headers: { cookie: "coc_session=abc.def.ghi" } })).statusCode).toBe(401);
  });

  it("révoque les sessions après un changement de mot de passe", async () => {
    const res = await register("bob");
    const cookie = cookieOf(res);
    await db.query("update users set token_version = token_version + 1 where username = 'bob'");
    expect((await app.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("refuse une écriture venant d'une autre origine", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://pirate.example" },
      payload: { username: "alice", password: "motdepasse1" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("enregistre un export, sans doublon pour le même timestamp, et l'affiche dans le classement", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "alice", password: "motdepasse1" } });
    const cookie = cookieOf(login);
    const bad = await app.inject({ method: "POST", url: "/api/exports", headers: { cookie }, payload: { text: "{pas du json" } });
    expect(bad.statusCode).toBe(400);
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: "POST", url: "/api/exports", headers: { cookie }, payload: { text: fixture } });
      expect(res.statusCode).toBe(201);
    }
    const { rows } = await db.query("select count(*)::int as n from exports");
    expect(rows[0].n).toBe(1);
    const players = (await app.inject({ url: "/api/players", headers: { cookie } })).json();
    expect(players).toHaveLength(1);
    expect(players[0].username).toBe("Alice");
    expect(players[0].summary).toMatchObject({ tag: "#ANON0001", th: 18, focus: DEFAULT_SETTINGS.focus });
    expect(players[0].summary.plan.heroes).toBeGreaterThan(0);
  });

  it("valide les réglages et recalcule le résumé du dernier export", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "alice", password: "motdepasse1" } });
    const cookie = cookieOf(login);
    const bad = await app.inject({ method: "PUT", url: "/api/me/settings", headers: { cookie }, payload: { ...DEFAULT_SETTINGS, focus: "tout" } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "PUT", url: "/api/me/settings", headers: { cookie }, payload: { ...DEFAULT_SETTINGS, focus: "buildings", medals: 1200 } });
    expect(ok.statusCode).toBe(200);
    const settings = (await app.inject({ url: "/api/me/settings", headers: { cookie } })).json();
    expect(settings).toMatchObject({ focus: "buildings", medals: 1200 });
    const players = (await app.inject({ url: "/api/players", headers: { cookie } })).json();
    expect(players[0].summary.focus).toBe("buildings");
  });

  it("un autre joueur voit le profil complet, en lecture", async () => {
    const res = await register("carol");
    const cookie = cookieOf(res);
    const profile = await app.inject({ url: "/api/players/alice", headers: { cookie } });
    expect(profile.statusCode).toBe(200);
    const p = profile.json();
    expect(p.username).toBe("Alice");
    expect(p.settings.focus).toBe("buildings");
    expect(p.exports).toHaveLength(1);
    expect((p.exports[0].raw as { tag: string }).tag).toBe("#ANON0001");
    expect((await app.inject({ url: "/api/players/inconnu", headers: { cookie } })).statusCode).toBe(404);
  });

  it("déconnexion : le cookie est effacé", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/logout" });
    const c = res.cookies.find((x) => x.name === "coc_session");
    expect(c?.value).toBe("");
  });
});
