import Database from "better-sqlite3";
import { homedir } from "os";
import { join } from "path";

const dbPath =
  process.env.OPRETURN_DB ??
  join(homedir(), ".op-return-bot", "invoices.sqlite");

// Open read-write for backfill
const db = new Database(dbPath);

interface Row {
  date: string;
  cnt: number;
}

async function fetchPriceCoinbase(date: string): Promise<number> {
  const res = await fetch(
    `https://api.coinbase.com/v2/prices/BTC-USD/spot?date=${date}`
  );
  if (!res.ok) return 0;
  const json = (await res.json()) as { data: { amount: string } };
  const dollars = parseFloat(json.data.amount);
  return Math.round(dollars * 100);
}

async function fetchPriceBlockchain(date: string): Promise<number> {
  const res = await fetch(
    `https://api.blockchain.info/charts/market-price?timespan=1days&start=${date}&format=json`
  );
  if (!res.ok) return 0;
  const json = (await res.json()) as { values: { x: number; y: number }[] };
  if (!json.values || json.values.length === 0) return 0;
  return Math.round(json.values[0].y * 100);
}

async function fetchPrice(date: string): Promise<number> {
  const price = await fetchPriceCoinbase(date);
  if (price > 0) return price;
  return fetchPriceBlockchain(date);
}

async function main() {
  // Get unique dates that need backfill
  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', time, 'unixepoch') as date, count(*) as cnt
       FROM op_return_requests
       WHERE txid IS NOT NULL AND btc_price = 0
       GROUP BY date
       ORDER BY date`
    )
    .all() as Row[];

  if (rows.length === 0) {
    console.log("No orders need backfilling.");
    return;
  }

  console.log(`${rows.length} dates to backfill.`);

  const update = db.prepare(
    `UPDATE op_return_requests
     SET btc_price = ?
     WHERE txid IS NOT NULL
       AND btc_price = 0
       AND strftime('%Y-%m-%d', time, 'unixepoch') = ?`
  );

  for (const row of rows) {
    const priceCents = await fetchPrice(row.date);
    if (priceCents === 0) {
      console.log(`  ${row.date}: skipped (no price)`);
      continue;
    }

    const dollars = (priceCents / 100).toFixed(2);
    update.run(priceCents, row.date);
    console.log(`  ${row.date}: $${dollars} (${row.cnt} orders)`);

    // Rate limit: ~100ms between requests
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log("Done.");
}

main().catch(console.error);
