import { afterEach, describe, expect, it, vi } from "vitest";
import { searchBuildingsByRadius } from "./api";

describe("searchBuildingsByRadius", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("POSTs center/radius to /cityjson/search and returns the buildings array", async () => {
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

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ count: 1, buildings: [fakeBuilding], query_ms: 3.2 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await searchBuildingsByRadius({
      lat: 48.8566,
      lng: 2.3522,
      radiusM: 200,
      limit: 100,
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
    expect(body).toEqual({ center: [48.8566, 2.3522], radius_m: 200, limit: 100 });
  });

  it("throws when the server returns a non-OK status", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("boom", { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(
      searchBuildingsByRadius({ lat: 0, lng: 0, radiusM: 100 }),
    ).rejects.toThrow(/500/);
  });
});
