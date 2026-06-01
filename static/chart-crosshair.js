// Shared Chart.js helpers: a vertical crosshair line on hover + a tooltip that
// shows the hovered date and value. Load after chart.umd.min.js, then build a
// line chart with options from crosshairLineOptions({unit}).

// Plugin: draw a vertical line through the active (hovered) point.
const CrosshairLine = {
  id: "crosshairLine",
  afterDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.() || [];
    if (!active.length) return;
    const x = active[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(148,163,184,.6)";
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  },
};
if (window.Chart) Chart.register(CrosshairLine);

// unit: "%" | "pp" | "$" | "" — formats the tooltip value.
function crosshairLineOptions({ unit = "", color = "#3b82f6" } = {}) {
  const fmt = (v) => {
    if (v === null || v === undefined) return "—";
    if (unit === "$") return "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (unit === "%") return Number(v).toFixed(2) + "%";
    if (unit === "pp") return Number(v).toFixed(2) + " pp";
    return Number(v).toLocaleString();
  };
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },   // hover anywhere on the x
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        displayColors: false,
        callbacks: {
          title: (items) => items[0]?.label ?? "",        // the date
          label: (item) => fmt(item.parsed.y),             // the metric value
        },
      },
    },
    hover: { mode: "index", intersect: false },
    scales: {
      x: { ticks: { maxTicksLimit: 8, color: "#94a3b8" }, grid: { display: false } },
      y: { ticks: { color: "#94a3b8" } },
    },
    elements: { point: { radius: 0, hoverRadius: 4, hitRadius: 12 } },
    _color: color,
  };
}
