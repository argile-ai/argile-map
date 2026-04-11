/**
 * Integration test for the reactive building store. Stubs the network layer
 * so loadTile() pulls from an in-memory map, then asserts:
 *
 *   - buildings land in the single `buildingsCollection` via writeInsert
 *   - duplicates are deduped (same building present in two tiles)
 *   - pruneTiles() removes buildings unique to evicted tiles
 *   - the collection re-populates when the tile is re-loaded
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => {
  const registry = new Map<string, unknown[]>();
  return {
    __registry: registry,
    searchBuildingsByRadius: vi.fn(async (params: { lat: number; lng: number }) => {
      const key = `${params.lat.toFixed(4)},${params.lng.toFixed(4)}`;
      return registry.get(key) ?? [];
    }),
  };
});

import * as apiMock from "./api";
import { buildingsCollection, loadTile, pruneTiles, queryClient } from "./collections";
import type { Tile } from "./tiles";
import type { CityJsonBuilding } from "./types";

function fakeBuilding(id: string): CityJsonBuilding {
  return {
    geopf_id: id,
    lat: 48.8566,
    lng: 2.3522,
    multipolygon_geojson: {
      type: "Polygon",
      coordinates: [
        [
          [2.3522, 48.8566],
          [2.3523, 48.8566],
          [2.3523, 48.8567],
          [2.3522, 48.8567],
          [2.3522, 48.8566],
        ],
      ],
    },
    // Empty cityjson is enough — collections.ts doesn't parse it, only the
    // renderer does.
    cityjson: {
      type: "CityJSON",
      version: "2.0",
      CityObjects: {},
      vertices: [],
    },
  };
}

function fakeTile(id: string, lat: number, lng: number): Tile {
  return { id: id as Tile["id"], lat, lng, radiusM: 300 };
}

describe("loadTile + pruneTiles", () => {
  beforeEach(() => {
    // Reset both the backing registry AND the collection state. The real app
    // never clears the collection, so we poke at it through its internal
    // write utilities here.
    // biome-ignore lint/suspicious/noExplicitAny: test-only access to mock state.
    const registry: Map<string, unknown[]> = (apiMock as any).__registry;
    registry.clear();
    for (const b of [...buildingsCollection.values()]) {
      buildingsCollection.delete(b.geopf_id);
    }
    pruneTiles(new Set());
    // The tile-level HTTP cache must also be cleared, otherwise loadTile()
    // in a later test would return data cached from an earlier one.
    queryClient.clear();
    vi.mocked(apiMock.searchBuildingsByRadius).mockClear();
  });

  it("inserts buildings from a fetched tile into the single collection", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test-only access to mock state.
    const registry: Map<string, unknown[]> = (apiMock as any).__registry;
    const lat = 48.8566;
    const lng = 2.3522;
    registry.set(`${lat.toFixed(4)},${lng.toFixed(4)}`, [
      fakeBuilding("b1"),
      fakeBuilding("b2"),
    ]);

    await loadTile(fakeTile("t1", lat, lng));

    const all = [...buildingsCollection.values()];
    const ids = all.map((b) => b.geopf_id).sort();
    expect(ids).toEqual(["b1", "b2"]);
  });

  it("dedupes buildings that appear in two tiles", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test-only access to mock state.
    const registry: Map<string, unknown[]> = (apiMock as any).__registry;
    registry.set("48.8566,2.3522", [fakeBuilding("shared"), fakeBuilding("only-a")]);
    registry.set("48.8570,2.3525", [fakeBuilding("shared"), fakeBuilding("only-b")]);

    await loadTile(fakeTile("tA", 48.8566, 2.3522));
    await loadTile(fakeTile("tB", 48.8570, 2.3525));

    const ids = [...buildingsCollection.values()].map((b) => b.geopf_id).sort();
    expect(ids).toEqual(["only-a", "only-b", "shared"]);
  });

  it("prunes buildings from evicted tiles but keeps shared ones", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test-only access to mock state.
    const registry: Map<string, unknown[]> = (apiMock as any).__registry;
    registry.set("48.8566,2.3522", [fakeBuilding("shared"), fakeBuilding("only-a")]);
    registry.set("48.8570,2.3525", [fakeBuilding("shared"), fakeBuilding("only-b")]);

    await loadTile(fakeTile("tA", 48.8566, 2.3522));
    await loadTile(fakeTile("tB", 48.8570, 2.3525));

    // Evict tB — only-b should disappear, shared should stay (still in tA),
    // only-a should stay.
    pruneTiles(new Set(["tA"] as unknown as Iterable<Tile["id"]>));

    const ids = [...buildingsCollection.values()].map((b) => b.geopf_id).sort();
    expect(ids).toEqual(["only-a", "shared"]);
  });

  it("is idempotent: re-loading the same tile is a no-op", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test-only access to mock state.
    const registry: Map<string, unknown[]> = (apiMock as any).__registry;
    registry.set("48.8566,2.3522", [fakeBuilding("b1")]);

    await loadTile(fakeTile("t1", 48.8566, 2.3522));
    await loadTile(fakeTile("t1", 48.8566, 2.3522));

    const ids = [...buildingsCollection.values()].map((b) => b.geopf_id);
    expect(ids).toEqual(["b1"]);
    // Fetch was cached by TanStack Query after the first call.
    // biome-ignore lint/suspicious/noExplicitAny: mock introspection.
    const calls = (apiMock.searchBuildingsByRadius as any).mock.calls.length;
    expect(calls).toBe(1);
  });
});
