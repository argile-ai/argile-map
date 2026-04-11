/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        // cityjson-threejs-loader is ESM but its internal imports omit the
        // `.js` extension. Vite's dev/build resolver handles this; Vitest's
        // stricter SSR resolver doesn't. Inlining the package forces it to
        // go through Vite's transform pipeline.
        inline: [/cityjson-threejs-loader/],
      },
    },
  },
});
