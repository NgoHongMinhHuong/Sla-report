// Wait for the given number of milliseconds
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Minimal helpdesk API client. Extend as needed.
export class HelpdeskClient {
  constructor({
    baseUrl = process.env.HELPDESK_URL || "http://localhost:4010",
    token = process.env.HELPDESK_TOKEN || "",
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.gapMs = 0;        // pause between calls; grows after each 429
    this.nextCallAt = 0;   // earliest time (ms) the next call may start
    this.rateLimited = 0;  // how many 429s we got (shown in /api/status)
  }

    // GET a path (e.g. "/v1/sites") with optional query params; returns parsed JSON.
  // Retries when the API answers 429 (rate limited).
  async get(pathname, params = {}) {
    const url = new URL(this.baseUrl + pathname);
    for (const [key, value] of Object.entries(params)) {
      // Only send params that have a value (otherwise cursor=null becomes "?cursor=null")
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, value);
      }
    }

    // Try up to 10 times
    for (let attempt = 0; attempt < 10; attempt++) {
            // Pace ourselves: wait until we're allowed to call again
      const wait = this.nextCallAt - Date.now();
      if (wait > 0) await sleep(wait);
      this.nextCallAt = Date.now() + this.gapMs;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
      });

            if (res.status === 429) {        
            this.rateLimited++;
        // Too fast: double the pause between calls (250 ms, 500 ms, ... at most 2 s)
        this.gapMs = Math.min(2000, Math.max(250, this.gapMs * 2));
        // Read how long the API wants us to wait (seconds, as a string like "1")
        const header = res.headers.get("retry-after");
        // Convert to a number; fall back to 1 second if the header is missing
        const seconds = Number(header) || 1;
        console.log(`429, waiting ${seconds}s before retry...`);
        // Wait, then go back to the top of the loop and call again
        await sleep(seconds * 1000);
        continue;
      }

            if (!res.ok) {
        const body = await res.text();
        const err = new Error(`Helpdesk API GET ${url} failed: ${res.status} ${body}`);
        err.status = res.status; // so callers can react to a specific status, e.g. 410
        throw err;
      }
      return res.json();
    }
    // Still rate limited after 10 tries
    throw new Error(`Helpdesk API GET ${url}: still 429 after 10 tries`);
  }
}
