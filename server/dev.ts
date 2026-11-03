// Données de test du mode dev (DEV_LOGIN) : compte admin avec un village, un ami, quelques tickets.
// Créées une fois, au démarrage ; rien n'est écrasé si elles existent déjà.
import { randomBytes } from "node:crypto";
import demo from "../src/data/demo.json";
import { LATEST_RELEASE } from "../src/lib/changelog";
import { DEFAULT_SETTINGS } from "../src/lib/plan";
import { summarize, villageFromText } from "../src/lib/summary";
import { hashPassword } from "./auth";
import type { Db } from "./db";

/** Compte de test, sans mot de passe connu (on n'en a pas besoin : la session est automatique). */
async function ensureUser(db: Db, username: string, admin: boolean): Promise<{ id: number; created: boolean }> {
  const { rows } = await db.query<{ id: string }>("select id from users where lower(username) = lower($1)", [username]);
  if (rows[0]) {
    if (admin) await db.query("update users set is_admin = true where id = $1", [rows[0].id]);
    return { id: Number(rows[0].id), created: false };
  }
  const { rows: created } = await db.query<{ id: string }>(
    `insert into users (username, email, password_hash, email_verified_at, is_admin, seen_release)
     values ($1, $2, $3, now(), $4, $5) returning id`,
    [username, `${username.toLowerCase()}@dev.localhost`, await hashPassword(randomBytes(24).toString("hex")), admin, LATEST_RELEASE],
  );
  return { id: Number(created[0].id), created: true };
}

/** Le village de démo, décalé de `hoursAgo` pour que chaque compte ait son propre export. */
async function ensureExport(db: Db, userId: number, hoursAgo: number) {
  const { rowCount } = await db.query("select 1 from exports where user_id = $1 limit 1", [userId]);
  if (rowCount) return;
  const raw = { ...demo, timestamp: Math.floor(Date.now() / 1000) - hoursAgo * 3600 };
  const text = JSON.stringify(raw);
  const village = villageFromText(text);
  await db.query(
    "insert into exports (user_id, tag, exported_at, raw, summary) values ($1, $2, to_timestamp($3), $4, $5)",
    [userId, village.tag, village.timestamp, raw, summarize(village, DEFAULT_SETTINGS)],
  );
}

async function ensureBacklog(db: Db, me: number, friend: number) {
  const { rowCount } = await db.query("select 1 from backlog_items limit 1");
  if (rowCount) return;
  const tickets: [number, string, string, string, string][] = [
    [friend, "feature", "Afficher le coût total de chaque jour dans le plan", "Pour savoir combien d'élixir garder de côté.", "backlog"],
    [me, "bug", "Le calendrier dépasse sur petit écran", "", "in_progress"],
    [friend, "change", "Mettre les potions en haut du plan", "", "deployed"],
    [me, "feature", "Mode sombre", "", "validated"],
  ];
  for (const [user, kind, title, body, status] of tickets) {
    const { rows } = await db.query<{ id: string }>(
      "insert into backlog_items (user_id, kind, title, body, status) values ($1, $2, $3, $4, $5) returning id",
      [user, kind, title, body, status],
    );
    await db.query("insert into backlog_votes (item_id, user_id) values ($1, $2)", [rows[0].id, user]);
    if (user === friend) await db.query("insert into backlog_comments (item_id, user_id, body) values ($1, $2, 'Bonne idée, je regarde.')", [rows[0].id, me]);
  }
}

export async function seedDev(db: Db, username: string): Promise<void> {
  const me = await ensureUser(db, username, true);
  const friend = await ensureUser(db, "ami_dev", false);
  await ensureExport(db, me.id, 2);
  await ensureExport(db, friend.id, 30);
  await ensureBacklog(db, me.id, friend.id);
}
