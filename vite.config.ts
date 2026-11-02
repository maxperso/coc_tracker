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
  base: "./",
  plugins: [csp()],
  test: { include: ["tests/**/*.test.ts"] },
});
