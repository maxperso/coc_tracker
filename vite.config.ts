import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// CSP stricte, ajoutée seulement au build : le serveur de dev injecte des styles en ligne.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "csp-meta",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  // Chemins absolus : le serveur renvoie index.html pour toutes les routes du site.
  base: "/",
  plugins: [csp()],
  // En dev, l'API tourne à part (npm run dev:server) : Vite lui transmet /api.
  server: { proxy: { "/api": "http://localhost:3000" } },
  test: { include: ["tests/**/*.test.ts"] },
});
