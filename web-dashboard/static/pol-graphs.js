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
// Edge-type filters. Each carries the colour its edges are drawn in, so the
// toggle lights up in the same colour as the connections it controls and greys
// out when they're hidden. "curated" covers several hand-entered kinds; it
// takes the business-deal amber since that's the bulk of them.
const PG_EDGE_TOGGLES = [
  { k: "curated",    label: "Curated ties",         color: "#f59e0b", on: true  },
  { k: "cotrade",    label: "Co-timed trades",      color: "#fb7185", on: true  },
  { k: "committee",  label: "Shared committees",    color: "#60a5fa", on: true  },
  { k: "leadership", label: "Committee leadership", color: "#a3e635", on: true  },
  { k: "stock",      label: "Shared stocks",        color: "#22c55e", on: false },
  { k: "sector",     label: "Shared sectors",       color: "#f97316", on: false },
  { k: "state",      label: "Same state",           color: "#06b6d4", on: false },
];
function pgRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

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
// cfg.ids = { container, empty, count, limit, checks:{<PG_EDGE_TOGGLES key>: elementId} }
// checks is optional; it defaults to the ids polNetworkMarkup() emits.
function createPolNetwork(cfg) {
  const C = cfg.ids;
  const CHECKS = C.checks || Object.fromEntries(PG_EDGE_TOGGLES.map(t => [t.k, "pg-ek-" + t.k]));
  // settled: physics runs once to unpack the radial seed into a readable web,
  // then switches off for good. After that the graph is purely manual — drag a
  // node and it stays put, because nothing is left to push it around.
  const st = { party: "republican", raw: { nodes: [], edges: [] },
               network: null, ds: null, nodeMeta: {}, settled: false };
  const el = id => (id ? document.getElementById(id) : null);
  const isOn = k => { const b = el(CHECKS[k]); return b ? b.classList.contains("active") : false; };

  function fatal(msg) {
    const c = el(C.container);
    if (c) c.innerHTML = `<div style="display:flex;height:100%;align-items:center;justify-content:center;
      text-align:center;padding:24px;color:var(--muted)">${msg}</div>`;
  }

  function switchParty(p) { st.party = p; reload(); }

  // Throw away hand-placed positions, re-seed radially and let physics settle
  // once more. The only way back to a tidy layout after dragging things around.
  function relayout() {
    st.settled = false;
    layout(st.raw.nodes || [], st.raw.edges || []);
    rerender(true);
  }

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
    st.settled = false;              // new data gets a fresh settle
    layout(d.nodes || [], d.edges || []);
    rerender(true);
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
    // The hub anchors the web while physics settles. Once settled nothing is
    // pinned, so every node can be dragged and stays where it's dropped.
    const fixed = n.type === "hub" && !st.settled;
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

  function rerender(resetPositions) {
    const show = { structure: true };
    PG_EDGE_TOGGLES.forEach(t => { show[t.k] = isOn(t.k); });
    const nodes = st.raw.nodes || [];
    st.nodeMeta = {}; nodes.forEach(n => st.nodeMeta[n.id] = n);
    if (el(C.empty)) el(C.empty).style.display = nodes.length ? "none" : "flex";

    const allEdges = (st.raw.edges || []).concat(scaffoldEdges(nodes));
    const visEdges = allEdges.filter(e => show[pgEdgeGroup(e.kind)]).map(toVisEdge);
    // Carry over wherever the nodes currently sit, so flipping an edge filter
    // doesn't yank everything back to the radial seed and undo the user's drags.
    const pos = (st.network && !resetPositions) ? st.network.getPositions() : {};
    const visNodes = nodes.map(n => {
      const v = toVisNode(n), p = pos[n.id];
      if (p) { v.x = p.x; v.y = p.y; }
      return v;
    });

    const c = st.raw.counts || {};
    if (el(C.count)) el(C.count).textContent = nodes.length
      ? `${c.main || 0} main · ${c.connected || 0} connected · edges: ${c.curated || 0} curated, `
        + `${c.shared_stock || 0} stock, ${c.co_trade || 0} co-timed, ${c.shared_sector || 0} sector, `
        + `${c.shared_committee || 0} committee, ${c.committee_leadership || 0} leadership, ${c.same_state || 0} same-state`
      : "";

    const data = { nodes: new vis.DataSet(visNodes), edges: new vis.DataSet(visEdges) };
    st.ds = data;                    // keep the handles; avoids reaching into network internals
    const options = {
      interaction: { hover: true, tooltipDelay: 120, dragNodes: true,
                     zoomView: true, dragView: true },
      nodes: { borderWidth: 2, scaling: { min: 10, max: 40 } },
      edges: { arrows: { to: false } },
      // Run only until the layout unpacks, then stop for good — see the
      // stabilizationIterationsDone handler below.
      physics: st.settled ? { enabled: false } : {
        enabled: true, solver: "forceAtlas2Based",
        forceAtlas2Based: { gravitationalConstant: -55, centralGravity: 0.012,
                            springLength: 120, springConstant: 0.08, damping: 0.6, avoidOverlap: 0.35 },
        stabilization: { enabled: true, iterations: 200 }, minVelocity: 0.75,
      },
    };
    if (st.network) { st.network.setOptions(options); st.network.setData(data); }
    else {
      st.network = new vis.Network(el(C.container), data, options);
      st.network.on("click", params => {
        if (!params.nodes.length) return;
        const n = st.nodeMeta[params.nodes[0]];
        if (n && n.type === "congress") window.location = "/politician/" + params.nodes[0];
      });
      // Freeze as soon as the layout stops moving: kill physics, unpin the hub
      // so it's draggable too, and reframe. From here the graph only moves when
      // the user moves it.
      st.network.on("stabilizationIterationsDone", () => {
        st.settled = true;
        st.network.setOptions({ physics: { enabled: false } });
        const hub = (st.raw.nodes || []).find(n => n.type === "hub");
        if (hub && st.ds) st.ds.nodes.update({ id: hub.id, fixed: false });
        st.network.fit({ animation: false });
      });
    }
    // Physics off means no stabilization event, so reframe directly.
    if (st.settled) st.network.fit({ animation: false });
  }

  return { reload, switchParty, relayout, rerender, state: st };
}

// ── Trade timing ─────────────────────────────────────────────────────────────
// cfg = { canvas, summary, empty, range, input, quick, fixedTicker, rangeDays }
function createPolTiming(cfg) {
  const PRESETS = [{ l: "1Y", d: 365 }, { l: "3Y", d: 1095 }, { l: "5Y", d: 1825 }, { l: "All", d: 0 }];
  const st = { chart: null, rangeDays: cfg.rangeDays ?? 0, ticker: cfg.fixedTicker || null,
               custom: false, customStart: "", customEnd: "", mode: cfg.mode0 || "dots",
               seq: 0 };   // bumped per load() so a slow phase-2 can't overwrite a newer chart
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
    const seq = ++st.seq;

    const [pol, price] = await Promise.all([
      fetch(`/api/pol/ticker/${encodeURIComponent(ticker)}`).then(r => r.json()).catch(() => ({ trades: [] })),
      fetch(`/api/price/${encodeURIComponent(ticker)}?days=99999`).then(r => r.json()).catch(() => []),
    ]);
    if (seq !== st.seq) return;   // a newer load() started while we waited

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

    const toPts = arr => (Array.isArray(arr) ? arr : [])
      .filter(p => p.close != null && inWin(Date.parse(p.date)))
      .map(p => ({ x: Date.parse(p.date), y: p.close }));

    // Phase 1 — paint straight from the shipped DB snapshot, no waiting.
    const shallow = toPts(price);
    draw(trades, shallow);

    // Phase 2 — the snapshot only reaches back ~1yr but trades run to 2012, so
    // dots can sit over blank chart. If the price line doesn't cover the oldest
    // trade on screen, ask the server to fill the gap: it serves the DB where it
    // can and fetches only the missing deep tail (cached + guarded server-side).
    const oldestTrade = trades.reduce((m, t) => {
      const ms = Date.parse(t.transaction_date);
      return (m === null || ms < m) ? ms : m;
    }, null);
    if (oldestTrade === null) return;
    const havePrice = (Array.isArray(price) ? price : []).reduce((m, p) => {
      const ms = Date.parse(p.date);
      return (m === null || ms < m) ? ms : m;
    }, null);
    if (havePrice !== null && havePrice <= oldestTrade) return;   // already covered

    const since = new Date(oldestTrade).toISOString().slice(0, 10);
    const deep = await fetch(
      `/api/price/${encodeURIComponent(ticker)}?since=${since}&allow_live=1`
    ).then(r => r.json()).catch(() => null);
    if (seq !== st.seq || !Array.isArray(deep)) return;   // superseded, or failed
    const deepPts = toPts(deep);
    if (deepPts.length > shallow.length) draw(trades, deepPts);
  }

  function draw(trades, priceData) {
    let datasets, scales, tooltip, legend;
    if (st.mode === "hist") {
      // Monthly bins of trade COUNT, split purchases/sales — shows "piling in".
      const bins = {};
      trades.forEach(t => {
        const d = new Date(t.transaction_date);
        const key = d.getUTCFullYear() + "-" + d.getUTCMonth();
        const b = bins[key] || (bins[key] = { ms: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15), buy: 0, sell: 0, vol: 0 });
        if (t.transaction_type === "purchase") b.buy++; else b.sell++;
        b.vol += amtMid(t);
      });
      const arr = Object.values(bins).sort((a, b) => a.ms - b.ms);
      const bw = Math.max(3, Math.min(18, Math.round(720 / Math.max(1, arr.length))));
      datasets = [
        { type: "bar", label: "Purchases", yAxisID: "yCount", stack: "v", order: 2, barThickness: bw,
          data: arr.map(b => ({ x: b.ms, y: b.buy, _b: b })), backgroundColor: "rgba(34,197,94,.78)", borderWidth: 0 },
        { type: "bar", label: "Sales", yAxisID: "yCount", stack: "v", order: 2, barThickness: bw,
          data: arr.map(b => ({ x: b.ms, y: b.sell, _b: b })), backgroundColor: "rgba(239,68,68,.78)", borderWidth: 0 },
      ];
      if (priceData.length) datasets.push({ type: "line", label: "Price", data: priceData, yAxisID: "yPrice",
        borderColor: "#64748b", borderWidth: 1.4, pointRadius: 0, fill: false, tension: 0.1, order: 1 });
      scales = {
        x: { type: "linear", stacked: true, grid: { color: "rgba(148,163,184,.08)" },
             ticks: { maxTicksLimit: 9, callback: v => new Date(v).toISOString().slice(0, 7) } },
        yCount: { type: "linear", position: "left", beginAtZero: true, stacked: true,
             title: { display: true, text: "# trades / month", color: "#94a3b8" },
             ticks: { color: "#94a3b8", precision: 0 }, grid: { color: "rgba(148,163,184,.06)" } },
        yPrice: { type: "linear", position: "right", display: priceData.length > 0,
             title: { display: true, text: "Price", color: "#64748b" },
             ticks: { color: "#64748b" }, grid: { drawOnChartArea: false } },
      };
      legend = { display: true, labels: { color: "#94a3b8", boxWidth: 12 } };
      tooltip = { callbacks: {
        title: items => new Date(items[0].parsed.x).toISOString().slice(0, 7),
        label: ctx => ctx.raw._b ? `${ctx.dataset.label}: ${ctx.parsed.y}` : `Price $${ctx.parsed.y?.toFixed?.(2) ?? ""}`,
        afterBody: items => {
          const b = items.find(i => i.raw && i.raw._b);
          return b ? `month: ${b.raw._b.buy + b.raw._b.sell} trades · ${usd(b.raw._b.vol)}` : "";
        },
      } };
    } else {
      const pts = trades.map(t => {
        const buy = t.transaction_type === "purchase", a = amtMid(t);
        return { x: Date.parse(t.transaction_date), y: Math.max(1, a), rot: buy ? 0 : 180,
                 r: radius(a), bg: PG_PARTY_COLORS[t.party] || "#94a3b8", _t: t, _buy: buy, _amt: a };
      });
      datasets = [{
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
      scales = {
        x: { type: "linear", grid: { color: "rgba(148,163,184,.08)" },
             ticks: { maxTicksLimit: 9, callback: v => new Date(v).toISOString().slice(0, 7) } },
        yAmount: { type: "logarithmic", position: "left",
             title: { display: true, text: "Trade $ (log)", color: "#94a3b8" },
             ticks: { color: "#94a3b8", callback: v => usd(v) }, grid: { color: "rgba(148,163,184,.06)" } },
        yPrice: { type: "linear", position: "right", display: priceData.length > 0,
             title: { display: true, text: "Price", color: "#64748b" },
             ticks: { color: "#64748b" }, grid: { drawOnChartArea: false } },
      };
      legend = { display: false };
      tooltip = { callbacks: {
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
      } };
    }

    if (st.chart) st.chart.destroy();
    st.chart = new Chart(el(cfg.canvas), {
      data: { datasets },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend, tooltip }, scales },
    });
  }

  function renderMode() {
    const c = el(cfg.mode);
    if (!c) return;
    c.innerHTML = [["dots", "● Dots"], ["hist", "▮ Histogram"]].map(([m, lab]) =>
      `<button class="pg-range-btn${st.mode === m ? " active" : ""}" data-m="${m}">${lab}</button>`).join("");
    c.querySelectorAll(".pg-range-btn").forEach(b =>
      b.onclick = () => { st.mode = b.dataset.m; renderMode(); load(); });
  }

  function init() {
    renderMode(); renderRange(); renderQuick();
    if (el(cfg.input)) el(cfg.input).addEventListener("keydown", e => { if (e.key === "Enter") load(); });
    if (st.ticker) load();
  }

  return { load, init, setRange: d => { st.rangeDays = d; renderRange(); load(); }, state: st };
}

// ── Shared markup + mount helpers (used by /relationships and /politicians) ──
function polNetworkMarkup() {
  return `
  <style>
  /* Edge-type toggles. Each button carries --ek (the colour its edges are drawn
     in) so it lights up in that colour when on and greys out when off. */
  .pg-ek { padding:4px 11px; border:1px solid var(--border); border-radius:999px;
    background:transparent; color:var(--muted); cursor:pointer; font-size:12px;
    line-height:1.6; font-family:inherit; opacity:.6;
    transition:color .12s, border-color .12s, background .12s, opacity .12s; }
  .pg-ek:hover { opacity:1; color:var(--ek); border-color:var(--ek); }
  .pg-ek.active { opacity:1; color:var(--ek); border-color:var(--ek); background:var(--ek-bg); }
  .pg-ek:focus-visible { outline:2px solid var(--ek); outline-offset:2px; }
  #pg-net { cursor:grab; }
  #pg-net:active { cursor:grabbing; }
  </style>
  <div style="display:flex;gap:8px;margin-bottom:14px;border-bottom:1px solid var(--border)">
    <button class="sub-tab pg-party-btn active" data-party="republican">🐘 Republican web</button>
    <button class="sub-tab pg-party-btn"        data-party="democrat">🫏 Democrat web</button>
  </div>
  <div class="filters" style="align-items:center;flex-wrap:wrap;gap:8px">
    <label style="font-size:12px;color:var(--muted);margin-right:4px">Main nodes:
      <select id="pg-limit" style="font-size:12px">
        <option value="12">Top 12</option><option value="20">Top 20</option>
        <option value="30" selected>Top 30</option><option value="40">Top 40</option>
      </select></label>
    <button class="pg-range-btn" id="pg-relayout"
            title="Re-seed the layout and let it settle again">↻ Re-layout</button>
    <span style="width:1px;height:18px;background:var(--border);margin:0 2px"></span>
    ${PG_EDGE_TOGGLES.map(t =>
      `<button class="pg-ek${t.on ? " active" : ""}" id="pg-ek-${t.k}"
               style="--ek:${t.color};--ek-bg:${pgRgba(t.color, 0.14)}"
               aria-pressed="${t.on}">${t.label}</button>`).join("")}
    <span id="pg-net-count" style="color:var(--muted);font-size:12px;margin-left:auto"></span>
  </div>
  <p style="color:var(--muted);font-size:12px;margin:8px 0 0">
    Drag any node to reposition it — it stays where you drop it. Scroll to zoom,
    drag the background to pan.</p>
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
    <span style="font-size:12px;color:var(--muted)">View:</span><span id="pg-tk-mode"></span>
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
    container: "pg-net", empty: "pg-net-empty", count: "pg-net-count", limit: "pg-limit",
    checks: Object.fromEntries(PG_EDGE_TOGGLES.map(t => [t.k, "pg-ek-" + t.k])),
  } });
  document.querySelectorAll(".pg-party-btn").forEach(b => b.onclick = () => {
    document.querySelectorAll(".pg-party-btn").forEach(x => x.classList.toggle("active", x === b));
    net.switchParty(b.dataset.party);
  });
  const lim = document.getElementById("pg-limit"); if (lim) lim.onchange = () => net.reload();
  PG_EDGE_TOGGLES.forEach(t => {
    const b = document.getElementById("pg-ek-" + t.k);
    if (!b) return;
    b.onclick = () => {
      const on = !b.classList.contains("active");
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
      net.rerender();          // keeps current node positions
    };
  });
  const rl = document.getElementById("pg-relayout"); if (rl) rl.onclick = () => net.relayout();
  net.reload();
  return net;
}

function mountPolTiming(opts) {
  const t = createPolTiming({
    canvas: "pg-timing-chart", summary: "pg-tk-summary", empty: "pg-timing-empty",
    range: "pg-tk-range", mode: "pg-tk-mode", input: "pg-tk-input", quick: "pg-tk-quick",
    fixedTicker: (opts && opts.ticker) || "NVDA",
  });
  const inp = document.getElementById("pg-tk-input"); if (inp) inp.value = (opts && opts.ticker) || "NVDA";
  const ld = document.getElementById("pg-tk-load"); if (ld) ld.onclick = () => t.load();
  t.init();
  return t;
}
