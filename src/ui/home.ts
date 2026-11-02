import { MAX_EXPORT_CHARS } from "../lib/exportParse";
import { canReadClipboard } from "../lib/pwa";
import { h } from "./dom";
import { icon } from "./icons";

export function homeView(opts: {
  error?: string;
  onSubmit: (text: string) => void;
  onPlayers: () => void;
  /** Présent quand un export existe déjà : retour au tableau sans rien envoyer. */
  onCancel?: () => void;
  onLogout: () => void;
}): HTMLElement {
  const textarea = h("textarea", {
    id: "export-input",
    class: "paste",
    placeholder: '{"tag":"#...","timestamp":...}',
    spellcheck: "false",
    autocomplete: "off",
    maxlength: MAX_EXPORT_CHARS,
    "aria-describedby": "paste-note",
  });
  const fileInput = h("input", { type: "file", accept: "application/json,.json,.txt", class: "visually-hidden", id: "export-file" });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    if (f.size > MAX_EXPORT_CHARS * 4) return opts.onSubmit(" ".repeat(MAX_EXPORT_CHARS + 1));
    opts.onSubmit(await f.text());
  });

  // Collage en un tap : lit le presse-papiers et envoie directement.
  const clipError = h("p", { class: "error", role: "alert" });
  const pasteButton = canReadClipboard()
    ? h(
        "button",
        {
          type: "button",
          class: "btn btn-primary btn-lg paste-now",
          onClick: async () => {
            clipError.textContent = "";
            try {
              const text = (await navigator.clipboard.readText()).trim();
              if (!text) {
                clipError.textContent = "Le presse-papiers est vide : copie d'abord l'export dans le jeu.";
                return;
              }
              textarea.value = text;
              opts.onSubmit(text);
            } catch {
              clipError.textContent = "Lecture du presse-papiers refusée : colle l'export dans la zone ci-dessous.";
              textarea.focus();
            }
          },
        },
        icon("paste"),
        "Coller depuis le presse-papiers",
      )
    : null;

  const form = h(
    "form",
    {
      class: "card paste-card",
      onSubmit: (e: Event) => {
        e.preventDefault();
        opts.onSubmit(textarea.value);
      },
    },
    pasteButton,
    clipError,
    pasteButton ? h("p", { class: "hint center or" }, "ou colle-le à la main") : null,
    h("label", { for: "export-input", class: "field-label" }, "Export de ton village"),
    textarea,
    opts.error ? h("p", { class: "error", role: "alert" }, opts.error) : null,
    h(
      "div",
      { class: "paste-actions" },
      h("p", { id: "paste-note", class: "muted" }, "Ton export est enregistré sur ton compte : tes amis verront ton avancement."),
      h(
        "div",
        { class: "paste-buttons" },
        h("label", { for: "export-file", class: "btn btn-ghost" }, "Choisir un fichier"),
        fileInput,
        h("button", { type: "submit", class: "btn btn-primary" }, "Voir mon avancement"),
      ),
    ),
  );

  return h(
    "main",
    { class: "page home" },
    h("h1", { class: "display center" }, "Où en est ton village ?"),
    h("p", { class: "lead center" }, "Colle ton export pour voir ton avancement et tes fins de chantier."),
    form,
    h(
      "section",
      { class: "steps", "aria-labelledby": "steps-title" },
      h("h2", { id: "steps-title", class: "steps-title" }, "Où trouver l'export dans le jeu"),
      h(
        "ol",
        null,
        h("li", null, "Ouvre les réglages."),
        h("li", null, "Va dans Plus de réglages."),
        h("li", null, "En bas, dans Data Export, appuie sur Copier."),
      ),
    ),
    h(
      "div",
      { class: "button-row center-row" },
      opts.onCancel ? h("button", { type: "button", class: "btn btn-ghost", onClick: opts.onCancel }, "Retour à mon plan") : null,
      h("button", { type: "button", class: "btn btn-ghost", onClick: opts.onPlayers }, "Voir la commu"),
      h("button", { type: "button", class: "btn btn-ghost", onClick: opts.onLogout }, "Se déconnecter"),
    ),
  );
}
