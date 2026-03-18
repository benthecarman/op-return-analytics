const $ = (s) => document.querySelector(s);
const api = async (path, params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([_, v]) => v))
  );
  const res = await fetch(`/api/${path}?${qs}`);
  return res.json();
};

let ordersChart, profitChart;
let currentPage = 1;
let lastTimeseriesData = null;

function getFilters() {
  return {
    start: $("#start").value || undefined,
    end: $("#end").value || undefined,
    granularity: $("#granularity").value,
  };
}

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

async function loadSummary(filters) {
  const data = await api("summary", filters);
  $("#summary").innerHTML = [
    ["Total Orders", fmtSats(data.total_orders)],
    ["Total Profit", fmtSats(data.total_profit_sats) + " sats"],
    ["Total Chain Fees", fmtSats(data.total_chain_fees_sats) + " sats"],
    ["Avg Profit / Order", fmtSats(data.avg_profit_sats) + " sats"],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`
    )
    .join("");
}

function cumulative(arr) {
  let sum = 0;
  return arr.map((v) => (sum += v));
}

function renderCharts(data) {
  const cumul = $("#chartMode").value === "cumulative";
  const labels = data.map((d) => d.period);
  const orders = data.map((d) => d.orders);
  const profit = data.map((d) => d.profit_sats);

  const ordersData = cumul ? cumulative(orders) : orders;
  const profitData = cumul ? cumulative(profit) : profit;
  const suffix = cumul ? " (Cumulative)" : "";

  const chartOpts = (title) => ({
    responsive: true,
    plugins: {
      legend: { display: false },
      title: { display: true, text: title, color: "#f0f6fc" },
    },
    scales: {
      x: { ticks: { color: "#8b949e" }, grid: { color: "#21262d" } },
      y: {
        beginAtZero: true,
        ticks: { color: "#8b949e" },
        grid: { color: "#21262d" },
      },
    },
  });

  if (ordersChart) ordersChart.destroy();
  if (profitChart) profitChart.destroy();

  ordersChart = new Chart($("#ordersChart"), {
    type: cumul ? "line" : "bar",
    data: {
      labels,
      datasets: [
        cumul
          ? {
              data: ordersData,
              borderColor: "#1f6feb",
              backgroundColor: "rgba(31, 111, 235, 0.1)",
              fill: true,
              tension: 0.3,
              pointRadius: 2,
            }
          : {
              data: ordersData,
              backgroundColor: "#1f6feb",
              borderRadius: 3,
            },
      ],
    },
    options: chartOpts("Orders" + suffix),
  });

  profitChart = new Chart($("#profitChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data: profitData,
          borderColor: "#3fb950",
          backgroundColor: "rgba(63, 185, 80, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 2,
        },
      ],
    },
    options: chartOpts("Profit (sats)" + suffix),
  });
}

async function loadCharts(filters) {
  lastTimeseriesData = await api("timeseries", filters);
  renderCharts(lastTimeseriesData);
}

async function loadOrders(filters, page = 1) {
  currentPage = page;
  const data = await api("orders", { ...filters, page, limit: 50 });

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
      <td>${o.fee_rate ?? "\u2014"}</td>
      <td>${o.no_twitter ? "Yes" : "No"}</td>
    </tr>`
    )
    .join("");
}

async function refresh() {
  const f = getFilters();
  await Promise.all([loadSummary(f), loadCharts(f), loadOrders(f)]);
}

$("#apply").addEventListener("click", () => {
  currentPage = 1;
  refresh();
});

$("#prevPage").addEventListener("click", () => {
  loadOrders(getFilters(), currentPage - 1);
});

$("#nextPage").addEventListener("click", () => {
  loadOrders(getFilters(), currentPage + 1);
});

$("#chartMode").addEventListener("change", () => {
  if (lastTimeseriesData) renderCharts(lastTimeseriesData);
});
refresh();
