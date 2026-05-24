const ticker = location.pathname.split("/").pop().toUpperCase();
document.title = `${ticker} — Stock Tracker`;

async function init() {
  const [detail, news, prices, livePrice, scoreData] = await Promise.all([
    fetch(`/api/stocks/${ticker}`).then(r => r.json()).catch(() => null),
    fetch(`/api/live/news/${ticker}`).then(r => r.json()).catch(() => []),
    fetch(`/api/price/${ticker}`).then(r => r.json()).catch(() => []),
    fetch(`/api/live/price/${ticker}`).then(r => r.json()).catch(() => null),
    fetch(`/api/stocks/${ticker}/score`).then(r => r.json()).catch(() => null),
  ]);

  // Stock not in DB yet — still show live data if available
  if (!detail || detail.error) {
    if (livePrice && livePrice.price) {
      detail = {
        stock: {
          ticker,
          name:    livePrice.name    || ticker,
          sector:  livePrice.sector  || "",
          mkt_cap: null,
          price:   livePrice.price,
          change:  livePrice.change,
          change_pct: livePrice.change_pct,
          market_state: livePrice.market_state,
        },
        fundamentals: {},
        valuation: {},
      };
      document.getElementById("stock-header").insertAdjacentHTML("beforebegin",
        `<div style="background:#451a03;color:#fde68a;padding:10px 16px;border-radius:8px;
                     font-size:13px;margin-bottom:16px">
          ⚠ This stock isn't in the database yet — run the pipeline to get full analysis.
          Showing live price only.
        </div>`
      );
    } else {
      document.getElementById("stock-header").innerHTML =
        `<div class='empty'>Stock "${ticker}" not found. Run the pipeline to populate data.</div>`;
      return;
    }
  }

  // Inject live price into detail before rendering
  if (livePrice?.price && detail?.stock) {
    detail.stock.price         = livePrice.price;
    detail.stock.change        = livePrice.change;
    detail.stock.change_pct    = livePrice.change_pct;
    detail.stock.market_state  = livePrice.market_state;
  }
  renderHeader(detail);
  renderValuations(detail.valuation);
  renderScoreBreakdown(scoreData);
  renderFundamentals(detail.fundamentals);
  renderNews(news);
  if (prices.length) renderChart(prices);
}

// ── Header ────────────────────────────────────────────────────────────────────
function renderHeader({ stock, fundamentals: f, valuation: v }) {
  const s = stock;
  const scoreColor = scoreToColor(v?.score_composite);
  document.getElementById("stock-header").innerHTML = `
    <div class="stock-title">
      <div class="ticker">${s.ticker}</div>
      <div class="company-name">${s.name || ""}</div>
      <div class="tags">
        ${s.sector ? `<span class="tag">${s.sector}</span>` : ""}
        ${s.industry ? `<span class="tag">${s.industry}</span>` : ""}
        ${s.cap_size ? `<span class="tag">${s.cap_size}</span>` : ""}
        ${s.exchange ? `<span class="tag">${s.exchange}</span>` : ""}
      </div>
    </div>

    <div class="score-big" style="border-color:${scoreColor};color:${scoreColor}">
      <div class="score-num">${v?.score_composite ?? "—"}</div>
      <div class="score-label">${v?.score_label ?? "No Data"}</div>
    </div>

    <div class="stock-price">
      <div class="price-val">$${fmtNum(s.price)}
        ${s.change != null ? `<span style="font-size:16px;margin-left:8px" class="${s.change >= 0 ? 'pos' : 'neg'}">${s.change >= 0 ? "+" : ""}${fmtNum(s.change)} (${fmtNum(s.change_pct, 2)}%)</span>` : ""}
      </div>
      ${s.market_state ? `<div class="mkt-cap" style="margin-bottom:4px">${s.market_state === "REGULAR" ? "🟢 Market Open" : "🔴 Market Closed"}</div>` : ""}
      <div class="mkt-cap">Mkt Cap: ${fmtBillion(s.mkt_cap)}</div>
      ${f?.next_earnings ? `<div class="mkt-cap" style="margin-top:4px">Next Earnings: ${f.next_earnings}</div>` : ""}
      ${f?.analyst_rec ? `<div class="mkt-cap">Analyst: ${f.analyst_rec} (${f.num_analysts ?? 0} analysts)</div>` : ""}
    </div>
  `;
}

// ── Valuations ────────────────────────────────────────────────────────────────
function renderValuations(v) {
  if (!v || !v.dcf_fair_value) return;
  document.getElementById("val-grid").style.display = "grid";

  const models = [
    { id: "dcf",   fv: v.dcf_fair_value,   up: v.dcf_upside_pct,   sig: v.dcf_signal },
    { id: "comps", fv: v.comps_fair_value,  up: v.comps_upside_pct, sig: v.comps_signal },
    { id: "m3",    fv: v.m3_fair_value,     up: v.m3_upside_pct,    sig: v.m3_signal },
  ];

  models.forEach(({ id, fv, up, sig }) => {
    document.getElementById(`${id}-fv`).textContent  = fv ? `$${fmtNum(fv)}` : "—";
    const upEl = document.getElementById(`${id}-up`);
    if (up != null) {
      upEl.textContent  = `${up >= 0 ? "+" : ""}${fmtNum(up, 1)}%`;
      upEl.className    = "upside " + (up >= 0 ? "pos" : "neg");
    }
    document.getElementById(`${id}-sig`).textContent = sig || "";
  });
}

// ── Score breakdown ───────────────────────────────────────────────────────────
function renderScoreBreakdown(data) {
  if (!data || data.error || !data.categories) return;
  const card = document.getElementById("score-card");
  card.style.display = "block";

  const html = data.categories.map(cat => {
    const pct   = cat.score;
    const color = cat.score >= 70 ? "var(--green)" : cat.score >= 50 ? "var(--yellow)" : "var(--red)";
    const itemsHtml = cat.items.map(it => {
      const itPct = it.max > 0 ? Math.round(it.score / it.max * 100) : 0;
      return `
        <div class="score-item">
          <span class="score-item-label">${it.label}</span>
          <div class="score-bar-track"><div class="score-bar-fill" style="width:${itPct}%;background:${color}"></div></div>
          <span class="score-item-val">${it.display}</span>
          <span class="score-item-pts">${it.score}/${it.max}</span>
        </div>`;
    }).join("");

    return `
      <div class="score-category">
        <div class="score-cat-header">
          <span class="score-cat-name">${cat.name}</span>
          <span class="score-cat-weight">${cat.weight}% weight</span>
          <div class="score-bar-track score-cat-bar"><div class="score-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <span class="score-cat-pts" style="color:${color}">${cat.score}/100</span>
        </div>
        <div class="score-items">${itemsHtml}</div>
      </div>`;
  }).join("");

  document.getElementById("score-breakdown").innerHTML = html;
}

// ── Fundamentals ──────────────────────────────────────────────────────────────
function renderFundamentals(f) {
  if (!f || !f.ticker) return;
  document.getElementById("fund-grid").style.display = "grid";

  renderMetrics("metrics-income", [
    ["Revenue",      fmtBillion(f.rev_now)],
    ["Net Income",   fmtBillion(f.net_income)],
    ["EBITDA",       fmtBillion(f.ebitda)],
    ["FCF",          fmtBillion(f.fcf)],
    ["EPS (TTM)",    f.eps_ttm != null ? `$${fmtNum(f.eps_ttm)}` : null],
    ["Gross Margin", fmtPctRaw(f.gross_margin)],
    ["Op Margin",    fmtPctRaw(f.op_margin)],
    ["FCF Margin",   fmtPctRaw(f.fcf_margin)],
    ["P/E",          fmtNum(f.pe)],
    ["EV/EBITDA",    fmtNum(f.ev_ebitda)],
    ["P/S",          fmtNum(f.ps)],
    ["ROIC",         fmtPctRaw(f.roic)],
    ["ROE",          fmtPctRaw(f.roe)],
  ]);

  renderMetrics("metrics-growth", [
    ["Rev 1Y",      fmtPctRaw(f.rev_cagr_1y)],
    ["Rev 3Y",      fmtPctRaw(f.rev_cagr_3y)],
    ["Rev 5Y",      fmtPctRaw(f.rev_cagr_5y)],
    ["EPS 1Y",      fmtPctRaw(f.eps_cagr_1y)],
    ["EPS 3Y",      fmtPctRaw(f.eps_cagr_3y)],
    ["EPS 5Y",      fmtPctRaw(f.eps_cagr_5y)],
    ["FCF 3Y",      fmtPctRaw(f.fcf_cagr_3y)],
    ["FCF 5Y",      fmtPctRaw(f.fcf_cagr_5y)],
    ["BVPS 3Y",     fmtPctRaw(f.bvps_cagr_3y)],
    ["BVPS 5Y",     fmtPctRaw(f.bvps_cagr_5y)],
    ["ROIC 5Y Avg", fmtPctRaw(f.roic_avg_5y)],
    ["1Y Return",   fmtPctRaw(f.ret_1y)],
  ]);

  renderMetrics("metrics-balance", [
    ["Total Debt",  fmtBillion(f.total_debt)],
    ["Cash",        fmtBillion(f.cash)],
    ["Equity",      fmtBillion(f.equity)],
    ["D/E",         fmtNum(f.d_to_e)],
    ["D/EBITDA",    fmtNum(f.d_to_ebitda)],
    ["Curr Ratio",  fmtNum(f.curr_ratio)],
    ["Int Coverage",fmtNum(f.int_cov)],
    ["BVPS",        f.bvps != null ? `$${fmtNum(f.bvps)}` : null],
    ["RSI",         fmtNum(f.rsi, 1)],
    ["Data Quality",f.data_quality != null ? `${f.data_quality}/100` : null],
  ]);

  renderMetrics("metrics-rule1", [
    ["ROIC ≥10%",   f.rule1_roic   != null ? (f.rule1_roic   ? "✅ Pass" : "❌ Fail") : null],
    ["EPS ≥10%",    f.rule1_eps    != null ? (f.rule1_eps    ? "✅ Pass" : "❌ Fail") : null],
    ["Sales ≥10%",  f.rule1_sales  != null ? (f.rule1_sales  ? "✅ Pass" : "❌ Fail") : null],
    ["Equity ≥10%", f.rule1_equity != null ? (f.rule1_equity ? "✅ Pass" : "❌ Fail") : null],
    ["FCF ≥10%",    f.rule1_fcf    != null ? (f.rule1_fcf    ? "✅ Pass" : "❌ Fail") : null],
    ["Passes",      f.rule1_passes != null ? `${f.rule1_passes}/5` : null],
    ["Longevity",   f.longevity_score != null ? `${f.longevity_score}/5 yrs` : null],
    ["EPS Surprise",f.eps_surprise != null ? fmtPctRaw(f.eps_surprise) : null],
  ]);
}

function renderMetrics(id, items) {
  document.getElementById(id).innerHTML = items
    .filter(([, v]) => v != null && v !== "—")
    .map(([label, val]) => `
      <div class="metric">
        <div class="m-label">${label}</div>
        <div class="m-value">${val}</div>
      </div>
    `).join("");
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function renderChart(prices) {
  document.getElementById("chart-card").style.display = "block";
  const labels = prices.map(p => p.date);
  const data   = prices.map(p => p.close);
  const first  = data[0], last = data[data.length - 1];
  const color  = last >= first ? "#22c55e" : "#ef4444";

  new Chart(document.getElementById("price-chart"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        data,
        borderColor: color,
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        backgroundColor: color + "18",
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { color: "#334155" },
          ticks: { color: "#94a3b8", maxTicksLimit: 8 },
        },
        y: {
          grid: { color: "#334155" },
          ticks: { color: "#94a3b8", callback: v => `$${v.toFixed(0)}` },
        },
      },
    },
  });
}

// ── News ──────────────────────────────────────────────────────────────────────
function renderNews(articles) {
  const card = document.getElementById("news-card");
  const list = document.getElementById("news-list");
  card.style.display = "block";

  if (!articles.length) {
    list.innerHTML = `<div class="empty">No news available.</div>`;
    return;
  }

  list.innerHTML = articles.map(a => {
    const sentColor = a.sentiment > 0.05 ? "#22c55e" : a.sentiment < -0.05 ? "#ef4444" : "#94a3b8";
    const dateStr   = a.published_at ? new Date(a.published_at).toLocaleDateString() : "";
    return `
      <div class="news-item">
        <div class="news-sentiment" style="background:${sentColor}"></div>
        <div class="news-content">
          <a class="news-title" href="${a.url}" target="_blank" rel="noopener">${a.title}</a>
          <div class="news-meta">${a.publisher || ""} ${dateStr ? "· " + dateStr : ""}</div>
        </div>
      </div>
    `;
  }).join("");
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtNum(v, dec=2) { return v != null ? Number(v).toFixed(dec) : "—"; }
function fmtPctRaw(v)     { if (v == null) return null; const n = Number(v); return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; }
function fmtBillion(v) {
  if (v == null) return null;
  const b = v / 1e9;
  return b >= 1 ? `$${b.toFixed(2)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(0)}M` : `$${Number(v).toFixed(0)}`;
}
function scoreToColor(s) {
  if (s == null)  return "#94a3b8";
  if (s >= 85)    return "#22c55e";
  if (s >= 70)    return "#3b82f6";
  if (s >= 55)    return "#f59e0b";
  if (s >= 40)    return "#f97316";
  return "#ef4444";
}

init();
