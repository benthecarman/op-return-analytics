import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { dbPath, getSummary, getTimeseries, getChartPoints, getOrders } from "./db.js";

const app = new Hono();

app.get("/api/summary", (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  const row = getSummary(start, end);
  return c.json({
    total_orders: row.total_orders,
    total_profit_sats: row.total_profit,
    total_chain_fees_sats: row.total_chain_fees,
    avg_profit_sats: Math.round(row.avg_profit),
    first_order: row.first_order,
    last_order: row.last_order,
  });
});

app.get("/api/timeseries", (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  const granularity = c.req.query("granularity") ?? "day";
  const rows = getTimeseries(start, end, granularity);
  return c.json(
    rows.map((r) => ({
      period: r.period,
      orders: r.orders,
      profit_sats: r.profit,
      chain_fees_sats: r.chain_fees,
    }))
  );
});

app.get("/api/chart", (c) => {
  return c.json(getChartPoints());
});

app.get("/api/orders", (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  return c.json(getOrders(start, end, page, limit));
});

app.get("/", serveStatic({ path: "./static/index.html" }));
app.use("/static/*", serveStatic({ root: "./" }));

const port = parseInt(process.env.PORT ?? "8083", 10);
console.log(`Database: ${dbPath}`);
console.log(`Listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
