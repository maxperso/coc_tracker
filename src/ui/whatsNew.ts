import { STATUS_LABEL, type BacklogItem } from "../lib/backlog";
import { CHANGE_LABEL, type ChangeKind, type Release } from "../lib/changelog";
import { fmtDayLong } from "../lib/time";
import { avatar, kindTag } from "./backlog";
import { h } from "./dom";
import { icon, type IconName } from "./icons";

const CHANGE_ICON: Record<ChangeKind, IconName> = { feature: "bulb", bug: "bug", ui: "edit" };
const ORDER: ChangeKind[] = ["feature", "bug", "ui"];

function release(r: Release, latest: boolean): HTMLElement {
  return h(
    "section",
    { class: "wn-release" },
    latest ? null : h("h3", { class: "wn-date" }, `Mise à jour du ${fmtDayLong(new Date(`${r.date}T12:00:00Z`))}`),
    ORDER.map((kind) => {
      const items = r.changes.filter((c) => c.kind === kind);
      if (!items.length) return null;
      return h(
        "div",
        { class: `wn-group wn-${kind}` },
        h("h4", { class: "wn-kind" }, icon(CHANGE_ICON[kind], 16), CHANGE_LABEL[kind]),
        h("ul", { class: "wn-list" }, items.map((c) => h("li", null, c.text))),
      );
    }),
  );
}

/**
 * « Quoi de neuf ? » : mises à jour pas encore vues et tickets de la commu déployés depuis la dernière
 * visite. Fermer la fenêtre (bouton, Échap) la marque lue.
 */
export function whatsNewDialog(opts: {
  releases: Release[];
  tickets: BacklogItem[];
  onOpenTicket: (id: number) => void;
  onClose: () => void;
}): HTMLDialogElement {
  const [latest, ...older] = opts.releases;
  const dlg: HTMLDialogElement = h(
    "dialog",
    { class: "settings whats-new", "aria-labelledby": "wn-title" },
    h(
      "form",
      { method: "dialog", class: "settings-form" },
      h(
        "div",
        { class: "settings-head" },
        h("div", null, h("h2", { id: "wn-title", tabindex: -1, autofocus: true, class: "wn-title" }, "Quoi de neuf ?"), latest ? h("p", { class: "muted" }, `Mise à jour du ${fmtDayLong(new Date(`${latest.date}T12:00:00Z`))}`) : null),
      ),
      latest ? release(latest, true) : null,
      older.map((r) => release(r, false)),
      opts.tickets.length
        ? h(
            "section",
            { class: "wn-release" },
            h("h3", { class: "wn-date" }, "Déployé depuis le backlog de la commu"),
            h(
              "ul",
              { class: "wn-tickets" },
              opts.tickets.map((t) =>
                h(
                  "li",
                  null,
                  h(
                    "button",
                    {
                      type: "button",
                      class: "wn-ticket",
                      onClick: () => {
                        dlg.close();
                        opts.onOpenTicket(t.id);
                      },
                    },
                    avatar(t.author),
                    h("span", { class: "wn-ticket-main" }, h("span", { class: "wn-ticket-title" }, t.title), h("span", { class: "bl-tags" }, kindTag(t.kind), h("span", { class: "hint" }, STATUS_LABEL[t.status]))),
                    icon("arrowRight", 16),
                  ),
                ),
              ),
            ),
          )
        : null,
      h("div", { class: "form-actions" }, h("button", { class: "btn btn-primary", value: "ok" }, "C'est noté")),
    ),
  );
  dlg.addEventListener("close", () => {
    opts.onClose();
    dlg.remove();
  });
  return dlg;
}
