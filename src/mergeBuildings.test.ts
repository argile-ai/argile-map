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
import {
  LAMBERT93_N,
  lambert93Convergence,
  mergeBuildings,
  mergeBuildingsByMaterial,
  type ParsedBuilding,
  rotateLambert93ToEastNorth,
} from "./mergeBuildings";

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
      surfaceTypes: new Int32Array([2, 2, 2]),
    },
    roofCentroid: [0.33, 0.33, 0],
    roofNormal: [0, 0, 1],
  };
}

describe("mergeBuildings", () => {
  it("concatenates soups with correctly offset indices", () => {
    const a = unitTriangle("a", 48.8566, 2.3522);
    const b = unitTriangle("b", 48.8566, 2.3522);

    const merged = mergeBuildings([a, b], { lat: a.lat, lng: a.lng });

    expect(merged.positions.length).toBe(a.soup.positions.length + b.soup.positions.length);
    expect(merged.normals.length).toBe(merged.positions.length);
    expect(merged.indices.length).toBe(a.soup.indices.length + b.soup.indices.length);
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

describe("mergeBuildingsByMaterial", () => {
  /** Build a two-triangle parsed building: one wall (type 1), one roof (type 2). */
  function wallAndRoof(geopf_id: string, lat: number, lng: number): ParsedBuilding {
    // 6 vertices total — verts 0..2 form the wall triangle, 3..5 the roof.
    const wallVerts = [0, 0, 0, 1, 0, 0, 0, 0, 5];
    const roofVerts = [0, 0, 5, 1, 0, 5, 1, 1, 5];
    const wallN = [0, -1, 0, 0, -1, 0, 0, -1, 0];
    const roofN = [0, 0, 1, 0, 0, 1, 0, 0, 1];
    return {
      geopf_id,
      lat,
      lng,
      height: 5,
      soup: {
        positions: new Float32Array([...wallVerts, ...roofVerts]),
        normals: new Float32Array([...wallN, ...roofN]),
        indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
        surfaceTypes: new Int32Array([1, 1, 1, 2, 2, 2]),
      },
      roofCentroid: null,
      roofNormal: null,
    };
  }

  it("routes roof triangles of material-tagged buildings into the material soup", () => {
    const origin = { lat: 48.8566, lng: 2.3522 };
    const a = wallAndRoof("a", origin.lat, origin.lng);
    const { body, roofsByMaterial } = mergeBuildingsByMaterial(
      [a],
      origin,
      () => "tuiles" as const,
    );
    expect(roofsByMaterial.get("tuiles")).toBeDefined();
    // 3 roof vertices go into the "tuiles" mesh; 3 wall vertices go into body.
    expect(roofsByMaterial.get("tuiles")!.positions.length).toBe(9);
    expect(body.positions.length).toBe(9);
  });

  it("folds roofs back into the body when materialOf returns null", () => {
    const origin = { lat: 48.8566, lng: 2.3522 };
    const a = wallAndRoof("a", origin.lat, origin.lng);
    const { body, roofsByMaterial } = mergeBuildingsByMaterial([a], origin, () => null);
    expect(roofsByMaterial.size).toBe(0);
    // Both triangles go into the body.
    expect(body.positions.length).toBe(18);
  });

  it("splits two buildings into two material soups", () => {
    const origin = { lat: 48.8566, lng: 2.3522 };
    const a = wallAndRoof("a", origin.lat, origin.lng);
    const b = wallAndRoof("b", origin.lat + 0.0005, origin.lng + 0.001);
    const { roofsByMaterial } = mergeBuildingsByMaterial([a, b], origin, (pb) =>
      pb.geopf_id === "a" ? ("tuiles" as const) : ("ardoises" as const),
    );
    expect(roofsByMaterial.get("tuiles")!.positions.length).toBe(9);
    expect(roofsByMaterial.get("ardoises")!.positions.length).toBe(9);
  });

  it("emits indices that exactly cover its positions (no sharing)", () => {
    const a = wallAndRoof("a", 48.8566, 2.3522);
    const { body } = mergeBuildingsByMaterial([a], { lat: a.lat, lng: a.lng }, () => null);
    // 6 verts expected (wall + roof). Indices are trivial 0..5.
    expect(body.positions.length / 3).toBe(6);
    expect(Array.from(body.indices)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("lambert93Convergence", () => {
  it("is zero on the central meridian (λ₀ = 3°E)", () => {
    expect(lambert93Convergence(3)).toBeCloseTo(0, 10);
  });

  it("is negative west of λ₀ and positive east of it", () => {
    expect(lambert93Convergence(2)).toBeLessThan(0);
    expect(lambert93Convergence(7)).toBeGreaterThan(0);
  });

  it("scales linearly with (λ - λ₀) via the known Lambert93 n", () => {
    // γ(λ) = n · (λ - λ₀). Reference constant comes from EPSG:2154.
    expect(LAMBERT93_N).toBeCloseTo(0.7256067949, 9);
    // γ at λ = 7°E: n · (7 - 3) · π/180
    const expected = (LAMBERT93_N * 4 * Math.PI) / 180;
    expect(lambert93Convergence(7)).toBeCloseTo(expected, 12);
  });

  it("matches published meridian convergence values to <0.01°", () => {
    // Paris: λ ≈ 2.35°, convergence is published as ≈ -0.47°
    const parisDeg = (lambert93Convergence(2.3522) * 180) / Math.PI;
    expect(parisDeg).toBeCloseTo(-0.472, 2);
    // Strasbourg: λ ≈ 7.75°, convergence ≈ +3.45°
    const strasDeg = (lambert93Convergence(7.75) * 180) / Math.PI;
    expect(strasDeg).toBeCloseTo(3.447, 2);
  });
});

describe("rotateLambert93ToEastNorth", () => {
  it("is the identity on the central meridian", () => {
    const [e, n] = rotateLambert93ToEastNorth(10, 5, 3);
    expect(e).toBeCloseTo(10, 10);
    expect(n).toBeCloseTo(5, 10);
  });

  it("west of λ₀, a Lambert93-north unit vector tilts slightly east", () => {
    // At Paris, Lambert93 γ ≈ -0.47°. A (dx=0, dy=1) Lambert93 vector maps
    // to WGS84 (E = sin(γ), N = cos(γ)). γ < 0 → E < 0 (west). Wait — that's
    // the opposite: "Lambert93 north" is rotated EAST of true north west
    // of λ₀, so expressed as WGS84 East/North it should have E > 0.
    //
    // The formula: [E; N] = [[cos γ, sin γ]; [-sin γ, cos γ]] · [dx; dy].
    // For dx=0, dy=1: E = sin(γ), N = cos(γ).
    // γ is NEGATIVE west of λ₀, so sin(γ) < 0, meaning E < 0. That means
    // we're interpreting "rotating Lambert93 north to WGS84" as a clockwise
    // rotation of the Lambert93 axes by γ — which is consistent with
    // meridian convergence sign conventions (positive γ east of λ₀ ⇒
    // Lambert93 N tilted east of true N ⇒ its east component is +sin γ).
    const [e, n] = rotateLambert93ToEastNorth(0, 1, 2.3522);
    expect(e).toBeCloseTo(Math.sin(lambert93Convergence(2.3522)), 10);
    expect(n).toBeCloseTo(Math.cos(lambert93Convergence(2.3522)), 10);
    // The magnitude is preserved (rotation, not scaling).
    expect(Math.hypot(e, n)).toBeCloseTo(1, 10);
  });

  it("preserves vector magnitudes everywhere in France", () => {
    for (const lng of [-2, 0, 3, 5, 8]) {
      const [e, n] = rotateLambert93ToEastNorth(13, -7, lng);
      expect(Math.hypot(e, n)).toBeCloseTo(Math.hypot(13, -7), 6);
    }
  });

  it("round-trips through the inverse via -γ", () => {
    const [e, n] = rotateLambert93ToEastNorth(10, 5, 7);
    // Apply inverse manually: rotate by -γ.
    const g = lambert93Convergence(7);
    const back_x = e * Math.cos(-g) + n * Math.sin(-g);
    const back_y = -e * Math.sin(-g) + n * Math.cos(-g);
    expect(back_x).toBeCloseTo(10, 6);
    expect(back_y).toBeCloseTo(5, 6);
  });
});
