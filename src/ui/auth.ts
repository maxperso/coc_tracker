import { passwordStrength } from "../lib/passwordStrength";
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
  /** Retour à la page d'accueil publique. */
  onHome: () => void;
}

const input = (id: string, attrs: Record<string, string | number | boolean>) =>
  h("input", { id, class: "input", spellcheck: "false", autocapitalize: "none", ...attrs });

const field = (id: string, label: string, el: HTMLElement, hint?: string) =>
  h("div", { class: "field" }, h("label", { for: id }, label), el, hint ? h("p", { class: "hint" }, hint) : null);

/**
 * Mot de passe + confirmation, avec une jauge de force (rouge, jaune, vert) mise à jour à la frappe.
 * `check()` renvoie un message d'erreur ou null.
 */
function passwordFields(label: string, username: () => string): { el: HTMLElement; check: () => string | null } {
  const pass = input("auth-pass", { type: "password", autocomplete: "new-password", required: true, minlength: 8, maxlength: 200, "aria-describedby": "pw-strength" });
  const confirm = input("auth-pass2", { type: "password", autocomplete: "new-password", required: true, maxlength: 200, "aria-describedby": "pw-match" });
  const fill = h("span", { class: "meter-fill" });
  const level = h("span", { class: "meter-label" }, "");
  const hint = h("span", { class: "hint" }, "8 caractères au moins.");
  const meter = h("div", { class: "meter", "data-level": "0" }, h("span", { class: "meter-track" }, fill), level);
  const match = h("p", { id: "pw-match", class: "hint match", "aria-live": "polite" });

  const update = () => {
    const s = passwordStrength(pass.value, username());
    meter.dataset.level = pass.value ? String(s.level) : "empty";
    level.textContent = pass.value ? s.label : "";
    hint.textContent = s.hint;
    if (!confirm.value) {
      match.textContent = "";
      match.className = "hint match";
    } else if (confirm.value === pass.value) {
      match.textContent = "Les deux mots de passe correspondent.";
      match.className = "hint match ok";
    } else {
      match.textContent = "Les deux mots de passe sont différents.";
      match.className = "hint match bad";
    }
    confirm.setCustomValidity(confirm.value && confirm.value !== pass.value ? "Les deux mots de passe sont différents." : "");
  };
  pass.addEventListener("input", update);
  confirm.addEventListener("input", update);

  return {
    el: h(
      "div",
      { class: "pw-group" },
      h("div", { class: "field" }, h("label", { for: "auth-pass" }, label), pass, h("div", { id: "pw-strength", "aria-live": "polite" }, meter, hint)),
      h("div", { class: "field" }, h("label", { for: "auth-pass2" }, "Confirme le mot de passe"), confirm, match),
    ),
    check: () => {
      if (pass.value.length < 8) return "Mot de passe : 8 caractères au moins.";
      if (pass.value !== confirm.value) return "Les deux mots de passe sont différents.";
      return null;
    },
  };
}

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
  let pw: ReturnType<typeof passwordFields> | null = null;
  const val = (f: HTMLFormElement, id: string) => (f.querySelector(`#${id}`) as HTMLInputElement | null)?.value ?? "";
  let userInput: HTMLInputElement | null = null;

  switch (s.mode) {
    case "register":
      userInput = input("auth-user", { autocomplete: "username", required: true, minlength: 3, maxlength: 20, pattern: "[A-Za-z0-9_\\-]{3,20}" });
      pw = passwordFields("Mot de passe", () => userInput?.value ?? "");
      body = [
        field("auth-user", "Pseudo", userInput, "3 à 20 lettres, chiffres, - ou _. Visible par tes amis."),
        field("auth-email", "Email", input("auth-email", { type: "email", autocomplete: "email", required: true, maxlength: 254 }), "Pour le code de confirmation et le mot de passe oublié. Jamais affiché."),
        pw.el,
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
      pw = passwordFields("Nouveau mot de passe", () => "");
      body = [
        h("h2", { class: "card-title" }, "Nouveau mot de passe"),
        h("p", { class: "muted" }, `Si un compte existe pour ${s.email ?? "cette adresse"}, un code vient de partir. Toutes tes sessions seront fermées.`),
        field("auth-code", "Code reçu", codeInput()),
        pw.el,
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
        const problem = pw?.check();
        const err = (e.currentTarget as HTMLFormElement).querySelector(".form-error");
        if (problem) {
          if (err) err.textContent = problem;
          (document.getElementById(problem.includes("différents") ? "auth-pass2" : "auth-pass") as HTMLInputElement | null)?.focus();
          return;
        }
        onSubmit(e.currentTarget as HTMLFormElement);
      },
    },
    tabs,
    body,
    s.info ? h("p", { class: "notice", role: "status" }, s.info) : null,
    h("p", { class: "error form-error", role: "alert" }, s.error ?? ""),
    h("button", { type: "submit", class: "btn btn-primary", disabled: s.busy }, s.busy ? "Patiente…" : submit),
    links.length ? h("div", { class: "auth-links" }, links) : null,
  );

  return h(
    "main",
    { class: "page home auth-page" },
    h("button", { type: "button", class: "link back-link", onClick: a.onHome }, "← Accueil"),
    h("h1", { class: "display center" }, "COC Tracker"),
    h("p", { class: "lead center" }, "Suis ton avancement pendant le Hammer Jam, et celui de tes amis."),
    form,
  );
}
