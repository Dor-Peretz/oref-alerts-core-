import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AreaCatalog } from "../src/areas.js";
import { areasPath } from "../src/paths.js";
import { validateDocument } from "../src/schema.js";

describe("area catalog", () => {
  const catalog = AreaCatalog.load();

  it("validates every committed area and district against schema v1", () => {
    const file = JSON.parse(readFileSync(areasPath(), "utf8")) as {
      areas: unknown[];
      districts: unknown[];
      provenance: { upstreamCommit: string };
    };
    assert.equal(file.provenance.upstreamCommit, "e40da77a4aab3052fb1a4a56402ae2e26c3e3cf3");
    assert.equal(file.areas.length, catalog.size);
    assert.ok(catalog.size >= 1400);
    assert.equal(catalog.districtCount, 30);
    for (const area of file.areas) validateDocument("catalogArea", area);
    for (const district of file.districts) validateDocument("catalogDistrict", district);
    for (const area of file.areas as Array<{ districtId: string | null }>) {
      if (area.districtId) assert.ok(catalog.district(area.districtId));
    }
  });

  it("resolves Tel Aviv - City Center and searches in English or Hebrew", () => {
    const area = catalog.get("city:742");
    assert.ok(area);
    assert.equal(area.names.en, "Tel Aviv - City Center");
    assert.equal(area.districtId, "district:dan");
    assert.equal(area.shelterTimeSeconds, 90);
    const english = catalog.search("tel aviv", 10).map((item) => item.id);
    const hebrew = catalog.search("תל אביב", 10).map((item) => item.id);
    assert.ok(english.includes("city:742"));
    assert.ok(hebrew.includes("city:742"));
  });
});
