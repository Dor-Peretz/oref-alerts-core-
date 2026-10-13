import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyMessage } from "../src/categories.js";

describe("category namespaces", () => {
  it("keeps live cat 13 as infiltration and history category 13 as all-clear", () => {
    const live = classifyMessage("חדירת מחבלים", "live", 13);
    assert.equal(live.category, "terrorist-infiltration");
    assert.equal(live.phase, "active");
    assert.equal(live.disputed, false);

    const history = classifyMessage("ירי רקטות וטילים - האירוע הסתיים", "history", 13);
    assert.equal(history.category, "all-clear");
    assert.equal(history.phase, "ended");
    assert.equal(history.relatedCategory, "missiles");
    assert.equal(history.basis, "title");
  });

  it("treats live cat 10 as informational until the title says pre-alert or all-clear", () => {
    assert.equal(classifyMessage("", "live", 10).category, "informational");
    assert.equal(classifyMessage("", "live", 10).phase, "none");
    const pre = classifyMessage("בדקות הקרובות צפויות להתקבל התרעות באזורך", "live", 10);
    assert.equal(pre.category, "pre-alert");
    assert.equal(pre.phase, "pre-alert");
    const ended = classifyMessage("האירוע הסתיים", "live", 10);
    assert.equal(ended.category, "all-clear");
    assert.equal(ended.phase, "ended");
  });

  it("maps live aircraft to cat 6 and history aircraft to category 2", () => {
    assert.equal(classifyMessage("חדירת כלי טיס עוין", "live", 6).category, "aircraft");
    assert.equal(classifyMessage("חדירת כלי טיס עוין", "history", 2).category, "aircraft");
    assert.equal(classifyMessage("חדירת כלי טיס עוין", "live", 6).basis, "title-and-code");
  });

  it("marks live cat 2 disputed and does not call it aircraft", () => {
    const general = classifyMessage("התרעה", "live", 2);
    assert.equal(general.category, "general");
    assert.equal(general.disputed, true);
    assert.notEqual(general.category, "aircraft");
  });

  it("defaults empty-title history 14 to pre-alert and marks drill codes", () => {
    const pre = classifyMessage("", "history", 14);
    assert.equal(pre.category, "pre-alert");
    const drill = classifyMessage("ירי רקטות וטילים", "live", 101);
    assert.equal(drill.category, "drill");
    assert.equal(drill.drill, true);
    assert.equal(drill.relatedCategory, "missiles");
    const historyDrill = classifyMessage("", "history", 16);
    assert.equal(historyDrill.category, "drill");
    assert.equal(historyDrill.relatedCategory, "aircraft");
  });
});
