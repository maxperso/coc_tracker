import { api } from "./client";

/** Événement d'installation de Chrome/Edge/Android, gardé pour proposer « Installer l'app » plus tard. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let installPrompt: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/** Appelé quand l'état d'installation ou de notification change, pour redessiner l'écran. */
export function onPwaChange(f: () => void): void {
  listeners.add(f);
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Sans service worker, le site marche quand même (pas de hors-ligne ni de rappels).
    });
  });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e as InstallPrompt;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    notify();
  });
}

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const canInstall = () => installPrompt != null;

export async function install(): Promise<boolean> {
  if (!installPrompt) return false;
  await installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  notify();
  return outcome === "accepted";
}

/* ---------- Notifications push ---------- */

export type PushState =
  | "unsupported" // navigateur sans push
  | "needs-install" // iPhone : il faut d'abord installer le site
  | "disabled" // serveur sans clés VAPID
  | "denied" // refusé dans le navigateur
  | "off"
  | "on";

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

let serverConfig: { enabled: boolean; publicKey: string | null } | null = null;
async function config() {
  serverConfig ??= await api.pushConfig().catch(() => ({ enabled: false, publicKey: null }));
  return serverConfig;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  if (!(await config()).enabled) return "disabled";
  if (Notification.permission === "denied") return "denied";
  return (await currentSubscription()) ? "on" : "off";
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Demande l'autorisation, abonne cet appareil et l'enregistre sur le serveur. */
export async function enablePush(): Promise<PushState> {
  const cfg = await config();
  if (!cfg.enabled || !cfg.publicKey) return "disabled";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(cfg.publicKey) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.pushSubscribe(json);
  notify();
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const sub = await currentSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  notify();
  return "off";
}

/* ---------- Presse-papiers ---------- */

export const canReadClipboard = () => typeof navigator.clipboard?.readText === "function";
