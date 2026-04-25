/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const upstream = env.VITE_ARGILE_API_URL ?? "https://ai-rgile.argile.ai";
  const argeme = env.VITE_ARGEME_API_URL ?? "https://argeme.argile.app";

  return {
    plugins: [react()],
    build: {
      // Split the heavy 3D vendor libs into their own chunks so they
      // can preload in parallel and stay cached across redeploys that
      // only touch app code. Shaves ~200 ms off LCP on cold visits.
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes("node_modules/@deck.gl")) return "deck-gl";
            if (id.includes("node_modules/three") || id.includes("cityjson-threejs-loader"))
              return "three";
            return undefined;
          },
        },
      },
    },
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
