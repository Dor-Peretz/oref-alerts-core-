export const DEFAULT_ALERTS_URL = "https://www.oref.org.il/warningMessages/alert/Alerts.json";
export const DEFAULT_HISTORY_URL = "https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json";

/**
 * Paths below are the ones requested by pikud-haoref-api (commit e40da77).
 * They are unofficial. This process could not read them: both hosts returned
 * Akamai HTTP 403 from the build environment. Override with OREF_ALERTS_URL
 * and OREF_HISTORY_URL if a mirror publishes the same JSON shapes.
 */
export const DOCUMENTED_ENDPOINTS = {
  liveAlerts: DEFAULT_ALERTS_URL,
  history: DEFAULT_HISTORY_URL,
  districts: "https://alerts-history.oref.org.il/Shared/Ajax/GetDistricts.aspx?lang=he",
  districtCitiesHebrew: "https://www.oref.org.il/districts/cities_heb.json",
  districtCitiesEnglish: "https://www.oref.org.il/districts/cities_eng.json",
  alertCategories: "https://www.oref.org.il/alerts/alertCategories.json",
  alarmsHistoryAspx: "https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx?lang=he&mode=1",
} as const;

export interface ServiceConfig {
  mode: "live" | "mock";
  host: string;
  port: number;
  proxyUrl: string | null;
  alertsUrl: string;
  historyUrl: string;
  liveIntervalMs: number;
  historyIntervalMs: number;
  liveTimeoutMs: number;
  historyTimeoutMs: number;
  ignoreDrills: boolean;
  apiToken: string | null;
  mockIntervalMs: number;
  userAgent: string;
}

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  const text = value.trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(text)) return false;
  if (["1", "true", "yes", "on"].includes(text)) return true;
  return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const mode = env.OREF_MODE === "mock" ? "mock" : "live";
  const proxy = (env.OREF_PROXY || env.HTTPS_PROXY || env.HTTP_PROXY || "").trim();
  return {
    mode,
    host: (env.OREF_HOST || "0.0.0.0").trim() || "0.0.0.0",
    port: integer(env.OREF_PORT, 8080, 0, 65535),
    proxyUrl: proxy || null,
    alertsUrl: (env.OREF_ALERTS_URL || DEFAULT_ALERTS_URL).trim(),
    historyUrl: (env.OREF_HISTORY_URL || DEFAULT_HISTORY_URL).trim(),
    liveIntervalMs: integer(env.OREF_POLL_INTERVAL_MS, 2000, 250, 120_000),
    historyIntervalMs: integer(env.OREF_HISTORY_INTERVAL_MS, 30_000, 5_000, 600_000),
    liveTimeoutMs: integer(env.OREF_LIVE_TIMEOUT_MS, 10_000, 1_000, 60_000),
    historyTimeoutMs: integer(env.OREF_HISTORY_TIMEOUT_MS, 20_000, 1_000, 120_000),
    ignoreDrills: flag(env.OREF_IGNORE_DRILLS, true),
    apiToken: (env.OREF_API_TOKEN || "").trim() || null,
    mockIntervalMs: integer(env.OREF_MOCK_INTERVAL_MS, 4_000, 200, 120_000),
    userAgent: (env.OREF_USER_AGENT || "oref-alerts-core/1.0.0").trim(),
  };
}
