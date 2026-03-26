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
let tsDay = [], tsWeek = [], tsMonth = [];
let isCumulative = false;
let currentBtcPriceCents = 0;
let currentGranularity = "month";
let suppressZoomHandler = false;

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

function fmtUsd(n, decimals = 2) {
  if (n == null || n === 0) return "\u2014";
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function satsToUsd(sats, btcPriceCents) {
  if (!btcPriceCents || btcPriceCents === 0) return null;
  return (sats / 100000000) * (btcPriceCents / 100);
}

function getVisibleRange() {
  if (!mainChart) return {};
  const scale = mainChart.scales.x;
  const start = new Date(scale.min).toISOString().slice(0, 10);
  const end = new Date(scale.max).toISOString().slice(0, 10);
  return { start, end };
}

function pickGranularity() {
  let rangeMs;
  if (mainChart) {
    const scale = mainChart.scales.x;
    rangeMs = scale.max - scale.min;
  } else {
    if (tsDay.length < 2) return "day";
    rangeMs = (tsDay[tsDay.length - 1].time - tsDay[0].time) * 1000;
  }
  const days = rangeMs / 86400000;
  if (days <= 90) return "day";
  if (days <= 730) return "week";
  return "month";
}

function getTimeseriesData(g) {
  if (g === "day") return tsDay;
  if (g === "week") return tsWeek;
  return tsMonth;
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
  if (suppressZoomHandler) return;
  document.querySelectorAll(".zoom-btn").forEach((b) => b.classList.remove("active"));
  const range = getVisibleRange();
  loadSummary(range.start, range.end);
  loadOrders(range.start, range.end);

  const g = pickGranularity();
  if (g !== currentGranularity) {
    renderChart();
  }
}

function renderChart() {
  const g = pickGranularity();
  currentGranularity = g;
  const data = getTimeseriesData(g);

  const toPoints = (values) => {
    let sum = 0;
    return data.map((p, i) => ({
      x: p.time * 1000,
      y: isCumulative ? (sum += values[i]) : values[i],
    }));
  };
  const invoiceData = toPoints(data.map((p) => p.invoices));
  const orderData = toPoints(data.map((p) => p.orders));
  const profitData = toPoints(data.map((p) => p.profit_sats));
  const profitUsdData = toPoints(data.map((p) => p.profit_usd));

  function percentile(points, pct) {
    const vals = points.map((p) => p.y).filter((v) => v > 0).sort((a, b) => a - b);
    if (vals.length === 0) return undefined;
    return vals[Math.min(Math.floor(vals.length * pct), vals.length - 1)];
  }
  const orderMax = isCumulative ? undefined : percentile(orderData.concat(invoiceData), 0.95);
  const profitMax = isCumulative ? undefined : percentile(profitData, 0.95);
  const usdMax = isCumulative ? undefined : percentile(profitUsdData, 0.95);

  const periodLabel = { day: "Day", week: "Week", month: "Month" }[g];
  const suffix = isCumulative ? " (Cumulative)" : " / " + periodLabel;

  let savedZoom = null;
  if (mainChart) {
    const scale = mainChart.scales.x;
    savedZoom = { min: scale.min, max: scale.max };
    mainChart.destroy();
  }

  const line = (label, data, color, bgColor, yAxisID, fill) => ({
    type: "line",
    label, data, borderColor: color, backgroundColor: bgColor,
    fill: !!fill, tension: 0, pointRadius: 1, parsing: false, yAxisID,
  });
  const bar = (label, data, color, yAxisID, stack, order, barPct) => ({
    type: "bar",
    label, data, backgroundColor: color, parsing: false, yAxisID,
    stack, order, barPercentage: barPct, categoryPercentage: 0.95,
  });

  const datasets = isCumulative ? [
    line("Total Invoices", invoiceData, "#8b949e", "rgba(139, 148, 158, 0.1)", "yOrders"),
    line("Total Paid", orderData, "#1f6feb", "rgba(31, 111, 235, 0.1)", "yOrders"),
    line("Profit (sats)" + suffix, profitData, "#d29922", "rgba(210, 153, 34, 0.1)", "yProfit"),
    line("Profit (USD)" + suffix, profitUsdData, "#3fb950", "rgba(63, 185, 80, 0.1)", "yUsd", true),
  ] : [
    bar("Invoices / " + periodLabel, invoiceData, "rgba(139, 148, 158, 0.5)", "yOrders", "counts", 0, 0.9),
    bar("Orders / " + periodLabel, orderData, "rgba(31, 111, 235, 0.7)", "yOrders", "counts", 1, 0.5),
    bar("Profit (sats)" + suffix, profitData, "rgba(210, 153, 34, 0.5)", "yProfit", "profit", 0, 0.9),
    bar("Profit (USD)" + suffix, profitUsdData, "rgba(63, 185, 80, 0.7)", "yUsd", "profit", 1, 0.5),
  ];

  const scales = {
    x: {
      type: "time",
      offset: !isCumulative,
      time: { tooltipFormat: "yyyy-MM-dd" },
      ticks: { color: "#8b949e", maxRotation: 45, maxTicksLimit: 20 },
      grid: { color: "#21262d" },
    },
    yOrders: {
      type: "linear",
      position: "left",
      beginAtZero: true,
      max: orderMax,
      title: {
        display: true,
        text: isCumulative ? "Total Count" : "Count / " + periodLabel,
        color: "#1f6feb",
      },
      ticks: { color: "#1f6feb" },
      grid: { color: "#21262d" },
    },
    yProfit: {
      type: "linear",
      position: "right",
      beginAtZero: true,
      max: profitMax,
      title: { display: true, text: "Profit (sats)" + suffix, color: "#d29922" },
      ticks: { color: "#d29922" },
      grid: { drawOnChartArea: false },
    },
    yUsd: {
      type: "linear",
      position: "right",
      beginAtZero: true,
      max: usdMax,
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
        decimation: {
          enabled: isCumulative,
          algorithm: "lttb",
          samples: 500,
        },
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

  if (savedZoom) {
    suppressZoomHandler = true;
    mainChart.zoomScale("x", savedZoom, "none");
    suppressZoomHandler = false;
  }

  $("#toggleMode").textContent = isCumulative ? "Per " + periodLabel : "Cumulative";
}

async function loadChart() {
  [tsDay, tsWeek, tsMonth] = await Promise.all([
    api("timeseries", { granularity: "day" }),
    api("timeseries", { granularity: "week" }),
    api("timeseries", { granularity: "month" }),
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
  renderChart();
});

function applyZoomPreset(range) {
  if (!mainChart) return;

  document.querySelectorAll(".zoom-btn").forEach((b) => b.classList.remove("active"));
  document.querySelector(`.zoom-btn[data-range="${range}"]`).classList.add("active");

  if (range === "all") {
    mainChart.resetZoom();
    loadSummary();
    loadOrders();
    const g = pickGranularity();
    if (g !== currentGranularity) renderChart();
    return;
  }

  const now = new Date();
  let min;
  switch (range) {
    case "4y": min = new Date(now.getFullYear() - 4, now.getMonth(), now.getDate()); break;
    case "1y": min = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
    case "ytd": min = new Date(now.getFullYear(), 0, 1); break;
    case "1m": min = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); break;
    case "1d": min = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); break;
  }

  mainChart.zoomScale("x", { min: min.getTime(), max: now.getTime() }, "default");
  onZoomOrPan();
}

document.querySelectorAll(".zoom-btn").forEach((btn) => {
  btn.addEventListener("click", () => applyZoomPreset(btn.dataset.range));
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
