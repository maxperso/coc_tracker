import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createPool, migrate } from "./db";
import { seedDev } from "./dev";
import { refreshSummaries } from "./summaries";
import { consoleMailer, smtpMailer } from "./mailer";
import { startScheduler, webPushSender } from "./push";

const cfg = loadConfig();
const db = createPool(cfg.databaseUrl);

// Postgres peut démarrer après l'app dans docker compose : quelques essais avant d'abandonner.
for (let attempt = 1; ; attempt++) {
  try {
    const n = await migrate(db);
    if (n) console.log(`${n} migration(s) appliquée(s).`);
    break;
  } catch (e) {
    if (attempt >= 15) throw e;
    console.log(`Base indisponible (essai ${attempt}), nouvel essai dans 2 s…`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

if (cfg.devLogin) {
  await seedDev(db, cfg.devLogin);
  console.warn(`MODE DEV : tout visiteur est connecté d'office en tant que « ${cfg.devLogin} » (admin). Jamais en production.`);
}

const smtp = cfg.smtp ? smtpMailer(cfg.smtp) : null;
const mailer = smtp ?? consoleMailer;
if (smtp) {
  // On prévient tôt si le SMTP refuse, sans bloquer le démarrage.
  smtp.verify().then(
    () => console.log(`SMTP prêt (${cfg.smtp!.host}:${cfg.smtp!.port}).`),
    (e) => console.error(`SMTP injoignable : ${(e as Error).message}`),
  );
} else {
  console.warn("Pas de SMTP configuré : les emails sont écrits dans les logs (dev).");
}

const push = cfg.vapid ? webPushSender(cfg.vapid) : null;
if (!push) console.warn("Pas de clés VAPID : les notifications push sont désactivées.");
else console.log(`Notifications push actives (contact ${cfg.vapid!.subject}).`);

const app = await buildApp(cfg, db, mailer, push);
await app.listen({ port: cfg.port, host: cfg.host });
// En fond : le site répond pendant ce calcul.
refreshSummaries(db).then(
  (n) => n && console.log(`${n} résumé(s) de joueur recalculé(s).`),
  (e) => console.error("Recalcul des résumés impossible :", e),
);
const stopScheduler = push ? startScheduler(db, push, (msg, err) => app.log.error({ err }, msg)) : () => {};

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    stopScheduler();
    await app.close();
    await db.end();
    process.exit(0);
  });
}
