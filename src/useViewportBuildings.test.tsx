/**
 * React hook test for useViewportBuildings. Renders a tiny harness that
 * exposes the hook's return value in the DOM and asserts it updates as
 * tiles resolve, across viewport transitions.
 *
 * The api module is mocked so loadTile() pulls from an in-memory registry
 * keyed by `${lat},${lng}` — same pattern as collections.test.ts — and we
 * don't hit the network.
 */

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { buildingsCollection, pruneTiles, queryClient } from "./collections";
import type { CityJsonBuilding } from "./types";
import { useViewportBuildings, type Bounds } from "./useViewportBuildings";

function fakeBuilding(id: string, lat = 48.8566, lng = 2.3522): CityJsonBuilding {
  return {
    geopf_id: id,
    lat,
    lng,
    multipolygon_geojson: {
      type: "Polygon",
      coordinates: [
        [
          [lng, lat],
          [lng + 0.0001, lat],
          [lng + 0.0001, lat + 0.0001],
          [lng, lat + 0.0001],
          [lng, lat],
        ],
      ],
    },
    cityjson: { type: "CityJSON", version: "2.0", CityObjects: {}, vertices: [] },
  };
}

function Harness({ bounds }: { bounds: Bounds | null }) {
  const buildings = useViewportBuildings(bounds);
  return (
    <div>
      <span data-testid="count">{buildings.length}</span>
      <span data-testid="ids">
        {buildings
          .map((b) => b.geopf_id)
          .sort()
          .join(",")}
      </span>
    </div>
  );
}

describe("useViewportBuildings", () => {
  beforeEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test-only access.
    const registry: Map<string, unknown[]> = (apiMock as any).__registry;
    registry.clear();
    for (const b of [...buildingsCollection.values()]) {
      buildingsCollection.delete(b.geopf_id);
    }
    pruneTiles(new Set());
    queryClient.clear();
    vi.mocked(apiMock.searchBuildingsByRadius).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns [] immediately when bounds is null", () => {
    const { getByTestId } = render(<Harness bounds={null} />);
    expect(getByTestId("count").textContent).toBe("0");
  });

  it("loads buildings for the visible viewport and renders them", async () => {
    // Plant fixtures at every tile the viewport will request. tilesInBounds
    // uses a ~400m degree grid so we drop buildings at every tile center the
    // harness might hit. For this test, we mock the api to return the same
    // two buildings regardless of coordinate — simpler than trying to match
    // tile centers exactly.
    vi.mocked(apiMock.searchBuildingsByRadius).mockImplementation(async () => [
      fakeBuilding("b1"),
      fakeBuilding("b2"),
    ]);

    const bounds: Bounds = {
      minLat: 48.8566,
      maxLat: 48.8566,
      minLng: 2.3522,
      maxLng: 2.3522,
    };

    const { getByTestId } = render(<Harness bounds={bounds} />);

    // Initially empty (effect hasn't run yet or fetches are in flight).
    expect(getByTestId("count").textContent).toBe("0");

    await waitFor(() => {
      expect(Number(getByTestId("count").textContent)).toBeGreaterThanOrEqual(2);
    });
    expect(getByTestId("ids").textContent).toBe("b1,b2");
  });

  it("replaces the rendered set when the viewport moves to a new area", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock impl per-call.
    vi.mocked(apiMock.searchBuildingsByRadius).mockImplementation(async (p: any) => {
      // Return different buildings depending on which tile the viewport hits.
      if (p.lat < 49) return [fakeBuilding("paris-1"), fakeBuilding("paris-2")];
      return [fakeBuilding("lille-1")];
    });

    const paris: Bounds = {
      minLat: 48.8566,
      maxLat: 48.8566,
      minLng: 2.3522,
      maxLng: 2.3522,
    };
    const lille: Bounds = {
      minLat: 50.6292,
      maxLat: 50.6292,
      minLng: 3.0573,
      maxLng: 3.0573,
    };

    const { rerender, getByTestId } = render(<Harness bounds={paris} />);
    await waitFor(() => {
      expect(getByTestId("ids").textContent).toBe("paris-1,paris-2");
    });

    await act(async () => {
      rerender(<Harness bounds={lille} />);
    });

    await waitFor(() => {
      expect(getByTestId("ids").textContent).toBe("lille-1");
    });
  });
});
