import {
  BACKLOG_BODY_MAX,
  BACKLOG_KINDS,
  BACKLOG_STATUSES,
  BACKLOG_TITLE_MAX,
  canMove,
  COMMENT_MAX,
  hueOf,
  IMAGES_MAX,
  initials,
  KIND_LABEL,
  sortColumn,
  STATUS_LABEL,
  type BacklogComment,
  type BacklogItem,
  type BacklogKind,
  type BacklogStatus,
  type BacklogTicket,
  type NewImage,
} from "../lib/backlog";
import { compressImage, type PickedImage } from "../lib/images";
import { fmtDateTime, fmtDay } from "../lib/time";
import { h } from "./dom";
import { icon, type IconName } from "./icons";

export interface BacklogState {
  rows: BacklogItem[] | null;
  error?: string;
  /** Envoi en cours (ticket ou commentaire). */
  busy?: boolean;
  /** Erreur du dernier envoi (titre manquant, limite atteinte…). */
  formError?: string;
  /** Ticket ouvert ; `data` absent pendant le chargement. */
  ticket?: { id: number; data?: BacklogTicket; error?: string };
}

export interface BacklogActions {
  onAdd: (d: { kind: BacklogKind; title: string; body: string; images: NewImage[] }) => void;
  onVote: (id: number, vote: boolean) => void;
  onMove: (id: number, status: BacklogStatus) => void;
  onDelete: (id: number) => void;
  /** Ouvre un ticket ; null revient au tableau. */
  onOpen: (id: number | null) => void;
  onComment: (id: number, d: { body: string; images: NewImage[] }) => void;
  onDeleteComment: (id: number) => void;
}

export interface BacklogContext {
  admin: boolean;
  rerender: () => void;
}

const KIND_ICON: Record<BacklogKind, IconName> = { feature: "bulb", bug: "bug", change: "edit" };
const KIND_SHORT: Record<BacklogKind, string> = { feature: "Idée", bug: "Bug", change: "Modif" };
const PLACEHOLDER: Record<BacklogKind, string> = {
  feature: "Ex. : afficher le coût total de chaque jour",
  bug: "Ex. : le calendrier dépasse sur iPhone",
  change: "Ex. : mettre les potions en haut du plan",
};

/* La page est redessinée à chaque changement : brouillons, filtre et colonne affichée sont gardés ici. */
const draft = { open: false, kind: "feature" as BacklogKind, title: "", body: "", images: [] as PickedImage[] };
const commentDraft = { ticketId: 0, body: "", images: [] as PickedImage[] };
let filter: BacklogKind | "all" = "all";
/** Colonne affichée sur téléphone (une à la fois). */
let mobileColumn: BacklogStatus = "backlog";

export function resetTicketDraft(): void {
  Object.assign(draft, { open: false, title: "", body: "", images: [] });
}

export function resetCommentDraft(): void {
  Object.assign(commentDraft, { body: "", images: [] });
}

/** Pastille aux initiales du joueur, de la même couleur partout. */
export function avatar(username: string, size: "sm" | "md" = "sm"): HTMLElement {
  const el = h("span", { class: `avatar-dot avatar-${size}`, title: username, "aria-label": username, role: "img" }, initials(username));
  el.style.setProperty("--hue", String(hueOf(username)));
  return el;
}

/** Auteur puis commentateurs, trois pastilles au plus et « +n ». */
function people(it: BacklogItem): HTMLElement {
  const names = [it.author, ...it.commenters.filter((n) => n !== it.author)];
  const shown = names.slice(0, 3);
  return h(
    "span",
    { class: "avatar-stack", title: names.join(", ") },
    shown.map((n) => avatar(n)),
    names.length > shown.length ? h("span", { class: "avatar-dot avatar-sm avatar-more" }, `+${names.length - shown.length}`) : null,
  );
}

/* ---------- Captures ---------- */

/**
 * Choix de captures : bouton, collage (Ctrl+V d'une capture d'écran) et aperçus avec retrait.
 * `onChange` redessine la page pour afficher les aperçus.
 */
function imagePicker(id: string, images: PickedImage[], onChange: () => void, onError: (msg: string) => void, pasteTarget: HTMLElement): HTMLElement {
  const add = async (files: Iterable<File>) => {
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      if (images.length >= IMAGES_MAX) {
        onError(`${IMAGES_MAX} captures au plus.`);
        break;
      }
      try {
        images.push(await compressImage(f));
      } catch (e) {
        onError(e instanceof Error ? e.message : "Image illisible.");
      }
    }
    onChange();
  };
  const input = h("input", { id, type: "file", accept: "image/*", multiple: true, class: "visually-hidden", tabindex: -1 });
  input.addEventListener("change", () => void add(input.files ?? []));
  pasteTarget.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    void add(files);
  });
  return h(
    "div",
    { class: "picker" },
    images.map((img, i) =>
      h(
        "span",
        { class: "picker-thumb" },
        h("img", { src: img.preview, alt: `Capture ${i + 1}` }),
        h(
          "button",
          {
            type: "button",
            class: "picker-remove",
            "aria-label": `Retirer la capture ${i + 1}`,
            onClick: () => {
              images.splice(i, 1);
              onChange();
            },
          },
          "×",
        ),
      ),
    ),
    images.length < IMAGES_MAX
      ? h(
          "button",
          { type: "button", class: "btn btn-ghost picker-add", onClick: () => input.click() },
          icon("image", 18),
          images.length ? "Ajouter" : "Ajouter une capture",
        )
      : null,
    input,
  );
}

/** Captures enregistrées : miniatures, ouvertes en grand dans un nouvel onglet. */
function gallery(ids: number[]): HTMLElement | null {
  if (!ids.length) return null;
  return h(
    "div",
    { class: "gallery" },
    ids.map((id, i) =>
      h(
        "a",
        { href: `/api/backlog/images/${id}`, target: "_blank", rel: "noopener", class: "gallery-item", title: "Voir en grand" },
        h("img", { src: `/api/backlog/images/${id}`, alt: `Capture ${i + 1}`, loading: "lazy", decoding: "async" }),
      ),
    ),
  );
}

/* ---------- Nouveau ticket ---------- */

function ticketForm(s: BacklogState, a: BacklogActions, ctx: BacklogContext): HTMLElement {
  const formError = h("p", { class: "alert", role: "alert", hidden: !s.formError }, s.formError ?? "");
  const showError = (msg: string) => {
    formError.textContent = msg;
    formError.hidden = false;
  };
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
    rows: 4,
    maxlength: BACKLOG_BODY_MAX,
    placeholder: "Détails : ce que tu voulais faire, ce qui s'est passé, sur quel écran… Tu peux coller une capture ici.",
    onInput: () => (draft.body = body.value),
  });
  body.value = draft.body;
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
          for (const b of (e.currentTarget as HTMLElement).parentElement!.children) b.setAttribute("aria-checked", String(b === e.currentTarget));
          title.placeholder = PLACEHOLDER[k];
        },
      },
      icon(KIND_ICON[k], 16),
      KIND_SHORT[k],
    ),
  );
  const form = h(
    "form",
    {
      class: "card backlog-form",
      onSubmit: (e: Event) => {
        e.preventDefault();
        if (!title.reportValidity()) return;
        a.onAdd({ kind: draft.kind, title: draft.title, body: draft.body, images: draft.images.map(({ type, data }) => ({ type, data })) });
      },
    },
    h("h3", { class: "card-title" }, "Nouveau ticket"),
    h("div", { class: "segmented seg-3", role: "radiogroup", "aria-label": "Type" }, kinds),
    h("div", { class: "field" }, h("label", { for: "bl-title" }, "Titre"), title),
    h("div", { class: "field" }, h("label", { for: "bl-body" }, "Description ", h("span", { class: "hint" }, "(facultatif)")), body),
  );
  form.append(
    imagePicker("bl-images", draft.images, ctx.rerender, showError, form),
    formError,
    h(
      "div",
      { class: "form-actions" },
      h("button", { type: "button", class: "btn btn-ghost", onClick: () => ((draft.open = false), ctx.rerender()) }, "Annuler"),
      h("button", { type: "submit", class: "btn btn-primary", disabled: !!s.busy }, s.busy ? "Envoi…" : "Créer le ticket"),
    ),
  );
  return form;
}

/* ---------- Tableau ---------- */

function voteButton(it: BacklogItem, a: BacklogActions, small = false): HTMLElement {
  return h(
    "button",
    {
      type: "button",
      class: `bl-vote${small ? " bl-vote-sm" : ""}${it.voted ? " voted" : ""}`,
      "aria-pressed": String(it.voted),
      "aria-label": `${it.voted ? "Retirer mon vote" : "Voter"} : ${it.title} (${it.votes})`,
      title: it.voted ? "Retirer mon vote" : "Moi aussi",
      onClick: (e: Event) => {
        e.stopPropagation();
        a.onVote(it.id, !it.voted);
      },
    },
    icon("upvote", small ? 14 : 18),
    h("span", null, String(it.votes)),
  );
}

export function kindTag(kind: BacklogKind): HTMLElement {
  return h("span", { class: `bl-kind bl-kind-${kind}` }, icon(KIND_ICON[kind], 14), KIND_LABEL[kind]);
}

function card(it: BacklogItem, a: BacklogActions, ctx: BacklogContext): HTMLElement {
  const el = h(
    "li",
    {
      class: "kb-card",
      tabindex: 0,
      role: "button",
      "aria-label": `${it.title}, ${KIND_LABEL[it.kind]}, ${it.votes} vote${it.votes > 1 ? "s" : ""}`,
      draggable: ctx.admin ? "true" : undefined,
      onClick: () => a.onOpen(it.id),
      onKeydown: (e: Event) => (e as KeyboardEvent).key === "Enter" && a.onOpen(it.id),
    },
    h("p", { class: "bl-tags" }, kindTag(it.kind)),
    h("p", { class: "kb-title" }, it.title),
    h(
      "div",
      { class: "kb-foot" },
      people(it),
      h(
        "span",
        { class: "kb-counts" },
        it.comments ? h("span", { class: "kb-count", title: `${it.comments} commentaire${it.comments > 1 ? "s" : ""}` }, icon("comment", 14), String(it.comments)) : null,
        it.images ? h("span", { class: "kb-count", title: `${it.images} capture${it.images > 1 ? "s" : ""}` }, icon("image", 14), String(it.images)) : null,
        voteButton(it, a, true),
      ),
    ),
  );
  if (ctx.admin) {
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", String(it.id));
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
  }
  return el;
}

function board(s: BacklogState, a: BacklogActions, ctx: BacklogContext): HTMLElement {
  const rows = (s.rows ?? []).filter((it) => filter === "all" || it.kind === filter);
  const picker = h(
    "div",
    { class: "segmented kb-picker", role: "radiogroup", "aria-label": "Colonne" },
    BACKLOG_STATUSES.map((st) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          class: "seg-btn",
          "aria-checked": String(mobileColumn === st),
          onClick: () => {
            mobileColumn = st;
            ctx.rerender();
          },
        },
        STATUS_LABEL[st],
        h("span", { class: "chip-count" }, String(rows.filter((it) => it.status === st).length)),
      ),
    ),
  );
  const columns = BACKLOG_STATUSES.map((st) => {
    const items = sortColumn(rows, st);
    const col = h(
      "section",
      { class: `kb-col${mobileColumn === st ? " shown" : ""}`, "aria-label": STATUS_LABEL[st] },
      h("h3", { class: `kb-head kb-head-${st}` }, STATUS_LABEL[st], h("span", { class: "chip-count" }, String(items.length))),
      items.length
        ? h("ol", { class: "kb-list" }, items.map((it) => card(it, a, ctx)))
        : h("p", { class: "kb-empty" }, st === "backlog" ? "Aucun ticket." : ctx.admin ? "Glisse un ticket ici." : "Rien pour l'instant."),
    );
    if (ctx.admin) {
      // L'admin glisse les tickets d'une colonne à l'autre (souris) ; sur téléphone, depuis le ticket.
      col.addEventListener("dragover", (e) => {
        e.preventDefault();
        col.classList.add("drop");
      });
      col.addEventListener("dragleave", (e) => {
        if (!col.contains(e.relatedTarget as Node)) col.classList.remove("drop");
      });
      col.addEventListener("drop", (e) => {
        e.preventDefault();
        col.classList.remove("drop");
        const id = Number(e.dataTransfer?.getData("text/plain"));
        const it = s.rows?.find((x) => x.id === id);
        if (it && it.status !== st) a.onMove(id, st);
      });
    }
    return col;
  });
  return h("div", { class: "kb-wrap" }, picker, h("div", { class: "kanban" }, columns));
}

/* ---------- Ticket ouvert ---------- */

function statusControl(t: BacklogTicket, a: BacklogActions, ctx: BacklogContext): HTMLElement {
  if (ctx.admin) {
    const sel = h(
      "select",
      { id: "bl-status", class: "input input-inline", "aria-label": "Colonne" },
      BACKLOG_STATUSES.map((st) => h("option", { value: st, selected: st === t.status }, STATUS_LABEL[st])),
    );
    sel.addEventListener("change", () => a.onMove(t.id, sel.value as BacklogStatus));
    return h("div", { class: "bl-status-row" }, h("label", { for: "bl-status", class: "form-label" }, "Colonne"), sel);
  }
  const moves = (["validated", "in_progress", "deployed"] as const).filter((st) => canMove(t, st, false));
  const label: Record<string, string> = { validated: "C'est bon, je valide", in_progress: "Pas encore réglé", deployed: "Annuler la validation" };
  return h(
    "div",
    { class: "bl-status-row" },
    h("span", { class: `bl-status bl-status-${t.status}` }, STATUS_LABEL[t.status]),
    moves.map((st) => h("button", { type: "button", class: st === "validated" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm", onClick: () => a.onMove(t.id, st) }, label[st])),
  );
}

function comment(c: BacklogComment, a: BacklogActions, ctx: BacklogContext): HTMLElement {
  return h(
    "li",
    { class: "bl-comment" },
    avatar(c.author, "md"),
    h(
      "div",
      { class: "bl-comment-main" },
      h(
        "p",
        { class: "bl-comment-head" },
        h("strong", null, c.author),
        h("span", { class: "hint" }, fmtDateTime(new Date(c.createdAt))),
        c.mine || ctx.admin
          ? h(
              "button",
              {
                type: "button",
                class: "bl-delete",
                onClick: () => confirm("Supprimer ce commentaire ?") && a.onDeleteComment(c.id),
              },
              icon("trash", 14),
              "Supprimer",
            )
          : null,
      ),
      c.body ? h("p", { class: "bl-body" }, c.body) : null,
      gallery(c.images),
    ),
  );
}

function commentForm(t: BacklogTicket, s: BacklogState, a: BacklogActions, ctx: BacklogContext): HTMLElement {
  if (commentDraft.ticketId !== t.id) Object.assign(commentDraft, { ticketId: t.id, body: "", images: [] });
  const formError = h("p", { class: "alert", role: "alert", hidden: !s.formError }, s.formError ?? "");
  const body = h("textarea", {
    id: "bl-comment",
    class: "input textarea",
    rows: 3,
    maxlength: COMMENT_MAX,
    placeholder: "Ton commentaire… Tu peux coller une capture ici.",
    onInput: () => (commentDraft.body = body.value),
  });
  body.value = commentDraft.body;
  const form = h("form", {
    class: "bl-comment-form",
    onSubmit: (e: Event) => {
      e.preventDefault();
      if (!commentDraft.body.trim() && !commentDraft.images.length) return void body.focus();
      a.onComment(t.id, { body: commentDraft.body, images: commentDraft.images.map(({ type, data }) => ({ type, data })) });
    },
  });
  form.append(
    h("label", { for: "bl-comment", class: "visually-hidden" }, "Commentaire"),
    body,
    imagePicker("bl-comment-images", commentDraft.images, ctx.rerender, (msg) => ((formError.textContent = msg), (formError.hidden = false)), form),
    formError,
    h("div", { class: "form-actions" }, h("button", { type: "submit", class: "btn btn-primary", disabled: !!s.busy }, s.busy ? "Envoi…" : "Commenter")),
  );
  return form;
}

function ticketView(s: BacklogState, a: BacklogActions, ctx: BacklogContext): HTMLElement {
  const back = h("button", { type: "button", class: "btn btn-ghost bl-back", onClick: () => a.onOpen(null) }, icon("arrowLeft", 18), "Tableau");
  const t = s.ticket!.data;
  if (!t) return h("section", { class: "stack" }, back, s.ticket!.error ? h("p", { class: "alert" }, s.ticket!.error) : h("p", { class: "muted" }, "Chargement…"));
  const canDelete = ctx.admin || (t.mine && t.status === "backlog");
  return h(
    "section",
    { class: "stack bl-ticket" },
    back,
    h(
      "article",
      { class: "card bl-ticket-card" },
      h("p", { class: "bl-tags" }, kindTag(t.kind), h("span", { class: "hint" }, `#${t.id}`)),
      h("h2", { class: "bl-ticket-title" }, t.title),
      h(
        "div",
        { class: "bl-ticket-meta" },
        avatar(t.author, "md"),
        h("span", null, h("strong", null, t.author), h("span", { class: "hint" }, ` · ${fmtDay(new Date(t.createdAt))}`)),
        voteButton(t, a),
      ),
      statusControl(t, a, ctx),
      t.body ? h("p", { class: "bl-body bl-ticket-body" }, t.body) : null,
      gallery(t.imageIds),
      canDelete
        ? h(
            "button",
            { type: "button", class: "bl-delete", onClick: () => confirm(`Supprimer le ticket « ${t.title} » ?`) && a.onDelete(t.id) },
            icon("trash", 14),
            "Supprimer le ticket",
          )
        : null,
    ),
    h("h3", { class: "section-title" }, t.thread.length ? `Commentaires (${t.thread.length})` : "Commentaires"),
    t.thread.length ? h("ol", { class: "bl-thread" }, t.thread.map((c) => comment(c, a, ctx))) : h("p", { class: "muted" }, "Pas encore de commentaire."),
    commentForm(t, s, a, ctx),
  );
}

/* ---------- Page ---------- */

/** Backlog de la communauté : tableau kanban, ou le ticket ouvert. */
export function backlogView(s: BacklogState, a: BacklogActions, ctx: BacklogContext): HTMLElement {
  if (s.ticket) return ticketView(s, a, ctx);
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
          ctx.rerender();
        },
      },
      k === "all" ? "Tout" : KIND_SHORT[k],
      h("span", { class: "chip-count" }, String(count(k))),
    ),
  );
  return h(
    "section",
    { class: "stack backlog", "aria-labelledby": "backlog-title" },
    h(
      "div",
      { class: "bl-head" },
      h(
        "div",
        null,
        h("h2", { id: "backlog-title", class: "section-title" }, "Backlog"),
        h("p", { class: "muted" }, ctx.admin ? "Tu es admin : glisse les tickets d'une colonne à l'autre, ou change la colonne depuis le ticket." : "Idées, bugs, modifications. Vote pour ce que tu veux voir en premier."),
      ),
      draft.open ? null : h("button", { type: "button", class: "btn btn-primary", onClick: () => ((draft.open = true), ctx.rerender()) }, "Nouveau ticket"),
    ),
    draft.open ? ticketForm(s, a, ctx) : null,
    s.rows?.length ? h("div", { class: "chips", role: "group", "aria-label": "Filtrer" }, filters) : null,
    s.error ? h("p", { class: "alert" }, s.error) : !s.rows ? h("p", { class: "muted" }, "Chargement…") : board(s, a, ctx),
  );
}
