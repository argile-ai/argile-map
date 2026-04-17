/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const upstream = env.VITE_ARGILE_API_URL ?? "https://ai-rgile.argile.ai";
  const argeme = env.VITE_ARGEME_API_URL ?? "https://argeme.argile.app";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Proxy API calls so the browser stays same-origin and we don't hit
      // CORS during local development. The frontend picks up the `/api` and
      // `/argeme` bases in dev (see src/config.ts) and the proxies rewrite
      // them to the upstream services.
      proxy: {
        "/api": {
          target: upstream,
          changeOrigin: true,
          secure: true,
          rewrite: (path: string) => path.replace(/^\/api/, ""),
        },
        "/argeme": {
          target: argeme,
          changeOrigin: true,
          secure: true,
          rewrite: (path: string) => path.replace(/^\/argeme/, ""),
        },
      },
    },
    test: {
      environment: "happy-dom",
      globals: true,
      include: ["src/**/*.test.{ts,tsx}"],
      server: {
        deps: {
          // cityjson-threejs-loader is ESM but its internal imports omit
          // the `.js` extension. Vite dev/build handles this; Vitest's
          // stricter SSR resolver doesn't. Inlining forces it through
          // Vite's transform pipeline.
          inline: [/cityjson-threejs-loader/],
        },
      },
    },
  };
});
