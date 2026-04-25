/**
 * Service-worker cache validation probe.
 *
 * Measures the per-endpoint round-trip time on two consecutive Marseille
 * viewport visits and prints a before/after table. Used to validate that
 * the SW (public/sw.js) actually shaves the second visit, and to spot
 * regressions in future PRs.
 *
 * Usage:
 *   npx --yes playwright@1 install chromium    # one-time
 *   node perf/probe-cache.mjs                  # against prod
 *   PROBE_URL=http://localhost:5173 node perf/probe-cache.mjs   # dev
 *
 * Reads:
 *   PROBE_URL — base URL to test (default https://map.argile.ai/)
 */

import { chromium } from "playwright";

const URL = process.env.PROBE_URL ?? "https://map.argile.ai/";
const TARGETS = [
  { name: "cityjson", re: /\/cityjson\/search/ },
  { name: "trees", re: /\/trees\/search/ },
  { name: "detections", re: /\/sat\/detections\/search/ },
  { name: "bdnb", re: /\/bdnb\/complet\/bbox/ },
];

function endpointName(url) {
  return TARGETS.find((t) => t.re.test(url))?.name ?? null;
}

async function panToMarseille(page) {
  const start = Date.now();
  const responses = [];

  const handler = async (resp) => {
    const name = endpointName(resp.url());
    if (!name) return;
    let bytes = -1;
    try {
      bytes = (await resp.body()).length;
    } catch {
      // some bodies are drained by the time we get here; that's fine.
    }
    responses.push({
      endpoint: name,
      bytes,
      timing: Math.round(resp.request().timing().responseEnd ?? 0),
      fromSW: resp.fromServiceWorker?.() ?? false,
      status: resp.status(),
    });
  };
  page.on("response", handler);

  // PR #10 made Enter validate the top suggestion in the address search.
  const input = page.getByPlaceholder("Rechercher une adresse…");
  await input.click();
  await input.fill("");
  await input.type("marseille");
  await page.waitForTimeout(800); // wait for autocomplete to populate
  await input.press("Enter");

  // Wait for at least one response from each endpoint, then settle.
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const seen = new Set(responses.map((r) => r.endpoint));
    if (seen.size >= TARGETS.length) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2000);

  page.off("response", handler);
  return { responses, elapsed: Date.now() - start };
}

function summarise(label, run) {
  const total = run.responses.reduce((a, r) => a + Math.max(0, r.bytes), 0);
  console.log(`\n=== ${label} ===`);
  console.log(
    `elapsed: ${run.elapsed} ms · total bytes: ${(total / 1024 / 1024).toFixed(2)} MB`,
  );
  for (const r of run.responses) {
    const sizeStr = r.bytes >= 0 ? `${(r.bytes / 1024).toFixed(1).padStart(8)} KB` : "        ?";
    console.log(
      `  ${r.endpoint.padEnd(11)} ${sizeStr}  status=${r.status}  fromSW=${r.fromSW}  timing=${String(r.timing).padStart(5)}ms`,
    );
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log(`navigating to ${URL}`);
  await page.goto(URL, { waitUntil: "load" });

  console.log("waiting for service worker…");
  await page.waitForFunction(
    async () => {
      if (!("serviceWorker" in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return !!(reg && reg.active);
    },
    null,
    { timeout: 20_000 },
  );
  console.log("SW active.");

  const first = await panToMarseille(page);
  summarise("VISIT 1 (cold)", first);

  await page.waitForTimeout(2000); // let SW finish writing to Cache Storage

  console.log("\nreloading page to retest with primed cache…");
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(
    async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!(reg && reg.active);
    },
    null,
    { timeout: 10_000 },
  );

  const second = await panToMarseille(page);
  summarise("VISIT 2 (SW cache primed)", second);

  console.log("\n--- Speedup per endpoint (cold ms / cached ms) ---");
  for (const t of TARGETS) {
    const c = first.responses.find((r) => r.endpoint === t.name);
    const w = second.responses.find((r) => r.endpoint === t.name);
    if (c && w && w.timing > 0) {
      console.log(
        `  ${t.name.padEnd(11)} ${String(c.timing).padStart(5)}ms → ${String(w.timing).padStart(5)}ms (${(c.timing / w.timing).toFixed(0)}×)`,
      );
    } else {
      console.log(`  ${t.name.padEnd(11)} (no comparable pair)`);
    }
  }

  await browser.close();
})();
