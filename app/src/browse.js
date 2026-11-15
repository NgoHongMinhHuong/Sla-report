// GET /api/requests (level 4): the report rows, filtered, sorted and paged.
//
// Paging while the data changes: the first page takes a "snapshot", the ordered list of
// matching ids at that moment. Later pages walk that same list, showing each row's CURRENT
// values and skipping rows that no longer match. So a row that matches during the whole walk
// is in the list once and is shown once, even if its sort value changes in between.
import crypto from "node:crypto";
import { isValidDate, rowInRange } from "./report.js";

const SORTS = ["id", "-id", "response_business_minutes", "-response_business_minutes"];
const snapshots = new Map(); // snapshot id -> { key, ids }

// Parse and check the query. Returns { error } or the parsed values.
function parseQuery(q) {
  if (!isValidDate(q.from) || !isValidDate(q.to) || q.from > q.to) return { error: "from and to must be YYYY-MM-DD, from <= to" };

  const f = { from: q.from, to: q.to, siteId: null, responderId: null, late: null, withinTarget: null, sort: "id", limit: 50 };
  const isInt = (v) => /^\d+$/.test(v); // "12" yes, "-1", "abc", "1.5" no
  const toBool = (v) => (v === "true" ? true : v === "false" ? false : undefined);

  if (q.site_id !== undefined) {
    if (!isInt(q.site_id)) return { error: "site_id must be a number" };
    f.siteId = Number(q.site_id);
  }
  if (q.responder_id !== undefined) {
    if (!isInt(q.responder_id)) return { error: "responder_id must be a number" };
    f.responderId = Number(q.responder_id);
  }
  if (q.late !== undefined) {
    f.late = toBool(q.late);
    if (f.late === undefined) return { error: "late must be true or false" };
  }
  if (q.within_target !== undefined) {
    f.withinTarget = toBool(q.within_target);
    if (f.withinTarget === undefined) return { error: "within_target must be true or false" };
  }
  if (q.sort !== undefined) {
    if (!SORTS.includes(q.sort)) return { error: "sort must be one of " + SORTS.join(", ") };
    f.sort = q.sort;
  }
  if (q.limit !== undefined) {
    if (!isInt(q.limit) || Number(q.limit) < 1 || Number(q.limit) > 200) return { error: "limit must be 1 to 200" };
    f.limit = Number(q.limit);
  }
  return f;
}

// Does a row pass every filter that was given? (null = filter not given)
function matches(row, f) {
  if (f.siteId !== null && row.site_id !== f.siteId) return false;
  // TODO: the same for the other three filters:
  //   f.responderId  vs row.responder_id
  //   f.late         vs row.completed_late
  //   f.withinTarget vs row.within_target
  if (f.responderId !== null && row.responder_id !== f.responderId) return false;
  if (f.late !== null && row.completed_late !== f.late) return false;
  if (f.withinTarget !== null && row.within_target !== f.withinTarget) return false;
  return true;
}

// Sort function for Array#sort: negative = a first, positive = b first.
function compare(sort) {
  if (sort === "id") return (a, b) => a.id - b.id;
  if (sort === "-id") return (a, b) => b.id - a.id;
  const direction = sort === "response_business_minutes" ? 1 : -1;
  return (a, b) => {
    const x = a.response_business_minutes;
    const y = b.response_business_minutes;
    if (x === null && y === null) return a.id - b.id; // both null: by id
    if (x === null) return 1; // nulls last, in both directions
    if (y === null) return -1;
    return direction * (x - y) || a.id - b.id; // ties by id ascending
  };
}

// Returns { status, body } for app.js to send.
export function browse(store, query) {
  const f = parseQuery(query);
  if (f.error) return { status: 400, body: { error: f.error } };
  if (!store || !store.ready) return { status: 503, body: { error: "still loading data" } };

  // Everything that decides WHICH rows and in WHAT order; a cursor only works with the same values
  const key = JSON.stringify([f.from, f.to, f.siteId, f.responderId, f.late, f.withinTarget, f.sort]);

  let snapId;
  let position;
  if (query.cursor !== undefined) {
    // Cursor = "<snapshot id>:<position>"
    const [id, pos] = String(query.cursor).split(":");
    const snap = snapshots.get(id);
    if (!snap || snap.key !== key || !/^\d+$/.test(pos ?? "") || Number(pos) > snap.ids.length) {
      return { status: 400, body: { error: "invalid cursor" } };
    }
    snapId = id;
    position = Number(pos);
  } else {
    // First page: build the snapshot
    const rows = [];
    for (const request of store.requests.values()) {
      const row = rowInRange(store, request, f.from, f.to);
      if (row && matches(row, f)) rows.push(row);
    }
    rows.sort(compare(f.sort));
    snapId = crypto.randomUUID();
    snapshots.set(snapId, { key, ids: rows.map((r) => r.id) });
    position = 0;
  }

  // Fill the page from the snapshot, with current values; skip rows that no longer match
  const ids = snapshots.get(snapId).ids;
  const data = [];
  while (position < ids.length && data.length < f.limit) {
    const request = store.requests.get(ids[position]);
    position++;
    const row = request ? rowInRange(store, request, f.from, f.to) : null;
    if (row && matches(row, f)) data.push(row);
  }

  const nextCursor = position < ids.length ? `${snapId}:${position}` : null;
  return { status: 200, body: { data, next_cursor: nextCursor } };
}
// ---------------------------------------------------------------------------
// GET /api/requests.csv (client request): every matching row as CSV, for Excel
// ---------------------------------------------------------------------------

const CSV_COLUMNS = ["id", "site_id", "responder_id", "responder", "response_business_minutes", "within_target", "completed_late"];

// One CSV field: null -> empty, true/false as words, text quoted if it contains , " or a line break
function csvField(value) {
  if (value === null || value === undefined) return "";
  const text = String(value); // numbers and booleans become "42", "true", "false"
  if (/[",\r\n]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"'; // standard CSV: double any quote inside
  }
  return text;
}

// Returns { status, body } like browse(); body is a CSV string when status is 200.
export function browseCsv(store, query) {
  // limit and cursor are ignored: take them out before checking the rest
  const { limit, cursor, ...rest } = query;
  const f = parseQuery(rest);
  if (f.error) return { status: 400, body: { error: f.error } };
  if (!store || !store.ready) return { status: 503, body: { error: "still loading data" } };

  // Same rows and order as the browse view, but all of them, no paging
  const rows = [];
  for (const request of store.requests.values()) {
    const row = rowInRange(store, request, f.from, f.to);
    if (row && matches(row, f)) rows.push(row);
  }
  rows.sort(compare(f.sort));

  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => csvField(row[c])).join(","));
  }
  return { status: 200, body: lines.join("\n") + "\n" };
}