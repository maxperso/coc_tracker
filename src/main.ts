import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./styles.css";

import type { MeResponse, PlanChecks, PlayerProfile, PlayerRow } from "./lib/api";
import type { BacklogItem, BacklogTicket } from "./lib/backlog";
import { createSaver } from "./lib/saver";
import { LATEST_RELEASE, unseenReleases } from "./lib/changelog";
import { whatsNewDialog } from "./ui/whatsNew";
import { api, ApiError } from "./lib/client";
import { parseExport } from "./lib/exportParse";
import { gameIndex } from "./lib/gamedata";
import { snapshotOf, type Snapshot } from "./lib/history";
import demoExport from "./data/demo.json";
import { DEFAULT_SETTINGS, heroChains, heroLabel, type Settings } from "./lib/plan";
import { effectiveSettings } from "./lib/recommend";
import { canInstall, disablePush, enablePush, install, isIos, isStandalone, onPwaChange, pushState, registerServiceWorker, type PushState } from "./lib/pwa";
import { applyTheme, loadTheme, saveTheme, type ThemePref } from "./lib/theme";
import { buildVillage, type Village } from "./lib/village";
import { authView, type AuthMode, type AuthState } from "./ui/auth";
import { backlogView, resetCommentDraft, resetTicketDraft, type BacklogActions, type BacklogState } from "./ui/backlog";
import { commuSwitch, dashboardView, friendsSection, tabsFor, themeControl, type CommuTab, type Tab } from "./ui/dashboard";
import { h } from "./ui/dom";
import { homeView } from "./ui/home";
import { landingView } from "./ui/landing";
import { legalFooter } from "./ui/legal";
import { onboardingView } from "./ui/onboarding";
import { playersView } from "./ui/players";
import { settingsDialog } from "./ui/settings";

type View = "loading" | "landing" | "auth" | "home" | "onboarding" | "dash" | "players" | "profile";

interface Loaded {
  village: Village;
  history: Snapshot[];
  /** Actions du plan cochées « fait » pour cet export. */
  checks: Set<string>;
}

const state: {
  view: View;
  me: string | null;
  auth: AuthState;
  homeError?: string;
  /** Message sur la page d'accueil (serveur injoignable). */
  landingError?: string;
  settings: Settings;
  samePass: boolean;
  mine: Loaded | null;
  /** Nouvel export : le formulaire de stratégie redemande les médailles. */
  newExport: boolean;
  tab: Tab;
  players: { rows: PlayerRow[] | null; error?: string };
  backlog: BacklogState;
  /** Administrateur du backlog. */
  admin: boolean;
  /** Page Commu sans export : amis ou backlog. */
  commuTab: CommuTab;
  friend: (Loaded & { username: string; settings: Settings; demo?: boolean }) | null;
  friendTab: Tab;
} = {
  view: "loading",
  me: null,
  auth: { mode: "login", busy: false, inviteRequired: true },
  settings: structuredClone(DEFAULT_SETTINGS),
  samePass: true,
  mine: null,
  newExport: false,
  tab: "summary",
  players: { rows: null },
  backlog: { rows: null },
  admin: false,
  commuTab: "players",
  friend: null,
  friendTab: "summary",
};

let theme: ThemePref = loadTheme();
applyTheme(theme);
function setTheme(t: ThemePref) {
  theme = t;
  saveTheme(t);
}

const root = document.getElementById("app")!;

registerServiceWorker();
let push: PushState | "loading" = "loading";
async function refreshPush() {
  push = await pushState().catch(() => "unsupported" as const);
  if (state.view === "dash" || state.view === "profile") render();
}
onPwaChange(() => void refreshPush());
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
  if (!village) return null;
  // Les coches ne valent que pour l'export auquel elles se rapportent.
  const checks = new Set(p.checks && p.checks.exportAt === village.timestamp ? p.checks.keys : []);
  return { village, history: villages.map(snapshotOf), checks };
}

/** Session expirée : retour à l'écran de connexion. */
function handleError(e: unknown): string {
  if (e instanceof ApiError && e.status === 401) {
    state.me = null;
    state.view = "auth";
    state.auth = { ...state.auth, mode: "login", busy: false, info: undefined, error: "Ta session a expiré, reconnecte-toi." };
    render();
  }
  return e instanceof Error ? e.message : "Erreur inattendue.";
}

async function loadMine(): Promise<void> {
  const [settings, profile] = await Promise.all([api.settings(), api.profile(state.me!)]);
  state.settings = settings;
  state.mine = loadProfile(profile);
  state.view = state.mine ? "dash" : "home";
  // Le classement sert aussi au dashboard : chargé en fond, comme l'état des rappels.
  void loadPlayers();
  void refreshPush();
}

async function boot(): Promise<void> {
  api.authConfig().then(
    (c) => {
      state.auth.inviteRequired = c.inviteRequired;
      if (state.view === "auth") render();
    },
    () => {},
  );
  try {
    setMe(await api.me());
    await loadMine();
  } catch (e) {
    // Pas de session (401) : rien à signaler. Sinon, le serveur ne répond pas.
    if (!(e instanceof ApiError && e.status === 401)) state.landingError = "Le serveur ne répond pas pour le moment : la connexion est indisponible.";
  }
  // La page d'accueil s'affiche toujours en premier, connecté ou non.
  state.view = "landing";
  render();
  void showWhatsNew();
}

/** Depuis la page d'accueil : ton dashboard, ou l'écran pour coller l'export s'il n'y en a pas encore. */
function openMine() {
  state.friend = null;
  state.view = state.mine ? "dash" : "home";
  state.tab = "summary";
  render();
  window.scrollTo(0, 0);
}

/** Démo depuis la page d'accueil : un village anonymisé, en lecture seule. */
function openDemo() {
  const r = parseExport(JSON.stringify(demoExport));
  if (!r.ok) return;
  const village = buildVillage(r.value, gameIndex());
  state.friend = { village, history: [snapshotOf(village)], checks: new Set(), username: "Démo", settings: { ...structuredClone(DEFAULT_SETTINGS), focus: "hybrid" }, demo: true };
  state.friendTab = "summary";
  state.view = "profile";
  render();
  window.scrollTo(0, 0);
}

function goLanding() {
  state.view = "landing";
  render();
  window.scrollTo(0, 0);
}

function setAuth(mode: AuthMode, extra: Partial<AuthState> = {}) {
  state.auth = { inviteRequired: state.auth.inviteRequired, mode, busy: false, ...extra };
  render();
  (document.querySelector(".auth-card input") as HTMLInputElement | null)?.focus();
}

/** Lance une action de compte : bouton occupé pendant l'appel, message d'erreur sinon. */
async function authStep(run: () => Promise<void>) {
  state.auth = { ...state.auth, busy: true, error: undefined };
  render();
  try {
    await run();
  } catch (e) {
    if (e instanceof ApiError && e.data.needsVerification) {
      return setAuth("verify", { username: String(e.data.username ?? ""), info: e.message });
    }
    state.auth = { ...state.auth, busy: false, info: undefined, error: e instanceof Error ? e.message : "Erreur inattendue." };
    render();
  }
}

function setMe(me: MeResponse) {
  state.me = me.username;
  state.admin = me.admin;
}

async function signedIn(me: MeResponse) {
  setMe(me);
  state.auth = { mode: "login", busy: false, inviteRequired: state.auth.inviteRequired };
  await loadMine();
  render();
  void showWhatsNew();
}

/* ---------- Quoi de neuf ? ---------- */

let whatsNewShown = false;
/** Une fois par mise à jour et par compte : rien si le joueur a déjà tout vu. */
async function showWhatsNew() {
  if (whatsNewShown || !state.me) return;
  try {
    const r = await api.whatsNew();
    const releases = unseenReleases(r.seenRelease);
    if (!releases.length && !r.tickets.length) return;
    whatsNewShown = true;
    const dlg = whatsNewDialog({
      releases,
      tickets: r.tickets,
      onOpenTicket: openBacklogTicket,
      // Vu, même sans avoir tout lu. Si l'envoi échoue, la fenêtre revient à la prochaine visite.
      onClose: () => void api.whatsNewSeen(LATEST_RELEASE, r.asOf).catch(() => {}),
    });
    document.body.append(dlg);
    dlg.showModal();
  } catch {
    // Pas grave : on réessaiera à la prochaine visite.
  }
}

function openBacklogTicket(id: number) {
  state.friend = null;
  if (state.mine) {
    state.view = "dash";
    state.tab = "backlog";
  } else {
    state.view = "players";
    state.commuTab = "backlog";
  }
  void loadBacklog();
  void openTicket(id);
}

const authActions = {
  onMode: (mode: AuthMode) => setAuth(mode, mode === "reset" || mode === "forgot" ? { email: state.auth.email } : {}),
  onLogin: (d: { username: string; password: string }) => void authStep(async () => signedIn(await api.login(d.username, d.password))),
  onRegister: (d: { username: string; email: string; password: string; inviteCode: string }) =>
    void authStep(async () => {
      const r = await api.register(d);
      setAuth("verify", { username: r.username, info: r.message });
    }),
  onVerify: (d: { username: string; code: string }) => void authStep(async () => signedIn(await api.verify(d.username, d.code))),
  onResend: (username: string) =>
    void authStep(async () => {
      const r = await api.resend(username);
      setAuth("verify", { username, info: `${r.message} Un nouveau code ne part qu'une fois par minute.` });
    }),
  onForgot: (email: string) =>
    void authStep(async () => {
      await api.forgot(email);
      setAuth("reset", { email });
    }),
  onReset: (d: { email: string; code: string; password: string }) =>
    void authStep(async () => signedIn(await api.reset(d.email, d.code, d.password))),
  onHome: () => {
    state.view = "landing";
    render();
    window.scrollTo(0, 0);
  },
};

function openAuth(mode: AuthMode) {
  state.view = "auth";
  setAuth(mode);
  window.scrollTo(0, 0);
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

/** Message bref en bas de l'écran (enregistrement raté…). */
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string) {
  let el = document.querySelector<HTMLElement>(".toast");
  if (!el) {
    el = h("div", { class: "toast", role: "status", "aria-live": "polite" });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el!.classList.remove("show"), 6000);
}

/** Envoi raté : session expirée → connexion ; sinon on prévient, l'état est renvoyé plus tard. */
function saveFailed(what: string) {
  return (e: unknown) => {
    const msg = handleError(e);
    if (!(e instanceof ApiError && e.status === 401)) toast(`${what} (${msg}). Nouvel essai automatique.`);
  };
}

/** Réglages : affichés tout de suite ; la saisie rapide est regroupée (600 ms) avant l'envoi. */
const settingsSaver = createSaver<Settings>({
  send: (s, keepalive) => api.saveSettings(s, keepalive),
  onError: saveFailed("Réglages pas encore enregistrés"),
  delayMs: 600,
});

function setSettings(next: Settings, immediate = false): void {
  state.settings = next;
  render();
  settingsSaver.save(next);
  if (immediate) settingsSaver.flush();
}

/** Coches « fait » : envoyées tout de suite, sans redessiner la page. */
const checksSaver = createSaver<PlanChecks>({
  send: (c, keepalive) => api.saveChecks(c, keepalive),
  onError: saveFailed("Coches pas encore enregistrées"),
});

function toggleCheck(key: string, done: boolean) {
  const mine = state.mine;
  if (!mine) return;
  if (done) mine.checks.add(key);
  else mine.checks.delete(key);
  checksSaver.save({ exportAt: mine.village.timestamp, keys: [...mine.checks] });
}

// Sur téléphone, on coche puis on repart aussitôt dans le jeu : tout part avant la mise en pause de l'app.
const flushAll = () => {
  settingsSaver.flush();
  checksSaver.flush();
};
const retryAll = () => {
  settingsSaver.retry();
  checksSaver.retry();
};
document.addEventListener("visibilitychange", () => (document.visibilityState === "hidden" ? flushAll() : retryAll()));
window.addEventListener("pagehide", flushAll);
window.addEventListener("online", retryAll);

async function togglePush(enable: boolean) {
  try {
    push = enable ? await enablePush() : await disablePush();
    if (enable && push === "on") await api.pushTest().catch(() => {});
  } catch {
    push = await pushState().catch(() => "unsupported" as const);
  }
  render();
}

async function loadPlayers() {
  try {
    state.players = { rows: await api.players() };
  } catch (e) {
    state.players = { rows: null, error: handleError(e) };
  }
  render();
}

/* ---------- Backlog ---------- */

async function loadBacklog() {
  try {
    // Lire l'état après la réponse : un ticket a pu être ouvert pendant le chargement.
    const rows = await api.backlog();
    state.backlog = { ...state.backlog, rows, error: undefined };
  } catch (e) {
    state.backlog = { ...state.backlog, error: handleError(e) };
  }
  render();
}

/** Met à jour un ticket dans le tableau et dans le ticket ouvert. */
function putBacklogItem(it: BacklogItem) {
  const b = state.backlog;
  const ticket = b.ticket?.data && b.ticket.id === it.id ? { ...b.ticket, data: { ...b.ticket.data, ...it } } : b.ticket;
  state.backlog = { ...b, ticket, rows: (b.rows ?? []).map((x) => (x.id === it.id ? it : x)) };
}

/** Ticket ouvert rechargé (après un commentaire) : sa ligne du tableau suit. */
function putTicket(t: BacklogTicket) {
  const { imageIds: _, thread: __, ...it } = t;
  putBacklogItem(it);
  state.backlog = { ...state.backlog, ticket: { id: t.id, data: t } };
}

async function openTicket(id: number | null) {
  state.backlog = { ...state.backlog, formError: undefined, ticket: id == null ? undefined : { id } };
  render();
  window.scrollTo(0, 0);
  if (id == null) return void loadBacklog();
  try {
    const data = await api.ticket(id);
    if (state.backlog.ticket?.id === id) state.backlog = { ...state.backlog, ticket: { id, data } };
  } catch (e) {
    if (state.backlog.ticket?.id === id) state.backlog = { ...state.backlog, ticket: { id, error: handleError(e) } };
  }
  render();
}

const backlogActions: BacklogActions = {
  onAdd: async (d) => {
    state.backlog = { ...state.backlog, busy: true, formError: undefined };
    render();
    try {
      const t = await api.addTicket(d);
      resetTicketDraft();
      const { imageIds: _, thread: __, ...it } = t;
      state.backlog = { ...state.backlog, busy: false, rows: [it, ...(state.backlog.rows ?? [])] };
    } catch (e) {
      state.backlog = { ...state.backlog, busy: false, formError: handleError(e) };
    }
    render();
  },
  onVote: async (id, vote) => {
    const before = state.backlog.rows?.find((x) => x.id === id) ?? state.backlog.ticket?.data;
    if (!before) return;
    // Affiché tout de suite, corrigé par la réponse du serveur.
    putBacklogItem({ ...before, voted: vote, votes: before.votes + (vote ? 1 : -1) });
    render();
    try {
      putBacklogItem(await api.voteTicket(id, vote));
    } catch (e) {
      putBacklogItem(before);
      toast(handleError(e));
    }
    render();
  },
  onMove: async (id, status) => {
    const before = state.backlog.rows?.find((x) => x.id === id) ?? state.backlog.ticket?.data;
    if (!before) return;
    putBacklogItem({ ...before, status, movedAt: new Date().toISOString() });
    render();
    try {
      putBacklogItem(await api.moveTicket(id, status));
    } catch (e) {
      putBacklogItem(before);
      toast(handleError(e));
    }
    render();
  },
  onDelete: async (id) => {
    try {
      await api.deleteTicket(id);
      state.backlog = { ...state.backlog, ticket: undefined, rows: (state.backlog.rows ?? []).filter((x) => x.id !== id) };
    } catch (e) {
      toast(handleError(e));
    }
    render();
  },
  onOpen: (id) => void openTicket(id),
  onComment: async (id, d) => {
    state.backlog = { ...state.backlog, busy: true, formError: undefined };
    render();
    try {
      const t = await api.addComment(id, d);
      resetCommentDraft();
      state.backlog = { ...state.backlog, busy: false };
      putTicket(t);
    } catch (e) {
      state.backlog = { ...state.backlog, busy: false, formError: handleError(e) };
    }
    render();
  },
  onDeleteComment: async (id) => {
    try {
      putTicket(await api.deleteComment(id));
    } catch (e) {
      toast(handleError(e));
    }
    render();
  },
};

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

/** `everywhere` : ferme aussi les sessions des autres appareils. */
async function logout(everywhere = false) {
  await (everywhere ? api.logoutAll() : api.logout()).catch(() => {});
  state.me = null;
  state.mine = null;
  state.friend = null;
  state.players = { rows: null };
  state.backlog = { rows: null };
  state.admin = false;
  state.view = "landing";
  state.auth = { mode: "login", busy: false, inviteRequired: state.auth.inviteRequired };
  render();
}

function goTab(t: Tab) {
  state.tab = t;
  if (t === "players") void loadPlayers();
  if (t === "backlog") {
    state.backlog = { ...state.backlog, ticket: undefined, formError: undefined };
    void loadBacklog();
  }
  render();
  window.scrollTo(0, 0);
}

/** Page Commu sans export : amis ou backlog. */
function goCommu(t: CommuTab) {
  state.commuTab = t;
  if (t === "players") void loadPlayers();
  else {
    state.backlog = { ...state.backlog, ticket: undefined, formError: undefined };
    void loadBacklog();
  }
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
      h("div", null, h("h1", { class: "title" }, "Commu"), h("p", { class: "lead" }, "Le classement de tes amis, et les idées pour améliorer COC Tracker.")),
      h("button", { type: "button", class: "btn btn-ghost", onClick: () => ((state.view = "home"), render()) }, "Coller mon export"),
    ),
    commuSwitch(state.commuTab, goCommu),
    state.commuTab === "backlog"
      ? backlogView(state.backlog, backlogActions, { admin: state.admin, rerender: render })
      : friendsSection(playersView({ ...state.players, me: state.me!, onOpen: (u) => void openPlayer(u) })),
  );
}

/** Page affichée : quand elle change, les blocs apparaissent en fondu. */
let shownPage = "";
const pageKey = () => {
  const ticket = state.backlog.ticket ? `:ticket${state.backlog.ticket.id}` : "";
  return state.view === "dash"
    ? `dash:${state.friend ? `${state.friend.username}:${state.friendTab}` : state.tab}${state.tab === "backlog" ? ticket : ""}`
    : state.view === "auth"
      ? `auth:${state.auth.mode}`
      : state.view === "players"
        ? `players:${state.commuTab}${ticket}`
        : state.view;
};

/** Blocs animés à l'entrée d'une page, l'un après l'autre. */
const ENTER_BLOCKS =
  ".section-head, .strategy, .banner, .village-switch, .tile, .card, .landing-hero, .landing-section, .feature, .player, .choice, .stepper, .notice, .kb-col, .bl-comment";
const MAX_STAGGER = 10;
let enterTimer: ReturnType<typeof setTimeout> | undefined;

/** Affiche la vue courante, puis le pied de page en bas de l'écran. */
function render(): void {
  const key = pageKey();
  const entering = key !== shownPage;
  shownPage = key;
  renderView();
  if (!root.querySelector(":scope > .legal")) root.append(legalFooter());

  // Simple mise à jour (réglage, coche…) : pas d'animation, la page ne doit pas clignoter.
  clearTimeout(enterTimer);
  root.classList.remove("page-enter");
  if (!entering) return;
  let i = 0;
  for (const e of root.querySelectorAll<HTMLElement>(ENTER_BLOCKS)) {
    if (e.parentElement?.closest(ENTER_BLOCKS)) continue; // un bloc dans un bloc arrive avec son parent
    e.dataset.enter = "";
    e.style.setProperty("--enter", String(Math.min(i++, MAX_STAGGER)));
  }
  void root.offsetWidth; // relance l'animation même si la classe vient d'être retirée
  root.classList.add("page-enter");
  enterTimer = setTimeout(() => root.classList.remove("page-enter"), 1000);
}

function renderView(): void {
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
    case "landing":
      root.append(
        landingView({
          me: state.me,
          error: state.landingError,
          onLogin: () => openAuth("login"),
          onRegister: () => openAuth("register"),
          onDashboard: openMine,
          onFriends: () => {
            if (state.mine) {
              state.friend = null;
              state.view = "dash";
              goTab("players");
            } else {
              state.view = "players";
              void loadPlayers();
              void loadBacklog();
            }
          },
          onLogout: () => void logout(),
          onDemo: openDemo,
        }),
      );
      return;
    case "auth":
      root.append(
        authView(state.auth, authActions),
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
            void loadBacklog();
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
        return renderView();
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
            // Premier passage en « Perso » : on montre l'ordre à régler.
            state.tab = next.focus === "custom" && state.settings.focus !== "custom" ? "order" : "summary";
            setSettings(next, true);
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
    return renderView();
  }
  const settings = friend ? friend.settings : state.settings;
  const eff = effective(loaded.village, settings);
  const owner = friend ? friend.username : state.me!;
  const tab = friend ? state.friendTab : state.tab;
  if (!tabsFor(settings, !!friend).includes(tab)) {
    if (friend) state.friendTab = "summary";
    else state.tab = "summary";
    return renderView();
  }

  const view = dashboardView({
    village: loaded.village,
    settings: eff.settings,
    purchase: eff.purchase,
    history: loaded.history,
    me: state.me ?? "",
    owner,
    demo: friend?.demo,
    players: state.players,
    backlog: state.backlog,
    backlogActions,
    admin: state.admin,
    rerender: render,
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
    onFocus: (focus) => setSettings({ ...state.settings, focus }, true),
    onOrder: (order) => setSettings({ ...state.settings, focus: "custom", order }),
    onSettings: () => dialog?.showModal(),
    onNewExport: () => ((state.view = "home"), render()),
    onOpenPlayer: (u) => void openPlayer(u),
    onBack: () => {
      state.view = state.mine ? "dash" : "players";
      if (state.mine) goTab("players");
      else render();
    },
    onMine: () => (friend?.demo && !state.me ? openAuth("register") : openMine()),
    onHome: goLanding,
    onLogout: () => void logout(),
    onLogoutAll: () => void logout(true),
    theme,
    onTheme: setTheme,
    checks: loaded.checks,
    onCheck: friend ? undefined : toggleCheck,
    push,
    onPush: (enable) => void togglePush(enable),
    onPushTest: () => void api.pushTest().catch((e) => void handleError(e)),
    install: { available: canInstall(), ios: isIos(), standalone: isStandalone() },
    onInstall: () => void install().then(() => render()),
    compare:
      friend && !friend.demo && state.mine && state.me
        ? { me: state.me, village: state.mine.village, settings: effective(state.mine.village, state.settings).settings }
        : undefined,
  });
  for (const d of view.querySelectorAll("details")) {
    if (openDetails.has(d.querySelector("h2")?.textContent ?? "")) d.open = true;
  }
  root.append(view);

  if (friend) return;
  dialog = settingsDialog(
    state.settings,
    eff.settings,
    state.samePass,
    (s) => setSettings(s),
    (same) => {
      state.samePass = same;
    },
    themeControl(theme, setTheme),
    heroChains(loaded.village).map((c) => ({ key: c.key, label: heroLabel(c) })),
  );
  document.body.append(dialog);
  if (wasOpen) {
    dialog.showModal();
    if (focusedId) document.getElementById(focusedId)?.focus();
  }
}

render();
void boot();
