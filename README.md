# OP_RETURN Analytics

Analytics dashboard for [OP_RETURN Bot](https://github.com/benthecarman/OP-RETURN-Bot). Tracks profit and orders over time with date range filtering.

## Features

- Summary stats: total orders, profit, chain fees, avg profit per order
- Orders over time (bar chart) and profit over time (line chart)
- Day / week / month granularity
- Paginated order table with mempool.space links
- Read-only database access

## Setup

```bash
npm install
```

## Usage

```bash
# default DB path: ~/.op-return-bot/invoices.sqlite
npm run dev

# custom DB path
OPRETURN_DB=/path/to/invoices.sqlite npm run dev

# custom port (default 8080)
PORT=3000 npm run dev
```

## Updating

```bash
git pull
npm install
npm run build
sudo systemctl restart op-return-analytics
```

## Stack

- TypeScript + [Hono](https://hono.dev)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (read-only)
- [Chart.js](https://www.chartjs.org)
