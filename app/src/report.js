// Builds the /api/sla-report answer from the in-memory store.
import { localDateKey } from "./time.js";
import { computeRow, isCounted } from "./rules.js";

// true for a real "YYYY-MM-DD" date (rejects "2026-13-01", "2026-02-30", "1/10/2026")
export function isValidDate(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // JavaScript rolls 30 Feb over to 2 Mar; a real date survives the round trip
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function buildReport(store, from, to) {
  const rows = [];
  for (const request of store.requests.values()) {
    // Rule 1: skip canceled / deleted / merged
    if (!isCounted(request)) continue;

    const site = store.sites.get(request.site_id);
    if (!site) continue; // unknown site: can't compute local times

    // Rule 1: the request's local creation date must be within [from, to]
    const localDate = localDateKey(Date.parse(request.created_at), site.timezone);
    // TODO A: skip (continue) if localDate is before `from` or after `to`
        if (localDate < from || localDate > to) continue;

    // All events of this request (the inner Map's values), as an array
    const events = [...(store.events.get(request.id)?.values() ?? [])];
    rows.push(computeRow(request, events, site, store.staff));
  }

  // Summary per responder: { id, name, requests, within_target, completed_late }
  const byResponder = new Map();
  for (const row of rows) {
    if (row.responder_id === null) continue; // nobody responded
    let s = byResponder.get(row.responder_id);
    if (!s) {
      s = { id: row.responder_id, name: row.responder, requests: 0, within_target: 0, completed_late: 0 };
      byResponder.set(row.responder_id, s);
    }
    s.requests += 1;
    // TODO B: add 1 to s.within_target if row.within_target is true,
    //         and 1 to s.completed_late if row.completed_late is true
        if (row.within_target === true) s.within_target += 1;
        if (row.completed_late === true) s.completed_late += 1;
  }

  return { from, to, requests: rows, responders: [...byResponder.values()] };
}