import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** wrangler dev (apps/server) listens here. Override with HERALD_API=http://host:port. */
const API_TARGET = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.HERALD_API ??
  "http://localhost:8787";

// Keep the Host header (changeOrigin: false) so the server builds redirects/snippet URLs for the Vite origin.
const proxied = { target: API_TARGET, changeOrigin: false };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api/ws": { ...proxied, ws: true },
      "/api": proxied,
      "/auth": proxied,
      "/hook": proxied,
      "/mcp": proxied,
      "/healthz": proxied,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks cache well across deploys.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|react-router|scheduler|cookie)[\\/]/ },
            { name: "query", test: /node_modules[\\/]@tanstack[\\/]/ },
            { name: "schema", test: /node_modules[\\/]zod[\\/]|packages[\\/]schema[\\/]/ },
          ],
        },
      },
    },
  },
});
