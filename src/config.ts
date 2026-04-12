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

// 90 rue des Marguerites, Antony (92).
export const INITIAL_VIEW = {
  longitude: 2.2957,
  latitude: 48.7582,
  zoom: 17,
  pitch: 60,
  bearing: -20,
} as const;
