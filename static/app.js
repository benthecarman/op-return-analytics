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
let allTimeseriesData = null;

function fmtSats(n) {
  if (n == null) return "\u2014";
  return Number(n).toLocaleString();
}

function fmtDate(ts) {
  if (!ts) return "\u2014";
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function shortTxid(txid) {
  if (!txid) return "\u2014";
  return txid.slice(0, 8) + "\u2026" + txid.slice(-8);
}

function fmtFeeRate(raw) {
  if (raw == null) return "\u2014";
  // bitcoin-s stores SatoshisPerVirtualByte as little-endian hex (16 chars)
  if (/^[0-9a-fA-F]{16}$/.test(raw)) {
    const le = raw.match(/../g).reverse().join("");
    return parseInt(le, 16) + " sat/vB";
  }
  const f = parseFloat(raw);
  if (!isNaN(f)) return f + " sat/vB";
  return raw;
}

function cumulative(arr) {
  let sum = 0;
  return arr.map((v) => (sum += v));
}

function getVisibleRange() {
  if (!mainChart) return {};
  const scale = mainChart.scales.x;
  const min = Math.floor(scale.min);
  const max = Math.ceil(scale.max);
  if (!allTimeseriesData || allTimeseriesData.length === 0) return {};
  const startIdx = Math.max(0, min);
  const endIdx = Math.min(allTimeseriesData.length - 1, max);
  return {
    start: allTimeseriesData[startIdx]?.period,
    end: allTimeseriesData[endIdx]?.period,
  };
}

async function loadSummary(start, end) {
  const data = await api("summary", { start, end });
  $("#summary").innerHTML = [
    ["Orders", fmtSats(data.total_orders)],
    ["Profit", fmtSats(data.total_profit_sats) + " sats"],
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

function renderChart(data) {
  const cumul = $("#chartMode").value === "cumulative";
  const labels = data.map((d) => d.period);
  const orders = data.map((d) => d.orders);
  const profit = data.map((d) => d.profit_sats);

  const ordersData = cumul ? cumulative(orders) : orders;
  const profitData = cumul ? cumulative(profit) : profit;
  const suffix = cumul ? " (Cumulative)" : "";

  if (mainChart) mainChart.destroy();

  mainChart = new Chart($("#mainChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Orders" + suffix,
          data: ordersData,
          borderColor: "#1f6feb",
          backgroundColor: "rgba(31, 111, 235, 0.1)",
          fill: false,
          tension: 0.3,
          pointRadius: 2,
          yAxisID: "yOrders",
        },
        {
          label: "Profit (sats)" + suffix,
          data: profitData,
          borderColor: "#3fb950",
          backgroundColor: "rgba(63, 185, 80, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          yAxisID: "yProfit",
        },
      ],
    },
    options: {
      responsive: true,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          labels: { color: "#c9d1d9" },
        },
        zoom: {
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: "rgba(31, 111, 235, 0.15)",
              borderColor: "#1f6feb",
              borderWidth: 1,
            },
            wheel: {
              enabled: true,
            },
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
      scales: {
        x: {
          ticks: { color: "#8b949e", maxRotation: 45 },
          grid: { color: "#21262d" },
        },
        yOrders: {
          type: "linear",
          position: "left",
          beginAtZero: true,
          title: { display: true, text: "Orders" + suffix, color: "#1f6feb" },
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
      },
    },
  });
}

async function loadChart() {
  const granularity = $("#granularity").value;
  allTimeseriesData = await api("timeseries", { granularity });
  renderChart(allTimeseriesData);
}

async function refresh() {
  await Promise.all([loadSummary(), loadChart(), loadOrders()]);
}

$("#granularity").addEventListener("change", async () => {
  await loadChart();
  onZoomOrPan();
});

$("#chartMode").addEventListener("change", () => {
  if (allTimeseriesData) renderChart(allTimeseriesData);
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
