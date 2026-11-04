import type { PlanChecks, VillageInfo } from "../src/lib/api";
import type { Settings } from "../src/lib/plan";
import { parseSettings } from "../src/lib/settingsSchema";
import type { Db } from "./db";

/** Comptes CoC d'un joueur, d'après ses exports : le plus récent d'abord. */
export async function villagesOf(db: Db, userId: number): Promise<VillageInfo[]> {
  const { rows } = await db.query<{ tag: string; th: number | null; at: Date }>(
    `select distinct on (tag) tag, (summary->>'th')::int as th, exported_at as at
     from exports where user_id = $1 order by tag, exported_at desc`,
    [userId],
  );
  return rows.sort((a, b) => b.at.getTime() - a.at.getTime()).map((r) => ({ tag: r.tag, th: r.th ?? 0, updatedAt: r.at.toISOString() }));
}

/** Le village demandé s'il appartient au joueur, sinon son dernier exporté ; null s'il n'a aucun export. */
export async function resolveTag(db: Db, userId: number, tag?: string): Promise<string | null> {
  const villages = await villagesOf(db, userId);
  return villages.find((v) => v.tag === tag)?.tag ?? villages[0]?.tag ?? null;
}

/** Réglages d'un village ; à défaut, ceux du compte (ils servent de modèle pour un nouveau village). */
export async function villageSettings(db: Db, userId: number, tag: string | null): Promise<Settings> {
  const { rows } = await db.query<{ settings: unknown; fallback: unknown }>(
    `select v.settings, u.settings as fallback from users u
     left join user_villages v on v.user_id = u.id and v.tag = $2
     where u.id = $1`,
    [userId, tag ?? ""],
  );
  return parseSettings(rows[0]?.settings ?? rows[0]?.fallback);
}

export async function villageChecks(db: Db, userId: number, tag: string | null): Promise<PlanChecks | null> {
  if (!tag) return null;
  const { rows } = await db.query<{ plan_checks: PlanChecks | null }>("select plan_checks from user_villages where user_id = $1 and tag = $2", [userId, tag]);
  return rows[0]?.plan_checks ?? null;
}

/** Crée la ligne du village au premier export, avec les réglages du compte comme modèle. */
export async function ensureVillage(db: Db, userId: number, tag: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into user_villages (user_id, tag, settings) select id, $2, settings from users where id = $1 on conflict do nothing`,
    [userId, tag],
  );
  return (rowCount ?? 0) > 0;
}
