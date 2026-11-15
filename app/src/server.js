import { createApp } from "./app.js";
import { HelpdeskClient } from "./helpdesk.js";
import { Store } from "./store.js";
import { loadFeed } from "./sync.js";
import { parseDayMonthYear } from "./time.js";

const port = Number(process.env.PORT || 8080);
const client = new HelpdeskClient();
const store = new Store();

// Start the web server first, so /health answers while we load
createApp(store).listen(port, "0.0.0.0", () => {
  console.log(`listening on http://0.0.0.0:${port}`);
});

// Load all helpdesk data into memory
async function start() {
  const startedAt = Date.now();

  // Sites, each with its holidays turned into a Set of "YYYY-MM-DD"
  const sitesBody = await client.get("/v1/sites");
  for (const site of sitesBody.data) {
    const holidaysBody = await client.get(`/v1/sites/${site.id}/holidays`);
    const holidays = new Set(holidaysBody.data.map((h) => parseDayMonthYear(h.date)));
    // { ...site, holidays } = a copy of the site object with a `holidays` field added
    store.sites.set(site.id, { ...site, holidays });
  }

  // Staff names
  const staffBody = await client.get("/v1/staff");
  for (const person of staffBody.data) {
    store.staff.set(person.id, person.name);
  }

  // Requests and events from the change feed
  await loadFeed(client, store);

  store.ready = true; // /ready now answers 200
  console.log(`ready: ${store.requests.size} requests, ${store.sites.size} sites in ${Date.now() - startedAt} ms`);
}

start();