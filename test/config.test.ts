import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ALERTS_URL, DEFAULT_HISTORY_URL, loadConfig } from "../src/config.js";

describe("configuration", () => {
  it("defaults to the documented Oref URLs and prefers OREF_PROXY over the process proxy", () => {
    const config = loadConfig({
      OREF_PROXY: "http://israeli-proxy.example:8080",
      HTTPS_PROXY: "http://other.example:9",
      OREF_MODE: "live",
    });
    assert.equal(config.alertsUrl, DEFAULT_ALERTS_URL);
    assert.equal(config.historyUrl, DEFAULT_HISTORY_URL);
    assert.equal(config.proxyUrl, "http://israeli-proxy.example:8080");
    assert.equal(config.ignoreDrills, true);
    assert.equal(config.liveIntervalMs, 2000);
  });

  it("clamps a too-fast poll interval and honors mock mode", () => {
    const config = loadConfig({
      OREF_MODE: "mock",
      OREF_POLL_INTERVAL_MS: "10",
      OREF_IGNORE_DRILLS: "false",
      HTTP_PROXY: "http://127.0.0.1:8888",
    });
    assert.equal(config.mode, "mock");
    assert.equal(config.liveIntervalMs, 250);
    assert.equal(config.ignoreDrills, false);
    assert.equal(config.proxyUrl, "http://127.0.0.1:8888");
  });
});
