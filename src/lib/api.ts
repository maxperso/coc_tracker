import type { BacklogItem } from "./backlog";
import type { Settings } from "./plan";
import type { PlayerSummary } from "./summary";

/** Contrat entre le navigateur et le serveur (types seulement). */

export interface MeResponse {
  username: string;
  /** Administrateur : déplace et modère les tickets du backlog. */
  admin: boolean;
  /** Emails quand un de ses tickets est déployé ou commenté. */
  backlogEmails: boolean;
}

export interface AuthConfigResponse {
  /** L'inscription demande un code d'invitation. */
  inviteRequired: boolean;
  /** Mode dev : pseudo du compte de test connecté d'office ; null en production. */
  devLogin: string | null;
}

/** Réponse quand un code vient (peut-être) de partir par email. */
export interface PendingResponse {
  pending: true;
  username: string;
  message: string;
}

export interface PlayerRow {
  username: string;
  summary: PlayerSummary;
  /** Date d'envoi du dernier export (ISO). */
  updatedAt: string;
}

/** Actions du plan cochées « fait », pour un export donné. */
export interface PlanChecks {
  /** Secondes Unix de l'export auquel se rapportent les coches. */
  exportAt: number;
  keys: string[];
}

export interface PushConfigResponse {
  enabled: boolean;
  publicKey: string | null;
}

export interface StoredExport {
  /** Export tel que collé dans le jeu (objet JSON). */
  raw: unknown;
  exportedAt: string;
}

export interface PlayerProfile {
  username: string;
  settings: Settings;
  /** Exports du plus ancien au plus récent (30 au plus). */
  exports: StoredExport[];
  /** Coches du plan ; à ignorer si elles concernent un autre export que le dernier. */
  checks: PlanChecks | null;
}

/** « Quoi de neuf ? » : dernière mise à jour vue, tickets déployés depuis la dernière lecture. */
export interface WhatsNewResponse {
  seenRelease: number;
  tickets: BacklogItem[];
  /** Instant de la liste, renvoyé tel quel pour la marquer lue. */
  asOf: string;
}

export interface ApiError {
  error: string;
}
