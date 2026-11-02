import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { MeResponse, PlayerProfile, PlayerRow } from "../src/lib/api";
import { MAX_EXPORT_CHARS } from "../src/lib/exportParse";
import { parseSettings, SettingsSchema } from "../src/lib/settingsSchema";
import { summarize, villageFromText } from "../src/lib/summary";
import {
  checkPassword,
  clearSession,
  hashPassword,
  issueSession,
  PASSWORD_MIN,
  readSession,
  sameSecret,
  USERNAME_RE,
  type SessionUser,
} from "./auth";
import type { Config } from "./config";
import type { Db } from "./db";

const PROFILE_EXPORTS = 30;

const Credentials = z.object({
  username: z.string().regex(USERNAME_RE, "Pseudo : 3 à 20 lettres, chiffres, - ou _."),
  password: z.string().min(PASSWORD_MIN, `Mot de passe : ${PASSWORD_MIN} caractères au moins.`).max(200),
});
const Register = Credentials.extend({ inviteCode: z.string().max(200) });
const Login = z.object({ username: z.string().max(40), password: z.string().max(200) });
const ExportBody = z.object({ text: z.string().max(MAX_EXPORT_CHARS) });

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export async function buildApp(cfg: Config, db: Db) {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: "info" },
    // Derrière Nginx Proxy Manager : l'IP et le protocole viennent des en-têtes X-Forwarded-*.
    trustProxy: true,
    bodyLimit: MAX_EXPORT_CHARS * 2 + 10_000,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.decorateRequest("user", null);

  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Content-Security-Policy", CSP);
  });

  // Les écritures doivent venir du site lui-même (le cookie SameSite=Lax fait le reste).
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD") return;
    const origin = req.headers.origin;
    if (cfg.appOrigin && origin && origin !== cfg.appOrigin) {
      return reply.code(403).send({ error: "Origine refusée." });
    }
  });

  const requireUser = async (req: FastifyRequest, reply: FastifyReply) => {
    req.user = await readSession(req, cfg, db);
    if (!req.user) return reply.code(401).send({ error: "Connecte-toi pour continuer." });
  };

  const bad = (reply: FastifyReply, e: z.ZodError) => reply.code(400).send({ error: e.issues[0]?.message ?? "Requête invalide." });

  app.get("/api/health", async () => {
    await db.query("select 1");
    return { ok: true };
  });

  /* ---------- Comptes ---------- */

  const authLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.post("/api/auth/register", authLimit, async (req, reply) => {
    const body = Register.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const { username, password, inviteCode } = body.data;
    if (!sameSecret(inviteCode, cfg.inviteCode)) return reply.code(403).send({ error: "Code d'invitation incorrect." });
    const passwordHash = await hashPassword(password);
    try {
      const { rows } = await db.query<{ id: string; username: string; token_version: number }>(
        "insert into users (username, password_hash) values ($1, $2) returning id, username, token_version",
        [username, passwordHash],
      );
      const u = rows[0];
      await issueSession(reply, cfg, { id: Number(u.id), username: u.username, token_version: u.token_version });
      return reply.code(201).send({ username: u.username } satisfies MeResponse);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") return reply.code(409).send({ error: "Ce pseudo est déjà pris." });
      throw e;
    }
  });

  app.post("/api/auth/login", authLimit, async (req, reply) => {
    const body = Login.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const { rows } = await db.query<{ id: string; username: string; password_hash: string; token_version: number }>(
      "select id, username, password_hash, token_version from users where lower(username) = lower($1)",
      [body.data.username],
    );
    const u = rows[0];
    // Toujours vérifier un hash, même sans compte, pour ne pas révéler les pseudos par le temps de réponse.
    const ok = await checkPassword(u?.password_hash ?? (await dummyHash), body.data.password);
    if (!u || !ok) return reply.code(401).send({ error: "Pseudo ou mot de passe incorrect." });
    await issueSession(reply, cfg, { id: Number(u.id), username: u.username, token_version: u.token_version });
    return { username: u.username } satisfies MeResponse;
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    clearSession(reply, cfg);
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireUser }, async (req) => ({ username: req.user!.username }) satisfies MeResponse);

  /* ---------- Réglages ---------- */

  app.get("/api/me/settings", { preHandler: requireUser }, async (req) => {
    const { rows } = await db.query<{ settings: unknown }>("select settings from users where id = $1", [req.user!.id]);
    return parseSettings(rows[0]?.settings);
  });

  app.put("/api/me/settings", { preHandler: requireUser }, async (req, reply) => {
    const body = SettingsSchema.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    await db.query("update users set settings = $2 where id = $1", [req.user!.id, body.data]);
    // Le classement affiche le plan avec ces réglages : on recalcule le résumé du dernier export.
    const { rows } = await db.query<{ id: string; raw: unknown }>(
      "select id, raw from exports where user_id = $1 order by exported_at desc limit 1",
      [req.user!.id],
    );
    if (rows[0]) {
      const summary = summarize(villageFromText(JSON.stringify(rows[0].raw)), body.data);
      await db.query("update exports set summary = $2 where id = $1", [rows[0].id, summary]);
    }
    return body.data;
  });

  /* ---------- Exports ---------- */

  app.post("/api/exports", { preHandler: requireUser }, async (req, reply) => {
    const body = ExportBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    let village;
    try {
      village = villageFromText(body.data.text);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const { rows: s } = await db.query<{ settings: unknown }>("select settings from users where id = $1", [req.user!.id]);
    const summary = summarize(village, parseSettings(s[0]?.settings));
    await db.query(
      `insert into exports (user_id, tag, exported_at, raw, summary)
       values ($1, $2, to_timestamp($3), $4, $5)
       on conflict (user_id, exported_at) do update set tag = excluded.tag, raw = excluded.raw, summary = excluded.summary`,
      [req.user!.id, village.tag, village.timestamp, JSON.parse(body.data.text), summary],
    );
    return reply.code(201).send({ ok: true });
  });

  /* ---------- Joueurs ---------- */

  app.get("/api/players", { preHandler: requireUser }, async () => {
    const { rows } = await db.query<{ username: string; summary: PlayerRow["summary"]; created_at: Date }>(
      `select distinct on (u.id) u.username, e.summary, e.created_at
       from users u join exports e on e.user_id = u.id
       order by u.id, e.exported_at desc`,
    );
    const out: PlayerRow[] = rows.map((r) => ({ username: r.username, summary: r.summary, updatedAt: r.created_at.toISOString() }));
    return out.sort((a, b) => b.summary.pct.global - a.summary.pct.global);
  });

  app.get<{ Params: { username: string } }>("/api/players/:username", { preHandler: requireUser }, async (req, reply) => {
    const { rows: users } = await db.query<{ id: string; username: string; settings: unknown }>(
      "select id, username, settings from users where lower(username) = lower($1)",
      [req.params.username],
    );
    const u = users[0];
    if (!u) return reply.code(404).send({ error: "Joueur introuvable." });
    const { rows } = await db.query<{ raw: unknown; exported_at: Date }>(
      `select raw, exported_at from (
         select raw, exported_at from exports where user_id = $1 order by exported_at desc limit $2
       ) t order by exported_at asc`,
      [u.id, PROFILE_EXPORTS],
    );
    return {
      username: u.username,
      settings: parseSettings(u.settings),
      exports: rows.map((r) => ({ raw: r.raw, exportedAt: r.exported_at.toISOString() })),
    } satisfies PlayerProfile;
  });

  /* ---------- Site ---------- */

  if (cfg.staticDir && existsSync(join(cfg.staticDir, "index.html"))) {
    await app.register(fastifyStatic, { root: cfg.staticDir, wildcard: false, maxAge: "1h" });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || req.method !== "GET" || !cfg.staticDir) {
      return reply.code(404).send({ error: "Introuvable." });
    }
    return reply.type("text/html").sendFile("index.html");
  });

  return app;
}

/** Hash d'un mot de passe jetable, pour un temps de réponse constant quand le pseudo n'existe pas. */
const dummyHash = hashPassword("pas-un-vrai-compte");
