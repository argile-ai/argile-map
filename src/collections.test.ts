/**
 * Unit test for `setViewportBuildings`: verifies that atomic replacement
 * drops stale buildings and inserts new ones without throwing on key
 * collisions.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildingsCollection, setViewportBuildings } from "./collections";
import type { CityJsonBuilding } from "./types";

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

describe("setViewportBuildings", () => {
  beforeEach(() => {
    for (const b of [...buildingsCollection.values()]) {
      buildingsCollection.delete(b.geopf_id);
    }
  });

  it("inserts every building from an empty collection", () => {
    setViewportBuildings([fakeBuilding("a"), fakeBuilding("b")]);
    const ids = [...buildingsCollection.values()].map((b) => b.geopf_id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("replaces the set atomically: drops missing, adds new, keeps shared", () => {
    setViewportBuildings([fakeBuilding("a"), fakeBuilding("b"), fakeBuilding("c")]);
    setViewportBuildings([fakeBuilding("b"), fakeBuilding("c"), fakeBuilding("d")]);
    const ids = [...buildingsCollection.values()].map((b) => b.geopf_id).sort();
    expect(ids).toEqual(["b", "c", "d"]);
  });

  it("is idempotent when called with the same set twice", () => {
    setViewportBuildings([fakeBuilding("a"), fakeBuilding("b")]);
    setViewportBuildings([fakeBuilding("a"), fakeBuilding("b")]);
    const ids = [...buildingsCollection.values()].map((b) => b.geopf_id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("clears the collection when passed an empty array", () => {
    setViewportBuildings([fakeBuilding("a")]);
    setViewportBuildings([]);
    expect([...buildingsCollection.values()]).toEqual([]);
  });
});
