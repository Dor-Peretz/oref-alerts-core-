import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AreaCatalog } from "../src/areas.js";
import { AlertEngine } from "../src/engine.js";
import type { NormalizedAlert } from "../src/types.js";
import { fixture } from "./helpers.js";

const catalog = AreaCatalog.load();
const TEL_AVIV = "תל אביב - מרכז העיר";

function engine(): { engine: AlertEngine; created: NormalizedAlert[]; updates: number } {
  const service = new AlertEngine({ catalog });
  const created: NormalizedAlert[] = [];
  let updates = 0;
  service.on("alert.created", (alert) => created.push(alert));
  service.on("lifecycle.updated", () => {
    updates += 1;
  });
  return { engine: service, created, get updates() { return updates; } };
}

describe("lifecycle", () => {
  it("moves an area through pre-alert, active, and ended, and stops the siren without ending it", () => {
    const { engine: service, created } = engine();
    service.ingest(
      JSON.stringify({
        id: "pre-1",
        cat: "10",
        title: "הנחיה מקדימה",
        data: [TEL_AVIV],
        desc: "",
      }),
      { feed: "live", observedAt: new Date("2026-10-13T05:00:00.000Z") },
    );
    let row = service.getAreaLifecycle("city:742");
    assert.equal(row?.phase, "pre-alert");
    assert.equal(row?.sounding, true);
    assert.equal(row?.names.en, "Tel Aviv - City Center");
    assert.equal(row?.district?.id, "district:dan");

    service.ingest(
      JSON.stringify({
        id: "active-1",
        cat: "1",
        title: "ירי רקטות וטילים",
        data: [TEL_AVIV],
        desc: "היכנסו למרחב המוגן",
      }),
      { feed: "live", observedAt: new Date("2026-10-13T05:02:00.000Z") },
    );
    row = service.getAreaLifecycle("city:742");
    assert.equal(row?.phase, "active");
    assert.equal(row?.threatCategory, "missiles");
    assert.equal(row?.sounding, true);

    service.ingest("", { feed: "live" });
    row = service.getAreaLifecycle("city:742");
    assert.equal(row?.phase, "active");
    assert.equal(row?.sounding, false);

    service.ingest(fixture("live-all-clear.json"), {
      feed: "live",
      observedAt: new Date("2026-10-13T05:12:00.000Z"),
    });
    row = service.getAreaLifecycle("city:742");
    assert.equal(row?.phase, "ended");
    assert.equal(row?.category, "all-clear");
    assert.equal(row?.threatCategory, "missiles");
    assert.equal(row?.sounding, false);
    assert.equal(created.length, 3);
  });

  it("deduplicates the same live id and coalesces a history row for the same wave", () => {
    const { engine: service, created } = engine();
    const body = fixture("live-aircraft.json");
    service.ingest(body, { feed: "live", observedAt: new Date("2026-10-13T06:00:00.000Z") });
    service.ingest(body, { feed: "live", observedAt: new Date("2026-10-13T06:00:01.000Z") });
    service.ingest(
      JSON.stringify([
        {
          alertDate: "2026-10-13 09:00:30",
          title: "חדירת כלי טיס עוין",
          data: "נחל עוז",
          category: 2,
        },
      ]),
      { feed: "history" },
    );
    assert.equal(created.length, 1);
    assert.equal(service.getAreaLifecycle("city:234")?.phase, "active");
    assert.equal(service.getAlerts().length, 2);
  });

  it("seeds the first history batch without webhooks, then notifies on a new record", () => {
    const { engine: service, created } = engine();
    const base = JSON.parse(fixture("history.json")) as unknown[];
    service.ingest(JSON.stringify(base), { feed: "history" });
    assert.equal(created.length, 0);
    assert.equal(service.stats().historySeeded, true);
    assert.equal(service.getAreaLifecycle("city:1603")?.phase, "ended");
    assert.equal(service.getAreaLifecycle("city:1638")?.phase, "active");
    assert.equal(service.getAreaLifecycle("city:1603")?.sounding, false);

    base.push({
      alertDate: "2024-07-03 19:10:00",
      title: "ירי רקטות וטילים",
      data: "נחל עוז",
      category: 1,
    });
    service.ingest(JSON.stringify(base), { feed: "history" });
    assert.equal(created.length, 1);
    assert.equal(service.getAreaLifecycle("city:234")?.phase, "active");
  });

  it("ignores drills and test strings unless drills are enabled", () => {
    const { engine: service } = engine();
    service.ingest(
      JSON.stringify({
        id: "drill-1",
        cat: "101",
        title: "ירי רקטות וטילים",
        data: [TEL_AVIV, "בדיקה"],
        desc: "",
      }),
      { feed: "live" },
    );
    assert.equal(service.getAreaLifecycle("city:742"), undefined);
    assert.equal(service.current().length, 0);

    const drills = new AlertEngine({ catalog, ignoreDrills: false });
    drills.ingest(
      JSON.stringify({
        id: "drill-2",
        cat: "101",
        title: "ירי רקטות וטילים",
        data: [TEL_AVIV],
        desc: "",
      }),
      { feed: "live" },
    );
    assert.equal(drills.getAreaLifecycle("city:742")?.drill, true);
    assert.equal(drills.getAreaLifecycle("city:742")?.phase, "active");
  });

  it("keeps the previous lifecycle when a later body is malformed", () => {
    const { engine: service } = engine();
    service.ingest(fixture("live-aircraft.json"), { feed: "live" });
    assert.throws(() => service.ingest("{", { feed: "live" }));
    assert.equal(service.getAreaLifecycle("city:234")?.phase, "active");
    assert.equal(service.getAreaLifecycle("city:234")?.sounding, true);
  });
});
