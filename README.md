# oref-alerts-core

[![CI](https://github.com/Dor-Peretz/oref-alerts-core-/actions/workflows/ci.yml/badge.svg)](https://github.com/Dor-Peretz/oref-alerts-core-/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](package.json)
[![Schema](https://img.shields.io/badge/schema-v1.0.0-informational.svg)](schema/v1.schema.json)

<p align="center">
  <img src="assets/oref-alerts-core-linkedin.jpg" alt="oref-alerts-core" width="640" />
</p>

A reliable, open-source data layer for [Pikud HaOref](https://www.oref.org.il/) (פיקוד העורף) alerts.

Polls the unofficial Home Front Command feeds, normalizes them into a versioned JSON Schema, maps Hebrew area names to stable IDs, tracks per-area lifecycle (`pre-alert` → `active` → `ended`), and exposes the result as a TypeScript library plus a small service (REST, SSE, webhooks).

> **Disclaimer.** This project is not affiliated with Pikud HaOref or the IDF. It is not a substitute for the official app, website, or public sirens. Upstream feeds are undocumented, change without notice, and are often geo-blocked outside Israel. Use at your own risk.

Background on the problem space: [Israel-Home-Front-Ideas](https://github.com/danielrosehill/Israel-Home-Front-Ideas).

---

## Features

- Robust polling of live alerts and history (BOM / NUL / empty bodies, retries, backoff)
- Optional HTTP proxy for Israeli egress (`OREF_PROXY`)
- Documented schema (`schema/v1.schema.json`) with runtime validation
- Stable area IDs (`city:742` = Tel Aviv – City Center) with Hebrew and English names
- Per-area lifecycle with explicit siren state (`sounding`) vs. event end
- Library API and HTTP service: REST, Server-Sent Events, signed webhooks
- Mock mode for local development without calling Oref
- Tests against recorded fixtures — CI does not need live access

## Why TypeScript

The contract is a versioned JSON Schema. The same Node 22 process is both the library and the HTTP service (`fetch`, HTTP server, and `node:test` built in). Consumers such as Home Assistant talk to the HTTP API; they do not need to import this package.

## Quickstart

Requires Node.js 22+.

```bash
npm ci
npm test
npm run build
OREF_MODE=mock npm start
```

Mock mode never calls Oref. It cycles a scripted incident for Tel Aviv – City Center and Ramat Gan – West: pre-alert → rocket alert → silence → all-clear.

```bash
curl -s localhost:8080/health
curl -s localhost:8080/v1/current
curl -s localhost:8080/v1/areas/city:742
curl -N localhost:8080/v1/stream
```

### Docker

The image defaults to mock mode:

```bash
docker build -t oref-alerts-core .
docker run --rm -p 8080:8080 oref-alerts-core
```

### Live mode

Use an HTTP proxy with Israeli egress when running outside Israel:

```bash
OREF_MODE=live OREF_PROXY=http://user:pass@proxy.example:8080 npm start
```

If `OREF_PROXY` is unset, `HTTPS_PROXY` or `HTTP_PROXY` is used.

---

## Library

```ts
import { AlertEngine, AreaCatalog, HttpFeedSource } from "oref-alerts-core";

const catalog = AreaCatalog.load();
const engine = new AlertEngine({ catalog });
const source = new HttpFeedSource({
  alertsUrl: process.env.OREF_ALERTS_URL,
  historyUrl: process.env.OREF_HISTORY_URL,
  proxyUrl: process.env.OREF_PROXY ?? null,
  userAgent: "my-app/1.0",
  liveTimeoutMs: 10_000,
  historyTimeoutMs: 20_000,
});

const live = await source.fetchLive();
engine.ingest(live, { feed: "live" });
console.log(engine.current());
```

`ingest` throws `FeedError` on a malformed body and leaves the previous lifecycle unchanged. An empty live body is valid and means nothing is sounding right now.

---

## HTTP API

All JSON responses use `schemaVersion: "1.0.0"`.

If `OREF_API_TOKEN` is set, every route except `GET /health` requires `Authorization: Bearer <token>` or `?access_token=`.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness check |
| GET | `/v1/schema` | JSON Schema document |
| GET | `/v1/status` | Poller status, catalog provenance, webhook count |
| GET | `/v1/current` | Areas in `pre-alert` or `active` |
| GET | `/v1/lifecycle?phase=` | Tracked areas |
| GET | `/v1/alerts?phase=&source=&limit=` | Retained alerts (newest first) |
| GET | `/v1/alerts/:id` | Single alert |
| GET | `/v1/history` | Same store as `/v1/alerts` |
| GET | `/v1/areas?q=&limit=` | Catalog search (Hebrew or English) |
| GET | `/v1/areas/:id` | Single area (e.g. `city:742`) |
| GET | `/v1/districts` | Districts assigned by this project |
| GET | `/v1/stream` | Server-Sent Events |
| GET | `/v1/webhooks` | Registered URLs (secrets omitted) |
| POST | `/v1/webhooks` | `{ "url": "https://example/hook", "secret": "optional" }` |
| DELETE | `/v1/webhooks/:id` | Remove a webhook |

CORS is open on these routes. The webhook registrar will POST to any URL you provide, including loopback. Do not expose the service publicly without `OREF_API_TOKEN`.

### Server-Sent Events

`GET /v1/stream` emits:

| Event | When |
| --- | --- |
| `hello` | On connect |
| `alert` | A new alert is applied |
| `lifecycle` | One or more areas change phase or siren state |

A comment heartbeat is sent every 15 seconds.

### Webhooks

| Event | Payload |
| --- | --- |
| `alert.created` | `alert` set; `changes` empty |
| `lifecycle.updated` | `alert` null; `changes` lists affected areas |

Headers: `X-Oref-Event`, `X-Oref-Delivery`, and (when a secret was registered) `X-Oref-Signature: sha256=<hmac of raw body>`. One retry after 200 ms. Failures do not stop the poller.

The first non-empty history response seeds state without webhooks, so a restart does not replay up to ~3,000 old rows. Subsequent history records and every live alert notify normally.

### Home Assistant

Poll `/v1/current` with a REST sensor. For push, register a webhook (Node-RED, AppDaemon, or a local receiver). This service does not implement the Home Assistant WebSocket API.

```yaml
rest:
  - resource: http://127.0.0.1:8080/v1/current
    scan_interval: 2
    sensor:
      - name: Oref areas in alert
        value_template: "{{ value_json.areas | length }}"
        json_attributes:
          - areas
```

---

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `OREF_MODE` | `live` | `mock` or `live` (Docker image defaults to `mock`) |
| `OREF_PROXY` | `HTTPS_PROXY` / `HTTP_PROXY` | HTTP proxy URL |
| `OREF_ALERTS_URL` | see [Upstream feeds](#upstream-feeds) | Live feed URL |
| `OREF_HISTORY_URL` | see [Upstream feeds](#upstream-feeds) | History feed URL |
| `OREF_POLL_INTERVAL_MS` | `2000` | Live poll interval (250–120000) |
| `OREF_HISTORY_INTERVAL_MS` | `30000` | History poll interval (5000–600000) |
| `OREF_PORT` / `OREF_HOST` | `8080` / `0.0.0.0` | Listen address |
| `OREF_API_TOKEN` | unset | Bearer token for all routes except `/health` |
| `OREF_IGNORE_DRILLS` | `true` | Store drills without moving lifecycle |
| `OREF_MOCK_INTERVAL_MS` | `4000` | Duration of one mock step |
| `OREF_USER_AGENT` | `oref-alerts-core/1.0.0` | Outbound User-Agent |

Failed polls back off (up to 60 s) and keep the last good lifecycle. HTTP 403 is reported as `geo-blocked`.

---

## Schema 1.0.0

Contract: [`schema/v1.schema.json`](schema/v1.schema.json) (`$id: urn:oref-alerts:schema:v1`). Every normalized alert is validated against `$defs/alert` before it is stored.

```json
{
  "schemaVersion": "1.0.0",
  "id": "132944072580000000",
  "origin": "upstream",
  "source": "live",
  "category": "missiles",
  "relatedCategory": null,
  "phase": "active",
  "drill": false,
  "test": false,
  "title": { "he": "ירי טילים ורקטות", "en": "Rocket and missile fire" },
  "instructions": { "he": "היכנסו למרחב המוגן", "en": "Enter the protected space" },
  "areas": [
    {
      "id": "city:235",
      "rawName": "סעד",
      "match": "exact",
      "names": { "he": "סעד", "en": "Sa'ad" },
      "district": {
        "id": "district:gaza-envelope",
        "names": { "he": "עוטף עזה", "en": "Gaza Envelope" }
      },
      "shelterTimeSeconds": 15,
      "location": { "lat": 31.46937, "lng": 34.53467 }
    }
  ],
  "timestamps": {
    "observedAt": "2026-10-13T05:02:00.000Z",
    "alertTime": null,
    "sourceTimezone": null
  },
  "classification": {
    "basis": "title-and-code",
    "namespace": "live",
    "sourceCat": "1",
    "disputed": false
  }
}
```

Notes:

- `title.en` / `instructions.en` are null when the Hebrew text is not a recognized phrase (not machine-translated).
- Upstream timestamps are Israel local (`Asia/Jerusalem`) without an offset. `alertTime` is stored as UTC. If the live object has no `alertDate`, `alertTime` is null and ordering uses `observedAt`.

### Lifecycle

Lifecycle is tracked **per area**, not per national bulletin.

| Phase | Entered when |
| --- | --- |
| `pre-alert` | Title contains an advance-notice phrase, or history category `14` |
| `active` | A threat message (missiles, aircraft, earthquake, …) |
| `ended` | Title contains `האירוע הסתיים` / `ניתן לצאת מהמרחב המוגן`, or history category `13` |

Important rules:

- An empty live body sets `sounding` to `false` and does **not** end the alert. The live feed only shows the seconds a siren is active.
- A pre-alert does not downgrade an area that is already `active`.
- Older messages than the area’s current phase are ignored.
- The same wave on both feeds (same phase and category within 90 s) does not emit a second notification.
- Names containing `בדיקה` are tests and do not move lifecycle.
- Drill codes do not move lifecycle unless `OREF_IGNORE_DRILLS=false`.

`threatCategory` keeps the last concrete threat (e.g. `missiles` after an all-clear).

---

## Categories

Live `cat` and history `category` are **different numeric namespaces**. Mixing them is how all-clears get misread as infiltrations.

- `classification.namespace` is `live` or `history`
- `classification.disputed` is true when maintained parsers disagree, or when the title contradicted the code
- Hebrew titles win for pre-alert and all-clear

Sources:

- [eladnava/pikud-haoref-api `lib/alerts.js`](https://github.com/eladnava/pikud-haoref-api/blob/e40da77a4aab3052fb1a4a56402ae2e26c3e3cf3/lib/alerts.js) (commit `e40da77`)
- [amitfin/oref_alert `categories.py`](https://github.com/amitfin/oref_alert/blob/main/custom_components/oref_alert/categories.py)
- [danielrosehill/Israel-Red-Alert-Syntax-Notes](https://github.com/danielrosehill/Israel-Red-Alert-Syntax-Notes)

### Live `cat`

| Code | Category | Notes |
| --- | --- | --- |
| 1 | missiles | Agreed |
| 2 | general | Disputed (eladnava: general; homebridge-redalert: nonconventional) |
| 3 | earthquake | Agreed |
| 4 | radiological | Agreed by primary parsers |
| 5 | tsunami | Agreed |
| 6 | aircraft | Hostile aircraft / UAV |
| 7 | hazardous-materials | Agreed |
| 10 | informational | Title may upgrade to pre-alert or all-clear |
| 13 | terrorist-infiltration | Live only — not an all-clear |
| 101–113 | drill | `relatedCategory` from `code - 100` when known |

### History `category`

| Code | Category | Notes |
| --- | --- | --- |
| 1 | missiles | Agreed |
| 2 | aircraft | Not the same as live cat 2 |
| 3 | nonconventional | Disputed |
| 4, 5, 6 | informational | Disputed |
| 7, 8 | earthquake | Agreed |
| 9 | radiological | Disputed vs CBRNE labeling |
| 10 | terrorist-infiltration | Agreed |
| 11 | tsunami | Agreed |
| 12 | hazardous-materials | Agreed |
| 13 | all-clear | End / update channel |
| 14 | pre-alert | Advance notice |
| 15–28 | drill | Related threat set when known |

Unknown codes become `unknown` with phase `none` and do not move lifecycle.

Recognized phrases:

| Kind | Hebrew |
| --- | --- |
| All-clear | `האירוע הסתיים`, `ניתן לצאת מהמרחב המוגן` |
| Pre-alert | `בדקות הקרובות צפויות להתקבל התרעות`, `הנחיה מקדימה`, `התרעה מוקדמת` |

Example: `ירי רקטות וטילים - האירוע הסתיים` → `all-clear` with `relatedCategory: missiles`.

---

## Areas

`data/areas.json` contains **1,450 areas** and **30 districts**.

| Field | Meaning |
| --- | --- |
| Area ID | `city:{sourceId}` from the pikud-haoref-api cities cache (e.g. `city:742`) |
| District ID | `district:{slug}` assigned by this project from the Hebrew zone name — not official Oref IDs |
| Matching | Exact match on normalized Hebrew (`NFKC`, trim, strip bidi marks). Near-miss strings become `unmapped:{12 hex}` |
| Shelter / coords | From the same cache; treat shelter times as operational data that can go stale |

City IDs were not re-confirmed against a live `GetDistricts` response (upstream returned HTTP 403 from the build environment). Regenerate when you can reach the upstream file:

```bash
python3 scripts/build-areas.py
python3 scripts/build-areas.py /path/to/cities.json
```

Existing district IDs are preserved for Hebrew zone names already present in `data/areas.json`.

Upstream cache: Apache-2.0 — see [`NOTICE`](NOTICE) and [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt). This repository: MIT.

---

## Upstream feeds

These URLs are **unofficial**. They are the paths requested by `pikud-haoref-api` (`config.js` at commit `e40da77`).

On 2026-10-13, every URL below on `www.oref.org.il` and `alerts-history.oref.org.il` returned Akamai HTTP 403 from this project’s build environment. Bodies were not captured. A 403 proves the edge refused the request; it does not prove the path exists.

| Role | URL | Verification status |
| --- | --- | --- |
| Live alerts | `https://www.oref.org.il/warningMessages/alert/Alerts.json` | Path used by pikud-haoref-api. Casing not re-tested here. Parser accepts object or array. |
| History | `https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json` | Shape `{ alertDate, title, data: string, category: number }`. ~3,000-row cap reported by third parties; not re-measured here. |
| Districts | `https://alerts-history.oref.org.il/Shared/Ajax/GetDistricts.aspx?lang=he` | Cited by the city generator. No sample response in this repo. |
| Zone names | `https://www.oref.org.il/districts/cities_heb.json` (+ eng/rus/arb) | Cited by the same generator. Not fetched here. |
| Categories | `https://www.oref.org.il/alerts/alertCategories.json` | Cited by third parties. Not used at runtime. |
| ASPX history | `https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx?lang=he&mode=1` | Described by third parties. **This service does not call it.** |

Client hardening (from pikud-haoref-api, not official docs):

- `Referer: https://www.oref.org.il/11226-he/pakar.aspx` and `X-Requested-With: XMLHttpRequest`
- Cache-buster `_` query parameter
- Strip UTF-8 / UTF-16LE BOMs, NULs, and U+0A7B before parse
- HTML containing `Access Denied` or `/errorpage_adom/` is an error, not an empty alert

### Not polled

[Tzofar / Tzeva Adom](https://api.tzevaadom.co.il/alerts-history) answered HTTP 200 when probed, but omits pre-alerts and all-clears and uses a different threat ID space. It is not a source for this service.

---

## Fixtures

Tests parse files under `data/fixtures/`. They are reconstructed from published examples so CI runs without an Israeli IP — they are not captures taken from Oref by this project.

| File | Based on |
| --- | --- |
| `live-missiles.json`, rocket rows in `history.json` | Examples in [dmatik/oref-alerts-proxy-ms](https://github.com/dmatik/oref-alerts-proxy-ms) |
| Pre-alert / all-clear / aircraft / infiltration | Field shapes from the parsers above; Hebrew titles from the syntax notes |

---

## Development

```bash
npm test          # compile + node:test
npm run typecheck
npm run build
npm start         # live mode
OREF_MODE=mock npm start
```

Node.js 22 or newer. Tests do not call Oref.

---

## License

[MIT](LICENSE). The vendored area catalog is derived from Apache-2.0 data; see [`NOTICE`](NOTICE).
