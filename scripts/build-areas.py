#!/usr/bin/env python3
"""Build data/areas.json from the pikud-haoref-api cities cache.

The official district endpoints (GetDistricts.aspx, districts/cities_*.json)
returned HTTP 403 from the environment that produced the committed catalog.
This script transforms cities.json from eladnava/pikud-haoref-api, which is
Apache-2.0 and is itself generated from those endpoints. Numeric city ids are
preserved. District ids are assigned by this script from the Hebrew zone name
and reused across regenerations when data/areas.json already exists.

Usage:
  python3 scripts/build-areas.py [path-or-url-to-cities.json]
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "areas.json"
DEFAULT_URL = (
    "https://raw.githubusercontent.com/eladnava/pikud-haoref-api/"
    "e40da77a4aab3052fb1a4a56402ae2e26c3e3cf3/cities.json"
)
COMMIT = "e40da77a4aab3052fb1a4a56402ae2e26c3e3cf3"


def slug(english: str) -> str:
    text = re.sub(r"\([^)]*\)", "", english)
    text = text.lower().replace("'", "").replace("’", "")
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "zone"


def load_input(source: str) -> tuple[list, str]:
    if source.startswith("http://") or source.startswith("https://"):
        with urllib.request.urlopen(source, timeout=60) as response:
            body = response.read()
        return json.loads(body.decode("utf-8-sig")), hashlib.sha256(body).hexdigest()
    path = Path(source)
    body = path.read_bytes()
    return json.loads(body.decode("utf-8-sig")), hashlib.sha256(body).hexdigest()


def existing_district_ids() -> dict[str, str]:
    if not OUTPUT.exists():
        return {}
    current = json.loads(OUTPUT.read_text(encoding="utf-8"))
    return {
        district["names"]["he"]: district["id"]
        for district in current.get("districts", [])
        if district.get("names", {}).get("he") and district.get("id")
    }


def main() -> None:
    source = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    cities, digest = load_input(source)
    preserved = existing_district_ids()

    by_zone: dict[str, list[dict]] = defaultdict(list)
    for city in cities:
        if not city.get("id") or not city.get("zone"):
            continue
        by_zone[city["zone"]].append(city)

    used_slugs: set[str] = set()
    districts = []
    zone_to_id: dict[str, str] = {}
    for hebrew in sorted(by_zone):
        rows = by_zone[hebrew]
        english_counts = Counter((row.get("zone_en") or "").strip() for row in rows)
        english_counts.pop("", None)
        majority = english_counts.most_common(1)[0][0]
        variants = sorted(english_counts)
        if hebrew in preserved:
            district_id = preserved[hebrew]
        else:
            base = slug(majority)
            district_id = f"district:{base}"
            n = 2
            while district_id in used_slugs:
                district_id = f"district:{base}-{n}"
                n += 1
        used_slugs.add(district_id)
        zone_to_id[hebrew] = district_id
        districts.append(
            {
                "id": district_id,
                "names": {"he": hebrew, "en": majority},
                "englishVariants": variants,
            }
        )

    areas = []
    for city in cities:
        if not city.get("id") or city.get("value") == "all":
            continue
        name = (city.get("name") or "").strip()
        if not name:
            continue
        zone = city.get("zone") or ""
        areas.append(
            {
                "id": f"city:{int(city['id'])}",
                "sourceId": int(city["id"]),
                "alertName": (city.get("value") or name).strip(),
                "names": {
                    "he": name,
                    "en": (city.get("name_en") or "").strip(),
                    "ru": (city.get("name_ru") or "").strip() or None,
                    "ar": (city.get("name_ar") or "").strip() or None,
                },
                "districtId": zone_to_id.get(zone),
                "shelterTimeSeconds": int(city.get("countdown") or 0),
                "location": {
                    "lat": float(city["lat"]),
                    "lng": float(city["lng"]),
                },
            }
        )

    areas.sort(key=lambda row: (row["names"]["he"], row["sourceId"]))
    districts.sort(key=lambda row: row["names"]["he"])
    document = {
        "schemaVersion": "1.0.0",
        "provenance": {
            "retrieved": "2026-10-13",
            "upstream": "eladnava/pikud-haoref-api cities.json",
            "upstreamCommit": COMMIT,
            "upstreamUrl": DEFAULT_URL,
            "upstreamSha256": digest,
            "license": "Apache-2.0",
            "officialEndpointsNotFetched": [
                "https://alerts-history.oref.org.il/Shared/Ajax/GetDistricts.aspx?lang=he",
                "https://www.oref.org.il/districts/cities_heb.json",
                "https://www.oref.org.il/districts/cities_eng.json",
            ],
            "notes": (
                "City ids are the numeric ids preserved by pikud-haoref-api, which "
                "builds this cache from Pikud HaOref GetDistricts / segment polygon ids. "
                "Those official URLs returned HTTP 403 to the environment that committed "
                "this file, so the ids were not re-confirmed against a live response. "
                "District ids are assigned by oref-alerts-core from the Hebrew zone string."
            ),
        },
        "districts": districts,
        "areas": areas,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(areas)} areas and {len(districts)} districts to {OUTPUT}")


if __name__ == "__main__":
    main()
