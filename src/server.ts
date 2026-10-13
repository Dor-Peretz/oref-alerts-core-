import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AreaCatalog } from "./areas.js";
import type { ServiceConfig } from "./config.js";
import type { AlertEngine } from "./engine.js";
import type { Poller } from "./poller.js";
import { loadSchemaDocument } from "./schema.js";
import {
  SCHEMA_VERSION,
  type AreaLifecycle,
  type NormalizedAlert,
  type WebhookEvent,
} from "./types.js";

interface Hook {
  id: string;
  url: string;
  secret: string | null;
}

export interface RunningServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export interface ServerOptions {
  engine: AlertEngine;
  catalog: AreaCatalog;
  config: ServiceConfig;
  poller?: Poller;
}

function safeEqual(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, error: string, message: string): void {
  sendJson(res, status, { error, message });
}

function readBody(req: IncomingMessage, limit = 32_768): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function queryLimit(value: string | null, fallback = 100): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1000, Math.max(1, Math.trunc(parsed)));
}

function filterAlerts(alerts: NormalizedAlert[], url: URL): NormalizedAlert[] {
  const phase = url.searchParams.get("phase");
  const source = url.searchParams.get("source");
  return alerts.filter((alert) => {
    if (phase && phase !== "all" && alert.phase !== phase) return false;
    if (source && alert.source !== source) return false;
    return true;
  });
}

async function deliver(hook: Hook, event: WebhookEvent): Promise<void> {
  const body = JSON.stringify(event);
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "user-agent": "oref-alerts-core/1.0.0",
    "x-oref-event": event.event,
    "x-oref-delivery": randomUUID(),
  };
  if (hook.secret) {
    headers["x-oref-signature"] = `sha256=${createHmac("sha256", hook.secret).update(body).digest("hex")}`;
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(hook.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return;
    } catch {
      // Retry once. Webhook failures must not break the poller.
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const { engine, catalog, config, poller } = options;
  const hooks = new Map<string, Hook>();
  const streams = new Set<ServerResponse>();

  const broadcast = (event: string, data: unknown): void => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const stream of streams) {
      stream.write(frame);
    }
  };

  const onAlert = (alert: NormalizedAlert): void => {
    const event: WebhookEvent = {
      schemaVersion: SCHEMA_VERSION,
      event: "alert.created",
      sentAt: new Date().toISOString(),
      alert,
      changes: [],
    };
    broadcast("alert", event);
    for (const hook of hooks.values()) void deliver(hook, event);
  };
  const onLifecycle = (changes: AreaLifecycle[]): void => {
    const event: WebhookEvent = {
      schemaVersion: SCHEMA_VERSION,
      event: "lifecycle.updated",
      sentAt: new Date().toISOString(),
      alert: null,
      changes,
    };
    broadcast("lifecycle", event);
    for (const hook of hooks.values()) void deliver(hook, event);
  };
  engine.on("alert.created", onAlert);
  engine.on("lifecycle.updated", onLifecycle);

  const heartbeat = setInterval(() => {
    for (const stream of streams) stream.write(": ping\n\n");
  }, 15_000);
  heartbeat.unref?.();

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "request failed";
      if (!res.headersSent) sendError(res, 400, "bad_request", message);
      else res.end();
    });
  });
  server.requestTimeout = 0;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "authorization, content-type",
      });
      res.end();
      return;
    }

    if (path === "/health") {
      sendJson(res, 200, { ok: true, schemaVersion: SCHEMA_VERSION, mode: config.mode });
      return;
    }

    if (config.apiToken) {
      const header = req.headers.authorization;
      const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
      const provided = bearer || url.searchParams.get("access_token") || "";
      if (!safeEqual(provided, config.apiToken)) {
        sendError(res, 401, "unauthorized", "Missing or invalid bearer token.");
        return;
      }
    }

    if (method === "GET" && path === "/v1/schema") {
      sendJson(res, 200, loadSchemaDocument());
      return;
    }
    if (method === "GET" && path === "/v1/status") {
      const stats = engine.stats();
      sendJson(res, 200, {
        schemaVersion: SCHEMA_VERSION,
        mode: config.mode,
        now: new Date().toISOString(),
        areasInCatalog: catalog.size,
        districtsInCatalog: catalog.districtCount,
        catalogProvenance: catalog.provenance,
        poller: poller?.status ?? null,
        engine: stats,
        webhooks: hooks.size,
        streams: streams.size,
      });
      return;
    }
    if (method === "GET" && (path === "/v1/alerts" || path === "/v1/history")) {
      const alerts = filterAlerts(engine.getAlerts(), url).slice(0, queryLimit(url.searchParams.get("limit")));
      sendJson(res, 200, { schemaVersion: SCHEMA_VERSION, alerts });
      return;
    }
    if (method === "GET" && path.startsWith("/v1/alerts/")) {
      const id = decodeURIComponent(path.slice("/v1/alerts/".length));
      const alert = engine.getAlert(id);
      if (!alert) {
        sendError(res, 404, "not_found", `No alert ${id}.`);
        return;
      }
      sendJson(res, 200, alert);
      return;
    }
    if (method === "GET" && path === "/v1/lifecycle") {
      const phase = url.searchParams.get("phase");
      let rows = engine.getLifecycle();
      if (phase && phase !== "all") rows = rows.filter((row) => row.phase === phase);
      sendJson(res, 200, { schemaVersion: SCHEMA_VERSION, areas: rows });
      return;
    }
    if (method === "GET" && path === "/v1/current") {
      sendJson(res, 200, {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        areas: engine.current(),
      });
      return;
    }
    if (method === "GET" && path === "/v1/districts") {
      sendJson(res, 200, { schemaVersion: SCHEMA_VERSION, districts: catalog.districts() });
      return;
    }
    if (method === "GET" && path === "/v1/areas") {
      const q = url.searchParams.get("q") ?? "";
      const limit = queryLimit(url.searchParams.get("limit"), 50);
      sendJson(res, 200, { schemaVersion: SCHEMA_VERSION, areas: catalog.search(q, limit) });
      return;
    }
    if (method === "GET" && path.startsWith("/v1/areas/")) {
      const id = decodeURIComponent(path.slice("/v1/areas/".length));
      const area = catalog.get(id);
      if (!area) {
        sendError(res, 404, "not_found", `No area ${id}.`);
        return;
      }
      const district = area.districtId ? catalog.district(area.districtId) ?? null : null;
      sendJson(res, 200, { ...area, district });
      return;
    }
    if (method === "GET" && path === "/v1/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "access-control-allow-origin": "*",
        "x-accel-buffering": "no",
      });
      streams.add(res);
      res.write(`event: hello\ndata: ${JSON.stringify({ schemaVersion: SCHEMA_VERSION, mode: config.mode })}\n\n`);
      req.on("close", () => streams.delete(res));
      return;
    }
    if (method === "GET" && path === "/v1/webhooks") {
      sendJson(res, 200, {
        webhooks: [...hooks.values()].map((hook) => ({ id: hook.id, url: hook.url })),
      });
      return;
    }
    if (method === "POST" && path === "/v1/webhooks") {
      const raw = await readBody(req);
      const parsed = raw ? (JSON.parse(raw) as { url?: unknown; secret?: unknown }) : {};
      if (typeof parsed.url !== "string") {
        sendError(res, 400, "bad_request", "JSON body must include a url string.");
        return;
      }
      let target: URL;
      try {
        target = new URL(parsed.url);
      } catch {
        sendError(res, 400, "bad_request", "url is not a valid URL.");
        return;
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        sendError(res, 400, "bad_request", "url must be http or https.");
        return;
      }
      if (hooks.size >= 50) {
        sendError(res, 400, "bad_request", "Webhook limit is 50.");
        return;
      }
      const existing = [...hooks.values()].find((hook) => hook.url === target.toString());
      if (existing) {
        sendJson(res, 200, { id: existing.id, url: existing.url });
        return;
      }
      const hook: Hook = {
        id: randomUUID(),
        url: target.toString(),
        secret: typeof parsed.secret === "string" && parsed.secret ? parsed.secret : null,
      };
      hooks.set(hook.id, hook);
      sendJson(res, 201, { id: hook.id, url: hook.url });
      return;
    }
    if (method === "DELETE" && path.startsWith("/v1/webhooks/")) {
      const id = decodeURIComponent(path.slice("/v1/webhooks/".length));
      if (!hooks.delete(id)) {
        sendError(res, 404, "not_found", `No webhook ${id}.`);
        return;
      }
      sendJson(res, 200, { deleted: id });
      return;
    }

    sendError(res, 404, "not_found", `No route ${method} ${path}.`);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      clearInterval(heartbeat);
      engine.off("alert.created", onAlert);
      engine.off("lifecycle.updated", onLifecycle);
      for (const stream of streams) stream.end();
      streams.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
