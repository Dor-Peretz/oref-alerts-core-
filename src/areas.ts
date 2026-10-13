import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { areasPath } from "./paths.js";
import type { AreaRef, LocalizedName } from "./types.js";

export interface CatalogDistrict {
  id: string;
  names: LocalizedName;
  englishVariants: string[];
}

export interface CatalogArea {
  id: string;
  sourceId: number;
  alertName: string;
  names: { he: string; en: string; ru: string | null; ar: string | null };
  districtId: string | null;
  shelterTimeSeconds: number;
  location: { lat: number; lng: number } | null;
}

export interface AreaCatalogFile {
  schemaVersion: string;
  provenance: Record<string, unknown>;
  districts: CatalogDistrict[];
  areas: CatalogArea[];
}

export function normalizeAreaName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function unmappedAreaId(rawName: string): string {
  const hash = createHash("sha256").update(normalizeAreaName(rawName)).digest("hex").slice(0, 12);
  return `unmapped:${hash}`;
}

export class AreaCatalog {
  readonly provenance: Record<string, unknown>;
  private readonly byId = new Map<string, CatalogArea>();
  private readonly byName = new Map<string, CatalogArea>();
  private readonly districtsById = new Map<string, CatalogDistrict>();
  private readonly areasByDistrict = new Map<string, CatalogArea[]>();

  constructor(file: AreaCatalogFile) {
    this.provenance = file.provenance;
    for (const district of file.districts) {
      this.districtsById.set(district.id, district);
    }
    for (const area of file.areas) {
      this.byId.set(area.id, area);
      this.byName.set(normalizeAreaName(area.alertName), area);
      this.byName.set(normalizeAreaName(area.names.he), area);
      if (area.districtId) {
        const list = this.areasByDistrict.get(area.districtId) ?? [];
        list.push(area);
        this.areasByDistrict.set(area.districtId, list);
      }
    }
  }

  static load(path = areasPath()): AreaCatalog {
    const file = JSON.parse(readFileSync(path, "utf8")) as AreaCatalogFile;
    return new AreaCatalog(file);
  }

  get size(): number {
    return this.byId.size;
  }

  get districtCount(): number {
    return this.districtsById.size;
  }

  get(id: string): CatalogArea | undefined {
    return this.byId.get(id);
  }

  district(id: string): CatalogDistrict | undefined {
    return this.districtsById.get(id);
  }

  districts(): CatalogDistrict[] {
    return [...this.districtsById.values()];
  }

  areasInDistrict(id: string): CatalogArea[] {
    return this.areasByDistrict.get(id) ?? [];
  }

  search(query: string, limit: number): CatalogArea[] {
    const needle = normalizeAreaName(query).toLowerCase();
    if (!needle) return [...this.byId.values()].slice(0, limit);
    const hits: CatalogArea[] = [];
    for (const area of this.byId.values()) {
      const hebrew = normalizeAreaName(area.names.he);
      const english = area.names.en.toLowerCase();
      const district = area.districtId ? this.districtsById.get(area.districtId) : undefined;
      const districtHit =
        district != null &&
        (district.names.he.includes(query.trim()) || (district.names.en ?? "").toLowerCase().includes(needle));
      if (hebrew.includes(needle) || english.includes(needle) || area.id === query.trim() || districtHit) {
        hits.push(area);
        if (hits.length >= limit) break;
      }
    }
    return hits;
  }

  resolve(rawName: string): AreaRef {
    const normalized = normalizeAreaName(rawName);
    const area = this.byName.get(normalized);
    if (!area) {
      return {
        id: unmappedAreaId(rawName),
        rawName: normalized,
        match: "unmapped",
        names: { he: normalized, en: null },
        district: null,
        shelterTimeSeconds: null,
        location: null,
      };
    }
    const district = area.districtId ? this.districtsById.get(area.districtId) : undefined;
    return {
      id: area.id,
      rawName: normalized,
      match: "exact",
      names: { he: area.names.he, en: area.names.en },
      district: district
        ? { id: district.id, names: { he: district.names.he, en: district.names.en } }
        : null,
      shelterTimeSeconds: area.shelterTimeSeconds,
      location: area.location,
    };
  }
}
