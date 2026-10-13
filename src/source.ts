import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { ServiceConfig } from "./config.js";
import { FeedError } from "./types.js";
import { buildMockPayloads, encodePayload, MOCK_STEP_COUNT } from "./mock.js";

const MAX_BYTES = 8_000_000;

export interface FeedSource {
  readonly mode: "live" | "mock";
  fetchLive(): Promise<Uint8Array>;
  fetchHistory(): Promise<Uint8Array>;
  close(): Promise<void>;
}

type FetchImpl = typeof undiciFetch;

function withCacheBuster(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("_", String(Math.floor(Date.now() / 1000)));
  return parsed.toString();
}

export class HttpFeedSource implements FeedSource {
  readonly mode = "live" as const;
  private readonly dispatcher: ProxyAgent | undefined;

  constructor(
    private readonly config: Pick<
      ServiceConfig,
      "alertsUrl" | "historyUrl" | "proxyUrl" | "userAgent" | "liveTimeoutMs" | "historyTimeoutMs"
    >,
    private readonly fetchImpl: FetchImpl = undiciFetch,
  ) {
    if (config.proxyUrl) this.dispatcher = new ProxyAgent(config.proxyUrl);
  }

  fetchLive(): Promise<Uint8Array> {
    return this.get(this.config.alertsUrl, this.config.liveTimeoutMs);
  }

  fetchHistory(): Promise<Uint8Array> {
    return this.get(this.config.historyUrl, this.config.historyTimeoutMs);
  }

  async close(): Promise<void> {
    await this.dispatcher?.close();
  }

  private async get(url: string, timeoutMs: number): Promise<Uint8Array> {
    let response: Awaited<ReturnType<FetchImpl>>;
    try {
      response = await this.fetchImpl(withCacheBuster(url), {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "he-IL,he;q=0.9,en;q=0.8",
          pragma: "no-cache",
          "cache-control": "max-age=0",
          referer: "https://www.oref.org.il/11226-he/pakar.aspx",
          "x-requested-with": "XMLHttpRequest",
          "user-agent": this.config.userAgent,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      throw new FeedError("network", `Request failed for ${new URL(url).origin}: ${message}`);
    }

    if (response.status === 403) {
      throw new FeedError(
        "geo-blocked",
        `HTTP 403 from ${new URL(url).host}. Oref's edge usually rejects non-Israeli IPs. Set OREF_PROXY to an HTTP proxy with Israeli egress.`,
        403,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new FeedError("http", `HTTP ${response.status} from ${new URL(url).host}`, response.status);
    }

    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) {
      throw new FeedError("too-large", `Feed body was ${buffer.byteLength} bytes, over the ${MAX_BYTES} byte cap.`);
    }
    return buffer;
  }
}

export class MockFeedSource implements FeedSource {
  readonly mode = "mock" as const;
  private readonly origin: number;

  constructor(
    private readonly options: { intervalMs?: number; now?: () => number; startMs?: number } = {},
  ) {
    this.origin = options.startMs ?? (options.now ?? Date.now)();
  }

  position(now = this.options.now ?? Date.now): { step: number; cycle: number } {
    const interval = this.options.intervalMs ?? 4_000;
    const elapsed = Math.max(0, now() - this.origin);
    const span = interval * MOCK_STEP_COUNT;
    return {
      cycle: Math.floor(elapsed / span),
      step: Math.floor(elapsed / interval) % MOCK_STEP_COUNT,
    };
  }

  fetchLive(): Promise<Uint8Array> {
    const { step, cycle } = this.position();
    return Promise.resolve(encodePayload(buildMockPayloads(step, cycle).live));
  }

  fetchHistory(): Promise<Uint8Array> {
    const { step, cycle } = this.position();
    return Promise.resolve(encodePayload(buildMockPayloads(step, cycle).history));
  }

  async close(): Promise<void> {}
}
