import { FeedError } from "./types.js";

export type RawRecord = Record<string, unknown>;

export interface DecodedFeed {
  records: RawRecord[];
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 400).toLowerCase();
  return head.includes("<html") || head.includes("<!doctype html") || head.includes("<head>");
}

/**
 * Turn a feed body into text.
 * Official responses have been observed as UTF-8 or UTF-16LE, sometimes with a
 * BOM, and sometimes with embedded NUL bytes. Those quirks are handled here.
 */
export function decodeFeedText(input: Uint8Array | string): string {
  if (typeof input === "string") {
    return input.replace(/^\uFEFF/, "").replace(/\u0000/g, "").replace(/\u0A7B/g, "");
  }
  let bytes = input;
  let encoding: "utf-8" | "utf-16le" = "utf-8";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    bytes = bytes.subarray(2);
  } else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bytes = bytes.subarray(3);
  }
  const text = new TextDecoder(encoding).decode(bytes);
  return text.replace(/\u0000/g, "").replace(/\u0A7B/g, "").replace(/^\uFEFF/, "");
}

function isLiveShape(record: RawRecord): boolean {
  if ("cat" in record && record.cat != null && record.cat !== "") return true;
  return typeof record.id !== "undefined" && Array.isArray(record.data);
}

function isHistoryShape(record: RawRecord): boolean {
  if (isLiveShape(record)) return false;
  return "alertDate" in record || ("category" in record && "data" in record);
}

function recordsFromArray(value: unknown[]): RawRecord[] {
  return value.filter(isRecord);
}

/**
 * Accept the shapes maintained clients actually branch on:
 * an empty body, one live object, an array of live or history objects,
 * and a single wrapping object whose only payload is an array of records.
 * String `data` arrays are cities, not nested records.
 */
export function extractRecords(parsed: unknown): RawRecord[] {
  if (parsed == null) return [];
  if (Array.isArray(parsed)) return recordsFromArray(parsed);
  if (!isRecord(parsed)) {
    throw new FeedError("malformed", "Feed JSON was not an object or an array.");
  }
  if (isLiveShape(parsed) || isHistoryShape(parsed)) return [parsed];
  for (const key of ["alerts", "records", "history"]) {
    const value = parsed[key];
    if (Array.isArray(value)) return recordsFromArray(value);
  }
  if (Array.isArray(parsed.data) && parsed.data.every(isRecord)) {
    return recordsFromArray(parsed.data);
  }
  if (Object.keys(parsed).length === 0) return [];
  const objectArrays = Object.values(parsed).filter(
    (value): value is unknown[] => Array.isArray(value) && value.length > 0 && value.every(isRecord),
  );
  if (objectArrays.length === 1) return recordsFromArray(objectArrays[0]);
  throw new FeedError(
    "malformed",
    "Unrecognized feed JSON. Expected an alert object, an array, or a wrapper with an alerts array.",
  );
}

export function decodeFeedBody(input: Uint8Array | string): DecodedFeed {
  const text = decodeFeedText(input).trim();
  if (!text) return { records: [] };
  if (looksLikeHtml(text)) {
    if (/access denied/i.test(text)) {
      throw new FeedError(
        "geo-blocked",
        "Oref returned an Access Denied HTML page. The client IP is likely outside the edge allow-list. Set OREF_PROXY to an HTTP proxy with Israeli egress.",
      );
    }
    if (text.includes("/errorpage_adom/")) {
      throw new FeedError("upstream", "Oref returned its temporary error page (/errorpage_adom/).");
    }
    throw new FeedError("malformed", "Feed response was HTML, not JSON.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parse error";
    throw new FeedError("malformed", `Invalid JSON: ${message}`);
  }
  return { records: extractRecords(parsed) };
}

export function namespaceOf(record: RawRecord): "live" | "history" {
  if (isLiveShape(record)) return "live";
  return "history";
}
