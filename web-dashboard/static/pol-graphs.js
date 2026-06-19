/* pol-graphs.js — shared Congressional graphs: relationship network + trade timing.
   Two factories, each driven by a config of element ids so the same code powers
   the standalone /relationships page, the Congressional sub-tabs, and the stock
   detail page. */

const PG_PARTY_COLORS = { Republican: "#ef4444", Democrat: "#3b82f6", Independent: "#94a3b8" };
const PG_EDGE_STYLE = {
  business_deal:        { color: "#f59e0b", dashes: false },
  appointment:          { color: "#a855f7", dashes: [6, 4] },
  former_member:        { color: "#14b8a6", dashes: [2, 4] },
  donor:                { color: "#ec4899", dashes: false },
  family:               { color: "#eab308", dashes: [6, 4] },
  other:                { color: "#94a3b8", dashes: [2, 3] },
  shared_stock:         { color: "#22c55e", dashes: false },
  co_trade:             { color: "#fb7185", dashes: false },
  shared_sector:        { color: "#f97316", dashes: [5, 3] },
  shared_committee:     { color: "#60a5fa", dashes: false },
  committee_leadership: { color: "#a3e635", dashes: false },
  same_state:           { color: "#06b6d4", dashes: [2, 3] },
  hub:                  { color: "rgba(148,163,184,.16)", dashes: false },
  scaffold:             { color: "rgba(148,163,184,.09)", dashes: false },
};
function pgEdgeGroup(kind) {
  if (kind === "shared_stock") return "stock";
  if (kind === "co_trade") return "cotrade";
  if (kind === "shared_sector") return "sector";
  if (kind === "shared_committee") return "committee";
  if (kind === "committee_leadership") return "leadership";
  if (kind === "same_state") return "state";
  if (kind === "hub" || kind === "scaffold") return "structure";
  return "curated";
}

// ── Relationship network ─────────────────────────────────────────────────────
// cfg.ids = { container, empty, count, limit, animate, checks:{curated,stock,
//             cotrade,sector,committee,leadership,state} }
function createPolNetwork(cfg) {
  const C = cfg.ids;
  const st = { party: "republican", raw: { nodes: [], edges: [] },
               network: null, nodeMeta: {}, animate: cfg.animate !== false };
  const el = id => (id ? document.getElementById(id) : null);

  function fatal(msg) {
    const c = el(C.container);
    if (c) c.innerHTML = `<div style="display:flex;height:100%;align-items:center;justify-content:center;
      text-align:center;padding:24px;color:var(--muted)">${msg}</div>`;
  }

  function switchParty(p) { st.party = p; reload(); }
  function setAnimate(on) { st.animate = on; rerender(); }

  async function reload() {
    if (typeof vis === "undefined" || !vis.Network) {
      fatal("Graph library failed to load.<br>Check your network connection (the vis-network CDN is blocked).");
      return;
    }
    const limit = el(C.limit) ? el(C.limit).value : 30;
    let d;
    try {
      const r = await fetch(`/api/pol/relationships?party=${st.party}&limit=${limit}`);
      if (!r.ok) throw new Error("HTTP " + r.status);
      d = await r.json();
    } catch (err) {
      fatal(`Could not load relationship data (${err.message}).<br>If the server was already running, restart it.`);
      return;
    }
    st.raw = d;
    layout(d.nodes || [], d.edges || []);
    rerender();
  }

  // Radial concentric seed positions (also the frozen layout when animation is off).
  function layout(nodes, edges) {
    const byId = {}; nodes.forEach(n => byId[n.id] = n);
    const adj = {};
    edges.forEach(e => { (adj[e.from] = adj[e.from] || []).push(e.to);
                         (adj[e.to]   = adj[e.to]   || []).push(e.from); });
    const R1 = 330, STEP = 235, angle = {};
    const hub = nodes.find(n => n.ring === 0);
    if (hub) { hub.x = 0; hub.y = 0; }
    const ring1 = nodes.filter(n => n.ring === 1);
    ring1.forEach((n, i) => {
      const a = (i / Math.max(1, ring1.length)) * 2 * Math.PI - Math.PI / 2;
      angle[n.id] = a; n.x = Math.cos(a) * R1; n.y = Math.sin(a) * R1;
    });
    const maxRing = nodes.reduce((m, n) => Math.max(m, n.ring || 0), 0);
    for (let r = 2; r <= maxRing; r++) {
      const layer = nodes.filter(n => n.ring === r), groups = {};
      layer.forEach(n => {
        const parent = (adj[n.id] || []).map(id => byId[id])
          .find(p => p && p.ring === r - 1 && angle[p.id] !== undefined);
        (groups[parent ? parent.id : "_none"] = groups[parent ? parent.id : "_none"] || []).push(n);
      });
      const radius = R1 + (r - 1) * STEP;
      Object.entries(groups).forEach(([key, members], gi) => {
        const base = key === "_none"
          ? (gi / Math.max(1, Object.keys(groups).length)) * 2 * Math.PI : angle[key];
        members.forEach((n, i) => {
          const a = base + (members.length > 1 ? (i - (members.length - 1) / 2) * 0.30 : 0);
          angle[n.id] = a; n.x = Math.cos(a) * radius; n.y = Math.sin(a) * radius;
        });
      });
    }
  }

  function scaffoldEdges(nodes) {
    const ring1 = nodes.filter(n => n.ring === 1), out = [];
    for (let i = 0; i < ring1.length; i++)
      out.push({ from: ring1[i].id, to: ring1[(i + 1) % ring1.length].id, kind: "scaffold", label: "" });
    return out;
  }

  function toVisNode(n) {
    let color, shape = "dot";
    if (n.type === "hub")            { color = PG_PARTY_COLORS[n.party] || "#64748b"; shape = "star"; }
    else if (n.type === "executive") { color = "#f59e0b"; shape = "diamond"; }
    else if (n.type === "business")  { color = "#fb923c"; shape = "square"; }
    else                             { color = PG_PARTY_COLORS[n.party] || "#94a3b8"; }
    const title = n.type === "congress"
      ? `${n.name} · ${n.party || "?"}/${n.state || "?"}${n.chamber ? " · " + n.chamber : ""}`
      : n.role ? `${n.name} · ${n.role}` : n.name;
    // Hub is always pinned at centre. Other nodes are pinned only when frozen;
    // when animating they keep the radial seed but are free to move.
    const fixed = n.type === "hub" ? true : !st.animate;
    return {
      id: n.id, label: n.name, value: n.value || 1, x: n.x, y: n.y, fixed,
      shape, title,
      color: { background: color, border: "#0f172a", highlight: { background: color, border: "#e2e8f0" } },
      font: n.type === "hub" ? { size: 18, color: "#fff", strokeWidth: 4, strokeColor: "#0f172a" }
                             : { color: "#e2e8f0", size: 13, strokeWidth: 3, strokeColor: "#0f172a" },
    };
  }

  function toVisEdge(e) {
    const stl = PG_EDGE_STYLE[e.kind] || PG_EDGE_STYLE.other;
    const structural = e.kind === "hub" || e.kind === "scaffold";
    return {
      id: `${e.kind}|${e.from}|${e.to}|${e.label || ""}`,
      from: e.from, to: e.to, title: e.label || undefined,
      dashes: e.illustrative ? [4, 4] : stl.dashes,
      width: structural ? 1 : Math.min(8, 1 + (e.weight || 1)),
      color: { color: stl.color, opacity: e.illustrative ? 0.5 : (structural ? 0.5 : 0.9),
               highlight: stl.color, hover: stl.color },
      smooth: structural ? false : { type: "continuous" },
      selectionWidth: 2,
    };
  }

  function rerender() {
    const show = {
      curated:    el(C.checks.curated) ? el(C.checks.curated).checked : true,
      stock:      el(C.checks.stock) ? el(C.checks.stock).checked : true,
      cotrade:    el(C.checks.cotrade) ? el(C.checks.cotrade).checked : true,
      sector:     el(C.checks.sector) ? el(C.checks.sector).checked : false,
      committee:  el(C.checks.committee) ? el(C.checks.committee).checked : true,
      leadership: el(C.checks.leadership) ? el(C.checks.leadership).checked : true,
      state:      el(C.checks.state) ? el(C.checks.state).checked : true,
      structure:  true,
    };
    const nodes = st.raw.nodes || [];
    st.nodeMeta = {}; nodes.forEach(n => st.nodeMeta[n.id] = n);
    if (el(C.empty)) el(C.empty).style.display = nodes.length ? "none" : "flex";

    const allEdges = (st.raw.edges || []).concat(scaffoldEdges(nodes));
    const visEdges = allEdges.filter(e => show[pgEdgeGroup(e.kind)]).map(toVisEdge);
    const visNodes = nodes.map(toVisNode);

    const c = st.raw.counts || {};
    if (el(C.count)) el(C.count).textContent = nodes.length
      ? `${c.main || 0} main · ${c.connected || 0} connected · edges: ${c.curated || 0} curated, `
        + `${c.shared_stock || 0} stock, ${c.co_trade || 0} co-timed, ${c.shared_sector || 0} sector, `
        + `${c.shared_committee || 0} committee, ${c.committee_leadership || 0} leadership, ${c.same_state || 0} same-state`
      : "";

    const data = { nodes: new vis.DataSet(visNodes), edges: new vis.DataSet(visEdges) };
    const options = {
      interaction: { hover: true, tooltipDelay: 120, dragNodes: true, zoomView: true },
      nodes: { borderWidth: 2, scaling: { min: 10, max: 40 } },
      edges: { arrows: { to: false } },
      physics: st.animate ? {
        enabled: true, solver: "forceAtlas2Based",
        forceAtlas2Based: { gravitationalConstant: -55, centralGravity: 0.012,
                            springLength: 120, springConstant: 0.08, damping: 0.6, avoidOverlap: 0.35 },
        stabilization: { enabled: true, iterations: 120 }, minVelocity: 0.6,
      } : { enabled: false },
    };
    if (st.network) { st.network.setOptions(options); st.network.setData(data); }
    else {
      st.network = new vis.Network(el(C.container), data, options);
      st.network.on("click", params => {
        if (!params.nodes.length) return;
        const n = st.nodeMeta[params.nodes[0]];
        if (n && n.type === "congress") window.location = "/politician/" + params.nodes[0];
      });
      // Re-frame after each physics settle so the web stays in view.
      st.network.on("stabilizationIterationsDone", () => st.network.fit({ animation: false }));
    }
    // No stabilization event fires when physics is off, so fit directly.
    if (!st.animate) st.network.fit({ animation: false });
  }

  return { reload, switchParty, setAnimate, rerender, state: st };
}

// ── Trade timing ─────────────────────────────────────────────────────────────
// cfg = { canvas, summary, empty, range, input, quick, fixedTicker, rangeDays }
function createPolTiming(cfg) {
  const PRESETS = [{ l: "1Y", d: 365 }, { l: "3Y", d: 1095 }, { l: "5Y", d: 1825 }, { l: "All", d: 0 }];
  const st = { chart: null, rangeDays: cfg.rangeDays ?? 0, ticker: cfg.fixedTicker || null,
               custom: false, customStart: "", customEnd: "" };
  const el = id => (id ? document.getElementById(id) : null);
  const QUICK = ["NVDA", "AAPL", "MSFT", "TSLA", "AMZN"];

  function amtMid(t) { return t.amount_min == null ? 1000 : (t.amount_min + (t.amount_max ?? t.amount_min)) / 2; }
  function radius(a) { return a >= 5e6 ? 15 : a >= 1e6 ? 11 : a >= 250e3 ? 8 : a >= 50e3 ? 6 : 4; }
  function usd(a) { return a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(0)}K` : `$${a.toFixed(0)}`; }
  function lag(txn, disc) { return (!txn || !disc) ? null : Math.round((Date.parse(disc) - Date.parse(txn)) / 86400000); }

  function renderRange() {
    const c = el(cfg.range);
    if (!c) return;
    c.innerHTML =
      PRESETS.map(p => `<button class="pg-range-btn${!st.custom && st.rangeDays === p.d ? " active" : ""}" data-d="${p.d}">${p.l}</button>`).join("")
      + `<span style="width:1px;height:18px;background:var(--border);display:inline-block;vertical-align:middle;margin:0 4px"></span>`
      + `<input type="date" class="pg-d-start" style="padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg,#0b0f17);color:var(--text);font-size:12px" />`
      + `<span style="color:var(--muted);margin:0 3px">→</span>`
      + `<input type="date" class="pg-d-end" style="padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg,#0b0f17);color:var(--text);font-size:12px" />`
      + `<button class="btn btn-outline btn-sm pg-d-apply${st.custom ? " pg-range-active" : ""}" style="margin-left:4px">Apply</button>`;
    c.querySelectorAll(".pg-range-btn").forEach(b =>
      b.onclick = () => { st.custom = false; st.rangeDays = Number(b.dataset.d); renderRange(); load(); });
    const s = c.querySelector(".pg-d-start"), e = c.querySelector(".pg-d-end");
    if (st.customStart) s.value = st.customStart;
    if (st.customEnd)   e.value = st.customEnd;
    c.querySelector(".pg-d-apply").onclick = () => {
      if (!s.value || !e.value) { alert("Pick both a start and end date."); return; }
      st.custom = true; st.customStart = s.value; st.customEnd = e.value; renderRange(); load();
    };
  }
  function renderQuick() {
    if (!el(cfg.quick)) return;
    el(cfg.quick).innerHTML = QUICK.map(t =>
      `<button class="btn btn-outline btn-sm" style="padding:2px 8px;margin-right:4px" data-t="${t}">${t}</button>`).join("");
    el(cfg.quick).querySelectorAll("button").forEach(b =>
      b.onclick = () => { if (el(cfg.input)) el(cfg.input).value = b.dataset.t; load(b.dataset.t); });
  }

  async function load(tk) {
    if (tk !== undefined) st.ticker = (tk || "").toString().trim().toUpperCase();
    else if (el(cfg.input)) st.ticker = (el(cfg.input).value || "").trim().toUpperCase();
    const ticker = st.ticker;
    if (!ticker) return;

    const [pol, price] = await Promise.all([
      fetch(`/api/pol/ticker/${encodeURIComponent(ticker)}`).then(r => r.json()).catch(() => ({ trades: [] })),
      fetch(`/api/price/${encodeURIComponent(ticker)}?days=99999`).then(r => r.json()).catch(() => []),
    ]);

    // Resolve the active window: custom [start,end] takes precedence over presets.
    let lo = -Infinity, hi = Infinity;
    if (st.custom && st.customStart && st.customEnd) {
      lo = Date.parse(st.customStart);
      hi = Date.parse(st.customEnd) + 86400000;   // inclusive of the end day
      if (lo > hi) { const t = lo; lo = hi; hi = t; }
    } else if (st.rangeDays) {
      lo = Date.now() - st.rangeDays * 86400000;
    }
    const inWin = ms => ms >= lo && ms <= hi;
    let trades = (pol.trades || []).filter(t => t.transaction_date && inWin(Date.parse(t.transaction_date)));

    if (el(cfg.empty)) el(cfg.empty).style.display = trades.length ? "none" : "block";
    const members = new Set(trades.map(t => t.bioguide_id));
    const lags = trades.map(t => lag(t.transaction_date, t.disclosure_date)).filter(v => v != null);
    const avg = lags.length ? Math.round(lags.reduce((a, b) => a + b, 0) / lags.length) : null;
    if (el(cfg.summary)) el(cfg.summary).textContent = trades.length
      ? `${ticker}: ${trades.length} trades · ${members.size} members${avg != null ? ` · avg disclosure lag ${avg}d` : ""}`
      : `${ticker}: no congressional trades in range`;

    const pts = trades.map(t => {
      const buy = t.transaction_type === "purchase", a = amtMid(t);
      return { x: Date.parse(t.transaction_date), y: Math.max(1, a), rot: buy ? 0 : 180,
               r: radius(a), bg: PG_PARTY_COLORS[t.party] || "#94a3b8", _t: t, _buy: buy, _amt: a };
    });
    const priceData = (Array.isArray(price) ? price : [])
      .filter(p => p.close != null && inWin(Date.parse(p.date)))
      .map(p => ({ x: Date.parse(p.date), y: p.close }));

    const datasets = [{
      type: "scatter", label: "Trades", data: pts,
      pointStyle: "triangle", rotation: pts.map(p => p.rot),
      pointRadius: pts.map(p => p.r), pointHoverRadius: pts.map(p => p.r + 2),
      backgroundColor: pts.map(p => p.bg), borderColor: "#0f172a", borderWidth: 1,
      yAxisID: "yAmount", order: 1,
    }];
    if (priceData.length) datasets.push({
      type: "line", label: "Price", data: priceData, yAxisID: "yPrice",
      borderColor: "#64748b", borderWidth: 1.4, pointRadius: 0, fill: false, tension: 0.1, order: 2,
    });

    if (st.chart) st.chart.destroy();
    st.chart = new Chart(el(cfg.canvas), {
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: items => new Date(items[0].parsed.x).toISOString().slice(0, 10),
            label: ctx => {
              const t = ctx.raw._t;
              if (!t) return `Price $${ctx.parsed.y?.toFixed?.(2) ?? ""}`;
              return `${t.politician_name} (${t.party || "?"}) · ${ctx.raw._buy ? "BUY" : "SELL"} · ${usd(ctx.raw._amt)}`;
            },
            afterLabel: ctx => {
              const t = ctx.raw._t; if (!t) return "";
              const l = lag(t.transaction_date, t.disclosure_date);
              return l != null ? `disclosed ${l}d later` : "";
            },
          } },
        },
        scales: {
          x: { type: "linear", grid: { color: "rgba(148,163,184,.08)" },
               ticks: { maxTicksLimit: 9, callback: v => new Date(v).toISOString().slice(0, 7) } },
          yAmount: { type: "logarithmic", position: "left",
               title: { display: true, text: "Trade $ (log)", color: "#94a3b8" },
               ticks: { color: "#94a3b8", callback: v => usd(v) }, grid: { color: "rgba(148,163,184,.06)" } },
          yPrice: { type: "linear", position: "right", display: priceData.length > 0,
               title: { display: true, text: "Price", color: "#64748b" },
               ticks: { color: "#64748b" }, grid: { drawOnChartArea: false } },
        },
      },
    });
  }

  function init() {
    renderRange(); renderQuick();
    if (el(cfg.input)) el(cfg.input).addEventListener("keydown", e => { if (e.key === "Enter") load(); });
    if (st.ticker) load();
  }

  return { load, init, setRange: d => { st.rangeDays = d; renderRange(); load(); }, state: st };
}

// ── Shared markup + mount helpers (used by /relationships and /politicians) ──
function polNetworkMarkup() {
  return `
  <div style="display:flex;gap:8px;margin-bottom:14px;border-bottom:1px solid var(--border)">
    <button class="sub-tab pg-party-btn active" data-party="republican">🐘 Republican web</button>
    <button class="sub-tab pg-party-btn"        data-party="democrat">🫏 Democrat web</button>
  </div>
  <div class="filters" style="align-items:center;flex-wrap:wrap;gap:14px">
    <label style="font-size:12px;color:var(--muted)">Main nodes:
      <select id="pg-limit" style="font-size:12px">
        <option value="12">Top 12</option><option value="20">Top 20</option>
        <option value="30" selected>Top 30</option><option value="40">Top 40</option>
      </select></label>
    <label class="ek"><input type="checkbox" id="pg-animate" checked> Animate</label>
    <span style="width:1px;height:18px;background:var(--border)"></span>
    <label class="ek"><input type="checkbox" id="pg-ek-curated"    checked> Curated ties</label>
    <label class="ek"><input type="checkbox" id="pg-ek-stock"      checked> Shared stocks</label>
    <label class="ek"><input type="checkbox" id="pg-ek-cotrade"    checked> Co-timed trades</label>
    <label class="ek"><input type="checkbox" id="pg-ek-sector"            > Shared sectors</label>
    <label class="ek"><input type="checkbox" id="pg-ek-committee"  checked> Shared committees</label>
    <label class="ek"><input type="checkbox" id="pg-ek-leadership" checked> Committee leadership</label>
    <label class="ek"><input type="checkbox" id="pg-ek-state"      checked> Same state</label>
    <span id="pg-net-count" style="color:var(--muted);font-size:12px;margin-left:auto"></span>
  </div>
  <div id="pg-legend" class="card" style="margin:10px 0;padding:10px 14px;display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--muted)">
    <span><b style="color:var(--text)">Nodes:</b></span>
    <span><span class="dot" style="background:#ef4444"></span>Republican</span>
    <span><span class="dot" style="background:#3b82f6"></span>Democrat</span>
    <span><span class="dot" style="background:#94a3b8"></span>Independent/other</span>
    <span><span class="dot" style="background:#f59e0b;border-radius:2px;transform:rotate(45deg)"></span>Executive</span>
    <span><span class="dot" style="background:#fb923c;border-radius:2px"></span>Business</span>
    <span style="width:1px;height:16px;background:var(--border)"></span>
    <span><b style="color:var(--text)">Edges:</b></span>
    <span><span class="ln" style="background:#f59e0b"></span>Business deal</span>
    <span><span class="ln" style="background:#a855f7"></span>Appointment</span>
    <span><span class="ln" style="background:#14b8a6"></span>Former member</span>
    <span><span class="ln" style="background:#22c55e"></span>Shared stock</span>
    <span><span class="ln" style="background:#fb7185"></span>Co-timed trade</span>
    <span><span class="ln" style="background:#f97316"></span>Shared sector</span>
    <span><span class="ln" style="background:#60a5fa"></span>Shared committee</span>
    <span><span class="ln" style="background:#a3e635"></span>Committee leadership</span>
    <span><span class="ln" style="background:#06b6d4"></span>Same state</span>
  </div>
  <div class="card" style="padding:0;position:relative">
    <div id="pg-net" style="height:700px;border-radius:var(--radius)"></div>
    <div id="pg-net-empty" style="display:none;position:absolute;inset:0;align-items:center;justify-content:center"
         class="muted">No relationship data for this party.</div>
  </div>`;
}

function polTimingMarkup() {
  return `
  <p style="color:var(--muted);margin:0 0 12px;font-size:13px;max-width:880px">
    Pick a stock to see <strong>when</strong> members of Congress traded it. Each dot is one disclosed
    trade — ▲ purchase / ▼ sale — colored by party, sized by dollar amount, on its transaction date.
    Grey line = stock price. Use the range buttons to change the time scale.
  </p>
  <div class="filters" style="align-items:center;gap:10px;flex-wrap:wrap">
    <input type="text" id="pg-tk-input" placeholder="Ticker e.g. NVDA" maxlength="8"
           style="text-transform:uppercase;width:140px" />
    <button class="btn btn-outline btn-sm" id="pg-tk-load">Load</button>
    <span style="font-size:12px;color:var(--muted)">Quick:</span><span id="pg-tk-quick"></span>
    <span style="width:1px;height:18px;background:var(--border)"></span>
    <span style="font-size:12px;color:var(--muted)">Range:</span><span id="pg-tk-range"></span>
    <span id="pg-tk-summary" style="color:var(--muted);font-size:12px;margin-left:auto"></span>
  </div>
  <div class="card" style="margin:10px 0;padding:8px 14px;display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--muted)">
    <span><span class="dot" style="background:#ef4444"></span>Republican</span>
    <span><span class="dot" style="background:#3b82f6"></span>Democrat</span>
    <span><span class="dot" style="background:#94a3b8"></span>Independent/other</span>
    <span style="width:1px;height:14px;background:var(--border)"></span>
    <span>▲ purchase &nbsp; ▼ sale &nbsp; · &nbsp; dot size = $ amount</span>
    <span><span class="ln" style="background:#64748b"></span>Stock price</span>
  </div>
  <div class="card" style="position:relative">
    <div style="position:relative;height:460px"><canvas id="pg-timing-chart"></canvas></div>
    <div id="pg-timing-empty" class="muted" style="display:none;text-align:center;padding:20px">
      No congressional trades on record for this ticker.</div>
  </div>`;
}

function mountPolNetwork() {
  const net = createPolNetwork({ ids: {
    container: "pg-net", empty: "pg-net-empty", count: "pg-net-count",
    limit: "pg-limit", animate: "pg-animate",
    checks: { curated: "pg-ek-curated", stock: "pg-ek-stock", cotrade: "pg-ek-cotrade",
              sector: "pg-ek-sector", committee: "pg-ek-committee",
              leadership: "pg-ek-leadership", state: "pg-ek-state" },
  } });
  document.querySelectorAll(".pg-party-btn").forEach(b => b.onclick = () => {
    document.querySelectorAll(".pg-party-btn").forEach(x => x.classList.toggle("active", x === b));
    net.switchParty(b.dataset.party);
  });
  const lim = document.getElementById("pg-limit"); if (lim) lim.onchange = () => net.reload();
  ["curated", "stock", "cotrade", "sector", "committee", "leadership", "state"].forEach(k => {
    const c = document.getElementById("pg-ek-" + k); if (c) c.onchange = () => net.rerender();
  });
  const an = document.getElementById("pg-animate"); if (an) an.onchange = () => net.setAnimate(an.checked);
  net.reload();
  return net;
}

function mountPolTiming(opts) {
  const t = createPolTiming({
    canvas: "pg-timing-chart", summary: "pg-tk-summary", empty: "pg-timing-empty",
    range: "pg-tk-range", input: "pg-tk-input", quick: "pg-tk-quick",
    fixedTicker: (opts && opts.ticker) || "NVDA",
  });
  const inp = document.getElementById("pg-tk-input"); if (inp) inp.value = (opts && opts.ticker) || "NVDA";
  const ld = document.getElementById("pg-tk-load"); if (ld) ld.onclick = () => t.load();
  t.init();
  return t;
}
