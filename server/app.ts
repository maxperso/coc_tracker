import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { AuthConfigResponse, MeResponse, PendingResponse, PlayerProfile, PlayerRow } from "../src/lib/api";
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
import { MAX_CHECK_KEY, MAX_CHECKS } from "../src/lib/reminders";
import { consumeCode, createCode, sentRecently } from "./codes";
import { isAllowedEndpoint, MAX_SUBSCRIPTIONS, rebuildQueue, sendToUser, type PushSender } from "./push";
import type { Config } from "./config";
import type { Db } from "./db";
import { mails, type Mail, type Mailer } from "./mailer";

const PROFILE_EXPORTS = 30;
/** Exports gardés par compte : au-delà, les plus anciens sont supprimés. */
const KEPT_EXPORTS = 60;
/** Un compte jamais confirmé libère son pseudo et son email au bout de ce délai. */
const UNVERIFIED_HOURS = 24;

const Username = z.string().regex(USERNAME_RE, "Pseudo : 3 à 20 lettres, chiffres, - ou _.");
const Password = z.string().min(PASSWORD_MIN, `Mot de passe : ${PASSWORD_MIN} caractères au moins.`).max(200, "Mot de passe trop long.");
const Email = z.string().trim().max(254).email("Adresse email invalide.");
const Code = z.string().trim().max(12);

const Register = z.object({ username: Username, email: Email, password: Password, inviteCode: z.string().max(200).optional() });
const Login = z.object({ username: z.string().max(40), password: z.string().max(200) });
const Verify = z.object({ username: z.string().max(40), code: Code });
const Resend = z.object({ username: z.string().max(40) });
const Forgot = z.object({ email: Email });
const Reset = z.object({ email: Email, code: Code, password: Password });
const ExportBody = z.object({ text: z.string().max(MAX_EXPORT_CHARS) });
const Checks = z.object({ exportAt: z.number().int().positive(), keys: z.array(z.string().min(1).max(MAX_CHECK_KEY)).max(MAX_CHECKS) });
const Subscription = z.object({
  endpoint: z.string().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});
const Unsubscribe = z.object({ endpoint: z.string().max(2000) });

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const GENERIC_PENDING = "Si les informations sont bonnes, un code vient de partir par email.";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

interface UserRow {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  token_version: number;
  verified: boolean;
}

const USER_COLS = "id, username, email, password_hash, token_version, email_verified_at is not null as verified";

export async function buildApp(cfg: Config, db: Db, mailer: Mailer, push: PushSender | null = null) {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: "info" },
    // Seuls les proxys du réseau privé (Nginx Proxy Manager, Docker) sont crus pour X-Forwarded-*.
    // Un client qui atteint le port directement ne peut donc pas usurper une IP.
    trustProxy: cfg.trustProxy,
    bodyLimit: MAX_EXPORT_CHARS * 2 + 10_000,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  app.decorateRequest("user", null);

  app.addHook("onSend", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Content-Security-Policy", CSP);
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
  });

  // Les écritures doivent venir du site lui-même (en plus du cookie SameSite=Lax).
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    if ((cfg.appOrigin && origin && origin !== cfg.appOrigin) || (site && site !== "same-origin" && site !== "none")) {
      return reply.code(403).send({ error: "Origine refusée." });
    }
  });

  // Erreurs inattendues : détail dans les logs, message neutre pour le client.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error(err);
      return reply.code(500).send({ error: "Erreur du serveur, réessaie plus tard." });
    }
    return reply.code(status).send({ error: status === 429 ? "Trop d'essais, attends une minute." : err.message });
  });

  const requireUser = async (req: FastifyRequest, reply: FastifyReply) => {
    req.user = await readSession(req, cfg, db);
    if (!req.user) return reply.code(401).send({ error: "Connecte-toi pour continuer." });
  };

  const bad = (reply: FastifyReply, e: z.ZodError) => reply.code(400).send({ error: e.issues[0]?.message ?? "Requête invalide." });

  /** Envoi sans attendre : la réponse ne dépend pas du serveur mail (pas d'indice par le temps de réponse). */
  const sendLater = (mail: Mail) => {
    mailer.send(mail).catch((e) => app.log.error({ err: e, subject: mail.subject }, "Échec d'envoi d'email"));
  };

  /** Rappels recalculés en arrière-plan : la réponse n'attend pas ce calcul. */
  const refreshReminders = (userId: number) => {
    if (!push) return;
    rebuildQueue(db, userId).catch((e) => app.log.error({ err: e }, "Échec du calcul des rappels"));
  };

  const findUser = async (where: string, value: string) => {
    const { rows } = await db.query<UserRow>(`select ${USER_COLS} from users where ${where} limit 1`, [value]);
    return rows[0] ?? null;
  };

  const sendVerifyCode = async (u: UserRow) => {
    if (!u.email || (await sentRecently(db, Number(u.id), "verify"))) return;
    sendLater(mails.verify(u.email, u.username, await createCode(db, cfg.codeSecret, Number(u.id), "verify")));
  };

  const login = (reply: FastifyReply, u: UserRow) =>
    issueSession(reply, cfg, { id: Number(u.id), username: u.username, token_version: u.token_version });

  app.get("/api/health", async () => {
    await db.query("select 1");
    return { ok: true };
  });

  /* ---------- Comptes ---------- */

  const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
  const veryStrict = { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } };

  app.get("/api/auth/config", async () => ({ inviteRequired: cfg.inviteCode != null }) satisfies AuthConfigResponse);

  app.post("/api/auth/register", strict, async (req, reply) => {
    const body = Register.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const { username, email, password, inviteCode } = body.data;
    if (cfg.inviteCode && !sameSecret(inviteCode ?? "", cfg.inviteCode)) {
      return reply.code(403).send({ error: "Code d'invitation incorrect." });
    }
    // Comptes jamais confirmés : ils libèrent leur pseudo et leur email.
    await db.query(`delete from users where email_verified_at is null and created_at < now() - make_interval(hours => $1)`, [UNVERIFIED_HOURS]);

    const byName = await findUser("lower(username) = lower($1)", username);
    const byEmail = await findUser("lower(email) = lower($1)", email);
    const pending: PendingResponse = { pending: true, username, message: GENERIC_PENDING };

    if (byEmail && byEmail.id !== byName?.id) {
      // Email déjà pris : même réponse qu'un succès, pour ne pas révéler qui est inscrit.
      // Le titulaire de l'adresse est prévenu par email.
      if (byEmail.verified) sendLater(mails.alreadyRegistered(byEmail.email!, byEmail.username));
      if (!byName) {
        await hashPassword(password); // même durée qu'une vraie inscription
        return reply.code(202).send(pending);
      }
    }
    if (byName) {
      // Même pseudo et même email, pas encore confirmé : on relance l'inscription.
      if (!byName.verified && byName.email?.toLowerCase() === email.toLowerCase()) {
        await db.query("update users set password_hash = $2 where id = $1", [byName.id, await hashPassword(password)]);
        await sendVerifyCode(byName);
        return reply.code(202).send(pending);
      }
      return reply.code(409).send({ error: "Ce pseudo est déjà pris." });
    }

    const { rows } = await db.query<UserRow>(
      `insert into users (username, email, password_hash) values ($1, $2, $3) returning ${USER_COLS}`,
      [username, email, await hashPassword(password)],
    );
    await sendVerifyCode(rows[0]);
    return reply.code(202).send(pending);
  });

  app.post("/api/auth/verify", strict, async (req, reply) => {
    const body = Verify.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const u = await findUser("lower(username) = lower($1)", body.data.username);
    if (!u || u.verified || !(await consumeCode(db, cfg.codeSecret, Number(u.id), "verify", body.data.code))) {
      return reply.code(400).send({ error: "Code invalide ou expiré." });
    }
    await db.query("update users set email_verified_at = now() where id = $1", [u.id]);
    await login(reply, u);
    return { username: u.username } satisfies MeResponse;
  });

  app.post("/api/auth/resend", veryStrict, async (req, reply) => {
    const body = Resend.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const u = await findUser("lower(username) = lower($1)", body.data.username);
    if (u && !u.verified) await sendVerifyCode(u);
    return reply.code(202).send({ pending: true, username: body.data.username, message: GENERIC_PENDING } satisfies PendingResponse);
  });

  app.post("/api/auth/login", strict, async (req, reply) => {
    const body = Login.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const u = await findUser("lower(username) = lower($1)", body.data.username);
    // Toujours vérifier un hash, même sans compte, pour ne pas révéler les pseudos par le temps de réponse.
    const ok = await checkPassword(u?.password_hash ?? (await dummyHash), body.data.password);
    if (!u || !ok) return reply.code(401).send({ error: "Pseudo ou mot de passe incorrect." });
    if (!u.verified) {
      // Bon mot de passe mais email pas confirmé : on renvoie un code.
      await sendVerifyCode(u);
      return reply.code(403).send({ error: "Confirme d'abord ton email avec le code reçu.", needsVerification: true, username: u.username });
    }
    await login(reply, u);
    return { username: u.username } satisfies MeResponse;
  });

  app.post("/api/auth/forgot", veryStrict, async (req, reply) => {
    const body = Forgot.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const u = await findUser("lower(email) = lower($1)", body.data.email);
    if (u?.verified && !(await sentRecently(db, Number(u.id), "reset"))) {
      sendLater(mails.reset(u.email!, u.username, await createCode(db, cfg.codeSecret, Number(u.id), "reset")));
    }
    // Réponse identique que l'adresse existe ou non.
    return reply.code(202).send({ pending: true, username: "", message: GENERIC_PENDING } satisfies PendingResponse);
  });

  app.post("/api/auth/reset", strict, async (req, reply) => {
    const body = Reset.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const u = await findUser("lower(email) = lower($1)", body.data.email);
    if (!u?.verified || !(await consumeCode(db, cfg.codeSecret, Number(u.id), "reset", body.data.code))) {
      return reply.code(400).send({ error: "Code invalide ou expiré." });
    }
    // token_version + 1 : toutes les sessions ouvertes avec l'ancien mot de passe sont fermées.
    const { rows } = await db.query<UserRow>(
      `update users set password_hash = $2, token_version = token_version + 1 where id = $1 returning ${USER_COLS}`,
      [u.id, await hashPassword(body.data.password)],
    );
    await login(reply, rows[0]);
    return { username: u.username } satisfies MeResponse;
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    clearSession(reply, cfg);
    return { ok: true };
  });

  /** Ferme toutes les sessions du compte (autres appareils compris). */
  app.post("/api/auth/logout-all", { preHandler: requireUser }, async (req, reply) => {
    await db.query("update users set token_version = token_version + 1 where id = $1", [req.user!.id]);
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
    refreshReminders(req.user!.id);
    return body.data;
  });

  /* ---------- Exports ---------- */

  app.post("/api/exports", { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
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
    await db.query(
      `delete from exports where user_id = $1 and id not in (
         select id from exports where user_id = $1 order by exported_at desc limit $2)`,
      [req.user!.id, KEPT_EXPORTS],
    );
    refreshReminders(req.user!.id);
    return reply.code(201).send({ ok: true });
  });

  /* ---------- Joueurs ---------- */

  app.get("/api/players", { preHandler: requireUser }, async () => {
    const { rows } = await db.query<{ username: string; summary: PlayerRow["summary"]; created_at: Date }>(
      `select distinct on (u.id) u.username, e.summary, e.created_at
       from users u join exports e on e.user_id = u.id
       where u.email_verified_at is not null
       order by u.id, e.exported_at desc`,
    );
    const out: PlayerRow[] = rows.map((r) => ({ username: r.username, summary: r.summary, updatedAt: r.created_at.toISOString() }));
    return out.sort((a, b) => b.summary.pct.global - a.summary.pct.global);
  });

  app.get<{ Params: { username: string } }>("/api/players/:username", { preHandler: requireUser }, async (req, reply) => {
    const { rows: users } = await db.query<{ id: string; username: string; settings: unknown; plan_checks: PlayerProfile["checks"] }>(
      "select id, username, settings, plan_checks from users where lower(username) = lower($1) and email_verified_at is not null",
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
      checks: u.plan_checks ?? null,
    } satisfies PlayerProfile;
  });

  /* ---------- Plan coché ---------- */

  app.put("/api/me/checks", { preHandler: requireUser }, async (req, reply) => {
    const body = Checks.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const value = { exportAt: body.data.exportAt, keys: [...new Set(body.data.keys)] };
    await db.query("update users set plan_checks = $2 where id = $1", [req.user!.id, value]);
    return value;
  });

  /* ---------- Notifications push ---------- */

  app.get("/api/push/config", async () => ({ enabled: push != null && cfg.vapid != null, publicKey: cfg.vapid?.publicKey ?? null }));

  app.post("/api/push/subscribe", { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!push) return reply.code(503).send({ error: "Les notifications ne sont pas activées sur ce serveur." });
    const body = Subscription.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    if (!isAllowedEndpoint(body.data.endpoint)) return reply.code(400).send({ error: "Service de notification non reconnu." });
    const userId = req.user!.id;
    await db.query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)
       on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      [userId, body.data.endpoint, body.data.keys.p256dh, body.data.keys.auth],
    );
    // Au-delà de MAX_SUBSCRIPTIONS appareils, les plus anciens sont oubliés.
    await db.query(
      `delete from push_subscriptions where user_id = $1 and id not in (
         select id from push_subscriptions where user_id = $1 order by created_at desc limit $2)`,
      [userId, MAX_SUBSCRIPTIONS],
    );
    refreshReminders(userId);
    return reply.code(201).send({ ok: true });
  });

  app.post("/api/push/unsubscribe", { preHandler: requireUser }, async (req, reply) => {
    const body = Unsubscribe.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    await db.query("delete from push_subscriptions where user_id = $1 and endpoint = $2", [req.user!.id, body.data.endpoint]);
    refreshReminders(req.user!.id);
    return { ok: true };
  });

  app.post("/api/push/test", { preHandler: requireUser, config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!push) return reply.code(503).send({ error: "Les notifications ne sont pas activées sur ce serveur." });
    const sent = await sendToUser(db, push, req.user!.id, { title: "COC Tracker", body: "Les rappels sont activés sur cet appareil.", tag: "test" });
    return { sent };
  });

  /* ---------- Site ---------- */

  if (cfg.staticDir && existsSync(`${cfg.staticDir}/index.html`)) {
    await app.register(fastifyStatic, {
      root: cfg.staticDir,
      wildcard: false,
      cacheControl: false,
      // index.html toujours revalidé (nouvelle version visible tout de suite) ;
      // fichiers à empreinte de Vite gardés un an ; sprites une journée.
      setHeaders: (res, path) => {
        // Le service worker et le manifeste doivent être relus à chaque visite pour se mettre à jour.
        const cache = path.endsWith(".html") || path.endsWith("/sw.js") || path.endsWith(".webmanifest")
          ? "no-cache"
          : path.includes("/assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=86400";
        res.header("Cache-Control", cache);
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || req.method !== "GET" || !cfg.staticDir) {
      return reply.code(404).send({ error: "Introuvable." });
    }
    return reply.type("text/html").header("Cache-Control", "no-cache").sendFile("index.html");
  });

  return app;
}

/** Hash d'un mot de passe jetable, pour un temps de réponse constant quand le pseudo n'existe pas. */
const dummyHash = hashPassword("pas-un-vrai-compte");
