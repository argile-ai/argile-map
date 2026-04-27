/**
 * Service worker — stale-while-revalidate cache for the four viewport
 * search endpoints that drive map.argile.ai. Revisits to a previously
 * panned area read from disk cache instead of re-fetching ~24 MB per pan.
 *
 * Why each endpoint is here:
 *   - /cityjson/search       (POST) — 8.6 MB / pan in Marseille
 *   - /trees/search          (POST) — ~400 KB / pan
 *   - /sat/detections/search (POST) — 3.8 MB / pan
 *   - /bdnb/complet/bbox     (GET)  — 11.4 MB / pan
 *
 * Strategy: stale-while-revalidate with a 24 h freshness window.
 *   - Cache hit, age < 24 h:    serve cached, no network.
 *   - Cache hit, age >= 24 h:   serve cached, refresh in background.
 *   - Cache miss:                fetch + store.
 *
 * POST requests can't be Cache API keys directly, so we hash the URL +
 * body into a synthetic GET URL for the cache. Identical viewport
 * requests hash to the same key (the bbox is already grid-snapped client
 * side after PR #8).
 *
 * Cache versioning: bump CACHE_VERSION when the response shape changes
 * incompatibly. The activate hook drops old caches.
 */

// Bumped from v1 → v2 (2026-04-27) to invalidate cached responses that came
// from the misaligned-footprints v2 cityjson cohort. The activate hook drops
// the old cache namespace.
const CACHE_VERSION = "v2";
const CACHE_NAME = `argile-api-${CACHE_VERSION}`;
const TTL_MS = 24 * 60 * 60 * 1000;

const API_HOSTS = new Set(["ai-rgile.argile.ai", "argeme.argile.app"]);
const CACHEABLE_PATH = /^\/(cityjson\/search|trees\/search|sat\/detections\/search|bdnb\/complet\/bbox)/;

self.addEventListener("install", () => {
  // Activate immediately on first install so users don't need a second
  // page reload to start benefiting from the cache.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("argile-api-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

async function buildCacheKey(req) {
  if (req.method === "GET") return new Request(req.url, { method: "GET" });
  const body = await req.clone().text();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(req.url + body));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
  // Synthetic GET URL whose pathname is unique to this body — Cache API only
  // accepts GET as the lookup key.
  return new Request(`${req.url}#sw=${hex}`, { method: "GET" });
}

async function storeWithTimestamp(cache, key, response) {
  const blob = await response.clone().blob();
  const headers = new Headers(response.headers);
  headers.set("x-sw-cached-at", String(Date.now()));
  await cache.put(
    key,
    new Response(blob, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
}

async function revalidate(req, key, cache) {
  try {
    const fresh = await fetch(req);
    if (fresh.ok) await storeWithTimestamp(cache, key, fresh);
  } catch {
    // Offline / network blip — keep the stale entry until the next try.
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (!API_HOSTS.has(url.hostname)) return;
  if (!CACHEABLE_PATH.test(url.pathname)) return;
  if (req.method !== "GET" && req.method !== "POST") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const key = await buildCacheKey(req);
      const cached = await cache.match(key);
      if (cached) {
        const cachedAt = Number(cached.headers.get("x-sw-cached-at") ?? 0);
        const stale = Date.now() - cachedAt >= TTL_MS;
        if (stale) event.waitUntil(revalidate(req, key, cache));
        return cached;
      }
      const fresh = await fetch(req);
      if (fresh.ok) event.waitUntil(storeWithTimestamp(cache, key, fresh.clone()));
      return fresh;
    })(),
  );
});
