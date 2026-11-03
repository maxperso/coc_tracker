import { describe, expect, it } from "vitest";
import { deviceOf } from "../server/admin";

describe("appareil d'une connexion", () => {
  it("reconnaît le système et le navigateur, sans rien garder d'autre", () => {
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")).toBe("iPhone · app installée");
    expect(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe("Windows · Chrome");
    expect(deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe("Mac · Safari");
    expect(deviceOf("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(deviceOf(undefined)).toBe("inconnu");
  });
});
