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
