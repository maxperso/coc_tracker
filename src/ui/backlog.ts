import { BACKLOG_BODY_MAX, BACKLOG_KINDS, BACKLOG_TITLE_MAX, KIND_LABEL, sortBacklog, STATUS_LABEL, type BacklogItem, type BacklogKind } from "../lib/backlog";
import { fmtDay } from "../lib/time";
import { h } from "./dom";
import { icon, type IconName } from "./icons";

export interface BacklogState {
  rows: BacklogItem[] | null;
  error?: string;
  /** Envoi en cours. */
  busy?: boolean;
  /** Erreur de la dernière proposition (titre manquant, limite atteinte…). */
  formError?: string;
}

export interface BacklogActions {
  onAdd: (d: { kind: BacklogKind; title: string; body: string }) => void;
  onVote: (id: number, vote: boolean) => void;
  onDelete: (id: number) => void;
}

const KIND_ICON: Record<BacklogKind, IconName> = { feature: "bulb", bug: "bug", change: "edit" };
const KIND_SHORT: Record<BacklogKind, string> = { feature: "Idée", bug: "Bug", change: "Modif" };

/** Brouillon et filtre : gardés d'un rendu à l'autre (la page est redessinée à chaque changement). */
const draft: { kind: BacklogKind; title: string; body: string } = { kind: "feature", title: "", body: "" };
let filter: BacklogKind | "all" = "all";

export function resetBacklogDraft(): void {
  draft.title = "";
  draft.body = "";
}

function form(s: BacklogState, a: BacklogActions): HTMLElement {
  const kinds = BACKLOG_KINDS.map((k) =>
    h(
      "button",
      {
        type: "button",
        role: "radio",
        class: "seg-btn",
        "aria-checked": String(draft.kind === k),
        onClick: (e: Event) => {
          draft.kind = k;
          const group = (e.currentTarget as HTMLElement).parentElement!;
          for (const b of group.children) b.setAttribute("aria-checked", String(b === e.currentTarget));
          title.placeholder = PLACEHOLDER[k];
        },
      },
      icon(KIND_ICON[k], 16),
      KIND_SHORT[k],
    ),
  );
  const title = h("input", {
    id: "bl-title",
    class: "input",
    maxlength: BACKLOG_TITLE_MAX,
    required: true,
    value: draft.title,
    placeholder: PLACEHOLDER[draft.kind],
    onInput: () => (draft.title = title.value),
  });
  const body = h("textarea", {
    id: "bl-body",
    class: "input textarea",
    rows: 3,
    maxlength: BACKLOG_BODY_MAX,
    placeholder: "Détails : ce que tu voulais faire, ce qui s'est passé, sur quel écran…",
    onInput: () => (draft.body = body.value),
  });
  body.value = draft.body;
  return h(
    "form",
    {
      class: "card backlog-form",
      onSubmit: (e: Event) => {
        e.preventDefault();
        if (!title.reportValidity()) return;
        a.onAdd({ ...draft });
      },
    },
    h("h3", { class: "card-title" }, "Proposer"),
    h("div", { class: "segmented seg-3", role: "radiogroup", "aria-label": "Type" }, kinds),
    h("div", { class: "field" }, h("label", { for: "bl-title" }, "Titre"), title),
    h("div", { class: "field" }, h("label", { for: "bl-body" }, "Description ", h("span", { class: "hint" }, "(facultatif)")), body),
    s.formError ? h("p", { class: "alert", role: "alert" }, s.formError) : null,
    h("div", { class: "form-actions" }, h("button", { type: "submit", class: "btn btn-primary", disabled: !!s.busy }, s.busy ? "Envoi…" : "Envoyer")),
  );
}

const PLACEHOLDER: Record<BacklogKind, string> = {
  feature: "Ex. : afficher le coût total de chaque jour",
  bug: "Ex. : le calendrier dépasse sur iPhone",
  change: "Ex. : mettre les potions en haut du plan",
};

function item(it: BacklogItem, a: BacklogActions): HTMLElement {
  return h(
    "li",
    { class: `bl-item bl-${it.status}` },
    h(
      "button",
      {
        type: "button",
        class: it.voted ? "bl-vote voted" : "bl-vote",
        "aria-pressed": String(it.voted),
        "aria-label": `${it.voted ? "Retirer mon vote" : "Voter"} : ${it.title} (${it.votes})`,
        title: it.voted ? "Retirer mon vote" : "Moi aussi",
        onClick: () => a.onVote(it.id, !it.voted),
      },
      icon("upvote", 18),
      h("span", null, String(it.votes)),
    ),
    h(
      "div",
      { class: "bl-main" },
      h(
        "p",
        { class: "bl-tags" },
        h("span", { class: `bl-kind bl-kind-${it.kind}` }, icon(KIND_ICON[it.kind], 14), KIND_LABEL[it.kind]),
        it.status !== "open" ? h("span", { class: `bl-status bl-status-${it.status}` }, STATUS_LABEL[it.status]) : null,
      ),
      h("p", { class: "bl-title" }, it.title),
      it.body ? h("p", { class: "bl-body" }, it.body) : null,
      h(
        "p",
        { class: "hint bl-meta" },
        `${it.mine ? "Toi" : it.author} · ${fmtDay(new Date(it.createdAt))}`,
        it.mine
          ? h(
              "button",
              {
                type: "button",
                class: "bl-delete",
                onClick: () => {
                  if (confirm(`Supprimer « ${it.title} » ?`)) a.onDelete(it.id);
                },
              },
              icon("trash", 14),
              "Supprimer",
            )
          : null,
      ),
    ),
  );
}

/** Backlog de la communauté : proposer, voter, suivre ce qui est prévu ou fait. */
export function backlogView(s: BacklogState, a: BacklogActions, rerender: () => void): HTMLElement {
  const rows = s.rows ? sortBacklog(s.rows).filter((it) => filter === "all" || it.kind === filter) : null;
  const count = (k: BacklogKind | "all") => s.rows?.filter((it) => k === "all" || it.kind === k).length ?? 0;
  const filters = (["all", ...BACKLOG_KINDS] as const).map((k) =>
    h(
      "button",
      {
        type: "button",
        class: filter === k ? "chip active" : "chip",
        "aria-pressed": String(filter === k),
        onClick: () => {
          filter = k;
          rerender();
        },
      },
      k === "all" ? "Tout" : KIND_SHORT[k],
      h("span", { class: "chip-count" }, String(count(k))),
    ),
  );
  return h(
    "section",
    { class: "stack backlog", "aria-labelledby": "backlog-title" },
    h("div", null, h("h2", { id: "backlog-title", class: "section-title" }, "Backlog"), h("p", { class: "muted" }, "Idées de fonctionnalités, bugs, modifications. Vote pour ce que tu veux voir en premier.")),
    form(s, a),
    s.rows?.length ? h("div", { class: "chips", role: "group", "aria-label": "Filtrer" }, filters) : null,
    s.error
      ? h("p", { class: "alert" }, s.error)
      : !rows
        ? h("p", { class: "muted" }, "Chargement…")
        : !rows.length
          ? h("p", { class: "muted" }, s.rows!.length ? "Rien dans cette catégorie." : "Rien pour l'instant : sois le premier à proposer quelque chose.")
          : h("ol", { class: "bl-list" }, rows.map((it) => item(it, a))),
  );
}
