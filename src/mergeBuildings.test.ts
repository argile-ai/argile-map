/**
 * Tests for the CityJSON → triangle soup pipeline.
 *
 * We don't exercise `parseBuilding()` directly because it wires through
 * cityjson-threejs-loader, whose ESM imports omit `.js` extensions and
 * Vitest's strict resolver can't pick them up (they're fine in Vite dev/build).
 *
 * Instead we build `ParsedBuilding` fixtures by hand and focus on the logic
 * this project owns: `mergeBuildings()` — the merge that bakes each
 * building's (lng, lat) offset into the merged triangle soup.
 */

import { describe, expect, it } from "vitest";
import { mergeBuildings, type ParsedBuilding } from "./mergeBuildings";

/** Build a ParsedBuilding with a single unit triangle at the origin. */
function unitTriangle(geopf_id: string, lat: number, lng: number): ParsedBuilding {
  return {
    geopf_id,
    lat,
    lng,
    height: 5,
    soup: {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    },
  };
}

describe("mergeBuildings", () => {
  it("concatenates soups with correctly offset indices", () => {
    const a = unitTriangle("a", 48.8566, 2.3522);
    const b = unitTriangle("b", 48.8566, 2.3522);

    const merged = mergeBuildings([a, b], { lat: a.lat, lng: a.lng });

    expect(merged.positions.length).toBe(
      a.soup.positions.length + b.soup.positions.length,
    );
    expect(merged.normals.length).toBe(merged.positions.length);
    expect(merged.indices.length).toBe(
      a.soup.indices.length + b.soup.indices.length,
    );
    // Second triangle's indices shifted by the 3 vertices of A.
    expect(Array.from(merged.indices.slice(3))).toEqual([3, 4, 5]);
  });

  it("bakes the (east, north) offset of each building into the merged vertices", () => {
    const origin = { lat: 48.8566, lng: 2.3522 };
    const a = unitTriangle("a", origin.lat, origin.lng);
    // 0.001° lng at 48.85° ≈ 73 m east. 0.0005° lat ≈ 55 m north.
    const b = unitTriangle("b", origin.lat + 0.0005, origin.lng + 0.001);

    const merged = mergeBuildings([a, b], origin);

    // Building A's first vertex lands at (0, 0, 0) — origin is its own origin.
    expect(merged.positions[0]).toBeCloseTo(0, 2);
    expect(merged.positions[1]).toBeCloseTo(0, 2);

    // Building B's first vertex lands at the expected east/north offset.
    const bFirstX = merged.positions[9];
    const bFirstY = merged.positions[10];
    expect(bFirstX).toBeGreaterThan(60);
    expect(bFirstX).toBeLessThan(85);
    expect(bFirstY).toBeGreaterThan(45);
    expect(bFirstY).toBeLessThan(65);
  });

  it("preserves per-vertex normals verbatim", () => {
    const a = unitTriangle("a", 48.8566, 2.3522);
    const merged = mergeBuildings([a], { lat: a.lat, lng: a.lng });
    expect(Array.from(merged.normals)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  it("returns empty buffers for an empty input", () => {
    const merged = mergeBuildings([], { lat: 0, lng: 0 });
    expect(merged.positions.length).toBe(0);
    expect(merged.normals.length).toBe(0);
    expect(merged.indices.length).toBe(0);
  });
});
