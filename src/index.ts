export { AreaCatalog, normalizeAreaName, unmappedAreaId } from "./areas.js";
export type { AreaCatalogFile, CatalogArea, CatalogDistrict } from "./areas.js";
export { classifyMessage, englishInstructions, englishTitle, parseCategoryCode } from "./categories.js";
export type { ClassifiedMessage } from "./categories.js";
export { DEFAULT_ALERTS_URL, DEFAULT_HISTORY_URL, DOCUMENTED_ENDPOINTS, loadConfig } from "./config.js";
export type { ServiceConfig } from "./config.js";
export { decodeFeedBody, decodeFeedText, extractRecords } from "./decode.js";
export { AlertEngine } from "./engine.js";
export type { IngestOptions, IngestResult } from "./engine.js";
export { buildMockPayloads, encodePayload, MOCK_STEP_COUNT } from "./mock.js";
export { normalizeRecord, normalizeRecords } from "./normalize.js";
export { Poller } from "./poller.js";
export { loadSchemaDocument, validateDocument } from "./schema.js";
export { startServer } from "./server.js";
export type { RunningServer } from "./server.js";
export { HttpFeedSource, MockFeedSource } from "./source.js";
export type { FeedSource } from "./source.js";
export { formatJerusalem, parseJerusalem } from "./time.js";
export { CATEGORIES, FeedError, SCHEMA_VERSION } from "./types.js";
export type {
  AreaLifecycle,
  AreaRef,
  Category,
  Classification,
  FeedNamespace,
  LifecyclePhase,
  LocalizedName,
  OptionalText,
  MessagePhase,
  NormalizedAlert,
  WebhookEvent,
} from "./types.js";
