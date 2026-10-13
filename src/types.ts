/** Public schema version for every normalized document this package emits. */
export const SCHEMA_VERSION = "1.0.0" as const;

export const CATEGORIES = [
  "missiles",
  "aircraft",
  "earthquake",
  "tsunami",
  "radiological",
  "hazardous-materials",
  "terrorist-infiltration",
  "nonconventional",
  "general",
  "informational",
  "pre-alert",
  "all-clear",
  "drill",
  "unknown",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Phase of a single upstream message. `none` does not move an area's lifecycle. */
export type MessagePhase = "none" | "pre-alert" | "active" | "ended";

export type LifecyclePhase = "idle" | "pre-alert" | "active" | "ended";

export type ClassificationBasis = "title" | "live-cat" | "history-category" | "title-and-code";

export type FeedNamespace = "live" | "history";

export interface LocalizedName {
  he: string;
  en: string | null;
}

export interface OptionalText {
  he: string | null;
  en: string | null;
}

export interface AreaRef {
  id: string;
  rawName: string;
  match: "exact" | "unmapped";
  names: LocalizedName;
  district: { id: string; names: LocalizedName } | null;
  shelterTimeSeconds: number | null;
  location: { lat: number; lng: number } | null;
}

export interface Classification {
  basis: ClassificationBasis;
  namespace: FeedNamespace;
  /** Upstream category code, decimal string, without any remapping. */
  sourceCat: string | null;
  /** True when maintained clients disagree on this numeric code. */
  disputed: boolean;
}

export interface NormalizedAlert {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  origin: "upstream" | "mock";
  source: FeedNamespace;
  category: Category;
  /** Threat hinted by a pre-alert or all-clear title, or by a drill code. */
  relatedCategory: Category | null;
  phase: MessagePhase;
  drill: boolean;
  test: boolean;
  title: LocalizedName;
  instructions: OptionalText;
  areas: AreaRef[];
  timestamps: {
    observedAt: string;
    /** UTC instant. Null when the upstream record had no parseable time. */
    alertTime: string | null;
    sourceTimezone: "Asia/Jerusalem" | null;
  };
  classification: Classification;
}

export interface AreaLifecycle {
  schemaVersion: typeof SCHEMA_VERSION;
  areaId: string;
  rawName: string;
  names: LocalizedName;
  phase: LifecyclePhase;
  category: Category | null;
  /** Last concrete threat seen for this area (missiles, aircraft, and so on). */
  threatCategory: Category | null;
  drill: boolean;
  /** True only while this area is present on the latest successful live snapshot. */
  sounding: boolean;
  alertId: string | null;
  since: string | null;
  updatedAt: string | null;
  district: { id: string; names: LocalizedName } | null;
}

export interface WebhookEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  event: "alert.created" | "lifecycle.updated";
  sentAt: string;
  alert: NormalizedAlert | null;
  changes: AreaLifecycle[];
}

export class FeedError extends Error {
  readonly code: "malformed" | "geo-blocked" | "upstream" | "http" | "network" | "too-large";
  readonly status: number | undefined;

  constructor(
    code: FeedError["code"],
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "FeedError";
    this.code = code;
    this.status = status;
  }
}
