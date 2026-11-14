import { createApp } from "./app.js";
import { HelpdeskClient } from "./helpdesk.js";
import { Store } from "./store.js";
import { loadFeed } from "./sync.js";

const port = Number(process.env.PORT || 8080);

// Start the web server first, so /health answers while we load
createApp().listen(port, "0.0.0.0", () => {
  console.log(`listening on http://0.0.0.0:${port}`);
});

// Load all helpdesk data into memory
async function start() {
  const client = new HelpdeskClient();
  const store = new Store();
  const startedAt = Date.now();

  // Staff names: /v1/staff returns { data: [ {id, name}, ... ] }
  const staffBody = await client.get("/v1/staff");
  // TODO A: loop over staffBody.data and save each person: store.staff.set(person.id, person.name)
for (const person of staffBody.data){
  store.staff.set(person.id, person.name)
}
  // Read the whole change feed
  await loadFeed(client, store);

  // TODO B: count all events (store.events is a Map of Maps: add up the .size of each inner Map)
   let eventCount = 0;
  for (const eventsOfRequest of store.events.values()) {
    eventCount +=eventsOfRequest.size;   // how many events are in this drawer?
  }

  console.log(
    `loaded ${store.requests.size} requests, ${eventCount} events, ` +
    `${store.staff.size} staff in ${Date.now() - startedAt} ms`
  );
}

start();