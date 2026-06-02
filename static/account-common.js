// Shared auth identity (session token) + small account API helpers.
function getToken() { return localStorage.getItem("stockapp_token") || ""; }
function setAuth(token, email) {
  localStorage.setItem("stockapp_token", token || "");
  if (email) localStorage.setItem("stockapp_email", email);
}
function clearAuth() {
  localStorage.removeItem("stockapp_token");
  localStorage.removeItem("stockapp_email");
}
function getEmail() { return localStorage.getItem("stockapp_email") || ""; }
function isAuthed() { return !!getToken(); }

function _tok(extra) {
  const p = new URLSearchParams(extra || {});
  p.set("token", getToken());
  return p;
}

async function favToggle(ticker, kind) {
  if (!isAuthed()) { alert("Sign in on the Portfolio page first."); return null; }
  const p = _tok({ ticker, kind });
  return fetch(`/api/account/favorite?${p}`, { method: "POST" }).then(r => r.json()).catch(() => null);
}

async function favSet() {
  if (!isAuthed()) return new Set();
  const d = await fetch(`/api/account/favorites?${_tok()}`).then(r => r.json()).catch(() => null);
  return new Set((d && d.favorites || []).map(f => f.ticker));
}

async function addTrade({ ticker, kind, side, shares, price, date, note }) {
  if (!isAuthed()) { alert("Sign in on the Portfolio page first."); return null; }
  const p = _tok({ ticker, kind, side, shares, price });
  if (date) p.set("date", date);
  if (note) p.set("note", note);
  return fetch(`/api/account/trade?${p}`, { method: "POST" }).then(r => r.json()).catch(() => null);
}
