import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport, isValidDate } from "./report.js";
import { browse } from "./browse.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// store = the in-memory data (undefined in the starter's health test)
export function createApp(store) {
  const app = express();

  app.use(express.static(path.join(here, "..", "public")));

  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  // 200 once all data is loaded, 503 before that
  app.get("/ready", (req, res) => {
    if (store && store.ready) res.json({ ready: true });
    else res.status(503).json({ ready: false });
  });
  // Not part of the contract: shows that live sync is running (handy for checking and for the video)
  app.get("/api/status", (req, res) => {
    res.json({
      rate_limited: store && store.client ? store.client.rateLimited : 0,
      ready: Boolean(store && store.ready),
      requests: store ? store.requests.size : 0,
      last_sync_at: store ? store.lastSyncAt : null,
    });
  });
  app.get("/api/requests", (req, res) => {
    const { status, body } = browse(store, req.query);
    res.status(status).json(body);
  });

  app.get("/api/sla-report", (req, res) => {
    const { from, to } = req.query;
    // TODO C: 400 if from is not a valid date, OR to is not a valid date, OR from is after to
    if (!isValidDate(from) || !isValidDate(to) || from > to) {
      return res.status(400).json({ error: "from and to must be YYYY-MM-DD dates, from <= to" });
    }
    // 503 until the data is loaded
    if (!store || !store.ready) {
      return res.status(503).json({ error: "still loading data" });
    }
    res.json(buildReport(store, from, to));
  });

  return app;
}