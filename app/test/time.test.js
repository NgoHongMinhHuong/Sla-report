import { test } from "node:test";
import assert from "node:assert/strict";
import { businessSeconds, localDateKey, parseDayMonthYear } from "../src/time.js";

// Mon-Fri open, weekend closed
function weekdays(open, close) {
  const h = { open, close };
  return { mon: h, tue: h, wed: h, thu: h, fri: h, sat: null, sun: null };
}

// The real Singapore and Sydney sites from /v1/sites (one holiday each)
const singapore = { timezone: "Asia/Singapore", business_hours: weekdays("08:00", "18:00"), holidays: new Set(["2026-11-09"]) };
const sydney = { timezone: "Australia/Sydney", business_hours: weekdays("07:30", "17:00"), holidays: new Set(["2026-10-05"]) };

// "2026-10-05T09:00:00" Singapore local time -> UTC ms
const sg = (local) => Date.parse(local + "+08:00");

test("holiday dates are DD/MM/YYYY", () => {
  assert.equal(parseDayMonthYear("05/10/2026"), "2026-10-05");
});

test("local date, not UTC date", () => {
  // 30 Sep 17:00 UTC is already 1 Oct in Singapore
  assert.equal(localDateKey(Date.parse("2026-09-30T17:00:00Z"), "Asia/Singapore"), "2026-10-01");
});

test("same day: 42 min 30 s", () => {
  assert.equal(businessSeconds(sg("2026-10-05T09:00:00"), sg("2026-10-05T09:42:30"), singapore), 42 * 60 + 30);
});

test("over a weekend: Fri 17:30 -> Mon 08:15 = 45 min", () => {
  assert.equal(businessSeconds(sg("2026-10-09T17:30:00"), sg("2026-10-12T08:15:00"), singapore), 45 * 60);
});

test("holiday is closed all day: Fri 17:00 -> Tue 09:00, Mon is Deepavali = 120 min", () => {
  assert.equal(businessSeconds(sg("2026-11-06T17:00:00"), sg("2026-11-10T09:00:00"), singapore), 120 * 60);
});

test("response before creation = 0", () => {
  assert.equal(businessSeconds(sg("2026-10-05T10:00:00"), sg("2026-10-05T09:00:00"), singapore), 0);
});

test("Sydney across DST and a holiday: Fri 16:00 -> Tue 08:30 = 120 min", () => {
  // Fri 2 Oct 16:00 Sydney (UTC+10) and Tue 6 Oct 08:30 Sydney (UTC+11, after DST starts on 4 Oct).
  // Mon 5 Oct is Labour Day. So: Fri 16:00-17:00 (60) + Tue 07:30-08:30 (60).
  assert.equal(businessSeconds(Date.parse("2026-10-02T06:00:00Z"), Date.parse("2026-10-05T21:30:00Z"), sydney), 120 * 60);
});