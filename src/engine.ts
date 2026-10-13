import { EventEmitter } from "node:events";
import { AreaCatalog } from "./areas.js";
import { decodeFeedBody } from "./decode.js";
import { normalizeRecords } from "./normalize.js";
import {
  SCHEMA_VERSION,
  type AreaLifecycle,
  type FeedNamespace,
  type MessagePhase,
  type NormalizedAlert,
} from "./types.js";

export interface IngestOptions {
  /** Defaults to inferring live vs history from the records. Empty bodies do not clear sounding unless feed is "live". */
  feed?: FeedNamespace | "auto";
  origin?: "upstream" | "mock";
  notify?: boolean;
  observedAt?: Date;
}

export interface IngestResult {
  alerts: NormalizedAlert[];
  created: NormalizedAlert[];
  changes: AreaLifecycle[];
}

interface MutableLifecycle extends AreaLifecycle {
  sinceMs: number | null;
}

const PHASE_ORDER: Record<MessagePhase, number> = {
  "pre-alert": 0,
  active: 1,
  ended: 2,
  none: 3,
};

function eventTime(alert: NormalizedAlert): number {
  return alert.timestamps.alertTime ? Date.parse(alert.timestamps.alertTime) : Date.parse(alert.timestamps.observedAt);
}

export class AlertEngine extends EventEmitter {
  private readonly alerts = new Map<string, NormalizedAlert>();
  private readonly order: string[] = [];
  private readonly lifecycles = new Map<string, MutableLifecycle>();
  private readonly seenAreaKeys = new Map<string, true>();
  private readonly seenAlertIds = new Set<string>();
  private historySeeded = false;
  private liveIngests = 0;
  private historyIngests = 0;
  readonly ignoreDrills: boolean;
  private readonly retain: number;
  private readonly catalog: AreaCatalog;
  private readonly validate: boolean;

  constructor(options: { catalog: AreaCatalog; ignoreDrills?: boolean; retain?: number; validate?: boolean }) {
    super();
    this.catalog = options.catalog;
    this.ignoreDrills = options.ignoreDrills ?? true;
    this.retain = options.retain ?? 1000;
    this.validate = options.validate ?? true;
  }

  stats(): {
    retained: number;
    tracked: number;
    historySeeded: boolean;
    liveIngests: number;
    historyIngests: number;
  } {
    return {
      retained: this.alerts.size,
      tracked: this.lifecycles.size,
      historySeeded: this.historySeeded,
      liveIngests: this.liveIngests,
      historyIngests: this.historyIngests,
    };
  }

  getAlerts(): NormalizedAlert[] {
    return [...this.alerts.values()].sort((a, b) => eventTime(b) - eventTime(a));
  }

  getAlert(id: string): NormalizedAlert | undefined {
    return this.alerts.get(id);
  }

  getLifecycle(): AreaLifecycle[] {
    return [...this.lifecycles.values()].map(publicLifecycle);
  }

  getAreaLifecycle(areaId: string): AreaLifecycle | undefined {
    const row = this.lifecycles.get(areaId);
    return row ? publicLifecycle(row) : undefined;
  }

  current(): AreaLifecycle[] {
    return this.getLifecycle().filter((row) => row.phase === "pre-alert" || row.phase === "active");
  }

  ingest(body: Uint8Array | string, options: IngestOptions = {}): IngestResult {
    const decoded = decodeFeedBody(body);
    const feed = resolveFeed(options.feed, decoded.records);
    if (feed === "live") this.liveIngests += 1;
    else this.historyIngests += 1;

    const notify = options.notify ?? (feed === "history" ? this.historySeeded : true);
    if (feed === "history" && decoded.records.length > 0) this.historySeeded = true;

    const alerts = normalizeRecords(decoded.records, {
      catalog: this.catalog,
      origin: options.origin ?? "upstream",
      observedAt: options.observedAt,
      feed,
      validate: this.validate,
    }).sort((a, b) => {
      const time = eventTime(a) - eventTime(b);
      if (time !== 0) return time;
      return PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase];
    });

    const created: NormalizedAlert[] = [];
    const dirty = new Set<string>();
    for (const alert of alerts) {
      const isNewId = !this.seenAlertIds.has(alert.id);
      let applied = false;
      for (const area of alert.areas) {
        const key = `${alert.id}|${area.id}|${alert.phase}`;
        if (this.seenAreaKeys.has(key)) continue;
        this.rememberKey(key);
        if (this.apply(area, alert, dirty)) applied = true;
      }
      this.rememberAlert(alert);
      if (isNewId) this.seenAlertIds.add(alert.id);
      if (isNewId && applied) created.push(this.alerts.get(alert.id) ?? alert);
    }

    if (feed === "live") this.reconcileSounding(alerts, dirty);

    const changes = [...dirty].map((id) => this.lifecycles.get(id)).filter((row): row is MutableLifecycle => row != null).map(publicLifecycle);

    if (notify) {
      for (const alert of created) {
        if (alert.phase === "none") continue;
        if (alert.drill && this.ignoreDrills) continue;
        if (alert.test) continue;
        this.emit("alert.created", alert);
      }
      if (changes.length > 0) this.emit("lifecycle.updated", changes);
    }

    return { alerts, created, changes };
  }

  private rememberAlert(alert: NormalizedAlert): void {
    const existing = this.alerts.get(alert.id);
    if (!existing) {
      this.alerts.set(alert.id, alert);
      this.order.push(alert.id);
    } else {
      const seen = new Set(existing.areas.map((area) => area.id));
      const merged = [...existing.areas];
      for (const area of alert.areas) {
        if (!seen.has(area.id)) merged.push(area);
      }
      this.alerts.set(alert.id, { ...existing, areas: merged });
    }
    while (this.order.length > this.retain) {
      const oldest = this.order.shift();
      if (oldest) this.alerts.delete(oldest);
    }
  }

  private rememberKey(key: string): void {
    this.seenAreaKeys.set(key, true);
    while (this.seenAreaKeys.size > 50_000) {
      const oldest = this.seenAreaKeys.keys().next().value;
      if (oldest === undefined) break;
      this.seenAreaKeys.delete(oldest);
    }
  }

  private apply(area: NormalizedAlert["areas"][number], alert: NormalizedAlert, dirty: Set<string>): boolean {
    if (alert.phase === "none") return false;
    if (alert.drill && this.ignoreDrills) return false;
    if (alert.test || area.rawName.includes("בדיקה")) return false;

    const time = eventTime(alert);
    const state = this.lifecycleFor(area);
    if (state.sinceMs != null && time < state.sinceMs && state.phase !== "idle") return false;
    if (state.phase === "active" && alert.phase === "pre-alert") return false;
    if (state.phase === alert.phase && state.alertId === alert.id) return false;
    // Live and history feeds describe the same wave with different ids.
    // History timestamps are minute-granular on one of the documented endpoints.
    if (
      state.phase === alert.phase &&
      state.category === alert.category &&
      state.sinceMs != null &&
      Math.abs(time - state.sinceMs) <= 90_000
    ) {
      return false;
    }

    state.phase = alert.phase;
    state.category = alert.category;
    state.drill = alert.drill;
    state.alertId = alert.id;
    state.since = new Date(time).toISOString();
    state.sinceMs = time;
    state.updatedAt = alert.timestamps.observedAt;
    state.rawName = area.rawName;
    if (alert.phase === "active") {
      state.threatCategory = alert.category === "drill" || alert.category === "general"
        ? (alert.relatedCategory ?? state.threatCategory)
        : alert.category;
    } else if (alert.relatedCategory && state.threatCategory == null) {
      state.threatCategory = alert.relatedCategory;
    }
    dirty.add(area.id);
    return true;
  }

  private lifecycleFor(area: NormalizedAlert["areas"][number]): MutableLifecycle {
    const existing = this.lifecycles.get(area.id);
    if (existing) return existing;
    const created: MutableLifecycle = {
      schemaVersion: SCHEMA_VERSION,
      areaId: area.id,
      rawName: area.rawName,
      names: area.names,
      phase: "idle",
      category: null,
      threatCategory: null,
      drill: false,
      sounding: false,
      alertId: null,
      since: null,
      updatedAt: null,
      district: area.district,
      sinceMs: null,
    };
    this.lifecycles.set(area.id, created);
    return created;
  }

  private reconcileSounding(alerts: NormalizedAlert[], dirty: Set<string>): void {
    const sounding = new Set<string>();
    for (const alert of alerts) {
      if (alert.phase === "none" || alert.phase === "ended") continue;
      if (alert.drill && this.ignoreDrills) continue;
      if (alert.test) continue;
      for (const area of alert.areas) {
        if (area.rawName.includes("בדיקה")) continue;
        sounding.add(area.id);
      }
    }
    for (const state of this.lifecycles.values()) {
      const next = sounding.has(state.areaId);
      if (state.sounding === next) continue;
      state.sounding = next;
      dirty.add(state.areaId);
    }
  }
}

function publicLifecycle(row: MutableLifecycle): AreaLifecycle {
  return {
    schemaVersion: row.schemaVersion,
    areaId: row.areaId,
    rawName: row.rawName,
    names: row.names,
    phase: row.phase,
    category: row.category,
    threatCategory: row.threatCategory,
    drill: row.drill,
    sounding: row.sounding,
    alertId: row.alertId,
    since: row.since,
    updatedAt: row.updatedAt,
    district: row.district,
  };
}

function resolveFeed(
  requested: IngestOptions["feed"],
  records: Array<Record<string, unknown>>,
): FeedNamespace {
  if (requested && requested !== "auto") return requested;
  if (records.length === 0) return "history";
  const history = records.every((record) => "alertDate" in record && !("cat" in record));
  return history ? "history" : "live";
}
