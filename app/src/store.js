// In-memory copy of the helpdesk data.
export class Store {
  constructor() {
    this.requests = new Map(); // request id -> request object
    this.events = new Map();   // request id -> Map(event id -> event object)
    this.staff = new Map();    // staff id -> current name
    this.sites = new Map();    // site id -> { timezone, business_hours, holidays: Set of "YYYY-MM-DD" }
    this.ready = false;        // true once everything is loaded (for /ready)
    this.lastSyncAt = null;    // when we last finished reading the feed (ISO string)
  }

  // Apply one item from /v1/changes
  applyChange(item) {
    if (item.type === "request.created" || item.type === "request.updated") {
            this.requests.set(item.request.id, item.request);
    } else if (item.type === "event.created") {
      // Each request has its own small Map of events
            // Open the drawer for this request
      let eventsOfRequest = this.events.get(item.request_id);
      if (!eventsOfRequest) {
        // No drawer yet (first event of this request): make one and put it in the cabinet
        eventsOfRequest = new Map();                         // TODO 2, line 1
        this.events.set(item.request_id, eventsOfRequest);   // TODO 2, line 2
      }
      // Put the event in the drawer: key = event id, value = the event
      eventsOfRequest.set(item.event.id, item.event);                         // TODO 3
    } else if (item.type === "staff.updated") {
           this.staff.set(item.staff.id, item.staff.name);
    }
  }
}