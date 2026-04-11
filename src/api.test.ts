import { afterEach, describe, expect, it, vi } from "vitest";
import { searchBuildingsInBounds, searchDetectionsByBounds } from "./api";

const fakeBuilding = {
  geopf_id: "batiment.1",
  lat: 48.8566,
  lng: 2.3522,
  multipolygon_geojson: {
    type: "Polygon" as const,
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

describe("searchBuildingsInBounds", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("POSTs a WGS84 polygon to /cityjson/search and returns the buildings", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ count: 1, buildings: [fakeBuilding], query_ms: 3.2 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await searchBuildingsInBounds({
      bounds: { minLat: 48.85, maxLat: 48.87, minLng: 2.33, maxLng: 2.36 },
      limit: 2000,
    });

    expect(out).toHaveLength(1);
    expect(out[0].geopf_id).toBe("batiment.1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const url = call[0];
    const init = call[1];
    expect(url).toContain("/cityjson/search");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.crs).toBe("EPSG:4326");
    expect(body.limit).toBe(2000);
    expect(body.geometry.type).toBe("Polygon");
    // Closed ring (5 coordinates for a rect).
    expect(body.geometry.coordinates[0]).toHaveLength(5);
    expect(body.geometry.coordinates[0][0]).toEqual([2.33, 48.85]);
    expect(body.geometry.coordinates[0][4]).toEqual([2.33, 48.85]);
  });

  it("throws when the server returns a non-OK status", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("boom", { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(
      searchBuildingsInBounds({
        bounds: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 },
      }),
    ).rejects.toThrow(/500/);
  });
});

describe("searchDetectionsByBounds", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("POSTs a WGS84 polygon to /sat/detections/search and returns detections", async () => {
    const fakeDet = {
      building_id: "b1",
      label: "roof window",
      score: 0.9,
      box_xmin: 0,
      box_ymin: 0,
      box_xmax: 10,
      box_ymax: 10,
      center_lat: 48.86,
      center_lon: 2.34,
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ count: 1, detections: [fakeDet] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await searchDetectionsByBounds({
      bounds: { minLat: 48.85, maxLat: 48.87, minLng: 2.33, maxLng: 2.36 },
      minScore: 0.5,
    });

    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("roof window");

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const url = call[0];
    const body = JSON.parse(call[1].body as string);
    expect(url).toContain("/sat/detections/search");
    expect(body.crs).toBe("EPSG:4326");
    expect(body.min_score).toBe(0.5);
    expect(body.geometry.type).toBe("Polygon");
    expect(body.geometry.coordinates[0]).toHaveLength(5);
    expect(body.geometry.coordinates[0][0]).toEqual([2.33, 48.85]);
  });
});
