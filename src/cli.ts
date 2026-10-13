#!/usr/bin/env node
import { AreaCatalog } from "./areas.js";
import { loadConfig } from "./config.js";
import { AlertEngine } from "./engine.js";
import { Poller } from "./poller.js";
import { startServer } from "./server.js";
import { HttpFeedSource, MockFeedSource } from "./source.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const catalog = AreaCatalog.load();
  const engine = new AlertEngine({ catalog, ignoreDrills: config.ignoreDrills });
  const source =
    config.mode === "mock"
      ? new MockFeedSource({ intervalMs: config.mockIntervalMs })
      : new HttpFeedSource(config);
  const poller = new Poller(engine, source, config);
  const server = await startServer({ engine, catalog, config, poller });
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(
    `oref-alerts-core listening on ${server.url} mode=${config.mode} areas=${catalog.size} districts=${catalog.districtCount}`,
  );
  if (config.mode === "live") {
    console.log("Live mode polls unofficial Oref URLs. Outside Israel this usually needs OREF_PROXY.");
  }
  try {
    await poller.run(controller.signal);
  } finally {
    await server.close();
    await source.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
