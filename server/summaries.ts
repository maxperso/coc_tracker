import { parseSettings } from "../src/lib/settingsSchema";
import { summarize, villageFromText } from "../src/lib/summary";
import type { Db } from "./db";

/**
 * Résumés enregistrés avant l'ajout d'un chiffre (ex. la complétion du jeu entier) : recalculés au
 * démarrage, pour le dernier export de chaque joueur (celui du classement).
 */
export async function refreshSummaries(db: Db): Promise<number> {
  const { rows } = await db.query<{ id: string; raw: unknown; settings: unknown }>(
    `select * from (
       select distinct on (e.user_id) e.id, e.raw, e.summary, u.settings
       from exports e join users u on u.id = e.user_id
       order by e.user_id, e.exported_at desc
     ) last where last.summary->'pct'->'game' is null`,
  );
  for (const r of rows) {
    const summary = summarize(villageFromText(JSON.stringify(r.raw)), parseSettings(r.settings));
    await db.query("update exports set summary = $2 where id = $1", [r.id, summary]);
  }
  return rows.length;
}
