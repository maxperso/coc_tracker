import nodemailer from "nodemailer";
import type { SmtpConfig } from "./config";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export function smtpMailer(cfg: SmtpConfig): Mailer & { verify(): Promise<unknown> } {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure && cfg.requireTls,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: cfg.from, to: mail.to, subject: mail.subject, text: mail.text });
    },
    verify: () => transport.verify(),
  };
}

/** Dev sans SMTP : l'email est écrit dans la console du serveur. */
export const consoleMailer: Mailer = {
  async send(mail) {
    console.log(`\n--- Email pour ${mail.to} : ${mail.subject}\n${mail.text}\n---\n`);
  },
};

const SIGN = "\n\n— COC Tracker\nSi tu n'es pas à l'origine de cette demande, ignore ce message.";

/** Notifications : on dit pourquoi on écrit et comment arrêter. */
const NOTIFY_SIGN = "\n\n— COC Tracker\nTu reçois ce message parce que tu as créé ce ticket. Pour ne plus en recevoir : Mon compte › Emails.";

export const mails = {
  ticketDeployed: (to: string, username: string, title: string, link: string): Mail => ({
    to,
    subject: `Déployé : ${title}`,
    text: `Salut ${username},\n\nTon ticket « ${title} » est passé en Déployé : c'est en ligne sur COC Tracker.\nVérifie que ça marche chez toi, puis valide-le :\n${link}${NOTIFY_SIGN}`,
  }),
  ticketComment: (to: string, username: string, author: string, title: string, excerpt: string, link: string): Mail => ({
    to,
    subject: `${author} a commenté « ${title} »`,
    text: `Salut ${username},\n\n${author} a commenté ton ticket « ${title} » :\n\n${excerpt}\n\nRépondre :\n${link}${NOTIFY_SIGN}`,
  }),
  verify: (to: string, username: string, code: string): Mail => ({
    to,
    subject: `${code} : ton code COC Tracker`,
    text: `Salut ${username},\n\nVoici ton code pour confirmer ton compte COC Tracker : ${code}\n\nIl est valable 15 minutes.${SIGN}`,
  }),
  reset: (to: string, username: string, code: string): Mail => ({
    to,
    subject: `${code} : réinitialisation de ton mot de passe`,
    text: `Salut ${username},\n\nVoici ton code pour choisir un nouveau mot de passe : ${code}\n\nIl est valable 15 minutes. Toutes tes sessions seront fermées après le changement.${SIGN}`,
  }),
  alreadyRegistered: (to: string, username: string): Mail => ({
    to,
    subject: "Tu as déjà un compte COC Tracker",
    text: `Salut,\n\nQuelqu'un a voulu créer un compte avec cette adresse, mais elle est déjà liée au compte « ${username} ».\nSi tu as oublié ton mot de passe, utilise « Mot de passe oublié » sur la page de connexion.${SIGN}`,
  }),
};
