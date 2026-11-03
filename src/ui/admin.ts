import type { AdminOverview, AdminUser } from "../lib/api";
import { fmtDateTime, fmtDay } from "../lib/time";
import { avatar } from "./backlog";
import { h, nf, type Child } from "./dom";
import { icon } from "./icons";

export interface AdminState {
  data?: AdminOverview;
  error?: string;
  loading?: boolean;
}

const METHOD: Record<string, string> = { password: "mot de passe", code: "code email", reset: "nouveau mot de passe" };
const ONLINE_MIN = 5;

/** « à l'instant », « il y a 12 min », « il y a 3 h », « hier », sinon la date. */
function ago(iso: string | null, now: number): string {
  if (!iso) return "jamais";
  const min = Math.max(0, (now - Date.parse(iso)) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${Math.floor(min)} min`;
  if (min < 24 * 60) return `il y a ${Math.floor(min / 60)} h`;
  if (min < 48 * 60) return "hier";
  if (min < 7 * 24 * 60) return `il y a ${Math.floor(min / 1440)} j`;
  return `le ${fmtDay(new Date(iso))}`;
}

const online = (u: AdminUser, now: number) => !!u.lastSeenAt && now - Date.parse(u.lastSeenAt) < ONLINE_MIN * 60_000;

function tile(label: string, value: string, sub: string): HTMLElement {
  return h("div", { class: "card tile" }, h("span", { class: "tile-label" }, label), h("span", { class: "tile-value" }, value), h("span", { class: "tile-sub" }, sub));
}

/** Joueurs actifs par jour : une barre par jour, valeur au survol, la dernière étiquetée. */
function activityChart(daily: AdminOverview["daily"]): HTMLElement {
  const max = Math.max(1, ...daily.map((d) => d.active));
  const tip = h("p", { class: "ad-tip hint", "aria-live": "polite" }, "Survole une barre pour le détail.");
  const bars = daily.map((d) => {
    const label = `${fmtDay(new Date(`${d.day}T12:00:00Z`))} : ${d.active} joueur${d.active > 1 ? "s" : ""} actif${d.active > 1 ? "s" : ""}, ${d.logins} connexion${d.logins > 1 ? "s" : ""}`;
    const bar = h(
      "span",
      { class: "ad-bar", role: "img", "aria-label": label, tabindex: 0 },
      h("span", { class: "ad-fill", style: { width: "100%" } }),
    );
    (bar.firstChild as HTMLElement).style.height = `${(d.active / max) * 100}%`;
    const show = () => (tip.textContent = label);
    bar.addEventListener("pointerenter", show);
    bar.addEventListener("focus", show);
    return bar;
  });
  const last = daily.at(-1);
  return h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", { class: "card-title" }, "Joueurs actifs par jour"), h("span", { class: "muted" }, "30 derniers jours")),
    h("div", { class: "ad-chart" }, h("span", { class: "ad-max hint" }, String(max)), h("div", { class: "ad-bars" }, bars)),
    h(
      "div",
      { class: "ad-axis hint" },
      h("span", null, daily[0] ? fmtDay(new Date(`${daily[0].day}T12:00:00Z`)) : ""),
      h("span", null, last ? `aujourd'hui : ${last.active}` : ""),
    ),
    tip,
  );
}

/** Cellule avec son intitulé (affiché à gauche sur téléphone) et son contenu groupé. */
const cell = (label: string, ...content: Child[]) => h("td", { "data-label": label }, h("span", { class: "ad-cell" }, content));

function usersTable(users: AdminUser[], now: number): HTMLElement {
  return h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", { class: "card-title" }, "Joueurs"), h("span", { class: "muted" }, "du plus récent au plus ancien passage")),
    h(
      "div",
      { class: "ad-scroll" },
      h(
        "table",
        { class: "ad-table" },
        h(
          "thead",
          null,
          h("tr", null, ["Joueur", "Dernier passage", "Dernière connexion", "Actif", "Dernier export", "Rappels"].map((t) => h("th", { scope: "col" }, t))),
        ),
        h(
          "tbody",
          null,
          users.map((u) =>
            h(
              "tr",
              null,
              h(
                "th",
                { scope: "row" },
                h(
                  "span",
                  { class: "ad-user" },
                  avatar(u.username),
                  h(
                    "span",
                    null,
                    h("span", { class: "ad-name" }, u.username, u.admin ? h("span", { class: "badge" }, "admin") : null, u.verified ? null : h("span", { class: "badge ad-warn" }, "email pas confirmé")),
                    h("span", { class: "hint ad-email" }, u.email ?? "sans email", ` · inscrit le ${fmtDay(new Date(u.createdAt))}`),
                  ),
                ),
              ),
              cell("Dernier passage", online(u, now) ? h("span", { class: "pill" }, "en ligne") : ago(u.lastSeenAt, now)),
              cell(
                "Dernière connexion",
                u.lastLogin
                  ? [h("span", null, ago(u.lastLogin.at, now)), h("span", { class: "hint ad-sub" }, `${u.lastLogin.device} · ${METHOD[u.lastLogin.method] ?? u.lastLogin.method}`)]
                  : h("span", { class: "muted" }, "pas depuis le suivi"),
              ),
              cell("Actif", h("span", null, `${u.days7}/7 j`), h("span", { class: "hint ad-sub" }, `${u.days30}/30 j · ${u.logins30} connexion${u.logins30 > 1 ? "s" : ""}`)),
              cell(
                "Dernier export",
                u.lastExportAt ? [h("span", null, ago(u.lastExportAt, now)), h("span", { class: "hint ad-sub" }, `HDV ${u.th ?? "?"}`)] : h("span", { class: "muted" }, "aucun"),
              ),
              cell(
                "Rappels",
                u.pushDevices ? `${u.pushDevices} appareil${u.pushDevices > 1 ? "s" : ""}` : h("span", { class: "muted" }, "non"),
                u.backlogEmails ? null : h("span", { class: "hint ad-sub" }, "emails coupés"),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function recentLogins(logins: AdminOverview["logins"], now: number): HTMLElement {
  return h(
    "section",
    { class: "card" },
    h("h2", { class: "card-title" }, "Dernières connexions"),
    logins.length
      ? h(
          "ol",
          { class: "ad-logins" },
          logins.map((l) =>
            h(
              "li",
              null,
              avatar(l.username),
              h("span", { class: "ad-login-main" }, h("strong", null, l.username), h("span", { class: "hint" }, `${l.device} · ${METHOD[l.method] ?? l.method}`)),
              h("span", { class: "hint", title: fmtDateTime(new Date(l.at)) }, ago(l.at, now)),
            ),
          ),
        )
      : h("p", { class: "muted" }, "Aucune connexion depuis la mise en place du suivi."),
  );
}

/** Panneau admin : qui est inscrit, qui passe, qui se connecte et d'où. */
export function adminView(s: AdminState, onRefresh: () => void): HTMLElement {
  const head = h(
    "div",
    { class: "section-head" },
    h("div", null, h("h1", { class: "title" }, "Panneau admin"), h("p", { class: "lead" }, "Connexions et activité des joueurs. Aucune adresse IP n'est gardée, l'historique est effacé après 180 jours.")),
    h("button", { type: "button", class: "btn btn-ghost", onClick: onRefresh, disabled: !!s.loading }, icon("progress", 18), s.loading ? "Chargement…" : "Actualiser"),
  );
  if (s.error) return h("section", { class: "stack" }, head, h("p", { class: "alert" }, s.error));
  if (!s.data) return h("section", { class: "stack" }, head, h("p", { class: "muted" }, "Chargement…"));
  const d = s.data;
  const now = Date.parse(d.now);
  const onlineNow = d.users.filter((u) => online(u, now));
  const today = d.daily.at(-1);
  const week = d.users.filter((u) => u.days7 > 0).length;
  const logins30 = d.daily.reduce((n, x) => n + x.logins, 0);
  const pending = d.users.filter((u) => !u.verified).length;
  return h(
    "section",
    { class: "stack" },
    head,
    h(
      "div",
      { class: "tiles tiles-5" },
      tile("Inscrits", nf(d.users.length), pending ? `dont ${pending} pas confirmé${pending > 1 ? "s" : ""}` : "tous confirmés"),
      tile("En ligne", nf(onlineNow.length), onlineNow.length ? onlineNow.map((u) => u.username).join(", ") : `personne depuis ${ONLINE_MIN} min`),
      tile("Aujourd'hui", nf(today?.active ?? 0), "joueurs actifs"),
      tile("7 jours", nf(week), "joueurs actifs"),
      tile("Connexions", nf(logins30), "sur 30 jours"),
    ),
    activityChart(d.daily),
    usersTable(d.users, now),
    recentLogins(d.logins, now),
  );
}
