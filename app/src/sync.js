// Read the whole change feed into the store, page by page.
// Returns the last cursor, so we can continue from there later (step 7).
export async function loadFeed(client, store) {
  let cursor = null; // null = start from the very beginning
  let pages = 0;

  while (true) {
    // Ask for one page (up to 500 changes) after `cursor`
    const body = await client.get("/v1/changes", { limit: 500, cursor: cursor });

    // TODO 1: loop over body.data and call store.applyChange(item) for each item
    for (const item of body.data) {
        store.applyChange(item)
    }
    // Remember where we are, so the next call gets the next page
    if (body.next_cursor) {
      cursor = body.next_cursor;
    }
    pages++;

    // TODO 2: if there are no more pages (body.has_more is false), stop the loop
        if (body.has_more === false) {
      break;
    }
  }

  console.log(`feed loaded: ${pages} pages`);
  return cursor;
}