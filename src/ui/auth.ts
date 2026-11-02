import { h } from "./dom";
import { legalFooter } from "./legal";

export type AuthMode = "login" | "register";

export function authView(opts: {
  mode: AuthMode;
  error?: string;
  busy: boolean;
  onMode: (m: AuthMode) => void;
  onSubmit: (data: { username: string; password: string; inviteCode: string }) => void;
}): HTMLElement {
  const register = opts.mode === "register";
  const username = h("input", { id: "auth-user", class: "input", autocomplete: "username", required: true, minlength: 3, maxlength: 20, pattern: "[A-Za-z0-9_\\-]{3,20}", spellcheck: "false", autocapitalize: "none" });
  const password = h("input", { id: "auth-pass", class: "input", type: "password", autocomplete: register ? "new-password" : "current-password", required: true, minlength: register ? 8 : 1, maxlength: 200 });
  const invite = register ? h("input", { id: "auth-invite", class: "input", autocomplete: "off", required: true, maxlength: 200, spellcheck: "false" }) : null;

  const tab = (m: AuthMode, label: string) =>
    h("button", { type: "button", role: "tab", class: "tab", "aria-selected": String(opts.mode === m), onClick: () => opts.onMode(m) }, label);

  return h(
    "main",
    { class: "page home" },
    h("h1", { class: "display center" }, "Hammer Jam"),
    h("p", { class: "lead center" }, "Suis ton avancement pendant le Jam, et celui de tes potes."),
    h(
      "form",
      {
        class: "card auth-card",
        onSubmit: (e: Event) => {
          e.preventDefault();
          opts.onSubmit({ username: username.value.trim(), password: password.value, inviteCode: invite?.value.trim() ?? "" });
        },
      },
      h("div", { class: "auth-tabs", role: "tablist" }, tab("login", "Connexion"), tab("register", "Créer un compte")),
      h("div", { class: "field" }, h("label", { for: "auth-user" }, "Pseudo"), username, register ? h("p", { class: "hint" }, "3 à 20 lettres, chiffres, - ou _.") : null),
      h("div", { class: "field" }, h("label", { for: "auth-pass" }, "Mot de passe"), password, register ? h("p", { class: "hint" }, "8 caractères au moins.") : null),
      invite ? h("div", { class: "field" }, h("label", { for: "auth-invite" }, "Code d'invitation"), invite, h("p", { class: "hint" }, "Demande-le à celui qui t'a envoyé le lien.")) : null,
      opts.error ? h("p", { class: "error", role: "alert" }, opts.error) : null,
      h("button", { type: "submit", class: "btn btn-primary", disabled: opts.busy }, register ? "Créer mon compte" : "Me connecter"),
    ),
    legalFooter(true),
  );
}
