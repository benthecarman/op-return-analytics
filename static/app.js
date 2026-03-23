const $ = (s) => document.querySelector(s);
const api = async (path, params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([_, v]) => v))
  );
  const res = await fetch(`/api/${path}?${qs}`);
  return res.json();
};

let mainChart;
let currentPage = 1;
let allPoints = [];
let invoiceTimestamps = [];
let isCumulative = false;
let currentBtcPriceCents = 0;

function fmtSats(n) {
  if (n == null) return "\u2014";
  return Number(n).toLocaleString();
}

function fmtDate(ts) {
  if (!ts) return "\u2014";
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function fmtDateTime(ts) {
  if (!ts) return "\u2014";
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16);
}

function shortTxid(txid) {
  if (!txid) return "\u2014";
  return txid.slice(0, 8) + "\u2026" + txid.slice(-8);
}

function fmtFeeRate(raw) {
  if (raw == null) return "\u2014";
  if (/^[0-9a-fA-F]{16}$/.test(raw)) {
    const le = raw.match(/../g).reverse().join("");
    return parseInt(le, 16) + " sat/vB";
  }
  const f = parseFloat(raw);
  if (!isNaN(f)) return f + " sat/vB";
  return raw;
}

function getVisibleRange() {
  if (!mainChart || allPoints.length === 0) return {};
  const scale = mainChart.scales.x;
  const start = new Date(scale.min).toISOString().slice(0, 10);
  const end = new Date(scale.max).toISOString().slice(0, 10);
  return { start, end };
}

function fmtUsd(n, decimals = 2) {
  if (n == null || n === 0) return "\u2014";
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function satsToUsd(sats, btcPriceCents) {
  if (!btcPriceCents || btcPriceCents === 0) return null;
  return (sats / 100000000) * (btcPriceCents / 100);
}

async function loadSummary(start, end) {
  const data = await api("summary", { start, end });
  const currentUsd = currentBtcPriceCents > 0
    ? satsToUsd(data.total_profit_sats, currentBtcPriceCents)
    : null;
  const avgUsd = currentBtcPriceCents > 0 ? satsToUsd(data.avg_profit_sats, currentBtcPriceCents) : null;
  const chainFeesUsd = currentBtcPriceCents > 0 ? satsToUsd(data.total_chain_fees_sats, currentBtcPriceCents) : null;
  let avgPerDay = "\u2014";
  if (data.first_order && data.last_order && data.total_orders > 0) {
    const days = Math.max(1, (data.last_order - data.first_order) / 86400);
    avgPerDay = (data.total_orders / days).toFixed(1) + " / day";
  }
  const stat = (label, primary, secondary) => {
    const sub = secondary ? `<div class="subvalue">${secondary}</div>` : "";
    return `<div class="stat"><div class="label">${label}</div><div class="value">${primary}</div>${sub}</div>`;
  };
  const convRate = data.total_invoices > 0
    ? ((data.total_orders / data.total_invoices) * 100).toFixed(1) + "%"
    : "\u2014";
  $("#summary").innerHTML =
    stat("Invoices", fmtSats(data.total_invoices), convRate + " conversion") +
    stat("Paid", fmtSats(data.total_orders), avgPerDay) +
    stat("Profit", fmtSats(data.total_profit_sats) + " sats",
      fmtUsd(data.total_profit_usd, 0) + " at time / " + fmtUsd(currentUsd, 0) + " now") +
    stat("Chain Fees", fmtSats(data.total_chain_fees_sats) + " sats",
      fmtUsd(chainFeesUsd)) +
    stat("Avg Profit", fmtSats(data.avg_profit_sats) + " sats",
      fmtUsd(avgUsd));
}

async function loadOrders(start, end, page = 1) {
  currentPage = page;
  const data = await api("orders", { start, end, page, limit: 50 });

  $("#pageInfo").textContent = `Page ${data.page} of ${data.pages}`;
  $("#prevPage").disabled = data.page <= 1;
  $("#nextPage").disabled = data.page >= data.pages;

  const tbody = $("#ordersTable tbody");
  tbody.innerHTML = data.orders
    .map(
      (o) => `
    <tr>
      <td>${o.id}</td>
      <td>${fmtDate(o.time)}</td>
      <td><a href="https://mempool.space/tx/${o.txid}" target="_blank">${shortTxid(o.txid)}</a></td>
      <td>${fmtSats(o.profit)}</td>
      <td>${fmtUsd(satsToUsd(o.profit, o.btc_price))}</td>
      <td>${fmtSats(o.chain_fee)}</td>
      <td>${o.vsize != null ? Number(o.vsize).toLocaleString() : "\u2014"}</td>
      <td>${fmtFeeRate(o.fee_rate)}</td>
      <td>${o.no_twitter ? "Yes" : "No"}</td>
    </tr>`
    )
    .join("");
}

function onZoomOrPan() {
  const range = getVisibleRange();
  loadSummary(range.start, range.end);
  loadOrders(range.start, range.end);
}

function renderChart() {
  const timestamps = allPoints.map((p) => p.time * 1000);
  const profits = allPoints.map((p) => p.profit);
  const profitsUsd = allPoints.map((p) =>
    p.btc_price > 0 ? (p.profit / 100000000) * (p.btc_price / 100) : null
  );

  const invoiceTs = invoiceTimestamps.map((t) => t * 1000);
  const invoiceData = invoiceTs.map((t, i) => ({ x: t, y: i + 1 }));

  let profitData, profitUsdData, orderData;
  if (isCumulative) {
    let profitSum = 0;
    profitData = timestamps.map((t, i) => ({ x: t, y: (profitSum += profits[i]) }));
    let usdSum = 0;
    profitUsdData = timestamps.map((t, i) => ({ x: t, y: (usdSum += profitsUsd[i] ?? 0) }));
    orderData = timestamps.map((t, i) => ({ x: t, y: i + 1 }));
  } else {
    profitData = timestamps.map((t, i) => ({ x: t, y: profits[i] }));
    profitUsdData = timestamps.map((t, i) => ({ x: t, y: profitsUsd[i] }));
    orderData = timestamps.map((t, i) => ({ x: t, y: i + 1 }));
  }

  const suffix = isCumulative ? " (Cumulative)" : "";

  if (mainChart) mainChart.destroy();

  const datasets = [
    {
      label: "Total Invoices",
      data: invoiceData,
      borderColor: "#8b949e",
      backgroundColor: "rgba(139, 148, 158, 0.1)",
      fill: false,
      tension: 0,
      pointRadius: 1,
      yAxisID: "yOrders",
    },
    {
      label: isCumulative ? "Total Paid" : "Paid #",
      data: orderData,
      borderColor: "#1f6feb",
      backgroundColor: "rgba(31, 111, 235, 0.1)",
      fill: false,
      tension: 0,
      pointRadius: 1,
      yAxisID: "yOrders",
    },
    {
      label: "Profit (sats)" + suffix,
      data: profitData,
      borderColor: "#d29922",
      backgroundColor: "rgba(210, 153, 34, 0.1)",
      fill: false,
      tension: 0,
      pointRadius: 1,
      yAxisID: "yProfit",
    },
    {
      label: "Profit (USD)" + suffix,
      data: profitUsdData,
      borderColor: "#3fb950",
      backgroundColor: "rgba(63, 185, 80, 0.1)",
      fill: true,
      tension: 0,
      pointRadius: 1,
      yAxisID: "yUsd",
    },
  ];

  const scales = {
    x: {
      type: "time",
      time: { tooltipFormat: "yyyy-MM-dd HH:mm" },
      ticks: { color: "#8b949e", maxRotation: 45, maxTicksLimit: 20 },
      grid: { color: "#21262d" },
    },
    yOrders: {
      type: "linear",
      position: "left",
      beginAtZero: true,
      title: { display: true, text: isCumulative ? "Total Paid" : "Paid #", color: "#1f6feb" },
      ticks: { color: "#1f6feb" },
      grid: { color: "#21262d" },
    },
    yProfit: {
      type: "linear",
      position: "right",
      beginAtZero: true,
      title: { display: true, text: "Profit (sats)" + suffix, color: "#d29922" },
      ticks: { color: "#d29922" },
      grid: { drawOnChartArea: false },
    },
    yUsd: {
      type: "linear",
      position: "right",
      beginAtZero: true,
      title: { display: true, text: "Profit (USD)" + suffix, color: "#3fb950" },
      ticks: { color: "#3fb950" },
      grid: { drawOnChartArea: false },
    },
  };

  mainChart = new Chart($("#mainChart"), {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#c9d1d9" } },
        zoom: {
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: "rgba(31, 111, 235, 0.15)",
              borderColor: "#1f6feb",
              borderWidth: 1,
            },
            wheel: { enabled: false },
            mode: "x",
            onZoomComplete: onZoomOrPan,
          },
          pan: {
            enabled: true,
            mode: "x",
            onPanComplete: onZoomOrPan,
          },
        },
      },
      scales,
    },
  });
}

async function loadChart() {
  [allPoints, invoiceTimestamps] = await Promise.all([
    api("chart"),
    api("invoice-chart"),
  ]);
  renderChart();
}

async function fetchCurrentBtcPrice() {
  try {
    const data = await api("btc-price");
    currentBtcPriceCents = data.btc_price_cents;
  } catch (e) {
    console.error("Failed to fetch BTC price", e);
  }
}

async function refresh() {
  await fetchCurrentBtcPrice();
  await Promise.all([loadSummary(), loadChart(), loadOrders()]);
}

$("#toggleMode").addEventListener("click", () => {
  isCumulative = !isCumulative;
  $("#toggleMode").textContent = isCumulative ? "Per Order" : "Cumulative";
  renderChart();
});

$("#resetZoom").addEventListener("click", () => {
  if (mainChart) {
    mainChart.resetZoom();
    loadSummary();
    loadOrders();
  }
});

$("#prevPage").addEventListener("click", () => {
  const range = getVisibleRange();
  loadOrders(range.start, range.end, currentPage - 1);
});

$("#nextPage").addEventListener("click", () => {
  const range = getVisibleRange();
  loadOrders(range.start, range.end, currentPage + 1);
});

refresh();
