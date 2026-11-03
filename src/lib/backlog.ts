/** Backlog de la communauté : tableau kanban de tickets (idées, bugs, modifications), commentaires et captures. */

export const BACKLOG_KINDS = ["feature", "bug", "change"] as const;
export type BacklogKind = (typeof BACKLOG_KINDS)[number];

/** Colonnes du tableau, dans l'ordre. */
export const BACKLOG_STATUSES = ["backlog", "in_progress", "deployed", "validated"] as const;
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];

export const KIND_LABEL: Record<BacklogKind, string> = {
  feature: "Nouvelle fonctionnalité",
  bug: "Bug",
  change: "Modification",
};

export const STATUS_LABEL: Record<BacklogStatus, string> = {
  backlog: "Backlog",
  in_progress: "En cours",
  deployed: "Déployé",
  validated: "Validé",
};

export const BACKLOG_TITLE_MAX = 120;
export const BACKLOG_BODY_MAX = 2000;
export const COMMENT_MAX = 2000;
/** Tickets par joueur sur 24 h : assez pour tout dire, pas assez pour inonder le tableau. */
export const BACKLOG_DAILY_MAX = 20;
export const COMMENT_DAILY_MAX = 100;

/** Captures : 4 par ticket ou commentaire, réduites dans le navigateur avant l'envoi. */
export const IMAGES_MAX = 4;
export const IMAGE_BYTES_MAX = 1_500_000;
export const IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** Capture envoyée au serveur : contenu en base64, sans le préfixe « data: ». */
export interface NewImage {
  type: ImageType;
  data: string;
}

export interface BacklogItem {
  id: number;
  kind: BacklogKind;
  title: string;
  body: string;
  status: BacklogStatus;
  author: string;
  /** ISO. */
  createdAt: string;
  /** Dernier changement de colonne (ISO). */
  movedAt: string;
  votes: number;
  /** Le joueur connecté a voté. */
  voted: boolean;
  /** Créé par le joueur connecté. */
  mine: boolean;
  comments: number;
  images: number;
  /** Joueurs qui ont commenté, du premier au dernier. */
  commenters: string[];
}

export interface BacklogComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  mine: boolean;
  /** Identifiants des captures, servies par /api/backlog/images/:id. */
  images: number[];
}

/** Ticket ouvert : tout le fil de discussion. */
export interface BacklogTicket extends BacklogItem {
  imageIds: number[];
  thread: BacklogComment[];
}

/**
 * Qui déplace un ticket : l'admin, partout ; l'auteur, seulement pour valider ce qui est déployé
 * (« c'est bon chez moi ») ou le renvoyer en cours.
 */
export function canMove(item: Pick<BacklogItem, "status" | "mine">, to: BacklogStatus, admin: boolean): boolean {
  if (item.status === to) return false;
  if (admin) return true;
  return item.mine && ((item.status === "deployed" && (to === "validated" || to === "in_progress")) || (item.status === "validated" && to === "deployed"));
}

/** Backlog : les plus votés d'abord ; autres colonnes : les derniers arrivés en haut. */
export function sortColumn(items: BacklogItem[], status: BacklogStatus): BacklogItem[] {
  return items
    .filter((it) => it.status === status)
    .sort((a, b) =>
      status === "backlog" ? b.votes - a.votes || b.createdAt.localeCompare(a.createdAt) : b.movedAt.localeCompare(a.movedAt),
    );
}

/** « max_perso » → « MP », « Lulu » → « LU », « jeanLuc » → « JL ». */
export function initials(username: string): string {
  const parts = username
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : username.slice(0, 2);
  return s.toUpperCase();
}

/** Teinte stable par joueur (0-359), pour reconnaître les pastilles d'un coup d'œil. */
export function hueOf(username: string): number {
  let h = 2166136261;
  for (const c of username.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  // Angle d'or : deux pseudos proches tombent sur des teintes bien différentes.
  return Math.round((h * 137.508) % 360);
}
