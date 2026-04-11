/**
 * Integration test for the loader + parseBuilding pipeline. This exercises
 * cityjson-threejs-loader through Vitest's SSR transform (enabled via
 * `server.deps.inline` in vite.config.ts), which is the only place in our
 * test suite where we touch the real parser.
 *
 * We feed it a minimal but valid CityJSON v2.0 blob (a ten-meter box with
 * footprint centroid at a Lambert93 coordinate that also matches the
 * building's WGS84 lat/lng) and assert that the output soup is non-empty,
 * has the expected height, and is re-centered + rotated into the WGS84
 * East/North frame.
 */

import { describe, expect, it } from "vitest";
import { parseBuilding } from "./cityjsonMesh";
import type { CityJsonBuilding } from "./types";

/**
 * Minimal closed box (6 quads) in CityJSON v2.0. Integer vertices are
 * restored to Lambert93 meters by `transform.scale * raw + transform.translate`.
 * The translate anchors the box near a real building in Paris
 * (Lambert93 651728, 6862581) so our meridian convergence math runs on a
 * realistic geometry.
 */
function boxBuilding(): CityJsonBuilding {
  return {
    geopf_id: "batiment.test",
    lat: 48.8613,
    lng: 2.3421,
    multipolygon_geojson: {
      type: "Polygon",
      coordinates: [
        [
          [2.3421, 48.8613],
          [2.3422, 48.8613],
          [2.3422, 48.8614],
          [2.3421, 48.8614],
          [2.3421, 48.8613],
        ],
      ],
    },
    cityjson: {
      type: "CityJSON",
      version: "2.0",
      // Lambert93 anchor. scale=0.001 means raw integer coordinates are in
      // millimeters; translate puts them at a real Paris block.
      transform: { scale: [0.001, 0.001, 0.001], translate: [651728, 6862581, 0] },
      CityObjects: {
        "batiment.test": {
          type: "Building",
          geometry: [
            {
              type: "Solid",
              lod: "1.2",
              // One outer shell with six quads: bottom, top, four sides.
              boundaries: [
                [
                  [[0, 1, 2, 3]],
                  [[4, 5, 6, 7]],
                  [[0, 1, 5, 4]],
                  [[1, 2, 6, 5]],
                  [[2, 3, 7, 6]],
                  [[3, 0, 4, 7]],
                ],
              ],
            },
          ],
        },
      },
      // A 10m × 10m × 6m box, encoded in millimeters (scale = 0.001).
      vertices: [
        [0, 0, 0],
        [10000, 0, 0],
        [10000, 10000, 0],
        [0, 10000, 0],
        [0, 0, 6000],
        [10000, 0, 6000],
        [10000, 10000, 6000],
        [0, 10000, 6000],
      ],
    },
  };
}

describe("parseBuilding (loader integration)", () => {
  it("produces a non-empty triangle soup from a real CityJSON box", () => {
    const parsed = parseBuilding(boxBuilding());
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.soup.positions.length).toBeGreaterThan(0);
    expect(parsed.soup.positions.length % 3).toBe(0);
    expect(parsed.soup.indices.length).toBeGreaterThan(0);
    // Normals always have the same length as positions.
    expect(parsed.soup.normals.length).toBe(parsed.soup.positions.length);
  });

  it("extracts the correct building height from transform.scale", () => {
    const parsed = parseBuilding(boxBuilding());
    if (!parsed) throw new Error("parseBuilding returned null");
    // 6m box → height should be ~6m (allowing float tolerance).
    expect(parsed.height).toBeGreaterThan(5.5);
    expect(parsed.height).toBeLessThan(6.5);
  });

  it("re-centers the horizontal bbox at (0, 0) after Lambert93 rotation", () => {
    const parsed = parseBuilding(boxBuilding());
    if (!parsed) throw new Error("parseBuilding returned null");

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    for (let i = 0; i < parsed.soup.positions.length; i += 3) {
      const x = parsed.soup.positions[i];
      const y = parsed.soup.positions[i + 1];
      const z = parsed.soup.positions[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
    }
    // Rotation by γ preserves magnitudes but tilts slightly, so the bbox
    // is still centered at 0 (we re-center AFTER rotating).
    expect((minX + maxX) / 2).toBeCloseTo(0, 1);
    expect((minY + maxY) / 2).toBeCloseTo(0, 1);
    expect(minZ).toBeCloseTo(0, 3);
    // 10m × 10m footprint → bbox size ~10 m (±small rotation stretch).
    expect(maxX - minX).toBeGreaterThan(9);
    expect(maxX - minX).toBeLessThan(11);
  });

  it("carries the building's WGS84 centroid through unchanged", () => {
    const parsed = parseBuilding(boxBuilding());
    if (!parsed) throw new Error("parseBuilding returned null");
    expect(parsed.lat).toBeCloseTo(48.8613, 6);
    expect(parsed.lng).toBeCloseTo(2.3421, 6);
    expect(parsed.geopf_id).toBe("batiment.test");
  });

  it("returns null on malformed CityJSON", () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input.
    const bad: CityJsonBuilding = {
      ...boxBuilding(),
      cityjson: { type: "CityJSON", version: "2.0", CityObjects: {}, vertices: [] } as any,
    };
    const parsed = parseBuilding(bad);
    expect(parsed).toBeNull();
  });
});
