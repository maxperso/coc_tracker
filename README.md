# COC Tracker

Site pour suivre son village Clash of Clans pendant le Hammer Jam, et l'avancement de ses amis.
Chaque joueur crée un compte (pseudo, email confirmé par un code, mot de passe, code d'invitation),
colle l'export de son village et voit son plan : héros, bâtiments, labo, potions, achats en médailles.
Tous les inscrits voient le classement et le plan des autres, en lecture seule.

Les calculs se font dans le navigateur. Le serveur garde les comptes, les exports et les réglages.

## Développement

```bash
npm install
cp .env.example .env                # remplir, et décommenter DATABASE_URL et APP_ORIGIN de dev
docker compose up -d db             # Postgres seul (ou un Postgres local)
npm run dev:server                  # API sur :3000
npm run dev                         # site sur :5173, /api est relayé vers :3000
```

Tests :

```bash
npm test                                                     # calculs, sans base
DATABASE_URL_TEST=postgres://… npm test                      # + API (la base indiquée est vidée)
COC_EXPORT=mon_export.json npm test                          # + contrôles sur un vrai export
```

## Production (Docker)

Sur le serveur :

```bash
git clone … && cd coc_tracker
cp .env.example .env
# POSTGRES_PASSWORD : openssl rand -hex 24
# JWT_SECRET        : openssl rand -hex 32
# INVITE_CODE       : le code à donner à tes amis (vide = inscription ouverte)
# SMTP_* et MAIL_FROM : voir ci-dessous
docker compose up -d --build
docker compose logs app | grep SMTP     # « SMTP prêt » : les emails partiront
```

L'app écoute sur le port `APP_PORT` (3000 par défaut) de l'hôte. Les migrations de la base
s'appliquent au démarrage. Les données Postgres sont dans le volume `pgdata`.

### Nginx Proxy Manager

Nouveau *Proxy Host* :

- **Domain Names** : `coc.maxperso.fr`
- **Scheme** : `http`, **Forward Hostname / IP** : l'IP de l'hôte Docker (ou `coc-tracker-app-1` si NPM est sur le même réseau Docker), **Port** : `3000`
- **Block Common Exploits** : oui
- Onglet **SSL** : nouveau certificat Let's Encrypt, **Force SSL**, **HTTP/2**, **HSTS**

Le HTTPS est obligatoire : le cookie de session est `Secure`. `APP_ORIGIN` doit être exactement
l'adresse publique (`https://coc.maxperso.fr`), sinon les connexions et envois sont refusés.

### Emails (SMTP de WordPress)

Le site envoie un code à 6 chiffres pour confirmer l'email à l'inscription, et pour le mot de passe
oublié. Reprends les réglages SMTP de WordPress (WP Mail SMTP, Post SMTP…) :

| WordPress | `.env` |
|---|---|
| SMTP Host | `SMTP_HOST` |
| SMTP Port | `SMTP_PORT` (587 ou 465) |
| Encryption TLS / SSL | `SMTP_SECURE=false` (587, STARTTLS) ou `true` (465) |
| Username / Password | `SMTP_USER` / `SMTP_PASS` |
| From Email | `MAIL_FROM="COC Tracker <adresse>"` |

Si ton WordPress envoie via une API (Gmail OAuth, Brevo API…) et non en SMTP, crée plutôt des
identifiants SMTP chez le même fournisseur. Sans SMTP, l'app refuse de démarrer en production.

### Rappels (notifications push)

Le serveur envoie une notification à chaque relance prévue (chantier fini, potions), au réveil si
le joueur dort, et un rappel de recoller l'export 24 h après. Il faut une paire de clés VAPID :

```bash
docker compose build && docker run --rm --entrypoint npx coc-tracker:latest web-push generate-vapid-keys
# copie « Public Key » dans VAPID_PUBLIC_KEY et « Private Key » dans VAPID_PRIVATE_KEY (.env)
docker compose up -d
```

Ne change plus ces clés ensuite : les appareils abonnés devraient se réabonner. Chaque joueur active
les rappels dans *Mon compte* (sur iPhone, après avoir installé le site sur l'écran d'accueil).

### Administration

```bash
docker compose exec app node dist-server/cli.js list-users
docker compose exec -it app node dist-server/cli.js reset-password <pseudo>   # coupe aussi ses sessions
```

Sauvegarde : `docker compose exec db pg_dump -U coc coc > sauvegarde.sql`

## Sécurité

- Mots de passe hachés avec argon2id. Session : JWT HS256 dans un cookie `__Host-` `httpOnly`, `Secure`,
  `SameSite=Lax`, valable 30 jours, révoqué si le mot de passe est réinitialisé ou via « Se déconnecter partout ».
- Email confirmé obligatoire. Codes à 6 chiffres hachés (HMAC), valables 15 minutes, 5 essais, usage unique,
  un envoi par minute au plus. « Mot de passe oublié » et l'inscription ne révèlent pas si un email existe.
- Limites de tentatives par IP (5 à 10 par minute sur les comptes, 300 par minute sur l'API). Seuls les proxys
  du réseau privé sont crus pour `X-Forwarded-For` (`TRUST_PROXY`) : pas de contournement en usurpant une IP.
- Écritures refusées si elles viennent d'une autre origine (`Origin`, `Sec-Fetch-Site`). CSP stricte,
  `no-store` sur l'API, erreurs internes jamais détaillées au client.
- L'export collé est validé côté serveur ; 60 exports gardés par compte au plus.
- Laisse l'app joignable seulement par Nginx Proxy Manager (`APP_BIND`, pare-feu) : en HTTP direct, le cookie
  `Secure` ne passe pas et la connexion est inutilisable.

## Données et crédits

Données de jeu et images : [ClashKing Assets](https://github.com/ClashKingInc/ClashKingAssets) (GPL-3.0),
copiées par `npm run sync-data`. Merci à ClashKing.

This material is unofficial and is not endorsed by Supercell. For more information see Supercell's
Fan Content Policy: www.supercell.com/fan-content-policy.
