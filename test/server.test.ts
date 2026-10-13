import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { AreaCatalog } from "../src/areas.js";
import { loadConfig } from "../src/config.js";
import { AlertEngine } from "../src/engine.js";
import { startServer, type RunningServer } from "../src/server.js";
import { fixture } from "./helpers.js";

describe("HTTP service", { concurrency: 1 }, () => {
  const catalog = AreaCatalog.load();
  const engine = new AlertEngine({ catalog });
  const config = loadConfig({ OREF_MODE: "mock", OREF_PORT: "0", OREF_HOST: "127.0.0.1" });
  let server: RunningServer;

  before(async () => {
    server = await startServer({ engine, catalog, config });
  });

  after(async () => {
    await server.close();
  });

  it("serves health, schema, catalog search, and current lifecycle", async () => {
    const health = await fetch(`${server.url}/health`);
    assert.equal(health.status, 200);
    const healthBody = (await health.json()) as { ok: boolean; schemaVersion: string };
    assert.equal(healthBody.ok, true);
    assert.equal(healthBody.schemaVersion, "1.0.0");

    const schema = await fetch(`${server.url}/v1/schema`);
    const schemaBody = (await schema.json()) as { $id: string };
    assert.equal(schemaBody.$id, "urn:oref-alerts:schema:v1");

    const area = await fetch(`${server.url}/v1/areas/city:742`);
    assert.equal(area.status, 200);
    const areaBody = (await area.json()) as { names: { en: string }; district: { id: string } };
    assert.equal(areaBody.names.en, "Tel Aviv - City Center");
    assert.equal(areaBody.district.id, "district:dan");

    engine.ingest(fixture("live-prealert.json"), {
      feed: "live",
      observedAt: new Date("2026-10-13T05:00:00.000Z"),
    });
    const current = await fetch(`${server.url}/v1/current`);
    const currentBody = (await current.json()) as { areas: Array<{ areaId: string; phase: string }> };
    const ids = currentBody.areas.map((row) => row.areaId).sort();
    assert.deepEqual(ids, ["city:742", "city:745"]);
    assert.equal(currentBody.areas.every((row) => row.phase === "pre-alert"), true);
  });

  it("streams server-sent events and signs webhooks", async () => {
    const received: { body: string; signature: string | null; event: string | null }[] = [];
    const hook = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        received.push({
          body: Buffer.concat(chunks).toString("utf8"),
          signature: typeof req.headers["x-oref-signature"] === "string" ? req.headers["x-oref-signature"] : null,
          event: typeof req.headers["x-oref-event"] === "string" ? req.headers["x-oref-event"] : null,
        });
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise<void>((resolve) => hook.listen(0, "127.0.0.1", () => resolve()));
    const address = hook.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const created = await fetch(`${server.url}/v1/webhooks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: `http://127.0.0.1:${port}/hook`, secret: "test-secret" }),
      });
      assert.equal(created.status, 201);

      const stream = await fetch(`${server.url}/v1/stream`);
      const reader = stream.body?.getReader();
      assert.ok(reader);
      let buffered = "";
      const readUntil = async (needle: string): Promise<void> => {
        const deadline = Date.now() + 3000;
        while (!buffered.includes(needle)) {
          if (Date.now() > deadline) throw new Error(`timed out waiting for ${needle}`);
          const chunk = await reader.read();
          if (chunk.done) break;
          buffered += new TextDecoder().decode(chunk.value);
        }
      };
      await readUntil("event: hello");

      engine.ingest(fixture("live-aircraft.json"), {
        feed: "live",
        observedAt: new Date("2026-10-13T06:00:00.000Z"),
      });
      await readUntil("event: alert");
      assert.match(buffered, /hostile aircraft|aircraft|נחל עוז|city:234/i);

      const deadline = Date.now() + 3000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(received.length >= 1);
      const delivery = received.find((item) => item.event === "alert.created");
      assert.ok(delivery);
      const expected = `sha256=${createHmac("sha256", "test-secret").update(delivery.body).digest("hex")}`;
      assert.equal(delivery.signature, expected);
      const payload = JSON.parse(delivery.body) as { alert: { category: string } };
      assert.equal(payload.alert.category, "aircraft");
      await reader.cancel();
    } finally {
      await new Promise<void>((resolve, reject) => hook.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("requires a bearer token when OREF_API_TOKEN is set, except on /health", async () => {
    const lockedEngine = new AlertEngine({ catalog });
    const locked = await startServer({
      engine: lockedEngine,
      catalog,
      config: loadConfig({ OREF_PORT: "0", OREF_HOST: "127.0.0.1", OREF_API_TOKEN: "secret-token" }),
    });
    try {
      const health = await fetch(`${locked.url}/health`);
      assert.equal(health.status, 200);
      const denied = await fetch(`${locked.url}/v1/alerts`);
      assert.equal(denied.status, 401);
      const allowed = await fetch(`${locked.url}/v1/alerts`, {
        headers: { authorization: "Bearer secret-token" },
      });
      assert.equal(allowed.status, 200);
    } finally {
      await locked.close();
    }
  });
});
