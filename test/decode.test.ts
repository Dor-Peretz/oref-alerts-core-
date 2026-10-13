import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFeedBody, FeedError } from "../src/index.js";
import { fixture } from "./helpers.js";

describe("feed decoding", () => {
  it("treats empty, whitespace, and null JSON as no alerts", () => {
    assert.deepEqual(decodeFeedBody("").records, []);
    assert.deepEqual(decodeFeedBody(" \n\t").records, []);
    assert.deepEqual(decodeFeedBody("null").records, []);
    assert.deepEqual(decodeFeedBody("{}").records, []);
    assert.deepEqual(decodeFeedBody("[]").records, []);
  });

  it("strips a UTF-8 BOM, UTF-16LE BOM, NULs, and the stray character pikud-haoref-api removes", () => {
    const payload = fixture("live-missiles.json");
    const utf8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(payload)]);
    assert.equal(decodeFeedBody(utf8).records.length, 1);

    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(payload, "utf16le")]);
    assert.equal(decodeFeedBody(utf16).records[0]?.id, "132944072580000000");

    const nulled = payload.replace("{", "{\u0000").replace("סעד", "ס\u0000עד");
    const decoded = decodeFeedBody(nulled);
    assert.deepEqual(decoded.records[0]?.data, ["סעד", "אשדוד - יא,יב,טו,יז,מרינה"]);

    const stray = payload.replace("סעד", "ס\u0A7Bעד");
    assert.equal((decodeFeedBody(stray).records[0]?.data as string[])[0], "סעד");
  });

  it("accepts a live object, a live array, and a wrapped history array", () => {
    assert.equal(decodeFeedBody(fixture("live-missiles.json")).records.length, 1);
    assert.equal(decodeFeedBody(fixture("live-array.json")).records.length, 2);
    assert.equal(decodeFeedBody(fixture("wrapped-history.json")).records.length, 1);
    assert.equal(decodeFeedBody(fixture("history.json")).records.length, 4);
  });

  it("flags Access Denied HTML and the Oref error page instead of parsing them", () => {
    assert.throws(
      () => decodeFeedBody("<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY>Access Denied</BODY></HTML>"),
      (error: unknown) => error instanceof FeedError && error.code === "geo-blocked",
    );
    assert.throws(
      () => decodeFeedBody("<html><body>moved to /errorpage_adom/</body></html>"),
      (error: unknown) => error instanceof FeedError && error.code === "upstream",
    );
  });

  it("rejects truncated JSON", () => {
    assert.throws(
      () => decodeFeedBody("{"),
      (error: unknown) => error instanceof FeedError && error.code === "malformed",
    );
  });
});
