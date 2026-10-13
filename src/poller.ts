import type { ServiceConfig } from "./config.js";
import type { AlertEngine } from "./engine.js";
import type { FeedSource } from "./source.js";
import { FeedError } from "./types.js";

export interface ChannelStatus {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  consecutiveErrors: number;
  httpStatus: number | null;
}

export interface PollerStatus {
  mode: "live" | "mock";
  live: ChannelStatus;
  history: ChannelStatus;
}

function emptyChannel(): ChannelStatus {
  return {
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    consecutiveErrors: 0,
    httpStatus: null,
  };
}

function formatError(error: unknown): { message: string; status: number | null } {
  if (error instanceof FeedError) {
    return { message: `${error.code}: ${error.message}`, status: error.status ?? null };
  }
  if (error instanceof Error) return { message: error.message, status: null };
  return { message: String(error), status: null };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class Poller {
  readonly status: PollerStatus;
  private historyBackoffMs = 5_000;

  constructor(
    private readonly engine: AlertEngine,
    private readonly source: FeedSource,
    private readonly config: Pick<ServiceConfig, "mode" | "liveIntervalMs" | "historyIntervalMs">,
  ) {
    this.status = {
      mode: source.mode,
      live: emptyChannel(),
      history: emptyChannel(),
    };
  }

  async run(signal: AbortSignal): Promise<void> {
    let liveDelay = this.config.liveIntervalMs;
    let nextHistory = 0;
    while (!signal.aborted) {
      try {
        const body = await this.source.fetchLive();
        if (signal.aborted) return;
        this.engine.ingest(body, {
          feed: "live",
          origin: this.source.mode === "mock" ? "mock" : "upstream",
        });
        this.status.live.consecutiveErrors = 0;
        this.status.live.lastError = null;
        this.status.live.httpStatus = 200;
        this.status.live.lastSuccessAt = new Date().toISOString();
        liveDelay = this.config.liveIntervalMs;
      } catch (error) {
        const formatted = formatError(error);
        this.status.live.consecutiveErrors += 1;
        this.status.live.lastError = formatted.message;
        this.status.live.httpStatus = formatted.status;
        this.status.live.lastErrorAt = new Date().toISOString();
        liveDelay = Math.min(Math.max(liveDelay * 2, this.config.liveIntervalMs), 60_000);
      }

      if (!signal.aborted && Date.now() >= nextHistory) {
        try {
          const body = await this.source.fetchHistory();
          if (signal.aborted) return;
          this.engine.ingest(body, {
            feed: "history",
            origin: this.source.mode === "mock" ? "mock" : "upstream",
          });
          this.status.history.consecutiveErrors = 0;
          this.status.history.lastError = null;
          this.status.history.httpStatus = 200;
          this.status.history.lastSuccessAt = new Date().toISOString();
          this.historyBackoffMs = 5_000;
          nextHistory = Date.now() + this.config.historyIntervalMs;
        } catch (error) {
          const formatted = formatError(error);
          this.status.history.consecutiveErrors += 1;
          this.status.history.lastError = formatted.message;
          this.status.history.httpStatus = formatted.status;
          this.status.history.lastErrorAt = new Date().toISOString();
          nextHistory = Date.now() + this.historyBackoffMs;
          this.historyBackoffMs = Math.min(this.historyBackoffMs * 2, 60_000);
        }
      }

      await sleep(liveDelay, signal);
    }
  }
}
