import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect as connectTcp } from "node:net";
import { describe, it } from "node:test";
import { HttpFeedSource } from "../src/source.js";
import { FeedError } from "../src/types.js";
import { fixture } from "./helpers.js";

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/alerts.json`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

describe("HTTP feed client", () => {
  it("sends the documented headers and a cache-buster, and returns the body", async () => {
    let seenUrl = "";
    let seenReferer = "";
    const upstream = await listen((req, res) => {
      seenUrl = req.url ?? "";
      seenReferer = String(req.headers.referer ?? "");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(fixture("live-array.json"));
    });
    const source = new HttpFeedSource({
      alertsUrl: upstream.url,
      historyUrl: upstream.url,
      proxyUrl: null,
      userAgent: "oref-alerts-core-test",
      liveTimeoutMs: 2000,
      historyTimeoutMs: 2000,
    });
    try {
      const body = await source.fetchLive();
      assert.equal(JSON.parse(Buffer.from(body).toString("utf8")).length, 2);
      assert.match(seenUrl, /[?&]_=\d+/);
      assert.equal(seenReferer, "https://www.oref.org.il/11226-he/pakar.aspx");
    } finally {
      await source.close();
      await upstream.close();
    }
  });

  it("turns HTTP 403 into a geo-block error", async () => {
    const upstream = await listen((_req, res) => {
      res.writeHead(403, { "content-type": "text/html" });
      res.end("<HTML><TITLE>Access Denied</TITLE></HTML>");
    });
    const source = new HttpFeedSource({
      alertsUrl: upstream.url,
      historyUrl: upstream.url,
      proxyUrl: null,
      userAgent: "oref-alerts-core-test",
      liveTimeoutMs: 2000,
      historyTimeoutMs: 2000,
    });
    try {
      await assert.rejects(source.fetchLive(), (error: unknown) => error instanceof FeedError && error.code === "geo-blocked");
    } finally {
      await source.close();
      await upstream.close();
    }
  });

  it("sends live requests through an HTTP proxy when OREF_PROXY is set", async () => {
    let proxied = false;
    const upstream = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("[]");
    });
    const proxy = createServer();
    proxy.on("connect", (req, clientSocket, head) => {
      proxied = true;
      const [host, portText] = (req.url ?? "").split(":");
      const upstreamSocket = connectTcp(Number(portText), host, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstreamSocket.write(head);
        upstreamSocket.pipe(clientSocket);
        clientSocket.pipe(upstreamSocket);
      });
      upstreamSocket.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => upstreamSocket.destroy());
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", () => resolve()));
    const address = proxy.address();
    const proxyPort = typeof address === "object" && address ? address.port : 0;
    const source = new HttpFeedSource({
      alertsUrl: upstream.url,
      historyUrl: upstream.url,
      proxyUrl: `http://127.0.0.1:${proxyPort}`,
      userAgent: "oref-alerts-core-test",
      liveTimeoutMs: 2000,
      historyTimeoutMs: 2000,
    });
    try {
      const body = await source.fetchLive();
      assert.equal(Buffer.from(body).toString("utf8"), "[]");
      assert.equal(proxied, true);
    } finally {
      await source.close();
      await upstream.close();
      await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
