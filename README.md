# Suivi Hammer Jam

Site pour suivre son village Clash of Clans pendant le Hammer Jam, et l'avancement de ses potes.
Chaque joueur crée un compte (pseudo + mot de passe, avec un code d'invitation), colle l'export
de son village et voit son plan : héros, bâtiments, labo, potions, achats en médailles.
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
# INVITE_CODE       : le code à donner à tes potes
docker compose up -d --build
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

### Administration

```bash
docker compose exec app node dist-server/cli.js list-users
docker compose exec -it app node dist-server/cli.js reset-password <pseudo>   # coupe aussi ses sessions
```

Sauvegarde : `docker compose exec db pg_dump -U coc coc > sauvegarde.sql`

## Sécurité

- Mots de passe hachés avec argon2id. Session : JWT HS256 dans un cookie `httpOnly`, `Secure`,
  `SameSite=Lax`, valable 30 jours, révoqué si le mot de passe est réinitialisé.
- Inscription seulement avec le code d'invitation. Connexion et inscription limitées à 10 essais par minute.
- Les écritures venant d'une autre origine que `APP_ORIGIN` sont refusées. CSP stricte, pas de script tiers.
- L'export collé est validé côté serveur avant d'être enregistré.

## Données et crédits

Données de jeu et images : [ClashKing Assets](https://github.com/ClashKingInc/ClashKingAssets) (GPL-3.0),
copiées par `npm run sync-data`. Merci à ClashKing.

This material is unofficial and is not endorsed by Supercell. For more information see Supercell's
Fan Content Policy: www.supercell.com/fan-content-policy.
