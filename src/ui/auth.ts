import { h } from "./dom";

/** Étapes de l'écran de compte. */
export type AuthMode = "login" | "register" | "verify" | "forgot" | "reset";

export interface AuthState {
  mode: AuthMode;
  error?: string;
  info?: string;
  busy: boolean;
  inviteRequired: boolean;
  /** Pseudo en attente de confirmation (étape verify). */
  username?: string;
  /** Email de réinitialisation (étape reset). */
  email?: string;
}

export interface AuthActions {
  onMode: (m: AuthMode) => void;
  onLogin: (d: { username: string; password: string }) => void;
  onRegister: (d: { username: string; email: string; password: string; inviteCode: string }) => void;
  onVerify: (d: { username: string; code: string }) => void;
  onResend: (username: string) => void;
  onForgot: (email: string) => void;
  onReset: (d: { email: string; code: string; password: string }) => void;
}

const input = (id: string, attrs: Record<string, string | number | boolean>) =>
  h("input", { id, class: "input", spellcheck: "false", autocapitalize: "none", ...attrs });

const field = (id: string, label: string, el: HTMLElement, hint?: string) =>
  h("div", { class: "field" }, h("label", { for: id }, label), el, hint ? h("p", { class: "hint" }, hint) : null);

const codeInput = () =>
  input("auth-code", { inputmode: "numeric", autocomplete: "one-time-code", pattern: "\\d{6}", maxlength: 6, required: true, class: "input input-code" });

export function authView(s: AuthState, a: AuthActions): HTMLElement {
  const tabs =
    s.mode === "login" || s.mode === "register"
      ? h(
          "div",
          { class: "auth-tabs", role: "tablist" },
          ...(["login", "register"] as const).map((m) =>
            h("button", { type: "button", role: "tab", class: "tab", "aria-selected": String(s.mode === m), onClick: () => a.onMode(m) }, m === "login" ? "Connexion" : "Créer un compte"),
          ),
        )
      : null;

  let body: HTMLElement[];
  let submit: string;
  let onSubmit: (form: HTMLFormElement) => void;
  const val = (f: HTMLFormElement, id: string) => (f.querySelector(`#${id}`) as HTMLInputElement | null)?.value ?? "";

  switch (s.mode) {
    case "register":
      body = [
        field("auth-user", "Pseudo", input("auth-user", { autocomplete: "username", required: true, minlength: 3, maxlength: 20, pattern: "[A-Za-z0-9_\\-]{3,20}" }), "3 à 20 lettres, chiffres, - ou _. Visible par tes potes."),
        field("auth-email", "Email", input("auth-email", { type: "email", autocomplete: "email", required: true, maxlength: 254 }), "Pour le code de confirmation et le mot de passe oublié. Jamais affiché."),
        field("auth-pass", "Mot de passe", input("auth-pass", { type: "password", autocomplete: "new-password", required: true, minlength: 8, maxlength: 200 }), "8 caractères au moins."),
        ...(s.inviteRequired ? [field("auth-invite", "Code d'invitation", input("auth-invite", { autocomplete: "off", required: true, maxlength: 200 }), "Demande-le à celui qui t'a envoyé le lien.")] : []),
      ];
      submit = "Créer mon compte";
      onSubmit = (f) => a.onRegister({ username: val(f, "auth-user").trim(), email: val(f, "auth-email").trim(), password: val(f, "auth-pass"), inviteCode: val(f, "auth-invite").trim() });
      break;
    case "verify":
      body = [
        h("h2", { class: "card-title" }, "Confirme ton email"),
        h("p", { class: "muted" }, "On t'a envoyé un code à 6 chiffres. Il est valable 15 minutes. Pense à regarder dans les spams."),
        field("auth-code", "Code reçu", codeInput()),
      ];
      submit = "Confirmer";
      onSubmit = (f) => a.onVerify({ username: s.username ?? "", code: val(f, "auth-code").trim() });
      break;
    case "forgot":
      body = [
        h("h2", { class: "card-title" }, "Mot de passe oublié"),
        h("p", { class: "muted" }, "Indique l'email de ton compte : on t'envoie un code pour choisir un nouveau mot de passe."),
        field("auth-email", "Email", input("auth-email", { type: "email", autocomplete: "email", required: true, maxlength: 254, value: s.email ?? "" })),
      ];
      submit = "Recevoir un code";
      onSubmit = (f) => a.onForgot(val(f, "auth-email").trim());
      break;
    case "reset":
      body = [
        h("h2", { class: "card-title" }, "Nouveau mot de passe"),
        h("p", { class: "muted" }, `Si un compte existe pour ${s.email ?? "cette adresse"}, un code vient de partir. Toutes tes sessions seront fermées.`),
        field("auth-code", "Code reçu", codeInput()),
        field("auth-pass", "Nouveau mot de passe", input("auth-pass", { type: "password", autocomplete: "new-password", required: true, minlength: 8, maxlength: 200 }), "8 caractères au moins."),
      ];
      submit = "Changer mon mot de passe";
      onSubmit = (f) => a.onReset({ email: s.email ?? "", code: val(f, "auth-code").trim(), password: val(f, "auth-pass") });
      break;
    default:
      body = [
        field("auth-user", "Pseudo", input("auth-user", { autocomplete: "username", required: true, maxlength: 40 })),
        field("auth-pass", "Mot de passe", input("auth-pass", { type: "password", autocomplete: "current-password", required: true, maxlength: 200 })),
      ];
      submit = "Me connecter";
      onSubmit = (f) => a.onLogin({ username: val(f, "auth-user").trim(), password: val(f, "auth-pass") });
  }

  const links: HTMLElement[] = [];
  if (s.mode === "login") links.push(h("button", { type: "button", class: "link", onClick: () => a.onMode("forgot") }, "Mot de passe oublié ?"));
  if (s.mode === "verify") links.push(h("button", { type: "button", class: "link", onClick: () => a.onResend(s.username ?? "") }, "Renvoyer le code"));
  if (s.mode === "verify" || s.mode === "forgot" || s.mode === "reset") {
    links.push(h("button", { type: "button", class: "link", onClick: () => a.onMode("login") }, "Retour à la connexion"));
  }

  const form = h(
    "form",
    {
      class: "card auth-card",
      onSubmit: (e: Event) => {
        e.preventDefault();
        onSubmit(e.currentTarget as HTMLFormElement);
      },
    },
    tabs,
    body,
    s.info ? h("p", { class: "notice", role: "status" }, s.info) : null,
    s.error ? h("p", { class: "error", role: "alert" }, s.error) : null,
    h("button", { type: "submit", class: "btn btn-primary", disabled: s.busy }, s.busy ? "Patiente…" : submit),
    links.length ? h("div", { class: "auth-links" }, links) : null,
  );

  return h(
    "main",
    { class: "page home" },
    h("h1", { class: "display center" }, "COC Tracker"),
    h("p", { class: "lead center" }, "Suis ton avancement pendant le Hammer Jam, et celui de tes potes."),
    form,
  );
}
