const ticker = location.pathname.split("/").pop().toUpperCase();
document.title = `${ticker} — Stock Tracker`;

async function init() {
  const [detail, news, prices, livePrice, scoreData, polData, insiderData] = await Promise.all([
    fetch(`/api/stocks/${ticker}`).then(r => r.json()).catch(() => null),
    fetch(`/api/live/news/${ticker}`).then(r => r.json()).catch(() => []),
    fetch(`/api/price/${ticker}`).then(r => r.json()).catch(() => []),
    fetch(`/api/live/price/${ticker}`).then(r => r.json()).catch(() => null),
    fetch(`/api/stocks/${ticker}/score`).then(r => r.json()).catch(() => null),
    fetch(`/api/pol/ticker/${ticker}`).then(r => r.json()).catch(() => null),
    fetch(`/api/insider/ticker/${ticker}`).then(r => r.json()).catch(() => null),
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
  renderPoliticalTrades(polData);
  renderInsiderTrades(insiderData);
  if (prices.length) renderChart(prices);
  loadProfile();
  renderAcctControls(detail?.stock?.price);
}

// ── Account: favorite + quick paper trade ───────────────────────────────────────
async function renderAcctControls(lastPrice) {
  const el = document.getElementById("acct-controls");
  if (!el) return;
  const favs = await favSet();
  el.innerHTML = `
    <button class="btn btn-outline btn-sm" id="fav-btn" onclick="onFav()">${favs.has(ticker) ? "★ Favorited" : "☆ Favorite"}</button>
    <button class="btn btn-primary btn-sm" onclick="quickTrade(${lastPrice || 0})">+ Paper trade</button>`;
}
async function onFav() {
  const r = await favToggle(ticker, "stock");
  if (r) document.getElementById("fav-btn").textContent = r.favorited ? "★ Favorited" : "☆ Favorite";
}
async function quickTrade(lastPrice) {
  if (!getUser()) { alert("Set a username on the Portfolio page first."); return; }
  const side = (prompt("buy or sell?", "buy") || "").trim().toLowerCase();
  if (side !== "buy" && side !== "sell") return;
  const shares = parseFloat(prompt("Shares:", "10"));
  if (!(shares > 0)) return;
  const price = parseFloat(prompt("Price (you enter — daily pull):", lastPrice ? Number(lastPrice).toFixed(2) : ""));
  if (!(price >= 0)) return;
  const r = await addTrade({ ticker, kind: "stock", side, shares, price, date: new Date().toISOString().slice(0,10), note: "" });
  alert(r && r.ok ? `Logged ${side} ${shares} ${ticker} @ $${price}` : "Failed.");
}

// ── Company profile + SEC filings ───────────────────────────────────────────────
async function loadProfile() {
  const p = await fetch(`/api/live/profile/${ticker}`).then(r => r.json()).catch(() => null);
  if (!p) return;
  const payFmt = v => v == null ? "—" : v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : `$${(v/1e3).toFixed(0)}K`;

  if (p.summary || (p.officers && p.officers.length)) {
    document.getElementById("profile-card").style.display = "block";
    document.getElementById("profile-summary").textContent = p.summary || "";
    document.getElementById("profile-officers").innerHTML = (p.officers || []).length
      ? p.officers.map((o, i) => `
          <div style="border-bottom:1px solid var(--border);padding:8px 0">
            <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;gap:10px"
                 onclick="toggleBio(${i}, ${JSON.stringify(o.name || "").replace(/"/g,'&quot;')})">
              <span><strong>${o.name||"—"}</strong>
                <span class="muted" style="font-size:12px;margin-left:6px">${o.title||""}</span></span>
              <span class="muted" style="font-size:12px;white-space:nowrap">
                ${o.age?`age ${o.age} · `:""}${payFmt(o.pay)} <span id="bio-caret-${i}">▾</span></span>
            </div>
            <div id="bio-${i}" style="display:none;font-size:12.5px;color:var(--muted);line-height:1.6;margin-top:6px"></div>
          </div>`).join("")
      : `<div class="muted">No officer data.</div>`;
  }

  const fc = document.getElementById("filings-card");
  if (p.sec_url) document.getElementById("sec-all").href = p.sec_url;
  if (p.filings && p.filings.length) {
    fc.style.display = "block";
    document.getElementById("filings-list").innerHTML = p.filings.map(f => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
        <a href="${f.url}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600">${f.form}</a>
        <span class="muted">${f.date}</span>
      </div>`).join("");
  } else if (p.sec_url) {
    fc.style.display = "block";
    document.getElementById("filings-list").innerHTML =
      `<div class="muted" style="font-size:13px">View this company's filings on <a href="${p.sec_url}" target="_blank" rel="noopener" style="color:var(--accent)">SEC EDGAR →</a></div>`;
  }
}

const _bioLoaded = {};
async function toggleBio(i, name) {
  const div = document.getElementById(`bio-${i}`);
  const caret = document.getElementById(`bio-caret-${i}`);
  if (!div) return;
  if (div.style.display === "block") { div.style.display = "none"; caret.textContent = "▾"; return; }
  div.style.display = "block"; caret.textContent = "▴";
  if (_bioLoaded[i]) return;
  _bioLoaded[i] = true;
  div.innerHTML = `<span style="opacity:.6">Loading bio…</span>`;
  const d = await fetch(`/api/live/exec_bio?name=${encodeURIComponent(name)}`).then(r => r.json()).catch(() => null);
  if (d && d.bio) {
    div.innerHTML = `${d.bio}${d.url ? ` <a href="${d.url}" target="_blank" rel="noopener" style="color:var(--accent)">Wikipedia →</a>` : ""}`;
  } else {
    div.innerHTML = `<span style="opacity:.6">No public bio found.</span>`;
  }
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

  const opts = crosshairLineOptions({ unit: "$", color });
  opts.scales.y.ticks.callback = v => `$${v.toFixed(0)}`;
  new Chart(document.getElementById("price-chart"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        data,
        borderColor: color,
        borderWidth: 2,
        fill: true,
        backgroundColor: color + "18",
        tension: 0.3,
      }],
    },
    options: opts,
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

  const summary = (typeof newsSummaryHTML === "function") ? newsSummaryHTML(articles) : "";
  list.innerHTML = summary + articles.map(a => {
    const sentColor = a.sentiment > 0.05 ? "#22c55e" : a.sentiment < -0.05 ? "#ef4444" : "#94a3b8";
    const sentWord  = a.sentiment > 0.05 ? "Positive" : a.sentiment < -0.05 ? "Negative" : "Neutral";
    const dateStr   = a.published_at ? new Date(a.published_at).toLocaleDateString() : "";
    const srcTag    = a.source === "google"
      ? `<span style="background:rgba(59,130,246,.15);color:var(--accent);padding:1px 6px;border-radius:3px;font-size:10px;margin-left:6px">Google</span>`
      : a.source === "yahoo"
      ? `<span style="background:rgba(124,58,237,.15);color:#a78bfa;padding:1px 6px;border-radius:3px;font-size:10px;margin-left:6px">Yahoo</span>`
      : "";
    return `
      <div class="news-item">
        <div class="news-sentiment" style="background:${sentColor}"></div>
        <div class="news-content">
          <a class="news-title" href="${a.url}" target="_blank" rel="noopener">${a.title}</a>${srcTag}
          <div class="news-meta"><span style="color:${sentColor};font-weight:600">${sentWord}</span> · ${a.publisher || ""} ${dateStr ? "· " + dateStr : ""}</div>
        </div>
      </div>
    `;
  }).join("");
}

// ── Political trades (Congressional) — last 2 years ──────────────────────────
function renderPoliticalTrades(data) {
  if (!data || !data.trades || !data.trades.length) return;
  document.getElementById("pol-card").style.display = "block";

  const trades = data.trades;
  const titleEl = document.querySelector("#pol-card .card-title");
  if (titleEl) titleEl.querySelector("span:first-child").textContent =
    `Congressional Trades (${trades.length})`;

  document.getElementById("pol-list").innerHTML = `
    <div style="max-height:420px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead style="position:sticky;top:0;background:var(--surface);z-index:1">
          <tr style="color:var(--muted);text-align:left">
            <th style="padding:6px 8px">Politician</th>
            <th style="padding:6px 8px">Type</th>
            <th style="padding:6px 8px;text-align:right">Amount</th>
            <th style="padding:6px 8px">Date</th>
          </tr>
        </thead>
        <tbody>
          ${trades.map(t => {
            const txnColor = t.transaction_type === "purchase" ? "#22c55e"
                           : t.transaction_type && t.transaction_type.startsWith("sale") ? "#ef4444" : "#94a3b8";
            const mid = (t.amount_min != null && t.amount_max != null)
                        ? (t.amount_min + t.amount_max) / 2 : null;
            const amt = mid == null ? "—" : mid >= 1e6 ? `$${(mid/1e6).toFixed(1)}M`
                      : mid >= 1e3 ? `$${(mid/1e3).toFixed(0)}K` : `$${mid.toFixed(0)}`;
            return `
              <tr style="border-top:1px solid var(--border)">
                <td style="padding:7px 8px">
                  <a href="/politician/${t.bioguide_id}" style="color:var(--accent);font-weight:600">${t.politician_name}</a>
                  <span style="color:var(--muted);font-size:11px;margin-left:6px">${t.party || "?"}/${t.chamber || "?"}</span>
                </td>
                <td style="padding:7px 8px;color:${txnColor};font-weight:600;font-size:12px">${t.transaction_type || "?"}</td>
                <td style="padding:7px 8px;text-align:right;font-weight:600">${amt}</td>
                <td style="padding:7px 8px;color:var(--muted);font-size:12px">${t.transaction_date || "—"}</td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ── Insider trades (Form 4) — last 2 years ───────────────────────────────────
function renderInsiderTrades(data) {
  if (!data || !data.trades || !data.trades.length) return;
  document.getElementById("insider-card").style.display = "block";

  const TYPE_LABEL = {"P":"Purchase","S":"Sale","A":"Award","M":"Option Ex.","G":"Gift","F":"Tax","D":"Disposition"};
  const trades = data.trades;
  const titleEl = document.querySelector("#insider-card .card-title");
  if (titleEl) titleEl.querySelector("span:first-child").textContent =
    `Insider Trades — Form 4 (${trades.length})`;

  document.getElementById("insider-list").innerHTML = `
    <div style="max-height:420px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead style="position:sticky;top:0;background:var(--surface);z-index:1">
          <tr style="color:var(--muted);text-align:left">
            <th style="padding:6px 8px">Insider</th>
            <th style="padding:6px 8px">Title</th>
            <th style="padding:6px 8px">Type</th>
            <th style="padding:6px 8px;text-align:right">Shares</th>
            <th style="padding:6px 8px;text-align:right">Value</th>
            <th style="padding:6px 8px">Date</th>
          </tr>
        </thead>
        <tbody>
          ${trades.map(t => {
            const tc = t.transaction_type;
            const color = tc === "P" ? "#22c55e" : tc === "S" || tc === "D" ? "#ef4444" : "#94a3b8";
            const val = t.total_value == null ? "—"
                      : t.total_value >= 1e6 ? `$${(t.total_value/1e6).toFixed(2)}M`
                      : t.total_value >= 1e3 ? `$${(t.total_value/1e3).toFixed(0)}K`
                      : `$${t.total_value.toFixed(0)}`;
            return `
              <tr style="border-top:1px solid var(--border)">
                <td style="padding:7px 8px;font-weight:600">${t.insider_name || "—"}</td>
                <td style="padding:7px 8px;color:var(--muted);font-size:12px">${t.insider_title || "—"}</td>
                <td style="padding:7px 8px;color:${color};font-weight:600;font-size:12px">${TYPE_LABEL[tc] || tc || "?"}</td>
                <td style="padding:7px 8px;text-align:right">${t.shares ? Math.round(t.shares).toLocaleString() : "—"}</td>
                <td style="padding:7px 8px;text-align:right;font-weight:600">${val}</td>
                <td style="padding:7px 8px;color:var(--muted);font-size:12px">${t.transaction_date || "—"}</td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
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
