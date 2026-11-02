import type { Settings } from "./plan";
import type { PlayerSummary } from "./summary";

/** Contrat entre le navigateur et le serveur (types seulement). */

export interface MeResponse {
  username: string;
}

export interface AuthConfigResponse {
  /** L'inscription demande un code d'invitation. */
  inviteRequired: boolean;
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
}

export interface ApiError {
  error: string;
}
