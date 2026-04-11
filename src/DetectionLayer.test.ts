import { describe, expect, it } from "vitest";
import { createDetectionLayer, toMarkers } from "./DetectionLayer";
import type { Detection } from "./types";

function det(
  building_id: string,
  label: Detection["label"],
  score: number,
): Detection {
  return {
    building_id,
    label,
    score,
    box_xmin: 0,
    box_ymin: 0,
    box_xmax: 10,
    box_ymax: 10,
    center_lat: 48.86,
    center_lon: 2.34,
  };
}

describe("toMarkers", () => {
  it("emits one marker per detection", () => {
    const markers = toMarkers([
      det("b1", "roof window", 0.9),
      det("b1", "chimney", 0.7),
      det("b2", "photovoltaic solar panel", 0.8),
    ]);
    expect(markers).toHaveLength(3);
  });

  it("stacks multiple detections on the same building at distinct heights", () => {
    const markers = toMarkers([
      det("b1", "roof window", 0.6),
      det("b1", "chimney", 0.9),
      det("b1", "photovoltaic solar panel", 0.7),
    ]);
    const zs = markers.map((m) => m.position[2]);
    // All distinct, monotonically increasing (we sort by score desc).
    expect(new Set(zs).size).toBe(3);
    expect(zs[0]).toBeLessThan(zs[1]);
    expect(zs[1]).toBeLessThan(zs[2]);
  });

  it("sorts by score descending so the top-confidence detection sits lowest", () => {
    const markers = toMarkers([
      det("b1", "roof window", 0.5),
      det("b1", "chimney", 0.95),
    ]);
    // chimney (0.95) has the lower z.
    expect(markers[0].text).toBe("🏭");
    expect(markers[1].text).toBe("🪟");
  });

  it("colors each label class distinctly", () => {
    const markers = toMarkers([
      det("b1", "roof window", 0.9),
      det("b2", "photovoltaic solar panel", 0.9),
      det("b3", "chimney", 0.9),
    ]);
    const colors = new Set(markers.map((m) => m.color.join(",")));
    expect(colors.size).toBe(3);
  });
});

describe("createDetectionLayer", () => {
  it("returns null on empty input so the overlay can skip it", () => {
    expect(createDetectionLayer([])).toBeNull();
  });

  it("returns a TextLayer with a stable id on non-empty input", () => {
    const layer = createDetectionLayer([det("b1", "chimney", 0.9)]);
    expect(layer).not.toBeNull();
    expect(layer?.id).toBe("argile-detections");
  });
});
