import { describe, expect, it } from "vitest";
import { tilesInBounds } from "./tiles";

describe("tilesInBounds", () => {
  it("returns at least one tile for a degenerate bbox", () => {
    const tiles = tilesInBounds({
      minLat: 48.8566,
      maxLat: 48.8566,
      minLng: 2.3522,
      maxLng: 2.3522,
    });
    expect(tiles.length).toBeGreaterThan(0);
  });

  it("covers a viewport with a deterministic set of unique tiles", () => {
    const tiles = tilesInBounds({
      minLat: 48.85,
      maxLat: 48.86,
      minLng: 2.34,
      maxLng: 2.36,
    });
    const ids = tiles.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Every tile center lies within the padded envelope.
    for (const tile of tiles) {
      expect(tile.lat).toBeGreaterThan(48.84);
      expect(tile.lat).toBeLessThan(48.87);
      expect(tile.lng).toBeGreaterThan(2.33);
      expect(tile.lng).toBeLessThan(2.37);
      expect(tile.radiusM).toBeGreaterThan(200);
      expect(tile.radiusM).toBeLessThan(400);
    }
  });

  it("is stable across calls on the same bbox", () => {
    const bounds = { minLat: 48.855, maxLat: 48.87, minLng: 2.33, maxLng: 2.36 };
    const a = tilesInBounds(bounds)
      .map((t) => t.id)
      .sort();
    const b = tilesInBounds(bounds)
      .map((t) => t.id)
      .sort();
    expect(a).toEqual(b);
  });

  it("panning by one tile width shares most tiles with the previous view", () => {
    const a = new Set(
      tilesInBounds({
        minLat: 48.855,
        maxLat: 48.87,
        minLng: 2.33,
        maxLng: 2.36,
      }).map((t) => t.id),
    );
    const b = new Set(
      tilesInBounds({
        minLat: 48.855,
        maxLat: 48.87,
        minLng: 2.334,
        maxLng: 2.364,
      }).map((t) => t.id),
    );
    let overlap = 0;
    for (const id of a) if (b.has(id)) overlap += 1;
    // Small pan should preserve > 60% of tiles.
    expect(overlap / a.size).toBeGreaterThan(0.6);
  });
});
