# oref-alerts-core

Normalized data layer for [Pikud HaOref](https://www.oref.org.il/) (פיקוד העורף, the Israel Home Front Command) alerts.

This is **not** an official Home Front Command product. Do not use it as the only way you hear an alert. The official app, site, and sirens are the authoritative channel. Feeds below are undocumented, change without notice, and are often blocked outside Israel.

Background on the gap this tries to fill: [Israel-Home-Front-Ideas](https://github.com/danielrosehill/Israel-Home-Front-Ideas).

## Why TypeScript

The contract is a versioned JSON Schema, and the same process is both a library and a small HTTP service. Node 22 already has `fetch`, an HTTP server, and a test runner, so the service does not need a framework. Home Assistant and other apps talk to the HTTP API; they do not import this package. Python would poll just as well. One typed pipeline from bytes to schema was the smaller surface.

## Quickstart

```bash
npm ci
npm test
npm run build
OREF_MODE=mock npm start
```

Mock mode does not call Oref. It cycles one scripted incident for Tel Aviv - City Center and Ramat Gan - West: pre-alert, rocket alert, silence, all-clear. The cycle repeats with new ids.

```bash
curl -s localhost:8080/health
curl -s localhost:8080/v1/current
curl -s localhost:8080/v1/areas/city:742
curl -N localhost:8080/v1/stream
```

Docker (the image defaults to mock mode):

```bash
docker build -t oref-alerts-core .
docker run --rm -p 8080:8080 oref-alerts-core
```

Live mode, through an HTTP proxy that egresses from Israel:

```bash
OREF_MODE=live OREF_PROXY=http://user:pass@proxy.example:8080 npm start
```

`HTTPS_PROXY` or `HTTP_PROXY` is used when `OREF_PROXY` is unset.

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

`ingest` throws `FeedError` on a bad body and leaves the previous lifecycle in place. Empty live bodies are valid and mean "nothing is sounding right now."

## HTTP API

All JSON uses `schemaVersion: "1.0.0"`. `GET /health` stays open when `OREF_API_TOKEN` is set. Every other route then requires `Authorization: Bearer <token>` or `?access_token=`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Process is up |
| GET | `/v1/schema` | JSON Schema document |
| GET | `/v1/status` | Poller errors, catalog provenance, webhook count |
| GET | `/v1/current` | Areas whose lifecycle is `pre-alert` or `active` |
| GET | `/v1/lifecycle?phase=` | Every tracked area |
| GET | `/v1/alerts?phase=&source=&limit=` | Retained normalized alerts, newest first |
| GET | `/v1/alerts/:id` | One retained alert |
| GET | `/v1/history` | Same store as `/v1/alerts` |
| GET | `/v1/areas?q=&limit=` | Catalog search (Hebrew or English). Empty `q` returns the first page |
| GET | `/v1/areas/:id` | One area, for example `city:742` |
| GET | `/v1/districts` | Districts assigned by this project |
| GET | `/v1/stream` | Server-sent events |
| GET | `/v1/webhooks` | Registered webhook URLs (secrets are not returned) |
| POST | `/v1/webhooks` | `{ "url": "https://example/hook", "secret": "optional" }` |
| DELETE | `/v1/webhooks/:id` | Remove a webhook |

CORS allows any origin on these routes. The webhook registrar will POST to whatever URL you give it, including loopback. Do not expose it on the public internet without `OREF_API_TOKEN`.

### Server-sent events

`GET /v1/stream` sends:

- `hello` once on connect
- `alert` with a webhook-shaped body when a new alert is applied
- `lifecycle` when at least one area changes phase or siren state
- a comment heartbeat every 15 seconds

### Webhooks

Two event names:

- `alert.created` — first time an upstream id changes lifecycle. `alert` is the normalized alert. `changes` is empty.
- `lifecycle.updated` — phase and/or `sounding` changed. `alert` is null. `changes` is the affected area rows.

Headers: `X-Oref-Event`, `X-Oref-Delivery`, and `X-Oref-Signature: sha256=<hmac of the raw body>` when the registration included a secret. One retry after 200ms. Failures are not fatal to the poller.

The **first non-empty history response seeds state and does not send webhooks**, so a restart does not replay up to 3,000 old rows. Later history records, and every live alert, do notify.

### Home Assistant

A REST sensor can watch `/v1/current`. Automations that need a push should register a webhook (Node-RED, a small AppDaemon listener, or an HA automation triggered by a local receiver). This service does not speak the Home Assistant WebSocket API.

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

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `OREF_MODE` | `live` | `mock` or `live`. The Docker image sets `mock` |
| `OREF_PROXY` | `HTTPS_PROXY` or `HTTP_PROXY` | HTTP proxy URL, including userinfo if needed |
| `OREF_ALERTS_URL` | see below | Live feed |
| `OREF_HISTORY_URL` | see below | History feed |
| `OREF_POLL_INTERVAL_MS` | `2000` | Live poll. Clamped to 250–120000 |
| `OREF_HISTORY_INTERVAL_MS` | `30000` | History poll. Clamped to 5000–600000 |
| `OREF_PORT` / `OREF_HOST` | `8080` / `0.0.0.0` | Listen address |
| `OREF_API_TOKEN` | unset | Bearer token for every route except `/health` |
| `OREF_IGNORE_DRILLS` | `true` | Drill codes are stored but do not move lifecycle |
| `OREF_MOCK_INTERVAL_MS` | `4000` | Length of one mock step |
| `OREF_USER_AGENT` | `oref-alerts-core/1.0.0` | Outbound User-Agent |

Failed polls back off (live up to 60s, history up to 60s) and keep the last good lifecycle. A 403 is reported as `geo-blocked`.

## Schema 1.0.0

The document is [`schema/v1.schema.json`](schema/v1.schema.json) (`$id: urn:oref-alerts:schema:v1`). Every normalized alert is checked against `$defs/alert` before it is stored.

An alert looks like this:

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
      "district": { "id": "district:gaza-envelope", "names": { "he": "עוטף עזה", "en": "Gaza Envelope" } },
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

`title.en` and `instructions.en` are null when the Hebrew text is not one of the phrases this package recognizes. They are not machine translations.

`alertTime` is UTC. Upstream timestamps are Israel local (`Asia/Jerusalem`, no offset), in either `YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DDTHH:MM:SS`. When the live object has no `alertDate`, `alertTime` is null and ordering uses `observedAt`.

### Lifecycle

Per area, not per national bulletin:

| Phase | How it is entered |
| --- | --- |
| `pre-alert` | Title contains an advance-notice phrase, or history category 14 when the title does not say otherwise |
| `active` | A threat message (rockets, aircraft, earthquake, and the other threat categories) |
| `ended` | Title contains `האירוע הסתיים` or `ניתן לצאת מהמרחב המוגן`, or history category 13 when the title does not name a different threat |

Rules that are easy to get wrong:

- An empty live body sets `sounding` to false and **does not** end the alert. The live feed only shows the seconds the siren is actually up.
- A pre-alert does not downgrade an area that is already `active`.
- A message older than the area's current phase is ignored.
- The same wave seen on both feeds (same phase, same category, within 90 seconds) does not emit a second notification. History rows often have no id, and one history endpoint is documented as truncating seconds to `:00`.
- Names containing `בדיקה` are test strings and do not move lifecycle.
- Drill codes do not move lifecycle unless `OREF_IGNORE_DRILLS=false`.

`threatCategory` on a lifecycle row keeps the last concrete threat (for example `missiles` after the all-clear).

## Categories

There are **two** numeric namespaces. Mixing them up is how all-clears get treated as terrorist infiltrations.

`classification.namespace` is `live` for the `cat` field on the active-alerts feed and `history` for the `category` field on the history feed. `classification.disputed` is true when the two codebases cited below disagree, or when the Hebrew title contradicted the number. **Titles win** for pre-alert and all-clear.

Sources for the tables:

- Live and history switches in [eladnava/pikud-haoref-api `lib/alerts.js`](https://github.com/eladnava/pikud-haoref-api/blob/e40da77a4aab3052fb1a4a56402ae2e26c3e3cf3/lib/alerts.js) (commit `e40da77`, 2026-10-07). This file is parsing code, not a blog post.
- Real-time versus history comments in [amitfin/oref_alert `categories.py`](https://github.com/amitfin/oref_alert/blob/main/custom_components/oref_alert/categories.py), which says the history list is based on `https://www.oref.org.il/alerts/alertCategories.json`.
- Titles quoted from captured history by [danielrosehill/Israel-Red-Alert-Syntax-Notes](https://github.com/danielrosehill/Israel-Red-Alert-Syntax-Notes).

### Live `cat` (alerts feed)

| Code | This package | Disputed? |
| --- | --- | --- |
| 1 | missiles | No. eladnava and amitfin agree |
| 2 | general | **Yes.** eladnava says general. homebridge-redalert calls it nonconventional. Absent from amitfin's real-time map |
| 3 | earthquake | No |
| 4 | radiological | No in the two parsers. homebridge-redalert calls 4 CBRNE; that disagreement is not flagged on the record because both parsers agree |
| 5 | tsunami | No |
| 6 | aircraft (hostile aircraft / UAV) | No |
| 7 | hazardous-materials | No |
| 10 | informational, unless the title is a pre-alert or an all-clear | The number alone is not an end signal. homebridge-redalert remaps some cat-10 titles to a synthetic 99 |
| 13 | terrorist-infiltration | No on the **live** feed. This is not an all-clear |
| 101–113 | drill, with `relatedCategory` taken from `code - 100` when that live code exists | eladnava lists 101, 102, 103, 104, 105, 106, 107, 113 |

### History `category`

| Code | This package | Disputed? |
| --- | --- | --- |
| 1 | missiles | No |
| 2 | aircraft | No. This is **not** the same as live cat 2 |
| 3 | nonconventional | **Yes.** amitfin's category slug says nonconventional; eladnava collapses it to general |
| 4, 5, 6 | informational | **Yes.** amitfin: warning / memorial day. eladnava: general |
| 7, 8 | earthquake | No |
| 9 | radiological | **Yes.** eladnava says radiologicalEvent. amitfin's slug is `cbrne`, and its real-time map sends radiological events to history 9 |
| 10 | terrorist-infiltration | No |
| 11 | tsunami | No |
| 12 | hazardous-materials | No |
| 13 | all-clear, unless the title names a threat and does not say the event ended | amitfin treats 13 as the end/update channel. eladnava calls both 13 and 14 `newsFlash` and leaves the split to the title |
| 14 | pre-alert | Same split as 13. Observed titles include `בדקות הקרובות צפויות להתקבל התרעות` and `הנחיה מקדימה` |
| 15–28 | drill | `relatedCategory` is set for 15, 16, 21–26 where the two sources describe the same drill family. Other drill codes have `relatedCategory: null` |

Unknown codes become `unknown` with phase `none`. They do not move lifecycle.

Recognized all-clear phrases: `האירוע הסתיים`, `ניתן לצאת מהמרחב המוגן`.

Recognized pre-alert phrases: `בדקות הקרובות צפויות להתקבל התרעות`, `הנחיה מקדימה`, `התרעה מוקדמת`.

A title such as `ירי רקטות וטילים - האירוע הסתיים` is `all-clear` with `relatedCategory: missiles`.

## Areas

`data/areas.json` has 1,450 areas and 30 districts.

- Area id: `city:{sourceId}`. `sourceId` is the numeric id in the pikud-haoref-api cities cache (Tel Aviv - City Center is `city:742`). That project preserves ids from Oref's district/segment lists. **This environment could not re-fetch those lists** (HTTP 403), so the ids were not confirmed against a live `GetDistricts` response.
- District id: `district:{english-slug}`, assigned here from the Hebrew zone name. These are **not** official Oref district ids. A few upstream English zone labels disagree with each other (`englishVariants` records that). For example the Hebrew zone `יהודה` is mostly "Judea" but the cache also contains other English strings.
- Match policy is **exact** on the normalized Hebrew alert string (NFKC, trimmed, bidi marks removed, whitespace collapsed). `אשדוד - יא,יב,טו,יז,מרינה` does **not** match the catalog string `אשדוד -יא,יב,טו,יז,מרינה,סיטי`. Unmatched names get a stable `unmapped:{12 hex}` id and null shelter time. Substring matching would attach the wrong polygon.
- Shelter seconds and coordinates come from that same cache. Shelter time is operational data and can be wrong if the cache is stale. Do not bet a life on it.

Regenerate after you can reach the upstream file:

```bash
python3 scripts/build-areas.py
# or a local copy / raw URL
python3 scripts/build-areas.py /path/to/cities.json
```

Existing district ids are reused for Hebrew zone names already in `data/areas.json`.

The upstream cache is Apache-2.0. See `NOTICE` and `licenses/Apache-2.0.txt`. This repository is MIT.

## Upstream feeds

These URLs are **unofficial**. They are the ones `pikud-haoref-api` actually requests (`config.js` at commit `e40da77`). On 2026-10-13, from this build environment, every URL below on `www.oref.org.il` and `alerts-history.oref.org.il` returned **Akamai HTTP 403 Access Denied**. Response bodies were not captured. Do not treat a 403 as proof the path exists; it only proves the edge refused the request.

| Role | URL | What is verified |
| --- | --- | --- |
| Live alerts | `https://www.oref.org.il/warningMessages/alert/Alerts.json` | Path is what pikud-haoref-api polls. Other clients also use a lowercase `alerts.json`. Path **casing was not re-tested** here. The parser accepts one object or an array, because clients disagree and the library handles both |
| History | `https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json` | Same library. Documented shape: `{ alertDate, title, data: string, category: number }`. A 3,000-row cap is reported by third parties and was **not** re-measured here |
| District list | `https://alerts-history.oref.org.il/Shared/Ajax/GetDistricts.aspx?lang=he` (also `en`, `ru`, `ar`) | pikud-haoref-api reads an array of objects with `label` and `id`, sometimes `label` split on ` I ` or ` \| `. **No sample of this response is in the repo** |
| Zone names | `https://www.oref.org.il/districts/cities_heb.json` and `cities_eng.json`, `cities_rus.json`, `cities_arb.json` | Cited by the same generator. Not fetched here |
| Category metadata | `https://www.oref.org.il/alerts/alertCategories.json` | Cited by amitfin and by yaniv-golan/pikud-haoref-alerts as objects `{ id, category, matrix_id, priority, queue }`. The Internet Archive capture found for this path is itself a 403. **Not used at runtime** |
| Richer history | `https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx?lang=he&mode=1` | Described by third parties (extra fields such as `matrix_id`, a `T` in the timestamp, mode values that do not paginate). A 2023 Stack Overflow answer instead shows `www.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx` with `fromDate` / `toDate`. **Those query shapes were not re-checked, and this service does not call the ASPX endpoint** |

The client copies a few behaviors from pikud-haoref-api because that code exists to survive the real feed, not because Oref documents them:

- `Referer: https://www.oref.org.il/11226-he/pakar.aspx` and `X-Requested-With: XMLHttpRequest`
- a `_` query parameter with the current unix time, to avoid a cached empty body
- UTF-8 and UTF-16LE BOMs, embedded NULs, and the character U+0A7B stripped before `JSON.parse`
- an HTML body containing `Access Denied` or `/errorpage_adom/` is an error, not an empty alert

### Not polled

`https://api.tzevaadom.co.il/alerts-history` answered HTTP 200 on 2026-10-13 (alert groups with `id`, `alerts[].time`, `cities`, `threat`, `isDrill`). `GET /lists-versions` returned `{"cities":10,"polygons":5}`. It is **not** a source for this service: it does not carry pre-alerts or all-clears, and its threat numbers are a different list. City-list URLs that used to be published under that API (`/cities`, `/static/cities.json`) returned 404 that day.

## Fixtures

`data/fixtures/` is what the tests parse. They are **not** a capture taken from Oref by this project.

- `live-missiles.json` and the two rocket rows in `history.json` follow examples published in [dmatik/oref-alerts-proxy-ms](https://github.com/dmatik/oref-alerts-proxy-ms).
- Pre-alert, all-clear, aircraft, and infiltration fixtures use the field names the parsers above branch on (`id`, `cat`, `title`, `data`, `desc`, `alertDate`, `category`) and Hebrew titles quoted in the syntax notes. They are reconstructed so the tests have something to run without an Israeli IP.

## Development

```bash
npm test          # compile and run node:test
npm run typecheck
npm run build
npm start         # live
OREF_MODE=mock npm start
```

Node.js 22 or newer. Tests do not call Oref.

## License

MIT. The vendored area catalog is derived from Apache-2.0 data; see `NOTICE`.
