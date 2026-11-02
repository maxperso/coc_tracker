import type { MeResponse, PlayerProfile, PlayerRow } from "./api";
import type { Settings } from "./plan";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Serveur injoignable. Vérifie ta connexion.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Erreur ${res.status}`, res.status);
  return data as T;
}

export const api = {
  me: () => call<MeResponse>("GET", "/api/auth/me"),
  login: (username: string, password: string) => call<MeResponse>("POST", "/api/auth/login", { username, password }),
  register: (username: string, password: string, inviteCode: string) =>
    call<MeResponse>("POST", "/api/auth/register", { username, password, inviteCode }),
  logout: () => call<{ ok: true }>("POST", "/api/auth/logout"),
  settings: () => call<Settings>("GET", "/api/me/settings"),
  saveSettings: (s: Settings) => call<Settings>("PUT", "/api/me/settings", s),
  uploadExport: (text: string) => call<{ ok: true }>("POST", "/api/exports", { text }),
  players: () => call<PlayerRow[]>("GET", "/api/players"),
  profile: (username: string) => call<PlayerProfile>("GET", `/api/players/${encodeURIComponent(username)}`),
};
