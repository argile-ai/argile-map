import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

/**
 * Code splitting: MapLibre + deck.gl + three.js + cityjson-threejs-loader
 * together weigh ~1.1 MB. Lazy-load the whole map app so the initial chunk
 * only contains React + this shell (~40 KB). The first paint is a simple
 * "Loading..." overlay, then the rest streams in.
 */
const App = lazy(() => import("./App").then((m) => ({ default: m.App })));

// Register the API-cache service worker. Only in prod — the SW lifecycle
// fights with Vite's HMR in dev, and revisits matter most for real users
// not local development. See public/sw.js for the strategy.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker
    .register("/sw.js")
    .catch((err) => console.warn("SW registration failed", err));
}

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <Suspense
      fallback={
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0b0f14",
            color: "#c0c8d4",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Loading map…
        </div>
      }
    >
      <App />
    </Suspense>
  </StrictMode>,
);
