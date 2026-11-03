export interface SmtpConfig {
  host: string;
  port: number;
  /** true : TLS direct (port 465). false : STARTTLS (port 587). */
  secure: boolean;
  /** Sans TLS direct, exiger STARTTLS (désactivable seulement pour un relais local de test). */
  requireTls: boolean;
  user: string | null;
  pass: string | null;
  from: string;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** Contact du serveur pour les services push, ex. mailto:admin@exemple.fr. */
  subject: string;
}

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: Uint8Array;
  /** Clé HMAC des codes envoyés par email. */
  codeSecret: string;
  /** Code d'invitation demandé à l'inscription ; null = inscription ouverte (avec email confirmé). */
  inviteCode: string | null;
  /** Origine publique, ex. https://coc.maxperso.fr. Les requêtes d'écriture venant d'ailleurs sont refusées. */
  appOrigin: string | null;
  cookieSecure: boolean;
  /** Proxys dont on croit les en-têtes X-Forwarded-* (format proxy-addr). */
  trustProxy: string;
  /** Dossier du site compilé (vite build). Absent : le serveur ne sert que l'API. */
  staticDir: string | null;
  /** Absent : les emails sont écrits dans les logs (dev seulement). */
  smtp: SmtpConfig | null;
  /** Absent : les notifications push sont désactivées. */
  vapid: VapidConfig | null;
  /**
   * Mode dev : pseudo du compte de test, connecté d'office (admin, village et données d'exemple).
   * Interdit en production : le serveur refuse de démarrer.
   */
  devLogin: string | null;
}

/** Même règle que les pseudos des comptes. */
const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const secret = required(env, "JWT_SECRET");
  if (secret.length < 32) throw new Error("JWT_SECRET doit faire au moins 32 caractères.");
  const invite = env.INVITE_CODE?.trim() || null;
  if (invite && invite.length < 6) throw new Error("INVITE_CODE doit faire au moins 6 caractères.");

  const smtp: SmtpConfig | null = env.SMTP_HOST
    ? {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT ?? 587),
        secure: (env.SMTP_SECURE ?? (env.SMTP_PORT === "465" ? "true" : "false")) === "true",
        requireTls: env.SMTP_REQUIRE_TLS !== "false",
        user: env.SMTP_USER || null,
        pass: env.SMTP_PASS || null,
        from: required(env, "MAIL_FROM"),
      }
    : null;
  if (production && !smtp) throw new Error("SMTP_HOST et MAIL_FROM sont obligatoires en production (emails de confirmation).");

  const vapid: VapidConfig | null =
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
      ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || "mailto:admin@localhost" }
      : null;

  const devLogin = env.DEV_LOGIN?.trim() || null;
  if (devLogin && production) throw new Error("DEV_LOGIN est interdit en production : tout visiteur serait connecté d'office.");
  if (devLogin && !USERNAME.test(devLogin)) throw new Error("DEV_LOGIN : 3 à 20 lettres, chiffres, - ou _.");

  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    databaseUrl: required(env, "DATABASE_URL"),
    jwtSecret: new TextEncoder().encode(secret),
    codeSecret: `codes:${secret}`,
    inviteCode: invite,
    appOrigin: env.APP_ORIGIN?.replace(/\/$/, "") || null,
    cookieSecure: (env.COOKIE_SECURE ?? (production ? "true" : "false")) === "true",
    trustProxy: env.TRUST_PROXY ?? "loopback,linklocal,uniquelocal",
    staticDir: env.STATIC_DIR ?? null,
    smtp,
    vapid,
    devLogin,
  };
}
