const $ = (s) => document.querySelector(s);
const api = async (path, params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([_, v]) => v))
  );
  const res = await fetch(`/api/${path}?${qs}`);
  return res.json();
};

let countsChart, profitChart;
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
  if (!countsChart) return {};
  const scale = countsChart.scales.x;
  const start = new Date(scale.min).toISOString().slice(0, 10);
  const end = new Date(scale.max).toISOString().slice(0, 10);
  return { start, end };
}

function pickGranularity() {
  let rangeMs;
  if (countsChart) {
    const scale = countsChart.scales.x;
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

function syncZoom(source, target) {
  if (!target) return;
  const scale = source.scales.x;
  suppressZoomHandler = true;
  target.zoomScale("x", { min: scale.min, max: scale.max }, "none");
  suppressZoomHandler = false;
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

function makeZoomPluginConfig(partner) {
  return {
    zoom: {
      drag: {
        enabled: true,
        backgroundColor: "rgba(31, 111, 235, 0.15)",
        borderColor: "#1f6feb",
        borderWidth: 1,
      },
      wheel: { enabled: false },
      mode: "x",
      onZoomComplete: ({ chart }) => {
        if (suppressZoomHandler) return;
        syncZoom(chart, partner());
        onZoomOrPan();
      },
    },
    pan: {
      enabled: true,
      mode: "x",
      onPanComplete: ({ chart }) => {
        if (suppressZoomHandler) return;
        syncZoom(chart, partner());
        onZoomOrPan();
      },
    },
  };
}

function renderChart() {
  suppressZoomHandler = true;
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
  const profitSatsData = toPoints(data.map((p) => p.profit_sats));
  const profitUsdData = toPoints(data.map((p) => p.profit_usd));

  const periodLabel = { day: "Day", week: "Week", month: "Month" }[g];
  const suffix = isCumulative ? " (Cumulative)" : " / " + periodLabel;

  let savedZoom = null;
  if (countsChart) {
    const scale = countsChart.scales.x;
    savedZoom = { min: scale.min, max: scale.max };
    countsChart.destroy();
    profitChart.destroy();
  }

  const line = (label, data, color, bgColor, yAxisID, fill) => ({
    type: "line",
    label, data, borderColor: color, backgroundColor: bgColor,
    fill: !!fill, tension: 0, pointRadius: 1, parsing: false, yAxisID,
  });
  const bar = (label, data, color, yAxisID) => ({
    type: "bar",
    label, data, backgroundColor: color, parsing: false, yAxisID,
    barPercentage: 1, categoryPercentage: 1, minBarLength: 3,
  });

  // --- Counts chart datasets ---
  const countsDatasets = isCumulative ? [
    line("Total Invoices", invoiceData, "#8b949e", "rgba(139, 148, 158, 0.1)", "y"),
    line("Total Paid", orderData, "#1f6feb", "rgba(31, 111, 235, 0.1)", "y"),
  ] : [
    bar("Invoices" + suffix, invoiceData, "rgba(139, 148, 158, 0.5)", "y"),
    bar("Orders" + suffix, orderData, "rgba(31, 111, 235, 0.7)", "y"),
  ];

  // --- Profit chart datasets ---
  const profitDatasets = isCumulative ? [
    line("Profit (sats)" + suffix, profitSatsData, "#d29922", "rgba(210, 153, 34, 0.1)", "y"),
    line("Profit (USD)" + suffix, profitUsdData, "#3fb950", "rgba(63, 185, 80, 0.1)", "yUsd", true),
  ] : [
    bar("Profit (sats)" + suffix, profitSatsData, "rgba(210, 153, 34, 0.6)", "y"),
  ];

  const sharedXScale = (showTicks) => ({
    type: "time",
    offset: !isCumulative,
    time: { tooltipFormat: "yyyy-MM-dd" },
    ticks: { display: showTicks, color: "#8b949e", maxRotation: 45, maxTicksLimit: 20 },
    grid: { color: "#21262d" },
  });

  // --- Build counts chart ---
  countsChart = new Chart($("#countsChart"), {
    type: "line",
    data: { datasets: countsDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        decimation: { enabled: isCumulative, algorithm: "lttb", samples: 500 },
        legend: { labels: { color: "#c9d1d9" } },
        zoom: makeZoomPluginConfig(() => profitChart),
      },
      scales: {
        x: sharedXScale(false),
        y: {
          type: "linear",
          position: "left",
          beginAtZero: true,
          title: {
            display: true,
            text: isCumulative ? "Total Count" : "Count" + suffix,
            color: "#1f6feb",
          },
          ticks: { color: "#1f6feb" },
          grid: { color: "#21262d" },
        },
      },
    },
  });

  // --- Build profit chart ---
  const profitScales = {
    x: sharedXScale(true),
    y: {
      type: "linear",
      position: "left",
      beginAtZero: true,
      title: { display: true, text: "Profit (sats)" + suffix, color: "#d29922" },
      ticks: { color: "#d29922" },
      grid: { color: "#21262d" },
    },
  };

  if (isCumulative) {
    profitScales.yUsd = {
      type: "linear",
      position: "right",
      beginAtZero: true,
      title: { display: true, text: "Profit (USD)" + suffix, color: "#3fb950" },
      ticks: { color: "#3fb950" },
      grid: { drawOnChartArea: false },
    };
  }

  profitChart = new Chart($("#profitChart"), {
    type: "line",
    data: { datasets: profitDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        decimation: { enabled: isCumulative, algorithm: "lttb", samples: 500 },
        legend: { labels: { color: "#c9d1d9" } },
        zoom: makeZoomPluginConfig(() => countsChart),
        tooltip: !isCumulative ? {
          callbacks: {
            afterLabel: (ctx) => {
              const row = data[ctx.dataIndex];
              if (!row) return "";
              return fmtUsd(row.profit_usd);
            },
          },
        } : {},
      },
      scales: profitScales,
    },
  });

  if (savedZoom) {
    countsChart.zoomScale("x", savedZoom, "none");
    profitChart.zoomScale("x", savedZoom, "none");
  }

  suppressZoomHandler = false;
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
  if (!countsChart || !profitChart) return;

  document.querySelectorAll(".zoom-btn").forEach((b) => b.classList.remove("active"));
  document.querySelector(`.zoom-btn[data-range="${range}"]`).classList.add("active");

  if (range === "all") {
    countsChart.resetZoom();
    profitChart.resetZoom();
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

  countsChart.zoomScale("x", { min: min.getTime(), max: now.getTime() }, "default");
  profitChart.zoomScale("x", { min: min.getTime(), max: now.getTime() }, "default");
  onZoomOrPan();
}

document.querySelectorAll(".zoom-btn").forEach((btn) => {
  btn.addEventListener("click", () => applyZoomPreset(btn.dataset.range));
});

$("#countsChart").addEventListener("dblclick", () => {
  countsChart.resetZoom();
  profitChart.resetZoom();
  onZoomOrPan();
});

$("#profitChart").addEventListener("dblclick", () => {
  countsChart.resetZoom();
  profitChart.resetZoom();
  onZoomOrPan();
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
