// Time helpers: convert between UTC and a site's local time, and count business-hours seconds.
// Uses Node's built-in Intl, which knows every timezone and its DST rules, so no extra library.

// ---------------------------------------------------------------------------
// Part 1 (given): timezone conversion
// ---------------------------------------------------------------------------

// Creating an Intl.DateTimeFormat is slow, so keep one per timezone.
const formatters = new Map();

function formatterFor(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

// Local wall-clock parts of a UTC instant (ms) in timeZone.
// Example: localParts(Date.parse("2026-10-02T06:00:00Z"), "Australia/Sydney")
//          -> { y: 2026, m: 10, d: 2, hh: 16, mm: 0, ss: 0 }
export function localParts(utcMs, timeZone) {
  const out = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, hh: out.hour, mm: out.minute, ss: out.second };
}

// "YYYY-MM-DD" from numbers, e.g. dateKey(2026, 10, 5) -> "2026-10-05"
export function dateKey(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// The site-local date ("YYYY-MM-DD") of a UTC instant.
export function localDateKey(utcMs, timeZone) {
  const p = localParts(utcMs, timeZone);
  return dateKey(p.y, p.m, p.d);
}

// How far timeZone is ahead of UTC at a given instant, in ms (Singapore: +8 h).
function offsetMs(utcMs, timeZone) {
  const p = localParts(utcMs, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(utcMs / 1000) * 1000;
}

// UTC instant (ms) of a local wall-clock time in timeZone.
// Example: localToUtc(2026, 10, 5, 8, 0, 0, "Asia/Singapore") -> ms of 2026-10-05T00:00:00Z
export function localToUtc(y, m, d, hh, mm, ss, timeZone) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss); // pretend the local time is UTC
  const off1 = offsetMs(guess, timeZone); // offset near that moment
  const t = guess - off1;
  const off2 = offsetMs(t, timeZone); // check again: differs only around a DST change
  return off2 === off1 ? t : guess - off2;
}
// ---------------------------------------------------------------------------
// Part 2 (you write): holidays and business hours
// ---------------------------------------------------------------------------

// "05/10/2026" (DD/MM/YYYY, as the API sends holidays) -> "2026-10-05"
export function parseDayMonthYear(text) {
  // TODO 1: split the text on "/" into d, m, y, then return them in the order y-m-d
    const [d, m, y] = text.split("/");
  return `${y}-${m}-${d}`;
}

// Index = JavaScript weekday (0 = Sunday), same as Date#getUTCDay()
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Business-hours seconds between two UTC instants (ms) for a site.
// site = { timezone: "Asia/Singapore",
//          business_hours: { mon: { open: "08:00", close: "18:00" }, ..., sun: null },
//          holidays: Set of "YYYY-MM-DD" }
export function businessSeconds(startMs, endMs, site) {
  // Rule 4: response earlier than creation -> 0
  if (endMs <= startMs) return 0;

  const tz = site.timezone;
  const first = localParts(startMs, tz); // local date where we start
  const lastKey = localDateKey(endMs, tz); // local date where we stop

  // A calendar day we step through, one day at a time (a date, not a moment)
  const day = new Date(Date.UTC(first.y, first.m - 1, first.d));
  let totalMs = 0;

  while (true) {
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const key = dateKey(y, m, d); // e.g. "2026-10-05"
    const hours = site.business_hours[DAY_NAMES[day.getUTCDay()]]; // {open, close} or null

    // TODO 2: is this day a holiday? (site.holidays is a Set: use .has(key))
    const isHoliday = site.holidays.has(key);

    if (!isHoliday && hours) {
      // "08:00" -> [8, 0]
      const [oh, om] = hours.open.split(":").map(Number);
      const [ch, cm] = hours.close.split(":").map(Number);

      // TODO 3: opening and closing time of this day, as UTC ms (use localToUtc with y, m, d)
      const openMs = localToUtc(y, m, d, oh, om, 0, tz);
      const closeMs = localToUtc(y, m, d, ch, cm, 0, tz);

      // TODO 4: the overlap of [openMs, closeMs] and [startMs, endMs]
      //   it starts at the LATER of the two starts, and ends at the EARLIER of the two ends
      const from = Math.max(openMs, startMs);
      const to = Math.min(closeMs, endMs);
      if (to > from) totalMs += to - from;
    }

    if (key >= lastKey) break; // reached the response's day
    day.setUTCDate(day.getUTCDate() + 1); // next calendar day
  }

  // TODO 5: rule 4 says "summed in seconds", so turn totalMs into whole seconds (round down)
  return Math.floor(totalMs/1000);
}