import { createHash } from "node:crypto";
import { AreaCatalog } from "./areas.js";
import {
  classifyMessage,
  englishInstructions,
  englishTitle,
  parseCategoryCode,
} from "./categories.js";
import { namespaceOf, type RawRecord } from "./decode.js";
import { validateDocument } from "./schema.js";
import { parseJerusalem } from "./time.js";
import {
  SCHEMA_VERSION,
  type FeedNamespace,
  type NormalizedAlert,
} from "./types.js";

export interface NormalizeOptions {
  catalog: AreaCatalog;
  origin?: "upstream" | "mock";
  observedAt?: Date;
  /** Which feed the bytes came from. Per-record shape still wins when it is obvious. */
  feed?: FeedNamespace;
  validate?: boolean;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function areaNames(data: unknown): string[] {
  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(data)) return [];
  const names: string[] = [];
  for (const item of data) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed) names.push(trimmed);
  }
  return names;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function recordNamespace(record: RawRecord, feed: FeedNamespace | undefined): FeedNamespace {
  if ("cat" in record && record.cat != null && `${record.cat}`.trim() !== "") return "live";
  if ("alertDate" in record && !("cat" in record)) return "history";
  if (feed) return feed;
  return namespaceOf(record);
}

export function normalizeRecord(record: RawRecord, options: NormalizeOptions): NormalizedAlert | null {
  const namespace = recordNamespace(record, options.feed);
  const title = asString(record.title);
  const instructions = asString(record.desc ?? record.description);
  const code = parseCategoryCode(namespace === "live" ? (record.cat ?? record.category) : (record.category ?? record.cat));
  const classified = classifyMessage(title, namespace, code);
  const names = areaNames(record.data);
  if (names.length === 0) return null;

  const areas = names.map((name) => options.catalog.resolve(name));
  const observedAt = options.observedAt ?? new Date();
  const rawTime = asString(record.alertDate ?? record.date);
  const alertTime = rawTime ? parseJerusalem(rawTime) : null;
  const upstreamId = asString(record.id);
  const id =
    upstreamId ||
    `hist:${shortHash([rawTime, code ?? "", title, names.join("|")].join("\u001f"))}`;
  const test =
    title.includes("בדיקה") || (areas.length > 0 && areas.every((area) => area.rawName.includes("בדיקה")));

  const alert: NormalizedAlert = {
    schemaVersion: SCHEMA_VERSION,
    id,
    origin: options.origin ?? "upstream",
    source: namespace,
    category: classified.category,
    relatedCategory: classified.relatedCategory,
    phase: classified.phase,
    drill: classified.drill,
    test,
    title: { he: title, en: englishTitle(title) },
    instructions: {
      he: instructions || null,
      en: instructions ? englishInstructions(instructions) : null,
    },
    areas,
    timestamps: {
      observedAt: observedAt.toISOString(),
      alertTime: alertTime ? alertTime.toISOString() : null,
      sourceTimezone: alertTime ? "Asia/Jerusalem" : null,
    },
    classification: {
      basis: classified.basis,
      namespace,
      sourceCat: code == null ? null : String(code),
      disputed: classified.disputed,
    },
  };

  if (options.validate !== false) validateDocument("alert", alert);
  return alert;
}

export function normalizeRecords(records: RawRecord[], options: NormalizeOptions): NormalizedAlert[] {
  const alerts: NormalizedAlert[] = [];
  for (const record of records) {
    const alert = normalizeRecord(record, options);
    if (alert) alerts.push(alert);
  }
  return alerts;
}
