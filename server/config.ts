export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: Uint8Array;
  inviteCode: string;
  /** Origine publique, ex. https://coc.maxperso.fr. Les requêtes d'écriture venant d'ailleurs sont refusées. */
  appOrigin: string | null;
  cookieSecure: boolean;
  /** Dossier du site compilé (vite build). Absent : le serveur ne sert que l'API. */
  staticDir: string | null;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const secret = required(env, "JWT_SECRET");
  if (secret.length < 32) throw new Error("JWT_SECRET doit faire au moins 32 caractères.");
  const invite = required(env, "INVITE_CODE");
  if (invite.length < 6) throw new Error("INVITE_CODE doit faire au moins 6 caractères.");
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    databaseUrl: required(env, "DATABASE_URL"),
    jwtSecret: new TextEncoder().encode(secret),
    inviteCode: invite,
    appOrigin: env.APP_ORIGIN?.replace(/\/$/, "") || null,
    cookieSecure: (env.COOKIE_SECURE ?? (env.NODE_ENV === "production" ? "true" : "false")) === "true",
    staticDir: env.STATIC_DIR ?? null,
  };
}
