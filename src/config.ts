/**
 * In dev, hit `/api/...` which Vite's dev server proxies to the upstream
 * (see vite.config.ts). This keeps the browser same-origin and avoids
 * CORS entirely. In prod, talk to the backend directly; the backend
 * sets `Access-Control-Allow-Origin` via CORSMiddleware.
 */
export const config = {
  apiUrl: import.meta.env.DEV
    ? "/api"
    : (import.meta.env.VITE_ARGILE_API_URL ?? "https://ai-rgile.argile.ai"),
  mapStyle:
    import.meta.env.VITE_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/liberty",
} as const;

// Paris center as initial camera position.
export const INITIAL_VIEW = {
  longitude: 2.3522,
  latitude: 48.8566,
  zoom: 16,
  pitch: 60,
  bearing: -20,
} as const;
