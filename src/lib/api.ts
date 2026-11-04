import type { BacklogItem } from "./backlog";
import type { Fact } from "./facts";
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
  /** Heure réelle (et potions bues) confirmée en cochant, par action. */
  facts?: Record<string, Fact>;
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
  /** Village affiché (tag CoC). */
  tag: string | null;
  /** Tous les comptes CoC de ce joueur, le plus récent d'abord. */
  villages: VillageInfo[];
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

/** Panneau admin : comptes, connexions récentes, joueurs actifs par jour. */
export interface AdminUser {
  username: string;
  email: string | null;
  admin: boolean;
  verified: boolean;
  createdAt: string;
  /** Dernière requête faite connecté (ISO), à 2 minutes près. */
  lastSeenAt: string | null;
  lastLogin: { at: string; device: string; method: string } | null;
  /** Jours avec au moins une visite, sur 7 et 30 jours. */
  days7: number;
  days30: number;
  logins30: number;
  lastExportAt: string | null;
  th: number | null;
  pushDevices: number;
  backlogEmails: boolean;
}

export interface AdminOverview {
  /** Instant du serveur (ISO), pour « il y a 3 min ». */
  now: string;
  users: AdminUser[];
  logins: { username: string; at: string; device: string; method: string }[];
  /** 30 derniers jours, du plus ancien au plus récent (jour de Paris). */
  daily: { day: string; active: number; logins: number }[];
}

/** Un compte CoC (village) rattaché au compte COC Tracker. */
export interface VillageInfo {
  tag: string;
  th: number;
  /** Dernier export (ISO). */
  updatedAt: string;
}
