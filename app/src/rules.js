// The seven rules from docs/rules.md. Pure functions: no network, easy to test.
import { businessSeconds, localToUtc } from "./time.js";

// Rule 1 (status part): canceled, deleted or merged requests don't count.
// (The date-range part of rule 1 is done in the endpoint, step 5.)
export function isCounted(request) {
  // TODO 1: return false if request.status is "canceled",
  //         or request.deleted_at is set, or request.merged_into_id is set.
  //         Otherwise return true.
  //         Tip: `if (request.deleted_at)` is true when it has any value, false when null.
  if (request.status === "canceled") return false;
  if (request.deleted_at) return false;
  if (request.merged_into_id) return false;
  return true; // none of the above: it counts
}

// Rule 2: drop every event that reverts another, AND the event it reverts.
// Returns the remaining events sorted by time (ties broken by id).
export function activeEvents(events) {
  const ignored = new Set(); // ids of events to drop
  for (const ev of events) {
    if (ev.reverts_id) {
      // TODO 2: add BOTH ids to `ignored`: this event's id, and the id it points at
            ignored.add(ev.id);         // the reverting event itself
      ignored.add(ev.reverts_id); // the event it undoes
    }
  }
  const kept = events.filter((ev) => !ignored.has(ev.id));
  return kept.sort((a, b) => a.at - b.at || a.id - b.id);
}

// Rule 3: the earliest "processing" event done by a person (System has actor_id null).
// `events` is already sorted, so the first match is the earliest.
export function firstResponse(events) {
  // TODO 3: fill in the condition: status is "processing" AND actor_id is not null
    return events.find((ev) => ev.status === "processing" && ev.actor_id !== null) || null;
}

// Rule 5: target minutes by priority. Low and null both get 480.
export function targetMinutes(priority) {
  // TODO 4: 60 for "High", 240 for "Medium", 480 for anything else
  if (priority === "High") return 60;
  if (priority === "Medium") return 240;
  return 480; // "Low", null, anything else
}

// "07/10/2026 10:00" (site-local wall-clock time) -> UTC ms
export function parseDueAt(text, timeZone) {
  const [datePart, timePart] = text.split(" "); // "07/10/2026", "10:00"
  const [d, m, y] = datePart.split("/").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  return localToUtc(y, m, d, hh, mm, 0, timeZone);
}

// Rule 6: is the LAST "complete" event strictly after the deadline?
// Deadline = due_at of the LATEST event that has one. Returns true, false, or null (rule 7).
export function completedLate(events, timeZone) {
  let lastComplete = null; // the last event with status "complete"
  let deadline = null; // UTC ms
  for (const ev of events) {
    // TODO 5a
    if (ev.status === "complete") lastComplete = ev;
    // TODO 5b
    if (ev.due_at) deadline = parseDueAt(ev.due_at, timeZone);
  }
  if (!lastComplete || deadline === null) return null;
  // TODO 5c: seconds -> ms, then "strictly after"
  return lastComplete.at * 1000 > deadline;
}
// One report row for a request (rules 2-7).
// staffNames = Map(staff id -> current name), i.e. store.staff
export function computeRow(request, events, site, staffNames) {
  const evs = activeEvents(events);
  const first = firstResponse(evs);

  let minutes = null; // rule 7: stays null if there is no response
  let within = null;
  if (first) {
    const secs = businessSeconds(Date.parse(request.created_at), first.at * 1000, site);
    // TODO 6a: seconds -> whole minutes, rounded down
    minutes = Math.floor(secs / 60);
    // TODO 6b
    within = minutes <= targetMinutes(request.priority);
  }

  return {
    id: request.id,
    site_id: request.site_id,
    responder_id: first ? first.actor_id : null,
    // current name from /v1/staff; fall back to the name on the event if unknown
    responder: first ? staffNames.get(first.actor_id) ?? first.actor_name : null,
    response_business_minutes: minutes,
    within_target: within,
    completed_late: completedLate(evs, site.timezone),
  };
}