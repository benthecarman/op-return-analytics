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
  const labels = mainChart.data.labels;
  const minIdx = Math.max(0, Math.floor(scale.min));
  const maxIdx = Math.min(labels.length - 1, Math.ceil(scale.max));
  // Convert displayed dates back to API format (YYYY-MM-DD)
  return {
    start: labels[minIdx]?.slice(0, 10),
    end: labels[maxIdx]?.slice(0, 10),
  };
}

function fmtUsd(n) {
  if (n == null || n === 0) return "\u2014";
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  $("#summary").innerHTML = [
    ["Orders", fmtSats(data.total_orders)],
    ["Profit", fmtSats(data.total_profit_sats) + " sats"],
    ["Profit (USD at time)", fmtUsd(data.total_profit_usd)],
    ["Profit (USD now)", fmtUsd(currentUsd)],
    ["Chain Fees", fmtSats(data.total_chain_fees_sats) + " sats"],
    ["Avg Profit / Order", fmtSats(data.avg_profit_sats) + " sats"],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`
    )
    .join("");
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
      <td>${o.vsize ?? "\u2014"}</td>
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
  const labels = allPoints.map((p) => fmtDateTime(p.time));
  const profits = allPoints.map((p) => p.profit);

  let profitData, orderData;
  if (isCumulative) {
    let profitSum = 0;
    profitData = profits.map((v) => (profitSum += v));
    orderData = profits.map((_, i) => i + 1);
  } else {
    profitData = profits;
    orderData = profits.map((_, i) => i + 1);
  }

  const suffix = isCumulative ? " (Cumulative)" : "";

  if (mainChart) mainChart.destroy();

  const datasets = [
    {
      label: isCumulative ? "Total Orders" : "Order #",
      data: orderData,
      borderColor: "#1f6feb",
      backgroundColor: "rgba(31, 111, 235, 0.1)",
      fill: false,
      tension: 0.3,
      pointRadius: 1,
      yAxisID: "yOrders",
    },
    {
      label: "Profit (sats)" + suffix,
      data: profitData,
      borderColor: "#3fb950",
      backgroundColor: "rgba(63, 185, 80, 0.1)",
      fill: true,
      tension: 0.3,
      pointRadius: 1,
      yAxisID: "yProfit",
    },
  ];

  const scales = {
    x: {
      ticks: { color: "#8b949e", maxRotation: 45, maxTicksLimit: 20 },
      grid: { color: "#21262d" },
    },
    yOrders: {
      type: "linear",
      position: "left",
      beginAtZero: true,
      title: { display: true, text: isCumulative ? "Total Orders" : "Order #", color: "#1f6feb" },
      ticks: { color: "#1f6feb" },
      grid: { color: "#21262d" },
    },
    yProfit: {
      type: "linear",
      position: "right",
      beginAtZero: true,
      title: { display: true, text: "Profit (sats)" + suffix, color: "#3fb950" },
      ticks: { color: "#3fb950" },
      grid: { drawOnChartArea: false },
    },
  };

  mainChart = new Chart($("#mainChart"), {
    type: "line",
    data: { labels, datasets },
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
            wheel: { enabled: true },
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
  allPoints = await api("chart");
  renderChart();
}

async function fetchCurrentBtcPrice() {
  try {
    const res = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
    const json = await res.json();
    currentBtcPriceCents = Math.round(parseFloat(json.data.amount) * 100);
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
