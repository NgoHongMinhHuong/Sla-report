import { test } from "node:test";
import assert from "node:assert/strict";
import { activeEvents, completedLate, computeRow, firstResponse, isCounted, targetMinutes } from "../src/rules.js";

// Singapore site, Mon-Fri 08:00-18:00
const h = { open: "08:00", close: "18:00" };
const singapore = {
  timezone: "Asia/Singapore",
  business_hours: { mon: h, tue: h, wed: h, thu: h, fri: h, sat: null, sun: null },
  holidays: new Set(),
};
const staffNames = new Map([[335, "Aisha Rahman-Lim"], [338, "Benjamin Tan"]]);

// Singapore local time -> Unix seconds (the format of event.at)
const at = (local) => Date.parse(local + "+08:00") / 1000;

// An event with sensible defaults
let nextId = 1;
function ev(fields) {
  return { id: nextId++, status: null, at: 0, actor_id: null, actor_name: "System", due_at: null, reverts_id: null, ...fields };
}

test("rule 1: canceled, deleted, merged don't count", () => {
  assert.equal(isCounted({ status: "complete", deleted_at: null, merged_into_id: null }), true);
  assert.equal(isCounted({ status: "canceled", deleted_at: null, merged_into_id: null }), false);
  assert.equal(isCounted({ status: "complete", deleted_at: "2026-10-06T00:00:00Z", merged_into_id: null }), false);
  assert.equal(isCounted({ status: "complete", deleted_at: null, merged_into_id: 41160 }), false);
});

test("rule 5: targets", () => {
  assert.equal(targetMinutes("High"), 60);
  assert.equal(targetMinutes("Medium"), 240);
  assert.equal(targetMinutes("Low"), 480);
  assert.equal(targetMinutes(null), 480);
});

test("exercise 2: revert hides both events, System doesn't count -> 338", () => {
  const e1 = ev({ status: "processing", at: at("2026-10-05T09:00:00"), actor_id: 335 });
  const e2 = ev({ status: "pending", at: at("2026-10-05T09:05:00"), reverts_id: e1.id });
  const e3 = ev({ status: "processing", at: at("2026-10-05T09:30:00") }); // System
  const e4 = ev({ status: "processing", at: at("2026-10-05T10:00:00"), actor_id: 338 });
  // given in the wrong order on purpose: activeEvents must sort
  const first = firstResponse(activeEvents([e4, e3, e2, e1]));
  assert.equal(first.actor_id, 338);
});

test("exercise 3: last complete exactly at the latest deadline is not late", () => {
  const events = activeEvents([
    ev({ at: at("2026-10-05T10:00:00"), due_at: "05/10/2026 12:00" }),
    ev({ at: at("2026-10-05T11:00:00"), due_at: "05/10/2026 16:00" }),
    ev({ status: "complete", at: at("2026-10-05T13:00:00"), actor_id: 338 }),
    ev({ status: "processing", at: at("2026-10-05T14:00:00"), actor_id: 338 }),
    ev({ status: "complete", at: at("2026-10-05T16:00:00"), actor_id: 338 }),
  ]);
  assert.equal(completedLate(events, "Asia/Singapore"), false);
  // one second later would be late
  events[events.length - 1].at += 1;
  assert.equal(completedLate(events, "Asia/Singapore"), true);
});

test("exercise 1: Thu 17:50 -> Fri 08:20:30 = 30 min, High, within target", () => {
  const request = { id: 7, site_id: 11, priority: "High", created_at: "2026-10-08T09:50:00Z" }; // Thu 17:50 SG
  const events = [ev({ status: "processing", at: at("2026-10-09T08:20:30"), actor_id: 338, actor_name: "Ben T" })];
  assert.deepEqual(computeRow(request, events, singapore, staffNames), {
    id: 7,
    site_id: 11,
    responder_id: 338,
    responder: "Benjamin Tan", // current name from /v1/staff, not actor_name
    response_business_minutes: 30,
    within_target: true,
    completed_late: null, // never completed
  });
});

test("rule 7: no response -> nulls", () => {
  const request = { id: 8, site_id: 11, priority: "Low", created_at: "2026-10-08T09:50:00Z" };
  const row = computeRow(request, [ev({ status: "pending", at: at("2026-10-08T17:51:00") })], singapore, staffNames);
  assert.equal(row.responder_id, null);
  assert.equal(row.responder, null);
  assert.equal(row.response_business_minutes, null);
  assert.equal(row.within_target, null);
  assert.equal(row.completed_late, null);
});