import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AreaCatalog } from "../src/areas.js";
import { decodeFeedBody } from "../src/decode.js";
import { normalizeRecords } from "../src/normalize.js";
import { unmappedAreaId } from "../src/areas.js";
import { fixture } from "./helpers.js";

const catalog = AreaCatalog.load();

describe("normalization", () => {
  it("maps a published missiles example onto catalog ids and leaves unknown strings unmapped", () => {
    const [alert] = normalizeRecords(decodeFeedBody(fixture("live-missiles.json")).records, { catalog });
    assert.ok(alert);
    assert.equal(alert.source, "live");
    assert.equal(alert.category, "missiles");
    assert.equal(alert.phase, "active");
    assert.equal(alert.title.en, "Rocket and missile fire");
    assert.equal(alert.instructions.en, "Enter the protected space");
    assert.equal(alert.areas[0]?.id, "city:235");
    assert.equal(alert.areas[0]?.names.en, "Sa'ad");
    assert.equal(alert.areas[0]?.match, "exact");
    const raw = "אשדוד - יא,יב,טו,יז,מרינה";
    assert.equal(alert.areas[1]?.match, "unmapped");
    assert.equal(alert.areas[1]?.id, unmappedAreaId(raw));
    assert.equal(alert.classification.basis, "title-and-code");
    assert.equal(alert.classification.disputed, false);
  });

  it("converts history alertDate from Israel local time and keeps one city per row", () => {
    const alerts = normalizeRecords(decodeFeedBody(fixture("history.json")).records, {
      catalog,
      feed: "history",
    });
    const zarit = alerts.find((alert) => alert.areas[0]?.id === "city:1603" && alert.phase === "active");
    assert.ok(zarit);
    assert.equal(zarit.timestamps.alertTime, "2024-07-03T15:45:36.000Z");
    assert.equal(zarit.timestamps.sourceTimezone, "Asia/Jerusalem");
    assert.equal(zarit.id.startsWith("hist:"), true);
  });

  it("does not treat a live cat 13 infiltration as an all-clear", () => {
    const [alert] = normalizeRecords(decodeFeedBody(fixture("live-infiltration.json")).records, { catalog });
    assert.equal(alert?.category, "terrorist-infiltration");
    assert.equal(alert?.phase, "active");
    assert.equal(alert?.areas[0]?.id, "city:234");
    assert.equal(alert?.areas[0]?.shelterTimeSeconds, 15);
  });
});
