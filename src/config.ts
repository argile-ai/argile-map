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
  argemeUrl: import.meta.env.DEV
    ? "/argeme"
    : (import.meta.env.VITE_ARGEME_API_URL ?? "https://argeme.argile.app"),
  argileApiUrl: import.meta.env.VITE_ARGILE_BUSINESS_API_URL ?? "https://api.argile.ai",
  argileWebUrl: import.meta.env.VITE_ARGILE_WEB_URL ?? "https://app.argile.ai",
  argileBranchId: import.meta.env.VITE_ARGILE_BRANCH_ID ?? "5d1f455c-91e9-43f8-9fcc-f028b42e23cb",
  mapStyle: import.meta.env.VITE_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/liberty",
} as const;

// 21 Rue de l'Oppidum, 62000 Arras.
export const INITIAL_VIEW = {
  longitude: 2.742413,
  latitude: 50.305751,
  zoom: 18.5,
  pitch: 60,
  bearing: -20,
} as const;
