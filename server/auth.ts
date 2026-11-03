import { hash, verify } from "@node-rs/argon2";
import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";
import type { Config } from "./config";
import type { Db } from "./db";

/**
 * En HTTPS, préfixe __Host- : le navigateur impose Secure, Path=/ et aucun Domain,
 * donc un sous-domaine ne peut pas écraser le cookie.
 */
export const cookieName = (cfg: Pick<Config, "cookieSecure">) => (cfg.cookieSecure ? "__Host-coc_session" : "coc_session");
const SESSION_DAYS = 30;

export const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
export const PASSWORD_MIN = 8;

export const hashPassword = (password: string) => hash(password);
export const checkPassword = (stored: string, password: string) => verify(stored, password).catch(() => false);

/** Comparaison à temps constant, pour le code d'invitation. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface SessionUser {
  id: number;
  username: string;
  /** Peut déplacer et modérer les tickets du backlog. */
  admin: boolean;
}

export async function issueSession(reply: FastifyReply, cfg: Config, user: { id: number; username: string; token_version: number }) {
  const token = await new SignJWT({ name: user.username, ver: user.token_version })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(cfg.jwtSecret);
  reply.setCookie(cookieName(cfg), token, {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export function clearSession(reply: FastifyReply, cfg: Config) {
  reply.clearCookie(cookieName(cfg), { path: "/", httpOnly: true, secure: cfg.cookieSecure, sameSite: "lax" });
}

/**
 * Lit le cookie de session. Le jeton est refusé si le mot de passe a été réinitialisé depuis
 * (token_version incrémenté) ou si le compte n'existe plus.
 */
export async function readSession(req: FastifyRequest, cfg: Config, db: Db): Promise<SessionUser | null> {
  const token = req.cookies[cookieName(cfg)];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, cfg.jwtSecret, { algorithms: ["HS256"] });
    const id = Number(payload.sub);
    const { rows } = await db.query<{ id: string; username: string; token_version: number; verified: boolean; is_admin: boolean }>(
      "select id, username, token_version, email_verified_at is not null as verified, is_admin from users where id = $1",
      [id],
    );
    const u = rows[0];
    if (!u || !u.verified || u.token_version !== payload.ver) return null;
    return { id: Number(u.id), username: u.username, admin: u.is_admin };
  } catch {
    return null;
  }
}
