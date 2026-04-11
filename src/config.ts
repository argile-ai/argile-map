export const config = {
  apiUrl: import.meta.env.VITE_ARGILE_API_URL ?? "https://ai-rgile.argile.ai",
  apiKey: import.meta.env.VITE_ARGILE_API_KEY ?? "",
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
