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
