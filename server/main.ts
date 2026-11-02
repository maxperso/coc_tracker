import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createPool, migrate } from "./db";

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

const app = await buildApp(cfg, db);
await app.listen({ port: cfg.port, host: cfg.host });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
