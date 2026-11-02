/** Backlog de la communauté : idées, bugs et modifications proposés par les joueurs. */

export const BACKLOG_KINDS = ["feature", "bug", "change"] as const;
export type BacklogKind = (typeof BACKLOG_KINDS)[number];

export const BACKLOG_STATUSES = ["open", "planned", "done", "declined"] as const;
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];

export const KIND_LABEL: Record<BacklogKind, string> = {
  feature: "Nouvelle fonctionnalité",
  bug: "Bug",
  change: "Modification",
};

export const STATUS_LABEL: Record<BacklogStatus, string> = {
  open: "Proposé",
  planned: "Prévu",
  done: "Fait",
  declined: "Pas retenu",
};

export const BACKLOG_TITLE_MAX = 120;
export const BACKLOG_BODY_MAX = 2000;
/** Propositions par joueur sur 24 h : assez pour tout dire, pas assez pour inonder la liste. */
export const BACKLOG_DAILY_MAX = 20;

export interface BacklogItem {
  id: number;
  kind: BacklogKind;
  title: string;
  body: string;
  status: BacklogStatus;
  author: string;
  /** ISO. */
  createdAt: string;
  votes: number;
  /** Le joueur connecté a voté. */
  voted: boolean;
  /** Proposé par le joueur connecté : il peut le supprimer. */
  mine: boolean;
}

const STATUS_ORDER: Record<BacklogStatus, number> = { planned: 0, open: 1, done: 2, declined: 3 };

/** Prévu puis proposé (les plus votés d'abord, puis les plus récents) ; fait et pas retenu à la fin. */
export function sortBacklog(items: BacklogItem[]): BacklogItem[] {
  return [...items].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.votes - a.votes || b.createdAt.localeCompare(a.createdAt),
  );
}
