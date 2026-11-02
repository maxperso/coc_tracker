# Suivi Hammer Jam : cahier des charges pour Claude Code

## Objectif

Créer un site gratuit, hébergé pour un groupe d'amis. Chaque joueur colle l'export JSON de son village et voit :

- son avancement par rapport aux niveaux max de son HDV ;
- ce qu'il peut encore atteindre avant la fin du Hammer Jam, et à quelle date ;
- sa progression entre deux exports.

Avant de coder, vérifie les points listés dans « Inconnues à lever ». Ne présente jamais une estimation comme une valeur exacte.

## Architecture (v1)

- Site statique, tout le calcul côté navigateur.
- Le JSON collé ne quitte pas le navigateur : pas de compte, pas de base, pas d'analytics sur son contenu.
- Historique dans `localStorage`, indexé par tag du joueur, avec `try/catch` et export/import en fichier. Le site doit fonctionner si `localStorage` est indisponible.
- Données de jeu en fichiers JSON versionnés dans le dépôt, avec leur source, leur date et la version du jeu. Pas d'appel externe à l'exécution.
- Ne commite jamais l'export d'un ami. Les fixtures de test doivent être anonymisées.

## Saisies

**Depuis l'export :** tag, `timestamp`, bâtiments, pièges, unités, sorts, machines de siège, animaux, équipements, héros, minuteurs en cours.

**Saisies manuelles, absentes de l'export :**

| Champ | Valeurs |
|---|---|
| Boost ouvrier du Pass d'or | 0, 10, 15 ou 20 % (choix par défaut : 0) |
| Boost recherche du Pass d'or | 0, 10, 15 ou 20 % (choix par défaut : 0) |
| Ouvriers | 5 ou 6, plus ouvrier gobelin en option |
| Chercheur gobelin | oui ou non |
| Potions | ouvrier, recherche et animaux disponibles, plus rachats prévus |
| Médailles de ligue | optionnel |
| Plage de sommeil | optionnel |

Garde deux champs distincts pour le Pass d'or : Supercell documente un boost ouvrier et un boost recherche séparés. Propose une case « même valeur pour les deux ». Ne déduis jamais le pourcentage de `boosts.builder_boost` : son sens est inconnu.

## Règles du Jam (`config/hammer-jam-2026.json`)

```json
{
  "start": "2026-11-01T08:00:00Z",
  "end": "2026-11-16T08:00:00Z",
  "timeReduction": 0.5,
  "costReduction": 0.5,
  "excluded": ["supercharges", "crafted_defenses"],
  "homeVillageOnly": true,
  "collectors": { "production": 2, "capacity": 2 }
}
```

## Calculs

### Durée et coût d'un nouveau chantier

```text
g = boost Pass d'or du type concerné (0, 0.10, 0.15 ou 0.20)
pendant le Jam : valeur = base × 0.5 × (1 - g)
hors Jam :       valeur = base × (1 - g)
```

| Pass d'or | Facteur pendant le Jam | Réduction totale |
|---:|---:|---:|
| 0 % | 0,500 | 50 % |
| 10 % | 0,450 | 55 % |
| 15 % | 0,425 | 57,5 % |
| 20 % | 0,400 | 60 % |

Le cas de 60 % à 20 % vient d'un guide communautaire. Les règles exactes de cumul et d'arrondi ne sont pas documentées officiellement : garde ces paramètres modifiables et compare-les au jeu.

### Portée du Pass d'or

- Boost ouvrier : bâtiments et héros, selon le support Supercell.
- Boost recherche : troupes, sorts et machines de siège, selon le support Supercell.
- Animaux, équipements, forge, supercharges et défenses artisanales : portée non confirmée. Par défaut, n'applique aucun boost et affiche « non confirmé ».

### Chantiers déjà en cours

Utilise le `timer` de l'export tel quel, sans y réappliquer le Jam ni le Pass d'or. Convertis-le en temps restant à partir de `timestamp`, et non de l'heure actuelle.

### Capacité jusqu'à la fin du Jam

```text
T = heures entre export.timestamp et la fin du Jam
capacité d'un ouvrier = T + 9 × potions_ouvrier_utiles
capacité du labo      = T + 23 × potions_recherche_utiles
capacité des animaux  = T + 23 × potions_animaux_utiles
```

- Une potion d'ouvrier agit sur tous les ouvriers actifs pendant 1 h, à vitesse ×10.
- Une potion de recherche ou d'animaux agit pendant 1 h, à vitesse ×24.
- Le gain des potions ne dépend pas du Pass d'or : c'est la durée des chantiers qui baisse.
- Stock max : 5 de chaque. Le simulateur doit respecter ce plafond.
- Un chantier lancé avant la fin garde sa durée réduite. Après la fin, le temps restant s'écoule sans potion, sauf si l'utilisateur en prévoit.

### Prix en médailles (à vérifier en jeu)

- Potion d'ouvrier : 30
- Potion de recherche : 20
- Marteaux de combat, construction et sorts : 120
- Marteau de héros : 165, avec 7 jours d'attente avant de racheter le même marteau
- Potion d'animaux : non vendue en médailles
- Plafond de médailles : 2 500

### Contrôles

Avec un export à `T = 332,8 h` :

- 55 potions d'ouvrier : 34,5 jours de travail par ouvrier ;
- 45 potions de recherche : 57 jours de labo ;
- 5 potions d'animaux : 18,7 jours.

Sur un niveau de base de 8 jours : 4 j à 0 %, 3,6 j à 10 %, 3,4 j à 15 %, 3,2 j à 20 %.

## Écrans

1. **Coller mon JSON** : validation, aperçu du tag et de l'HDV, message clair si le format est inconnu.
2. **Avancement** : pourcentage par catégorie, niveaux restants, éléments à l'arrêt.
3. **Prévision** : Gantt en heure de Paris, ligne de fin du Jam, niveaux atteints, date de fin et ressources nécessaires.
4. **Comparaison** : effet du Pass d'or à 0, 10, 15 et 20 %, et de plusieurs répartitions des médailles.
5. **Historique** : gains entre deux exports.
6. **À propos** : sources, version des données, limites, mention légale.

## Sécurité

- Lis l'export avec `JSON.parse` seulement, jamais `eval`.
- Limite la taille collée et valide le schéma avec une bibliothèque dédiée.
- Échappe tout champ affiché et n'utilise jamais `innerHTML` avec des données collées.
- Ajoute une CSP stricte et aucun script tiers inutile.
- Affiche clairement : « Ton JSON reste dans ton navigateur. »

## Politique Supercell

- Affiche : « This material is unofficial and is not endorsed by Supercell. For more information see Supercell's Fan Content Policy: www.supercell.com/fan-content-policy. »
- Ne fais rien payer. Seuls publicité, dons sans avantage et coaching sont autorisés.
- N'utilise pas de nom de domaine ou de compte social contenant une marque Supercell.
- Ne modifie pas les ressources graphiques de Supercell.
- Ne laisse pas penser que le site est officiel.

## Données et sprites

Source principale : le dépôt [ClashKingAssets](https://github.com/ClashKingInc/ClashKingAssets) (GPLv3, crédit demandé). Copie les fichiers utiles dans le projet, avec le commit d'origine.

- `assets/static_data.json` : ID (`_id`), noms, niveaux, coûts et durées, à relier aux champs `data` de l'export. Toutes les catégories testées de l'export ont été reconnues.
- Sur une ligne de niveau N, `upgrade_time` (en secondes) et `upgrade_cost` servent à passer de N à N+1. Exemple : Roi 103 = 691 200 s, soit 8 jours de base, et 430 000 d'élixir noir. La ligne du niveau max vaut 0.
- Le niveau max s'obtient à partir de `required_townhall` sur chaque ligne.
- Chemins des sprites, à partir du nom nettoyé : `heroes/{nom}/icon.webp`, `troops/{nom}/icon.webp`, `spells/{nom}.webp`, `pets/{nom}/icon.webp`, `equipment/{nom}.webp`, `buildings/home-village/{nom}/level_{niveau}.webp`, `traps/home-village/{nom}/level_{niveau}.webp`.
- Nettoyage du nom : minuscules, espaces remplacés par `_`, sans points, `?` ni `’`. L'apostrophe droite reste (`builder's_hut`).
- Le [fan kit Supercell](https://fankit.supercell.com/d/vkEdmkUCngKw/game-assets) peut compléter les images manquantes ou en meilleure qualité.
- 177 sprites sur 180 ont été trouvés pour l'export test. Manquants : `B.O.B's Hut`, `Blacksmith` niveau 10 et `Helper Hut`. Prévois une image de repli.

## Inconnues à lever

1. Les données de ClashKing correspondent-elles aux minuteurs réels du jeu ? Vérifie sur plusieurs chantiers lancés.
2. Tout ID inconnu doit être signalé sans être deviné, surtout après la sortie de l'HDV 19.
3. Que signifient `extra`, `helper_timer`, `helper_recurrent`, `helper_cooldown`, `gear_up` et `builder_boost` ?
4. Comment le jeu arrondit-il les durées et les coûts avec le Jam et le Pass d'or ?
5. Le Pass d'or s'applique-t-il aux animaux et aux équipements ?
6. Un chantier garde-t-il sa durée réduite si le Pass d'or expire pendant son déroulement ?
7. Les murs exigent-ils un ouvrier libre au moment de l'achat ? Vérifie-le en jeu avant de modéliser.
8. Quelle licence s'applique aux données de `coc.py` et à `clash-of-clans-data` ? Peut-on les redistribuer ?
9. Que change l'HDV 19 pour les niveaux max et les durées ? Prévois une mise à jour des données dès sa sortie.

## Tests

- Tests unitaires : facteurs du Pass d'or, conversion des minuteurs, capacité avec potions, fin de chantier après le Jam, fuseau de Paris.
- Fixtures : export valide, export incomplet, ID inconnu, JSON invalide, HDV sans héros.
- Test réel : prédire un niveau et un minuteur, refaire un export après la fin du chantier, puis comparer.
- Tant que les données exactes manquent, affiche « Estimation » sur chaque prévision.

## Sources

### Officielles

- [Supercell : Hammer Jam Is Here](https://supercell.com/en/games/clashofclans/blog/news/hammer-jam-is-here-backup-has-arrived/) : dates, réductions, exclusions, collecteurs.
- [Supercell : Clash of Titans](https://supercell.com/en/games/clashofclans/blog/news/clash-of-titans-is-hot-off-the-press/) : calendrier de novembre, Pass d'or, Ligue de clans, HDV 19.
- [Support Supercell : Pass d'or](https://ingame.support.supercell.com/clash-of-clans/en/articles/gold-pass.html) : boosts ouvrier et recherche, durée de validité.
- [Supercell : Hammer Jam 2025](https://supercell.com/en/games/clashofclans/blog/news/hammer-jam-kickstarts-the-november-season) : référence de l'édition précédente.
- [Supercell : Fan Content Policy](https://supercell.com/fan-content-policy) : règles pour un site de fan.

### Données et développement

- [coc.py : système de données statiques](https://deepwiki.com/mathsman5133/coc.py/9-static-game-data-system) : champs d'amélioration, fichiers.
- [coc.py : fichiers et mises à jour](https://deepwiki.com/mathsman5133/coc.py/9.2-static-data-files-and-updates) : `coc/static/`, script de mise à jour.
- [clash-of-clans-data](https://github.com/chiefpansancolt/clash-of-clans-data/) : données typées, recherche par ID, MIT.
- [ClashKing Assets](https://github.com/ClashKingInc/ClashKingAssets/wiki) : images, crédit demandé.

### Guides communautaires

- [Clash Ninja : Data Export](https://www.clash.ninja/blog/one-tap-village-updating-is-here) : procédure et limites de l'export.
- [Clash Ninja : objets magiques](https://www.clash.ninja/guides/what-are-magic-items) : effets, stocks, prix.
- [Clash Ninja : Hammer Jam](https://www.clash.ninja/guides/when-is-hammer-jam) : cumul avec le Pass d'or, conseils.
- [Clash Ninja : temps pour maxer l'HDV 18](https://www.clash.ninja/guides/how-long-to-max-th-18) : totaux par catégorie.
- [Clash Ninja : suivi d'améliorations](https://www.clash.ninja/upgrade-tracker/overview) : outil existant à comparer.
- [Clash Guides With Dusk : niveaux max HDV 18](https://clashguideswithdusk.net/2026/07/th18-max-levels-list-clash-of-clans/) : niveaux max à recouper.
- [Blueprint : Hammer Jam 2024](https://blueprintcoc.com/blogs/clash-of-clans-event/hammer-jam-2024) : exemple de cumul à 60 %.
- [Blueprint : guide Hammer Jam](https://blueprintcoc.com/blogs/clash-of-clans-guides/best-hammer-jam-upgrade-guide) : cumul avec le Pass d'or.
- [Blueprint : héros en amélioration](https://blueprintcoc.com/blogs/clash-of-clans-guides/how-to-upgrade-heroes-without-missing-wars) : indisponibilité des héros.
- [TrophyCoach : préparation du Hammer Jam](https://trophycoach.com/clash-of-clans/guides/clash-of-clans-hammer-jam-2026-town-hall-19-prep-guide) : potions et marteaux.
- [Fandom : potions et marteaux](https://clashofclans.fandom.com/f/u/45636566) : calculs d'un joueur, Jam précédent.
- [CoC Base Drop : médailles de ligue](https://cocbasedrop.com/blog/cwl-medals-best-way-to-spend-them-2026) : plafond et prix.
- [Gaming on Phone : stratégies HDV 18](https://gamingonphone.com/guides/clash-of-clans-town-hall-18-best-war-and-farming-attack-strategies-tips/) : armées de farm.
- [Clash Ninja : mise à jour d'octobre 2025](https://www.clash.ninja/blog/october-2025-update-is-live) : Batailles illimitées.