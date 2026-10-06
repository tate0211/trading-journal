// Live prices for open trades (Twelve Data: US stocks, forex, gold). Shows unrealised R and $ for each open
// position, where price sits between stop and target, and flags when a stop or target has been reached.
// Free plan: 8 requests/min and 800/day, so prices refresh every 3 minutes while the dashboard is open.
const Live = (() => {
  const API = 'https://api.twelvedata.com/price';
  const REFRESH = 3 * 60 * 1000;
  const FRESH = 10 * 60 * 1000; // prices older than this aren't shown in the trades list
  const INDEX_SYMBOLS = { NAS100: 'NDX', US100: 'NDX', USTEC: 'NDX', US30: 'DJI', DJ30: 'DJI', SPX500: 'SPX', US500: 'SPX', GER40: 'DAX', DE40: 'DAX' };
  const prices = {}; // symbol -> { price, at }
  let timer = null, lastError = null, lastAt = null;

  // The Twelve Data symbol for a trade (forex "EUR/USD", gold "XAU/USD", stocks and options use the ticker / underlying).
  function symbolFor(t) {
    const s = (t.instrument || '').toUpperCase().replace(/[^A-Z0-9.]/g, '');
    if (!s) return null;
    if (t.market === 'Forex') return s.length >= 6 ? `${s.slice(0, 3)}/${s.slice(3, 6)}` : null;
    if (t.market === 'Indices/Futures') return INDEX_SYMBOLS[s] || s;
    return s;
  }

  // Twelve Data's own messages are long and technical; say plainly what to do.
  const friendly = (msg = '') => (/apikey/i.test(msg)
    ? "Twelve Data didn't accept your key. In Settings → Live prices, paste it again using the copy button on twelvedata.com → Dashboard → API Keys."
    : /run out of API credits|limit/i.test(msg) ? 'Free-plan limit reached for now. Prices will update again in a minute (or tomorrow if the daily 800 are used up).'
    : msg);

  async function fetchOne(sym, key) {
    try {
      const data = await (await fetch(`${API}?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(key)}`)).json();
      if (data.price) prices[sym] = { price: parseFloat(data.price), at: Date.now() };
      else lastError = /apikey/i.test(data.message) ? friendly(data.message) : `${sym}: ${friendly(data.message) || 'no price available'}`;
    } catch { lastError = "Couldn't reach Twelve Data. Are you online?"; }
  }

  async function refresh(trades) {
    const key = S.tdKey;
    if (!key) return;
    const symbols = [...new Set(trades.map(symbolFor).filter(Boolean))];
    lastError = null;
    for (let i = 0; i < symbols.length; i += 8) { // at most 8 symbols per request (free-plan rate limit)
      const batch = symbols.slice(i, i + 8);
      try {
        const res = await fetch(`${API}?symbol=${encodeURIComponent(batch.join(','))}&apikey=${encodeURIComponent(key)}`);
        const data = await res.json();
        if (data.status === 'error' && !data.price) {
          // One unknown symbol can fail the whole request; try each on its own so the rest still show.
          if (batch.length > 1) { for (const sym of batch) await fetchOne(sym, key); continue; }
          lastError = friendly(data.message) || 'Twelve Data returned an error.'; continue;
        }
        const map = batch.length === 1 ? { [batch[0]]: data } : data;
        for (const sym of batch) {
          const row = map[sym];
          if (row && row.price) prices[sym] = { price: parseFloat(row.price), at: Date.now() };
          else if (row?.message && !lastError) lastError = /apikey/i.test(row.message) ? friendly(row.message) : `${sym}: ${friendly(row.message)}`;
        }
      } catch { lastError = "Couldn't reach Twelve Data. Are you online?"; }
    }
    lastAt = new Date();
  }

  // Unrealised result for one open trade at the current price.
  function position(t) {
    const sym = symbolFor(t), p = prices[sym]?.price;
    const out = { sym, price: p ?? null, at: prices[sym]?.at };
    const e = num(t.entry), s = num(t.stop), tp = num(t.target);
    if (p == null || t.market === 'Options' || isDollar(t) || e === null) return out; // option premiums / $-mode can't be priced from the underlying
    const dir = t.direction === 'Short' ? -1 : 1, move = (p - e) * dir;
    out.r = s !== null && s !== e ? move / Math.abs(e - s) : null;
    const qty = parseFloat(t.size);
    if (qty) {
      if (t.market === 'Stocks') out.usd = move * qty;
      else if (t.market === 'Forex' && sym) {
        const units = qty * (sym.startsWith('XAU') ? 100 : 100000); // lots → ounces (gold) or units
        if (sym.endsWith('/USD')) out.usd = move * units;
        else if (sym.startsWith('USD/')) out.usd = (move * units) / p;
      }
    }
    if (s !== null && tp !== null && tp !== s) out.progress = Math.min(1, Math.max(0, (p - s) / (tp - s)));
    if (tp !== null && dir * (p - tp) >= 0) out.hit = 'target';
    else if (s !== null && dir * (p - s) <= 0) out.hit = 'stop';
    return out;
  }

  // Live R for the trades list, only if the price is recent.
  function peek(t) {
    const pos = position(t);
    return pos.at && Date.now() - pos.at < FRESH ? pos : null;
  }

  const money = (v) => (v == null ? '' : fmtMoney(v));
  function row(t) {
    const pos = position(t);
    const dp = pos.price == null ? '—' : pos.price.toLocaleString(undefined, { maximumFractionDigits: pos.price < 10 ? 5 : 2 });
    return `<div class="live-row ${pos.r > 0 ? 'up' : pos.r < 0 ? 'down' : ''}" data-trade="${t.id}">
      <div class="live-top">
        <div><b>${esc(t.instrument)}</b> <span class="dir ${t.direction === 'Short' ? 'short' : 'long'}">${esc(t.direction)}</span>
          <span class="muted" style="font-size:12px">${t.size ? esc(t.size) + (t.market === 'Stocks' ? ' sh' : t.market === 'Forex' ? ' lots' : '') : ''}</span></div>
        <div class="live-nums"><span class="live-price">${dp}</span>
          ${pos.r != null ? `<span class="${cls(pos.r)}">${fmtR(pos.r)}</span>` : ''}
          ${pos.usd != null ? `<span class="${cls(pos.usd)}">${money(pos.usd)}</span>` : ''}</div>
      </div>
      ${pos.progress != null ? `<div class="live-bar" title="Where price is between your stop and target">
        <span class="lb-stop">Stop ${esc(t.stop)}</span>
        <div class="lb-track"><div class="lb-entry" style="left:${Math.min(100, Math.max(0, ((num(t.entry) - num(t.stop)) / (num(t.target) - num(t.stop))) * 100))}%"></div><div class="lb-dot" style="left:${pos.progress * 100}%"></div></div>
        <span class="lb-target">Target ${esc(t.target)}</span></div>` : ''}
      ${pos.price == null ? `<div class="muted" style="font-size:12px;margin-top:4px">Entry ${esc(t.entry ?? '—')} · Stop ${esc(t.stop ?? '—')} · Target ${esc(t.target ?? '—')} · opened ${fmtDate(t.date)}</div>` : ''}
      ${pos.hit === 'target' ? '<div class="live-alert good">🎯 Price has reached your target. Close the trade in your broker, then here.</div>'
        : pos.hit === 'stop' ? '<div class="live-alert bad">⚠ Price is at or past your stop. Check your broker and close the trade here.</div>' : ''}
      ${t.market === 'Options' ? '<div class="muted" style="font-size:12px">Underlying price. Option P&amp;L depends on the premium, so it isn\'t estimated.</div>' : ''}
      ${isDollar(t) ? '<div class="muted" style="font-size:12px">Logged in dollar amounts; add the entry price to see live R.</div>' : ''}
    </div>`;
  }

  function renderCard(el, trades) {
    if (!el) return;
    if (!trades.length) { el.innerHTML = ''; return; }
    if (!S.tdKey) {
      // No key yet: still list every open position, and explain how to get live prices.
      el.innerHTML = `<div class="card live-card"><h2 style="margin:0">Open positions (${trades.length})</h2>
        <div class="live-list">${trades.map(row).join('')}</div>
        <div class="notice" style="margin-top:10px">To see whether these are winning or losing right now, add a free Twelve Data key in <a href="#settings">Settings → Live prices</a>.</div></div>`;
      el.querySelectorAll('[data-trade]').forEach((r) => (r.onclick = () => go('trade', r.dataset.trade)));
      return;
    }
    const all = trades.map(position);
    const totR = all.reduce((a, p) => a + (p.r || 0), 0), anyR = all.some((p) => p.r != null);
    const totUsd = all.reduce((a, p) => a + (p.usd || 0), 0), anyUsd = all.some((p) => p.usd != null);
    el.innerHTML = `<div class="card live-card">
      <div class="row between"><h2 style="margin:0">Live open positions</h2>
        <div class="row" style="gap:10px">${anyR ? `<b class="${cls(totR)}">${fmtR(totR)}</b>` : ''}${anyUsd ? `<b class="${cls(totUsd)}">${money(totUsd)}</b>` : ''}</div></div>
      <div class="live-list">${trades.map(row).join('')}</div>
      <div class="row between" style="margin-top:10px"><span class="muted" style="font-size:12px">${lastAt ? `Updated ${lastAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · refreshes every 3 min` : 'Loading prices…'} · Twelve Data</span>
        <button class="btn small" data-live-refresh>Refresh</button></div>
      ${lastError ? `<div class="notice neg" style="margin-top:8px">${esc(lastError)}</div>` : ''}
    </div>`;
    el.querySelector('[data-live-refresh]').onclick = () => start(el, trades, true);
    el.querySelectorAll('[data-trade]').forEach((r) => (r.onclick = () => go('trade', r.dataset.trade)));
  }

  // Fetch now (if due), draw, and keep refreshing while this card is on screen and the app is visible.
  async function start(el, trades, force = false) {
    clearTimeout(timer);
    renderCard(el, trades);
    if (!trades.length || !S.tdKey) return;
    const due = force || !lastAt || Date.now() - lastAt.getTime() > REFRESH - 5000;
    if (due) { await refresh(trades); if (el.isConnected) renderCard(el, trades); }
    const tick = async () => {
      if (!el.isConnected) return;
      if (document.visibilityState === 'visible') { await refresh(trades); if (el.isConnected) renderCard(el, trades); }
      timer = setTimeout(tick, REFRESH);
    };
    timer = setTimeout(tick, REFRESH);
  }

  return { start, peek, symbolFor };
})();
