# DECISIONS

## What I assumed

- **Data source: the change feed (`/v1/changes`) only.** Events are only available per request, so the requests endpoint would need 12,000+ calls. The feed has requests, events and staff changes in ~160 pages (~50 s on the practice data). Sites, holidays and staff are read once at start-up.
- **Everything in memory, no database.** ~12k requests and ~46k events fit easily in `Map`s keyed by id.
  The cost: a restart reloads the feed (~50 s), and `/ready` answers 503 meanwhile.
- **No cache.** The report computes every row on each call; six months takes ~0.7 s, well under 10 s.
- **Rule 2:** applied literally: an event with `reverts_id` and the event it points at are both ignored.
- **Event order:** by `at`, ties broken by event id (matters for "earliest" and "last").
- **Rule 4:** business time is summed per site-local calendar day against that day's opening hours; holidays are closed all day. Timezones use Node's built-in `Intl`, so Sydney's DST change is handled
  (there is a test across 4 Oct 2026).
- **Rule 5:** anything that is not `High` or `Medium` (including `null`) gets 480.
- **Rule 6:** `due_at` is read as `DD/MM/YYYY HH:mm` in site-local time; "late" means strictly after, so completing exactly at the deadline is on time. `due_on` on the request is ignored.
- **Responder name:** current name from `/v1/staff`; the event's `actor_name` only if the person is unknown.
- **Validation:** `from`/`to` must be real `YYYY-MM-DD` dates and `from <= to`, else 400. Dates in this format compare correctly as strings.

## What I found in the API or data

- **Rate limiting:** reading the feed back to back gets `429` with `Retry-After: 1`. My client waits that long and retries (up to 10 times).
- **The feed repeats items:** 318 of ~79k items came twice. Storing by id in a `Map` means a repeat just overwrites the same entry.
- **Holidays are `DD/MM/YYYY`** (e.g. Sydney Labour Day `05/10/2026` = 5 October).
- **Sites differ:** Sydney is open 07:30-17:00, Jakarta also Saturday 08:00-12:00.
- **Formats differ:** request `created_at` is an ISO string in UTC; event `at` is Unix seconds.
- **System events** (`actor_id: null`) also set status `processing`; rule 3 skips them.
- **The status label for `canceled` is "Cancelled"**; I compare against the value `canceled`.
- - **Two different staff members are both named "Marcus Lee"** (ids 368 and 371). The responder summary is grouped by id, never by name, so they stay separate.
- After the first `429` my client doubles the pause between calls (250 ms, at most 2 s) instead of retrying at full speed: a full load now gets 1 `429` instead of about 32.
## How I used AI
- I first had Claude (Anthropic) generate a complete version, which I ran to explore the real API.
- Then I rebuilt the app myself step by step so I understand every line: Claude gave me skeletons with TODOs and explained the rules; I wrote the logic. The timezone conversion helpers, Express wiring and the test files were mostly given by Claude.
- Mistakes I made and fixed: `=` instead of `===`, swapped `min`/`max` in the overlap, a typo (`totalMS`), and a bug in the late count that my tests never reached, found when running on real data.
## Trade-offs and what I would do next

- TODO: fill in after levels 3 and 4
