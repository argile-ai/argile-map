# argile-map

Interactive 3D viewer for French buildings reconstructed from LIDAR+BD TOPO.
Loads precomputed CityJSON buildings from the Argile AI `/cityjson/search`
endpoint as the map camera moves.

## Stack

- **Vite + React 19 + TypeScript**
- **MapLibre GL** (vector basemap via `react-map-gl`)
- **deck.gl** for the 3D overlay (interleaved `MapboxOverlay`, `PolygonLayer`
  with extrusion)
- **TanStack DB** collections for reactive data (one collection per ~400 m
  geo tile, live-merged into the rendered set)
- **cityjson-threejs-loader** when/if we upgrade to full roof meshes

## Data flow

```
viewport bounds
      │
      ▼
  tile grid              (src/tiles.ts)
      │
      ▼
per-tile TanStack DB collection   (src/collections.ts)
      │   queryFn → POST /cityjson/search {center, radius_m, limit}
      ▼
useViewportBuildings()    (src/useViewportBuildings.ts)
      │   subscribeChanges × N tiles → aggregated map
      ▼
createBuildingLayer()     (src/BuildingLayer.ts)
      │   extract footprint polygon + roof height from CityJSON vertices
      ▼
deck.gl PolygonLayer (extruded)
```

Moving the map recomputes the set of visible tiles. New tiles spin up their
TanStack DB collection on first access (and fetch). Tiles that leave the
viewport are pruned so the browser memory stays bounded.

## Setup

```bash
pnpm install                  # or npm / bun / yarn
cp .env.example .env.local
# edit .env.local and set VITE_ARGILE_API_KEY
pnpm dev
```

## Notes

The MVP renders buildings as extruded footprints (fast, ~1 draw call). The
real CityJSON mesh parsing is available in `src/cityjsonMesh.ts` using the
same `cityjson-threejs-loader` as `argile-web-ui`
(`qualif/components/QualificationForm/MursDetailSection/helpers/cityJsonSceneSetup.ts`)
and can be wired into a deck.gl `SimpleMeshLayer` in a follow-up.
