import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, isValidDate } from "../src/report.js";

const h = { open: "08:00", close: "18:00" };
const at = (local) => Date.parse(local + "+08:00") / 1000; // Singapore time -> Unix seconds

// A tiny store with the same shape as the real one
function makeStore() {
  const store = {
    requests: new Map(),
    events: new Map(),
    staff: new Map([[338, "Benjamin Tan"]]),
    sites: new Map([[11, { timezone: "Asia/Singapore", business_hours: { mon: h, tue: h, wed: h, thu: h, fri: h, sat: null, sun: null }, holidays: new Set() }]]),
  };
  const add = (id, fields, events = []) => {
    store.requests.set(id, { id, site_id: 11, status: "complete", priority: "High", created_at: "2026-10-05T01:00:00Z", deleted_at: null, merged_into_id: null, ...fields });
    store.events.set(id, new Map(events.map((e) => [e.id, e])));
  };
  return { store, add };
}

test("dates are checked strictly", () => {
  assert.equal(isValidDate("2026-10-01"), true);
  assert.equal(isValidDate("2026-02-30"), false);
  assert.equal(isValidDate("01/10/2026"), false);
  assert.equal(isValidDate(undefined), false);
});

test("report: range by local date, skips canceled, summary per responder", () => {
  const { store, add } = makeStore();
  // Mon 5 Oct 09:00 SG, answered by 338 at 09:30 -> 30 min
  add(1, {}, [{ id: 10, status: "processing", at: at("2026-10-05T09:30:00"), actor_id: 338, actor_name: "Ben", due_at: null, reverts_id: null }]);
  add(2, { status: "canceled" });
  // 30 Sep 17:00 UTC = 1 Oct 01:00 in Singapore
  add(3, { created_at: "2026-09-30T17:00:00Z" });
  add(4, { created_at: "2026-09-30T15:00:00Z" }); // 30 Sep 23:00 SG: outside October

  const report = buildReport(store, "2026-10-01", "2026-10-31");
  assert.deepEqual(report.requests.map((r) => r.id).sort(), [1, 3]);
  assert.deepEqual(report.responders, [{ id: 338, name: "Benjamin Tan", requests: 1, within_target: 1, completed_late: 0 }]);
});