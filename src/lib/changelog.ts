/**
 * Journal des mises à jour, affiché une fois à chaque joueur dans « Quoi de neuf ? ».
 * À chaque déploiement visible : une nouvelle entrée en tête, avec un `id` plus grand que le précédent.
 */
export type ChangeKind = "feature" | "bug" | "ui";

export const CHANGE_LABEL: Record<ChangeKind, string> = {
  feature: "Nouveautés",
  bug: "Corrections",
  ui: "Interface",
};

export interface Release {
  id: number;
  /** Jour de la mise à jour, « 2026-11-03 ». */
  date: string;
  changes: { kind: ChangeKind; text: string }[];
}

export const CHANGELOG: Release[] = [
  {
    id: 12,
    date: "2026-11-04",
    changes: [
      { kind: "feature", text: "HDV en dessous de 18 : le plan monte l'HDV, le labo et la salle des héros quand c'est rentable, construit les bâtiments qui te manquent, et ajoute les niveaux débloqués au fil du Jam. Il compare deux ordres et garde celui qui finit le Jam avec la meilleure complétion du jeu." },
    ],
  },
  {
    id: 11,
    date: "2026-11-03",
    changes: [
      { kind: "bug", text: "Potions à acheter : le plan supposait 5 potions de chaque en stock. Ton stock est maintenant demandé à chaque export (l'export du jeu ne le contient pas) et affiché sur chaque ligne de potions." },
    ],
  },
  {
    id: 10,
    date: "2026-11-03",
    changes: [
      { kind: "ui", text: "Dans le plan, touche une amélioration (« Lance Roi 105 → 106 ») pour ouvrir sa fiche : durée et coût de chaque niveau, et quand le plan les lance." },
    ],
  },
  {
    id: 9,
    date: "2026-11-03",
    changes: [
      { kind: "feature", text: "Coche une action au moment où tu la fais : tu confirmes l'heure (et combien de potions tu as bues), et la suite du plan se recale sur ce que tu as vraiment fait. Les potions non bues sont reportées sur les jours suivants." },
    ],
  },
  {
    id: 8,
    date: "2026-11-03",
    changes: [
      { kind: "feature", text: "Progression : héros, bâtiments, labo et animaux en détail. Touche un élément pour voir ses prochains niveaux : durée et coût pendant le Jam, ce qu'il faut pour les débloquer, et quand ton plan les lance (merci Axel pour l'idée)." },
      { kind: "feature", text: "Un email (et une notification si les rappels sont actifs) quand ton ticket du backlog passe en Déployé ou reçoit un commentaire. Désactivable dans Mon compte." },
      { kind: "bug", text: "Rappels sur iPhone : Apple refusait l'adresse de contact du serveur. Le bouton « Envoyer un test » dit maintenant ce qui s'est passé." },
    ],
  },
  {
    id: 7,
    date: "2026-11-03",
    changes: [
      { kind: "bug", text: "Classement des amis : par HDV d'abord, puis par complétion du jeu. Un HDV 17 ne passe plus devant un HDV 18." },
      { kind: "ui", text: "Page Progression refaite : complétion du jeu et de l'HDV, le labo sur la courbe, chaque catégorie avant et après le Jam, et le détail de chaque troupe, sort et animal." },
    ],
  },
  {
    id: 5,
    date: "2026-11-03",
    changes: [
      { kind: "feature", text: "Deux complétions : celle de ton HDV et celle du jeu entier. Le classement des amis se fait sur le jeu entier : un HDV 17 au max ne passe plus devant un HDV 18." },
      { kind: "bug", text: "Les bâtiments fusionnés (canon ricochet, tour multi-archers, tour multi-armes, super tour de sorciers) et l'aigle absorbé par l'HDV 17 sont bien comptés dans le pourcentage." },
    ],
  },
  {
    id: 4,
    date: "2026-11-03",
    changes: [
      { kind: "bug", text: "Achats recommandés en Hybride et Perso : plus de marteaux de héros payés par des dizaines de niveaux de bâtiments. Le plan vise le plus de niveaux au total." },
      { kind: "bug", text: "Toutes les potions achetées sont maintenant placées dans le plan, même quand le dernier jour du Jam est trop court pour en boire beaucoup." },
    ],
  },
  {
    id: 3,
    date: "2026-11-03",
    changes: [{ kind: "ui", text: "Une fois connecté, tu arrives directement sur ton dashboard. La page d'accueil reste à un clic, sur le logo." }],
  },
  {
    id: 2,
    date: "2026-11-03",
    changes: [
      { kind: "ui", text: "Nouvel export : tes réglages sont gardés. Plus de questionnaire, juste tes médailles de ligue à confirmer (merci Axel pour l'idée)." },
    ],
  },
  {
    id: 1,
    date: "2026-11-03",
    changes: [
      { kind: "feature", text: "Page Commu : tes amis, et un backlog en tableau (Backlog, En cours, Déployé, Validé) pour proposer des idées, signaler des bugs, voter, commenter et joindre des captures." },
      { kind: "feature", text: "Stratégie « Perso » : classe toi-même héros, bâtiments, labo et animaux, de A à Z, et mets ce que tu veux en pause." },
      { kind: "feature", text: "Ligue de clans : tes 4 héros restent libres à ton heure d'attaque, le plan s'adapte et te rappelle l'attaque." },
      { kind: "feature", text: "Le coût de chaque lancement (or, élixir, élixir noir) s'affiche dans le plan et dans « À faire maintenant »." },
      { kind: "bug", text: "Les cases cochées « fait » ne se perdent plus quand tu repars dans le jeu juste après." },
      { kind: "bug", text: "L'en-tête ne déborde plus sur la navigation, et le dashboard ne dépasse plus sur l'app installée." },
      { kind: "ui", text: "Le choix du plan (Héros, Bâtiments, Hybride, Perso) se fait directement sur le dashboard." },
      { kind: "ui", text: "Animations douces à l'ouverture des pages et au survol des boutons." },
    ],
  },
];

export const LATEST_RELEASE = Math.max(0, ...CHANGELOG.map((r) => r.id));

/**
 * Mises à jour pas encore vues, la plus récente d'abord. Celles d'un même jour sont regroupées :
 * le joueur voit une seule « mise à jour du 3 novembre ».
 */
export function unseenReleases(seen: number): Release[] {
  const out: Release[] = [];
  for (const r of CHANGELOG.filter((x) => x.id > seen).sort((a, b) => b.id - a.id)) {
    const sameDay = out.find((x) => x.date === r.date);
    if (sameDay) sameDay.changes = [...sameDay.changes, ...r.changes];
    else out.push({ ...r, changes: [...r.changes] });
  }
  return out;
}
