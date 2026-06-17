// Shared news-summary widget: positive/negative/neutral counts + a sentiment
// bar + the top 5 "movers" (strongest |sentiment|). Used on stock detail,
// ETF detail, and the News Feed.
function _nsLabel(s) { return s > 0.05 ? "Positive" : s < -0.05 ? "Negative" : "Neutral"; }
function _nsColor(s) { return s > 0.05 ? "#22c55e" : s < -0.05 ? "#ef4444" : "#94a3b8"; }

// Source trustworthiness (predictive track record), red(0) -> green(1).
function _trustColor(t) { return `hsl(${Math.round(Math.max(0, Math.min(1, t)) * 120)}, 65%, 42%)`; }
function trustHtml(t) {
  if (t == null) return `<div class="muted" style="font-size:10px;margin-top:2px">source: unrated</div>`;
  const c = _trustColor(t), pct = Math.round(t * 100);
  return `<div title="Source predictive track record (sentiment vs forward price move)" style="display:flex;align-items:center;gap:5px;margin-top:3px">
      <div style="width:42px;height:5px;border-radius:3px;background:var(--border);overflow:hidden">
        <div style="width:${pct}%;height:5px;background:${c}"></div></div>
      <span style="font-size:10px;font-weight:700;color:${c}">${pct}%</span></div>`;
}

function newsSummaryHTML(articles) {
  if (!articles || !articles.length) return "";
  let pos = 0, neg = 0, neu = 0;
  for (const a of articles) {
    const s = a.sentiment || 0;
    if (s > 0.05) pos++; else if (s < -0.05) neg++; else neu++;
  }
  const tot = articles.length;
  const pct = n => (n / tot * 100).toFixed(1);
  const top = articles
    .filter(a => a.title && Math.abs(a.sentiment || 0) > 0.05)
    .sort((x, y) => Math.abs(y.sentiment || 0) - Math.abs(x.sentiment || 0))
    .slice(0, 5);

  const counts = `<div style="font-size:13px">
      <span style="color:#22c55e;font-weight:700">${pos}</span> positive ·
      <span style="color:#94a3b8;font-weight:700">${neu}</span> neutral ·
      <span style="color:#ef4444;font-weight:700">${neg}</span> negative
      <span class="muted">of ${tot}</span></div>`;
  const bar = `<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;margin:8px 0;background:var(--border)">
      <div style="width:${pct(pos)}%;background:#22c55e"></div>
      <div style="width:${pct(neu)}%;background:#94a3b8"></div>
      <div style="width:${pct(neg)}%;background:#ef4444"></div></div>`;
  const topHTML = top.length ? `
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:8px 0 4px">Top movers (strongest sentiment)</div>
      ${top.map(a => `
        <div style="font-size:12.5px;padding:3px 0;line-height:1.4">
          <span style="color:${_nsColor(a.sentiment)};font-weight:600">${_nsLabel(a.sentiment)}</span>
          <a href="${a.url}" target="_blank" rel="noopener" style="color:var(--text);margin-left:6px">${(a.title || "").slice(0, 100)}</a>
          ${a.publisher ? `<span class="muted" style="font-size:11px"> · ${a.publisher}</span>` : ""}
          ${trustHtml(a.source_trust)}
        </div>`).join("")}` : "";

  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px">
      ${counts}${bar}${topHTML}</div>`;
}

function renderNewsSummary(el, articles) {
  if (el) el.innerHTML = newsSummaryHTML(articles);
}
