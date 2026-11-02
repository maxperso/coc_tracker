import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./styles.css";

import type { PlayerProfile, PlayerRow } from "./lib/api";
import { api, ApiError } from "./lib/client";
import { parseExport } from "./lib/exportParse";
import { gameIndex } from "./lib/gamedata";
import { snapshotOf, type Snapshot } from "./lib/history";
import { DEFAULT_SETTINGS, type Settings } from "./lib/plan";
import { effectiveSettings } from "./lib/recommend";
import { buildVillage, type Village } from "./lib/village";
import { authView, type AuthMode } from "./ui/auth";
import { dashboardView, tabsFor, type Tab } from "./ui/dashboard";
import { h } from "./ui/dom";
import { homeView } from "./ui/home";
import { legalFooter } from "./ui/legal";
import { onboardingView } from "./ui/onboarding";
import { playersView } from "./ui/players";
import { settingsDialog } from "./ui/settings";

type View = "loading" | "auth" | "home" | "onboarding" | "dash" | "players" | "profile";

interface Loaded {
  village: Village;
  history: Snapshot[];
}

const state: {
  view: View;
  me: string | null;
  auth: { mode: AuthMode; error?: string; busy: boolean };
  homeError?: string;
  settings: Settings;
  samePass: boolean;
  mine: Loaded | null;
  /** Nouvel export : le formulaire de stratégie redemande les médailles. */
  newExport: boolean;
  tab: Tab;
  players: { rows: PlayerRow[] | null; error?: string };
  friend: (Loaded & { username: string; settings: Settings }) | null;
  friendTab: Tab;
} = {
  view: "loading",
  me: null,
  auth: { mode: "login", busy: false },
  settings: structuredClone(DEFAULT_SETTINGS),
  samePass: true,
  mine: null,
  newExport: false,
  tab: "summary",
  players: { rows: null },
  friend: null,
  friendTab: "summary",
};

const root = document.getElementById("app")!;
let dialog: HTMLDialogElement | null = null;

/** Recommandation d'achats mise en cache : elle ne change qu'avec l'export ou les réglages. */
const effCache = new Map<string, ReturnType<typeof effectiveSettings>>();
function effective(v: Village, s: Settings) {
  const key = `${v.tag}:${v.timestamp}:${JSON.stringify(s)}`;
  let value = effCache.get(key);
  if (!value) {
    if (effCache.size > 20) effCache.clear();
    value = effectiveSettings(v, s);
    effCache.set(key, value);
  }
  return value;
}

/** Exports du serveur → village le plus récent et historique pour la courbe et les gains. */
function loadProfile(p: PlayerProfile): Loaded | null {
  const villages = p.exports.flatMap((e) => {
    const r = parseExport(JSON.stringify(e.raw));
    return r.ok ? [buildVillage(r.value, gameIndex())] : [];
  });
  const village = villages.at(-1);
  return village ? { village, history: villages.map(snapshotOf) } : null;
}

/** Session expirée : retour à l'écran de connexion. */
function handleError(e: unknown): string {
  if (e instanceof ApiError && e.status === 401) {
    state.me = null;
    state.view = "auth";
    state.auth = { mode: "login", busy: false, error: "Ta session a expiré, reconnecte-toi." };
    render();
  }
  return e instanceof Error ? e.message : "Erreur inattendue.";
}

async function loadMine(): Promise<void> {
  const [settings, profile] = await Promise.all([api.settings(), api.profile(state.me!)]);
  state.settings = settings;
  state.mine = loadProfile(profile);
  state.view = state.mine ? "dash" : "home";
}

async function boot(): Promise<void> {
  try {
    state.me = (await api.me()).username;
    await loadMine();
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) state.auth.error = handleError(e);
    state.view = "auth";
  }
  render();
}

async function submitAuth(data: { username: string; password: string; inviteCode: string }) {
  state.auth = { ...state.auth, busy: true, error: undefined };
  render();
  try {
    const r = state.auth.mode === "register" ? await api.register(data.username, data.password, data.inviteCode) : await api.login(data.username, data.password);
    state.me = r.username;
    state.auth = { mode: "login", busy: false };
    await loadMine();
  } catch (e) {
    state.auth = { ...state.auth, busy: false, error: e instanceof Error ? e.message : "Erreur inattendue." };
  }
  render();
}

async function submitExport(text: string) {
  const local = parseExport(text.trim());
  if (!local.ok) {
    state.homeError = local.error;
    render();
    document.getElementById("export-input")?.focus();
    return;
  }
  try {
    await api.uploadExport(text.trim());
    const profile = await api.profile(state.me!);
    state.mine = loadProfile(profile);
    state.homeError = undefined;
    state.newExport = true;
    state.tab = "summary";
    state.view = "onboarding";
  } catch (e) {
    state.homeError = handleError(e);
  }
  render();
  window.scrollTo(0, 0);
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Réglages : affichés tout de suite, enregistrés sur le serveur un instant plus tard. */
function setSettings(next: Settings, immediate = false): Promise<void> {
  state.settings = next;
  render();
  clearTimeout(saveTimer);
  const save = () => api.saveSettings(next).then(() => {}, (e) => void handleError(e));
  if (immediate) return save();
  saveTimer = setTimeout(save, 600);
  return Promise.resolve();
}

async function loadPlayers() {
  try {
    state.players = { rows: await api.players() };
  } catch (e) {
    state.players = { rows: null, error: handleError(e) };
  }
  render();
}

async function openPlayer(username: string) {
  if (username.toLowerCase() === state.me?.toLowerCase()) {
    state.view = state.mine ? "dash" : "home";
    state.tab = "summary";
    render();
    return;
  }
  try {
    const p = await api.profile(username);
    const loaded = loadProfile(p);
    if (!loaded) return;
    state.friend = { ...loaded, username: p.username, settings: p.settings };
    state.friendTab = "summary";
    state.view = "profile";
  } catch (e) {
    state.players = { ...state.players, error: handleError(e) };
  }
  render();
  window.scrollTo(0, 0);
}

async function logout() {
  await api.logout().catch(() => {});
  state.me = null;
  state.mine = null;
  state.friend = null;
  state.players = { rows: null };
  state.view = "auth";
  state.auth = { mode: "login", busy: false };
  render();
}

function goTab(t: Tab) {
  state.tab = t;
  if (t === "players") void loadPlayers();
  render();
  window.scrollTo(0, 0);
}

/** Classement seul, pour qui n'a pas encore envoyé d'export. */
function playersPage(): HTMLElement {
  return h(
    "main",
    { class: "page" },
    h(
      "div",
      { class: "section-head" },
      h("div", null, h("h1", { class: "title" }, "Potes"), h("p", { class: "lead" }, "Classés par avancement du village.")),
      h("button", { type: "button", class: "btn btn-ghost", onClick: () => ((state.view = "home"), render()) }, "Coller mon export"),
    ),
    playersView({ ...state.players, me: state.me!, onOpen: (u) => void openPlayer(u) }),
    legalFooter(),
  );
}

function render(): void {
  const wasOpen = dialog?.open ?? false;
  const focusedId = (document.activeElement as HTMLElement | null)?.id;
  const openDetails = new Set([...root.querySelectorAll("details[open] h2")].map((e) => e.textContent));
  root.replaceChildren();
  dialog?.remove();
  dialog = null;

  switch (state.view) {
    case "loading":
      root.append(h("main", { class: "page home" }, h("p", { class: "muted center" }, "Chargement…")));
      return;
    case "auth":
      root.append(
        authView({
          ...state.auth,
          onMode: (mode) => ((state.auth = { mode, busy: false }), render()),
          onSubmit: (d) => void submitAuth(d),
        }),
      );
      return;
    case "home":
      root.append(
        homeView({
          error: state.homeError,
          onSubmit: (t) => void submitExport(t),
          onPlayers: () => {
            state.view = "players";
            void loadPlayers();
          },
          onCancel: state.mine ? () => ((state.view = "dash"), render()) : undefined,
          onLogout: () => void logout(),
        }),
      );
      return;
    case "players":
      root.append(playersPage());
      return;
    case "onboarding":
      if (!state.mine) {
        state.view = "home";
        return render();
      }
      root.append(
        onboardingView({
          village: state.mine.village,
          settings: state.settings,
          canCancel: !state.newExport,
          askMedals: state.newExport,
          onDone: (next) => {
            state.newExport = false;
            state.view = "dash";
            state.tab = "summary";
            void setSettings(next, true);
            window.scrollTo(0, 0);
          },
          onCancel: () => ((state.view = "dash"), render()),
        }),
      );
      return;
  }

  const friend = state.view === "profile" ? state.friend : null;
  const loaded = friend ?? state.mine;
  if (!loaded) {
    state.view = "home";
    return render();
  }
  const settings = friend ? friend.settings : state.settings;
  const eff = effective(loaded.village, settings);
  const owner = friend ? friend.username : state.me!;
  const tab = friend ? state.friendTab : state.tab;
  if (!tabsFor(settings, !!friend).includes(tab)) {
    if (friend) state.friendTab = "summary";
    else state.tab = "summary";
    return render();
  }

  const view = dashboardView({
    village: loaded.village,
    settings: eff.settings,
    purchase: eff.purchase,
    history: loaded.history,
    me: state.me!,
    owner,
    players: state.players,
    tab,
    onTab: (t) => {
      if (friend) {
        state.friendTab = t;
        render();
        window.scrollTo(0, 0);
      } else goTab(t);
    },
    onStrategy: () => {
      state.view = "onboarding";
      render();
      window.scrollTo(0, 0);
    },
    onSettings: () => dialog?.showModal(),
    onNewExport: () => ((state.view = "home"), render()),
    onOpenPlayer: (u) => void openPlayer(u),
    onBack: () => {
      state.view = state.mine ? "dash" : "players";
      if (state.mine) goTab("players");
      else render();
    },
    onLogout: () => void logout(),
  });
  for (const d of view.querySelectorAll("details")) {
    if (openDetails.has(d.querySelector("h2")?.textContent ?? "")) d.open = true;
  }
  root.append(view);

  if (friend) return;
  dialog = settingsDialog(state.settings, eff.settings, state.samePass, (s) => void setSettings(s), (same) => {
    state.samePass = same;
  });
  document.body.append(dialog);
  if (wasOpen) {
    dialog.showModal();
    if (focusedId) document.getElementById(focusedId)?.focus();
  }
}

render();
void boot();
