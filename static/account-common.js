// Shared username identity (no auth) + small account API helpers.
function getUser() { return localStorage.getItem("stockapp_user") || ""; }
function setUser(u) { localStorage.setItem("stockapp_user", (u || "").trim()); }

async function favToggle(ticker, kind) {
  const u = getUser();
  if (!u) { alert("Set a username on the Portfolio page first."); return null; }
  const r = await fetch(`/api/account/favorite?user=${encodeURIComponent(u)}&ticker=${encodeURIComponent(ticker)}&kind=${kind}`,
    { method: "POST" }).then(r => r.json()).catch(() => null);
  return r;  // {ticker, favorited}
}

async function favSet() {
  const u = getUser();
  if (!u) return new Set();
  const d = await fetch(`/api/account/favorites?user=${encodeURIComponent(u)}`).then(r => r.json()).catch(() => null);
  return new Set((d && d.favorites || []).map(f => f.ticker));
}

async function addTrade({ ticker, kind, side, shares, price, date, note }) {
  const u = getUser();
  if (!u) { alert("Set a username on the Portfolio page first."); return null; }
  const p = new URLSearchParams({ user: u, ticker, kind, side, shares, price });
  if (date) p.set("date", date);
  if (note) p.set("note", note);
  return fetch(`/api/account/trade?${p}`, { method: "POST" }).then(r => r.json()).catch(() => null);
}
