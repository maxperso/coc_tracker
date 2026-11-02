import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";

export type CodePurpose = "verify" | "reset";

export const CODE_TTL_MINUTES = 15;
export const CODE_MAX_ATTEMPTS = 5;
/** Délai minimal entre deux envois de code pour un même compte. */
export const RESEND_SECONDS = 60;

/** Le code n'est jamais stocké en clair : HMAC lié au compte et à l'usage. */
function digest(secret: string, userId: number, purpose: CodePurpose, code: string): string {
  return createHmac("sha256", secret).update(`${purpose}:${userId}:${code}`).digest("hex");
}

/** Nouveau code à 6 chiffres ; les codes précédents de même usage sont annulés. */
export async function createCode(db: Db, secret: string, userId: number, purpose: CodePurpose): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.query("delete from email_codes where user_id = $1 and purpose = $2", [userId, purpose]);
  await db.query(
    `insert into email_codes (user_id, purpose, code_hash, expires_at)
     values ($1, $2, $3, now() + make_interval(mins => $4))`,
    [userId, purpose, digest(secret, userId, purpose, code), CODE_TTL_MINUTES],
  );
  return code;
}

/** Un code a-t-il été envoyé il y a moins de RESEND_SECONDS ? */
export async function sentRecently(db: Db, userId: number, purpose: CodePurpose): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from email_codes where user_id = $1 and purpose = $2 and created_at > now() - make_interval(secs => $3)`,
    [userId, purpose, RESEND_SECONDS],
  );
  return rows.length > 0;
}

/**
 * Vérifie un code. Chaque échec compte ; après CODE_MAX_ATTEMPTS, le code est inutilisable.
 * En cas de succès, le code est supprimé (usage unique).
 */
export async function consumeCode(db: Db, secret: string, userId: number, purpose: CodePurpose, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const { rows } = await db.query<{ id: string; code_hash: string; attempts: number }>(
    `select id, code_hash, attempts from email_codes
     where user_id = $1 and purpose = $2 and expires_at > now()
     order by created_at desc limit 1`,
    [userId, purpose],
  );
  const row = rows[0];
  if (!row || row.attempts >= CODE_MAX_ATTEMPTS) return false;
  const a = Buffer.from(row.code_hash, "hex");
  const b = Buffer.from(digest(secret, userId, purpose, code), "hex");
  if (a.length === b.length && timingSafeEqual(a, b)) {
    await db.query("delete from email_codes where user_id = $1 and purpose = $2", [userId, purpose]);
    return true;
  }
  await db.query("update email_codes set attempts = attempts + 1 where id = $1", [row.id]);
  return false;
}
