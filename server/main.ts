import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createPool, migrate } from "./db";
import { consoleMailer, smtpMailer } from "./mailer";

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

const app = await buildApp(cfg, db, mailer);
await app.listen({ port: cfg.port, host: cfg.host });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
