const PAGE_SIZE = 100;
let state = {
  page: 0, sort: "rank", order: "asc",
  sector: "", cap_size: "", search: "", min_score: "",
};

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadStats();
  await loadSectors();
  await loadStocks();
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const d = await fetch("/api/stats").then(r => r.json());
    document.getElementById("stat-stocks").textContent  = d.total_stocks.toLocaleString();
    document.getElementById("stat-val").textContent     = d.total_with_val.toLocaleString();
    document.getElementById("stat-news").textContent    = d.total_news.toLocaleString();
    document.getElementById("stat-updated").textContent = d.last_updated
      ? new Date(d.last_updated).toLocaleDateString() : "Never";
    updatePipelineStatus(d.pipeline);
  } catch(e) {}
}

function updatePipelineStatus(p) {
  const el = document.getElementById("pipeline-status");
  if (!p) return;
  if (p.running) {
    const pct     = p.pct_overall ?? 0;
    const script  = p.current_script ? ` — ${p.current_script}` : "";
    const total   = p.script_total  ?? 4;
    const idx     = p.script_index  ?? 0;
    el.innerHTML  = `
      <span style="color:var(--yellow)">⟳ Running${script} (${idx + (p.current_script ? 1 : 0)}/${total})</span>
      <div style="display:inline-block;width:120px;height:6px;background:var(--border);
                  border-radius:3px;vertical-align:middle;margin-left:8px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:var(--yellow);border-radius:3px;
                    transition:width .5s"></div>
      </div>
      <span style="color:var(--muted);margin-left:4px">${pct}%</span>`;
  } else if (p.last_result === "success") {
    el.innerHTML = `<span style="color:var(--green)">✓ Data up to date</span>`;
  } else if (p.last_result) {
    el.innerHTML = `<span style="color:var(--red)">⚠ Last run failed</span>`;
  } else {
    el.innerHTML = "";
  }
}

// ── Sectors ───────────────────────────────────────────────────────────────────
async function loadSectors() {
  try {
    const sectors = await fetch("/api/sectors").then(r => r.json());
    const sel = document.getElementById("sector-filter");
    sectors.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s; opt.textContent = s;
      sel.appendChild(opt);
    });
  } catch(e) {}
}

// ── Stock list ────────────────────────────────────────────────────────────────
let tradeCounts = {};   // ticker -> {pol_count, insider_count}

async function loadStocks() {
  const tbody = document.getElementById("stocks-body");
  tbody.innerHTML = `<tr><td colspan="12"><div class="loading"><div class="spinner"></div>Loading…</div></td></tr>`;

  const params = new URLSearchParams({
    sort:   state.sort,
    order:  state.order,
    limit:  PAGE_SIZE,
    offset: state.page * PAGE_SIZE,
  });
  if (state.sector)    params.set("sector",    state.sector);
  if (state.cap_size)  params.set("cap_size",  state.cap_size);
  if (state.search)    params.set("search",    state.search);
  if (state.min_score) params.set("min_score", state.min_score);

  try {
    const [data, tradeRes] = await Promise.all([
      fetch(`/api/stocks?${params}`).then(r => r.json()),
      fetch(`/api/stocks/trade_counts?days=30`).then(r => r.json()).catch(() => ({counts: {}})),
    ]);
    tradeCounts = tradeRes.counts || {};
    renderTable(data.stocks);
    renderPagination(data.total);
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="12"><div class="empty">Failed to load data. Is the server running?</div></td></tr>`;
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function tradeBadge(count, color) {
  if (!count) return `<span class="muted">—</span>`;
  return `<span style="color:${color};font-weight:600">${count}</span>`;
}

function renderTable(stocks) {
  const tbody = document.getElementById("stocks-body");
  if (!stocks.length) {
    const isFiltered = state.sector || state.cap_size || state.search || state.min_score;
    tbody.innerHTML = isFiltered
      ? `<tr><td colspan="12"><div class="empty">No stocks match your filters.</div></td></tr>`
      : `<tr><td colspan="12"><div class="empty">
           <strong>Database is empty.</strong><br><br>
           Click <strong>↻ Refresh Data</strong> in the top-right to run the pipeline.<br>
           <span style="color:var(--muted);font-size:12px">
             This fetches 2,500 stocks from NASDAQ, Yahoo Finance, and SEC EDGAR.<br>
             First run takes ~6 hours. Subsequent runs are incremental (~30 min).
           </span>
         </div></td></tr>`;
    return;
  }
  tbody.innerHTML = stocks.map(s => {
    const tc = tradeCounts[s.ticker] || {pol_count: 0, insider_count: 0};
    return `
    <tr onclick="location.href='/stock/${s.ticker}'">
      <td class="muted">#${s.rank ?? "—"}</td>
      <td>
        <span class="ticker-cell">${s.ticker}</span>
        <span class="muted" style="margin-left:8px;font-size:12px">${truncate(s.name, 28)}</span>
        <br><span class="muted" style="font-size:11px">${s.sector ?? ""} · ${s.cap_size ?? ""}</span>
      </td>
      <td>${fmtBillion(s.mkt_cap)}</td>
      <td>$${fmtNum(s.price)}</td>
      <td>${fmtNum(s.pe) ?? "<span class='muted'>—</span>"}</td>
      <td>${fmtPct(s.roic)}</td>
      <td>${fmtPct(s.rev_cagr_5y)}</td>
      <td><strong>${s.score ?? "—"}</strong></td>
      <td class="${upsideClass(s.upside)}">${fmtPct(s.upside)}</td>
      <td>${tradeBadge(tc.pol_count,     "var(--accent)")}</td>
      <td>${tradeBadge(tc.insider_count, "var(--yellow)")}</td>
      <td>${recBadge(s.rec)}</td>
    </tr>
  `;}).join("");
}

function renderPagination(total) {
  const pages = Math.ceil(total / PAGE_SIZE);
  document.getElementById("page-info").textContent = `Page ${state.page + 1} of ${pages || 1}`;
  document.getElementById("btn-prev").disabled = state.page === 0;
  document.getElementById("btn-next").disabled = state.page >= pages - 1;
  document.getElementById("result-count").textContent = `${total.toLocaleString()} stocks`;
}

// ── Sorting ───────────────────────────────────────────────────────────────────
function sortBy(col) {
  if (state.sort === col) {
    state.order = state.order === "asc" ? "desc" : "asc";
  } else {
    state.sort  = col;
    state.order = col === "rank" ? "asc" : "desc";
  }
  state.page = 0;
  document.querySelectorAll(".sort-arrow").forEach(el => el.textContent = "↕");
  const arr = document.getElementById(`arr-${col}`);
  if (arr) arr.textContent = state.order === "asc" ? "↑" : "↓";
  loadStocks();
}

// ── Filters ───────────────────────────────────────────────────────────────────
function applyFilters() {
  state.sector    = document.getElementById("sector-filter").value;
  state.cap_size  = document.getElementById("cap-filter").value;
  state.min_score = document.getElementById("score-filter").value;
  state.page = 0;
  loadStocks();
}

function resetFilters() {
  document.getElementById("search").value       = "";
  document.getElementById("sector-filter").value = "";
  document.getElementById("cap-filter").value    = "";
  document.getElementById("score-filter").value  = "";
  state = { ...state, sector: "", cap_size: "", search: "", min_score: "", page: 0 };
  loadStocks();
}

let _debounce;
function debounceSearch() {
  clearTimeout(_debounce);
  _debounce = setTimeout(() => {
    state.search = document.getElementById("search").value.trim();
    state.page = 0;
    loadStocks();
  }, 300);
}

// ── Pagination ────────────────────────────────────────────────────────────────
function changePage(dir) {
  state.page = Math.max(0, state.page + dir);
  loadStocks();
  window.scrollTo(0, 0);
}

// ── Pipeline ──────────────────────────────────────────────────────────────────
async function runPipeline() {
  if (!confirm("Start a full data refresh? This may take several minutes.")) return;
  await fetch("/api/pipeline/run", { method: "POST" });
  document.getElementById("pipeline-status").textContent = "⟳ Pipeline running…";
  document.getElementById("pipeline-status").style.color = "var(--yellow)";
  pollPipeline();
}

function pollPipeline() {
  const interval = setInterval(async () => {
    const d = await fetch("/api/stats").then(r => r.json()).catch(() => ({}));
    updatePipelineStatus(d.pipeline);
    if (d.pipeline && !d.pipeline.running) {
      clearInterval(interval);
      loadStats();
      loadStocks();
    }
  }, 2000);
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtNum(v, dec=2)  { return v != null ? Number(v).toFixed(dec) : "—"; }
function fmtPct(v)         { return v != null ? `<span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? "+" : ""}${Number(v).toFixed(1)}%</span>` : "<span class='muted'>—</span>"; }
function fmtBillion(v)     { if (v == null) return "—"; const b = v / 1e9; return b >= 1 ? `$${b.toFixed(1)}B` : `$${(v/1e6).toFixed(0)}M`; }
function truncate(s, n)    { if (!s) return ""; return s.length > n ? s.slice(0, n) + "…" : s; }
function upsideClass(v)    { return v == null ? "" : v >= 0 ? "pos" : "neg"; }

function recBadge(rec) {
  const map = {
    "STRONG BUY": "strong-buy",
    "BUY":        "buy",
    "WATCHLIST":  "watchlist",
    "HOLD":       "hold",
    "CAUTION":    "caution",
    "AVOID":      "avoid",
  };
  if (!rec) return "<span class='muted'>—</span>";
  const cls = map[rec] || "hold";
  return `<span class="badge badge-${cls}">${rec}</span>`;
}

init();
