import type { BacklogItem, BacklogKind, BacklogStatus, BacklogTicket, NewImage } from "./backlog";
import type { AuthConfigResponse, WhatsNewResponse, MeResponse, PendingResponse, PlanChecks, PlayerProfile, PlayerRow, PushConfigResponse } from "./api";
import type { Settings } from "./plan";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Corps de la réponse d'erreur (ex. needsVerification). */
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** `keepalive` : l'envoi se termine même si la page passe en arrière-plan ou se ferme. */
async function call<T>(method: string, url: string, body?: unknown, keepalive = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive,
    });
  } catch {
    throw new ApiError("Serveur injoignable. Vérifie ta connexion.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Erreur ${res.status}`, res.status, data as Record<string, unknown>);
  return data as T;
}

export const api = {
  me: () => call<MeResponse>("GET", "/api/auth/me"),
  authConfig: () => call<AuthConfigResponse>("GET", "/api/auth/config"),
  login: (username: string, password: string) => call<MeResponse>("POST", "/api/auth/login", { username, password }),
  register: (d: { username: string; email: string; password: string; inviteCode: string }) =>
    call<PendingResponse>("POST", "/api/auth/register", { ...d, inviteCode: d.inviteCode || undefined }),
  verify: (username: string, code: string) => call<MeResponse>("POST", "/api/auth/verify", { username, code }),
  resend: (username: string) => call<PendingResponse>("POST", "/api/auth/resend", { username }),
  forgot: (email: string) => call<PendingResponse>("POST", "/api/auth/forgot", { email }),
  reset: (email: string, code: string, password: string) => call<MeResponse>("POST", "/api/auth/reset", { email, code, password }),
  logout: () => call<{ ok: true }>("POST", "/api/auth/logout"),
  logoutAll: () => call<{ ok: true }>("POST", "/api/auth/logout-all"),
  settings: () => call<Settings>("GET", "/api/me/settings"),
  saveSettings: (s: Settings, keepalive = false) => call<Settings>("PUT", "/api/me/settings", s, keepalive),
  uploadExport: (text: string) => call<{ ok: true }>("POST", "/api/exports", { text }),
  players: () => call<PlayerRow[]>("GET", "/api/players"),
  profile: (username: string) => call<PlayerProfile>("GET", `/api/players/${encodeURIComponent(username)}`),
  saveChecks: (c: PlanChecks, keepalive = false) => call<PlanChecks>("PUT", "/api/me/checks", c, keepalive),
  pushConfig: () => call<PushConfigResponse>("GET", "/api/push/config"),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) => call<{ ok: true }>("POST", "/api/push/subscribe", sub),
  pushUnsubscribe: (endpoint: string) => call<{ ok: true }>("POST", "/api/push/unsubscribe", { endpoint }),
  pushTest: () => call<{ sent: number; failed: { service: string; status?: number; reason: string }[] }>("POST", "/api/push/test", {}),
  setEmails: (backlog: boolean) => call<{ backlog: boolean }>("PUT", "/api/me/emails", { backlog }),
  whatsNew: () => call<WhatsNewResponse>("GET", "/api/me/whats-new"),
  whatsNewSeen: (release: number, asOf: string) => call<{ ok: true }>("POST", "/api/me/whats-new/seen", { release, asOf }),
  backlog: () => call<BacklogItem[]>("GET", "/api/backlog"),
  ticket: (id: number) => call<BacklogTicket>("GET", `/api/backlog/${id}`),
  addTicket: (d: { kind: BacklogKind; title: string; body: string; images: NewImage[] }) => call<BacklogTicket>("POST", "/api/backlog", d),
  voteTicket: (id: number, vote: boolean) => call<BacklogItem>("PUT", `/api/backlog/${id}/vote`, { vote }),
  moveTicket: (id: number, status: BacklogStatus) => call<BacklogItem>("PUT", `/api/backlog/${id}/status`, { status }),
  deleteTicket: (id: number) => call<{ ok: true }>("DELETE", `/api/backlog/${id}`),
  addComment: (id: number, d: { body: string; images: NewImage[] }) => call<BacklogTicket>("POST", `/api/backlog/${id}/comments`, d),
  deleteComment: (id: number) => call<BacklogTicket>("DELETE", `/api/backlog/comments/${id}`),
};
