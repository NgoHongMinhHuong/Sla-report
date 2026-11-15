// Read the change feed into the store, from `startCursor` (null = from the very beginning)
// until there is nothing more. Returns the last cursor, to continue from next time.
export async function loadFeed(client, store, startCursor = null) {
  let cursor = startCursor;
  let pages = 0;
  let items = 0;

  while (true) {
    let body;
    try {
      body = await client.get("/v1/changes", { limit: 500, cursor: cursor });
    } catch (err) {
      // TODO: if err.status is 410 (cursor expired):
      //         log it, set cursor = null (start again from the beginning) and `continue`.
      //       For any other error: `throw err;`
            if (err.status === 410) {
        console.log("feed cursor expired (410), reading the feed again from the start");
        cursor = null;
        continue;
      }
      throw err;
    }

    for (const item of body.data) {
      store.applyChange(item);
      items++;
    }
    if (body.next_cursor) {
      cursor = body.next_cursor;
    }
    pages++;
    if (!body.has_more) break;
  }

  // Only log when something happened (polling every 5 s would be noisy otherwise)
  if (items > 0) console.log(`feed: ${items} changes in ${pages} pages`);
  return cursor;
}