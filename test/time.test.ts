import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatJerusalem, parseJerusalem } from "../src/time.js";

describe("Israel local timestamps", () => {
  it("converts winter and summer wall clocks to UTC", () => {
    const winter = parseJerusalem("2026-01-15 12:00:00");
    const summer = parseJerusalem("2026-10-13 12:00:00");
    const beforeDst = parseJerusalem("2026-03-26 12:00:00");
    const afterDst = parseJerusalem("2026-03-27 12:00:00");
    assert.ok(winter && summer && beforeDst && afterDst);
    assert.equal(winter.toISOString(), "2026-01-15T10:00:00.000Z");
    assert.equal(summer.toISOString(), "2026-10-13T09:00:00.000Z");
    assert.equal(beforeDst.toISOString(), "2026-03-26T10:00:00.000Z");
    assert.equal(afterDst.toISOString(), "2026-03-27T09:00:00.000Z");
  });

  it("accepts the T separator used by GetAlarmsHistory examples and round-trips", () => {
    const parsed = parseJerusalem("2026-07-03T18:45:36");
    assert.ok(parsed);
    assert.equal(formatJerusalem(parsed), "2026-07-03 18:45:36");
  });

  it("rejects shapes that are not local datetimes", () => {
    assert.equal(parseJerusalem(""), null);
    assert.equal(parseJerusalem("not-a-date"), null);
    assert.equal(parseJerusalem("2026-13-01 00:00:00"), null);
  });
});
