import { test } from "node:test";
import assert from "node:assert/strict";
import { browse } from "../src/browse.js";

const h = { open: "08:00", close: "18:00" };
const at = (local) => Date.parse(local + "+08:00") / 1000; // Singapore time -> Unix seconds

// 10 requests on Mon 5 Oct 09:00 Singapore. Even ids answered by 338 after `id` minutes,
// odd ids never answered. Ids 1-5 at site 11, 6-10 at site 13 (same timezone here for simplicity).
function makeStore() {
  const site = { timezone: "Asia/Singapore", business_hours: { mon: h, tue: h, wed: h, thu: h, fri: h, sat: null, sun: null }, holidays: new Set() };
  const store = { ready: true, requests: new Map(), events: new Map(), staff: new Map([[338, "Benjamin Tan"]]), sites: new Map([[11, site], [13, site]]) };
  for (let id = 1; id <= 10; id++) {
    store.requests.set(id, { id, site_id: id <= 5 ? 11 : 13, status: "processing", priority: "High", created_at: "2026-10-05T01:00:00Z", deleted_at: null, merged_into_id: null });
    const events = new Map();
    if (id % 2 === 0) events.set(100 + id, { id: 100 + id, status: "processing", at: at("2026-10-05T09:00:00") + id * 60, actor_id: 338, actor_name: "Ben", due_at: null, reverts_id: null });
    store.events.set(id, events);
  }
  return store;
}

const base = { from: "2026-10-01", to: "2026-10-31" };

// Follow next_cursor to the end; returns all ids in order
function walk(store, query) {
  const ids = [];
  let cursor;
  for (let i = 0; i < 100; i++) {
    const res = browse(store, { ...base, ...query, ...(cursor ? { cursor } : {}) });
    assert.equal(res.status, 200);
    ids.push(...res.body.data.map((r) => r.id));
    cursor = res.body.next_cursor;
    if (!cursor) return ids;
  }
  throw new Error("walk did not end");
}

test("paging and sorting", () => {
  const store = makeStore();
  assert.deepEqual(walk(store, { limit: "3" }), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(walk(store, { sort: "-id", limit: "4" }), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  // nulls last in both directions, ties by id ascending
  assert.deepEqual(walk(store, { sort: "response_business_minutes" }), [2, 4, 6, 8, 10, 1, 3, 5, 7, 9]);
  assert.deepEqual(walk(store, { sort: "-response_business_minutes", limit: "2" }), [10, 8, 6, 4, 2, 1, 3, 5, 7, 9]);
});

test("filters", () => {
  const store = makeStore();
  assert.deepEqual(walk(store, { site_id: "13" }), [6, 7, 8, 9, 10]);
  assert.deepEqual(walk(store, { responder_id: "338" }), [2, 4, 6, 8, 10]);
  assert.deepEqual(walk(store, { within_target: "true" }), [2, 4, 6, 8, 10]);
  assert.deepEqual(walk(store, { late: "true" }), []); // no deadlines -> completed_late is null
});

test("invalid values -> 400", () => {
  const store = makeStore();
  for (const q of [{ limit: "0" }, { limit: "201" }, { limit: "x" }, { sort: "name" }, { late: "yes" }, { site_id: "-1" }, { cursor: "made-up" }, { from: "2026-13-01" }]) {
    assert.equal(browse(store, { ...base, ...q }).status, 400, JSON.stringify(q));
  }
  // a real cursor, but used with a different sort
  const first = browse(store, { ...base, limit: "2" }).body.next_cursor;
  assert.equal(browse(store, { ...base, sort: "-id", cursor: first }).status, 400);
});

test("data changes mid-walk: stable rows appear exactly once", () => {
  const store = makeStore();
  const q = { ...base, sort: "response_business_minutes", limit: "3" };
  let res = browse(store, q);
  const seen = res.body.data.map((r) => r.id); // 2, 4, 6

  // Meanwhile: request 8 gets a much faster response (its sort value changes),
  // request 9 is deleted, and a new request 99 appears
  store.events.get(8).set(500, { id: 500, status: "processing", at: at("2026-10-05T09:00:30"), actor_id: 338, actor_name: "Ben", due_at: null, reverts_id: null });
  store.requests.set(9, { ...store.requests.get(9), deleted_at: "2026-10-06T00:00:00Z" });
  store.requests.set(99, { ...store.requests.get(1), id: 99 });

  while (res.body.next_cursor) {
    res = browse(store, { ...q, cursor: res.body.next_cursor });
    seen.push(...res.body.data.map((r) => r.id));
  }
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 10]) {
    assert.equal(seen.filter((x) => x === id).length, 1, `id ${id} should appear exactly once`);
  }
});