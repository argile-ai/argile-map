/**
 * React hook test for useViewportBuildings. Mocks the api module so the
 * debounced polygon fetch returns a deterministic list, then renders a
 * harness and asserts the hook resolves to the expected building set
 * across a viewport transition.
 */

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  searchBuildingsInBounds: vi.fn(),
}));

import * as apiMock from "./api";
import { buildingsCollection, queryClient } from "./collections";
import type { CityJsonBuilding } from "./types";
import { useViewportBuildings, type Bounds } from "./useViewportBuildings";

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
    cityjson: { type: "CityJSON", version: "2.0", CityObjects: {}, vertices: [] },
  };
}

function Harness({ bounds }: { bounds: Bounds | null }) {
  const buildings = useViewportBuildings(bounds);
  return (
    <div>
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
    for (const b of [...buildingsCollection.values()]) {
      buildingsCollection.delete(b.geopf_id);
    }
    queryClient.clear();
    vi.mocked(apiMock.searchBuildingsInBounds).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns [] when bounds is null", () => {
    const { getByTestId } = render(<Harness bounds={null} />);
    expect(getByTestId("ids").textContent).toBe("");
  });

  it("loads buildings for the current viewport via a single polygon query", async () => {
    vi.mocked(apiMock.searchBuildingsInBounds).mockImplementation(async () => [
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

    await waitFor(() => {
      expect(getByTestId("ids").textContent).toBe("b1,b2");
    });
    // Exactly one request per viewport — no tile grid, no per-tile fanout.
    expect(vi.mocked(apiMock.searchBuildingsInBounds)).toHaveBeenCalledTimes(1);
  });

  it("replaces the set when the viewport moves", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: per-call mock impl.
    vi.mocked(apiMock.searchBuildingsInBounds).mockImplementation(async (p: any) => {
      return p.bounds.minLat < 49
        ? [fakeBuilding("paris-1"), fakeBuilding("paris-2")]
        : [fakeBuilding("lille-1")];
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
