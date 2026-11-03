import { describe, expect, it } from "vitest";
import { vapidSubject } from "../server/config";
import { serviceName } from "../server/push";

describe("contact VAPID", () => {
  it("garde une adresse valide", () => {
    expect(vapidSubject({ VAPID_SUBJECT: "mailto:no-reply@maxperso.fr" })).toBe("mailto:no-reply@maxperso.fr");
    expect(vapidSubject({ VAPID_SUBJECT: "https://coc.maxperso.fr" })).toBe("https://coc.maxperso.fr");
  });
  it("remplace une adresse refusée par Apple par celle du site, sinon l'expéditeur des emails", () => {
    expect(vapidSubject({ VAPID_SUBJECT: "mailto:admin@localhost", APP_ORIGIN: "https://coc.maxperso.fr/" })).toBe("https://coc.maxperso.fr");
    expect(vapidSubject({ APP_ORIGIN: "https://coc.maxperso.fr" })).toBe("https://coc.maxperso.fr");
    expect(vapidSubject({ APP_ORIGIN: "http://localhost:3001", MAIL_FROM: "COC Tracker <no-reply@maxperso.fr>" })).toBe("mailto:no-reply@maxperso.fr");
  });
  it("nomme le service push d'un appareil", () => {
    expect(serviceName("https://web.push.apple.com/abc")).toBe("Apple");
    expect(serviceName("https://fcm.googleapis.com/fcm/send/x")).toBe("Google");
  });
});
