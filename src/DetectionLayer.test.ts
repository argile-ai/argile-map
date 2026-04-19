import { describe, expect, it } from "vitest";
import { createDetectionLayer } from "./DetectionLayer";
import type { ParsedBuilding } from "./mergeBuildings";
import type { Detection } from "./types";

function det(
  building_id: string,
  label: Detection["label"],
  score: number,
  lat = 48.86,
  lon = 2.34,
): Detection {
  return {
    building_id,
    label,
    score,
    box_xmin: 0,
    box_ymin: 0,
    box_xmax: 10,
    box_ymax: 10,
    center_lat: lat,
    center_lon: lon,
  };
}

function fakeBuilding(id: string, lat = 48.86, lng = 2.34): ParsedBuilding {
  return {
    geopf_id: id,
    lat,
    lng,
    height: 6,
    lambert93Center: null,
    soup: {
      positions: new Float32Array([0, 0, 5, 1, 0, 5, 0, 1, 5]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
      surfaceTypes: new Int32Array([2, 2, 2]),
    },
    roofCentroid: [0.33, 0.33, 5],
    roofNormal: [0, 0, 1],
  };
}

/** 20×20m flat roof centered at (0,0), z=5. Two triangles. */
function fakeBigBuilding(id: string, lat = 48.86, lng = 2.34): ParsedBuilding {
  return {
    geopf_id: id,
    lat,
    lng,
    height: 6,
    lambert93Center: null,
    soup: {
      positions: new Float32Array([-10, -10, 5, 10, -10, 5, 10, 10, 5, -10, 10, 5]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      surfaceTypes: new Int32Array([2, 2, 2, 2]),
    },
    roofCentroid: [0, 0, 5],
    roofNormal: [0, 0, 1],
  };
}

// biome-ignore lint/suspicious/noExplicitAny: deck.gl mesh attributes are loosely typed.
function quadCenter(layer: any, quadIdx = 0): [number, number, number] {
  const pos = layer.props.mesh.attributes.positions.value as Float32Array;
  const base = quadIdx * 12;
  let x = 0,
    y = 0,
    z = 0;
  for (let i = 0; i < 4; i++) {
    x += pos[base + i * 3];
    y += pos[base + i * 3 + 1];
    z += pos[base + i * 3 + 2];
  }
  return [x / 4, y / 4, z / 4];
}

const origin = { lat: 48.86, lng: 2.34 };

describe("createDetectionLayer", () => {
  it("returns [] on empty input", () => {
    expect(createDetectionLayer([], [], origin)).toEqual([]);
  });

  it("returns [] when no buildings are provided", () => {
    expect(createDetectionLayer([det("b1", "chimney", 0.9)], [], origin)).toEqual([]);
  });

  it("returns one layer per label when detections match buildings", () => {
    const layers = createDetectionLayer(
      [det("b1", "chimney", 0.9, 48.86, 2.34)],
      [fakeBuilding("bx", 48.86, 2.34)],
      origin,
    );
    expect(layers).toHaveLength(1);
    expect(layers[0].id).toBe("argile-det-chimney");
  });

  it("returns [] when detections are too far from any building", () => {
    const layers = createDetectionLayer(
      [det("b1", "chimney", 0.9, 49.0, 3.0)],
      [fakeBuilding("bx", 48.86, 2.34)],
      origin,
    );
    expect(layers).toEqual([]);
  });

  it("positions roof windows at their geo_* bbox centroid, not the building center", () => {
    const lat = 48.86;
    const lng = 2.34;
    // mPerDegLng at lat 48.86 ≈ 73231, mPerDegLat ≈ 111319.
    // Offset a detection so its bbox centroid lands at local (3, 4) meters.
    const dLng = 3 / 73231; // ≈ 4.097e-5
    const dLat = 4 / 111319; // ≈ 3.594e-5
    const d: Detection = {
      ...det("b1", "roof window", 0.9, lat, lng),
      geo_xmin: lng + dLng - 0.5 / 73231, // 1m wide
      geo_xmax: lng + dLng + 0.5 / 73231,
      geo_ymin: lat + dLat - 0.3 / 111319, // 0.6m tall
      geo_ymax: lat + dLat + 0.3 / 111319,
    };
    const layers = createDetectionLayer([d], [fakeBigBuilding("bx", lat, lng)], {
      lat,
      lng,
    });
    expect(layers).toHaveLength(1);
    const [cx, cy, cz] = quadCenter(layers[0]);
    expect(cx).toBeCloseTo(3, 2);
    expect(cy).toBeCloseTo(4, 2);
    // Flat roof at z=5, SURFACE_OFFSET = 0.05.
    expect(cz).toBeCloseTo(5.05, 2);
  });

  it("sizes the roof-window quad from the geo_* bbox dimensions", () => {
    const lat = 48.86;
    const lng = 2.34;
    // 2m × 1m bbox centered on the building.
    const halfW_lng = 1 / 73231;
    const halfH_lat = 0.5 / 111319;
    const d: Detection = {
      ...det("b1", "roof window", 0.9, lat, lng),
      geo_xmin: lng - halfW_lng,
      geo_xmax: lng + halfW_lng,
      geo_ymin: lat - halfH_lat,
      geo_ymax: lat + halfH_lat,
    };
    const layers = createDetectionLayer([d], [fakeBigBuilding("bx", lat, lng)], {
      lat,
      lng,
    });
    // biome-ignore lint/suspicious/noExplicitAny: deck.gl mesh attributes loosely typed.
    const pos = (layers[0] as any).props.mesh.attributes.positions.value as Float32Array;
    // Quad corners: (-halfW, -halfH), (halfW, -halfH), (halfW, halfH), (-halfW, halfH)
    // along roof `right` and `slopeDown` axes. For a flat roof (normal=[0,0,1])
    // slopeDown falls back to (0,1,0), right becomes (−1,0,0) in roofFrame.
    // Width span = 2 * halfW ≈ 2m, height span = 2 * halfH ≈ 1m.
    const xs = [pos[0], pos[3], pos[6], pos[9]];
    const ys = [pos[1], pos[4], pos[7], pos[10]];
    const widthSpan = Math.max(...xs) - Math.min(...xs);
    const heightSpan = Math.max(...ys) - Math.min(...ys);
    expect(widthSpan).toBeCloseTo(2, 1);
    expect(heightSpan).toBeCloseTo(1, 1);
  });

  it("creates one layer per label for mixed detection types", () => {
    const layers = createDetectionLayer(
      [
        det("b1", "roof window", 0.9, 48.86, 2.34),
        det("b1", "photovoltaic solar panel", 0.8, 48.86, 2.34),
        det("b1", "chimney", 0.7, 48.86, 2.34),
      ],
      [fakeBuilding("bx", 48.86, 2.34)],
      origin,
    );
    expect(layers).toHaveLength(3);
    const ids = layers.map((l) => l.id).sort();
    expect(ids).toEqual([
      "argile-det-chimney",
      "argile-det-photovoltaic-solar-panel",
      "argile-det-roof-window",
    ]);
  });
});
