import Database from "better-sqlite3";
import { homedir } from "os";
import { join } from "path";

export const dbPath =
  process.env.OPRETURN_DB ?? join(homedir(), ".op-return-bot", "invoices.sqlite");

const db = new Database(dbPath, { readonly: true });
db.pragma("journal_mode = WAL");

export interface SummaryRow {
  total_orders: number;
  total_profit: number;
  total_chain_fees: number;
  avg_profit: number;
  total_profit_usd: number;
  first_order: number | null;
  last_order: number | null;
}

export interface TimeseriesRow {
  period: string;
  orders: number;
  profit: number;
  chain_fees: number;
}

export interface OrderRow {
  id: number;
  time: number;
  txid: string;
  profit: number | null;
  chain_fee: number | null;
  vsize: number | null;
  fee_rate: string | null;
  btc_price: number;
  no_twitter: number;
  closed: number;
}

function tsFromDate(dateStr: string | undefined, fallback: number): number {
  if (!dateStr) return fallback;
  return Math.floor(new Date(dateStr + "T00:00:00Z").getTime() / 1000);
}

export function getSummary(start?: string, end?: string): SummaryRow {
  const tStart = tsFromDate(start, 0);
  const tEnd = tsFromDate(end, Math.floor(Date.now() / 1000));

  return db
    .prepare(
      `SELECT
        count(*) as total_orders,
        coalesce(sum(profit), 0) as total_profit,
        coalesce(sum(chain_fee), 0) as total_chain_fees,
        coalesce(avg(profit), 0) as avg_profit,
        coalesce(sum(
          CASE WHEN btc_price > 0
            THEN (profit * 1.0 / 100000000) * (btc_price * 1.0 / 100)
            ELSE 0 END
        ), 0) as total_profit_usd,
        min(time) as first_order,
        max(time) as last_order
      FROM op_return_requests
      WHERE txid IS NOT NULL
        AND time >= ? AND time <= ?`
    )
    .get(tStart, tEnd) as SummaryRow;
}

export function getTimeseries(
  start?: string,
  end?: string,
  granularity: string = "day"
): TimeseriesRow[] {
  const tStart = tsFromDate(start, 0);
  const tEnd = tsFromDate(end, Math.floor(Date.now() / 1000));

  const fmt: Record<string, string> = {
    day: "%Y-%m-%d",
    week: "%Y-%W",
    month: "%Y-%m",
  };
  const strftimeFmt = fmt[granularity] ?? fmt.day;

  return db
    .prepare(
      `SELECT
        strftime(?, time, 'unixepoch') as period,
        count(*) as orders,
        coalesce(sum(profit), 0) as profit,
        coalesce(sum(chain_fee), 0) as chain_fees
      FROM op_return_requests
      WHERE txid IS NOT NULL
        AND time >= ? AND time <= ?
      GROUP BY period
      ORDER BY period`
    )
    .all(strftimeFmt, tStart, tEnd) as TimeseriesRow[];
}

export interface ChartPoint {
  time: number;
  profit: number;
  btc_price: number;
}

export function getChartPoints(): ChartPoint[] {
  return db
    .prepare(
      `SELECT time, coalesce(profit, 0) as profit, btc_price
      FROM op_return_requests
      WHERE txid IS NOT NULL
      ORDER BY time`
    )
    .all() as ChartPoint[];
}

export function getOrders(
  start?: string,
  end?: string,
  page: number = 1,
  limit: number = 50
): { total: number; page: number; pages: number; orders: OrderRow[] } {
  const tStart = tsFromDate(start, 0);
  const tEnd = tsFromDate(end, Math.floor(Date.now() / 1000));
  const offset = (page - 1) * limit;

  const { cnt } = db
    .prepare(
      `SELECT count(*) as cnt
      FROM op_return_requests
      WHERE txid IS NOT NULL
        AND time >= ? AND time <= ?`
    )
    .get(tStart, tEnd) as { cnt: number };

  const orders = db
    .prepare(
      `SELECT id, time, txid, profit, chain_fee, vsize, fee_rate,
              btc_price, no_twitter, closed
      FROM op_return_requests
      WHERE txid IS NOT NULL
        AND time >= ? AND time <= ?
      ORDER BY time DESC
      LIMIT ? OFFSET ?`
    )
    .all(tStart, tEnd, limit, offset) as OrderRow[];

  return {
    total: cnt,
    page,
    pages: Math.ceil(cnt / limit) || 1,
    orders,
  };
}
