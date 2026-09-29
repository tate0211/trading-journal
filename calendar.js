// Calendar: your trading days, earnings dates for stocks you trade, options expiries,
// your own events, and a live forex economic calendar (TradingView widget) for your currencies.

// Calendar events are grouped by country. Gold (XAUUSD) has no country of its own and mostly moves on US data.
const FX_COUNTRIES = { USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp', AUD: 'au', CAD: 'ca', CHF: 'ch', NZD: 'nz', CNY: 'cn', XAUUSD: 'us' };
const EVENT_TYPES = ['Central bank', 'Economic data', 'Earnings', 'Personal', 'Other'];
const EARNINGS_TTL = 12 * 60 * 60 * 1000;

// Tickers from stock and options trades (both accounts) plus the watchlist in Settings.
function myTickers() {
  const fromTrades = S.trades.filter((t) => t.market === 'Stocks' || t.market === 'Options').map((t) => (t.instrument || '').toUpperCase());
  const watch = (S.settings.watchTickers || '').toUpperCase().split(/[\s,]+/);
  return [...new Set([...fromTrades, ...watch].filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)))].sort();
}
// Currencies from the forex pairs you've traded, unless you picked your own on the calendar.
function currenciesFromTrades() {
  const found = new Set();
  for (const t of S.trades) {
    if (t.market !== 'Forex') continue;
    const s = (t.instrument || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (s.startsWith('XAU')) { found.add('XAUUSD'); continue; }
    [s.slice(0, 3), s.slice(3, 6)].forEach((c) => FX_COUNTRIES[c] && found.add(c));
  }
  return found.size ? [...found] : ['USD', 'EUR', 'GBP', 'JPY'];
}

function parseCsv(text) {
  const rows = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const cells = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur); rows.push(cells);
  }
  return rows;
}

// All US earnings for the next 3 months in one Alpha Vantage request, cached for 12 hours.
async function loadEarnings(force = false) {
  const cache = await DB.getMeta('earnings', null);
  if (!S.avKey) return { rows: cache?.rows || [], fetchedAt: cache?.fetchedAt, error: null };
  if (!force && cache && Date.now() - new Date(cache.fetchedAt).getTime() < EARNINGS_TTL) return cache;
  try {
    const res = await fetch(`https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=${encodeURIComponent(S.avKey)}`);
    const text = await res.text();
    if (text.trim().startsWith('{')) {
      const j = JSON.parse(text);
      throw new Error(j['Error Message'] || j.Information || j.Note || 'Alpha Vantage returned an error.');
    }
    const [head, ...body] = parseCsv(text);
    const idx = (k) => head.indexOf(k);
    const rows = body.map((r) => ({ symbol: r[idx('symbol')], name: r[idx('name')], date: r[idx('reportDate')], estimate: r[idx('estimate')], time: r[idx('timeOfTheDay')] }))
      .filter((r) => r.symbol && r.date);
    const fresh = { rows, fetchedAt: new Date().toISOString() };
    await DB.setMeta('earnings', fresh);
    return fresh;
  } catch (e) {
    return { rows: cache?.rows || [], fetchedAt: cache?.fetchedAt, error: e.message || String(e) };
  }
}

// The widget gets a solid background (not transparent) so its text always contrasts. Light is the default.
function mountEconomicCalendar(el, currencies, importance, theme) {
  el.className = 'fx-widget ' + theme;
  el.innerHTML = '<div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div></div>';
  const s = document.createElement('script');
  s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-events.js';
  s.async = true;
  s.textContent = JSON.stringify({
    colorTheme: theme, isTransparent: false, width: '100%', height: 620, locale: 'en',
    importanceFilter: importance, countryFilter: [...new Set(currencies.map((c) => FX_COUNTRIES[c]))].join(','),
  });
  el.firstChild.appendChild(s);
}

async function viewCalendar(month) {
  S.events ||= await DB.getMeta('events', []);
  const fxCurrencies = (await DB.getMeta('fxCurrencies', null)) || currenciesFromTrades();
  const importance = (await DB.getMeta('fxImportance', '0,1'));
  const fxTheme = await DB.getMeta('fxTheme', 'light');
  const showFx = S.marketGroup !== 'stocks';
  const showStocks = S.marketGroup === 'all' || S.marketGroup === 'stocks';

  const ym = /^\d{4}-\d{2}$/.test(month || '') ? month : today().slice(0, 7);
  const first = new Date(ym + '-01T12:00');
  const gridStart = weekStart(ym + '-01');
  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const prevM = localDate(new Date(first.getFullYear(), first.getMonth() - 1, 1)).slice(0, 7);
  const nextM = localDate(new Date(first.getFullYear(), first.getMonth() + 1, 1)).slice(0, 7);

  const tickers = myTickers();
  const earningsData = showStocks ? await loadEarnings() : { rows: [] };
  const myEarnings = earningsData.rows.filter((r) => tickers.includes(r.symbol));
  const expiries = S.trades.filter((t) => t.market === 'Options' && t.expiry && acctOf(t) === S.account)
    .map((t) => ({ date: t.expiry, symbol: t.instrument, label: optionLabel(t) }));

  // Everything that goes on a given day.
  const dayItems = (d) => [
    ...(showStocks ? myEarnings.filter((e) => e.date === d).map((e) => ({ kind: 'earn', text: `${e.symbol} earnings`, tip: `${e.name}${e.time ? ' · ' + e.time.replace('-', ' ') : ''}` })) : []),
    ...(showStocks ? expiries.filter((e) => e.date === d).map((e) => ({ kind: 'exp', text: `${e.symbol} ${e.label.split(' · ')[0]} expires`, tip: 'Options expiry' })) : []),
    ...S.events.filter((e) => e.date === d).map((e) => ({ kind: 'evt', text: e.title, tip: e.type + (e.note ? ' · ' + e.note : '') })),
  ];

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    if (i >= 35 && d.slice(0, 7) !== ym) break;
    const tr = T().filter((t) => t.date === d);
    const st = tr.length ? stats(tr) : null;
    const items = dayItems(d);
    const hasJournal = S.journal.some((j) => j.id === d);
    cells.push(`<div class="cal-day ${d.slice(0, 7) !== ym ? 'other' : ''} ${d === today() ? 'today' : ''}" data-cal-day="${d}" tabindex="0" role="button" aria-label="${fmtDate(d)}">
      <div class="cal-num">${+d.slice(8)}${hasJournal ? '<span class="cal-dot" title="Journal entry"></span>' : ''}</div>
      ${st ? `<div class="cal-trades ${cls(st.totalR)}">${st.n} trade${st.n > 1 ? 's' : ''} · ${fmtR(st.totalR)}</div>` : ''}
      ${items.slice(0, 3).map((it) => `<div class="cal-item ${it.kind}" title="${esc(it.tip)}">${esc(it.text)}</div>`).join('')}
      ${items.length > 3 ? `<div class="muted" style="font-size:11px">+${items.length - 3} more</div>` : ''}
    </div>`);
  }

  // Upcoming list (next 60 days).
  const horizon = addDays(today(), 60);
  const upcoming = [];
  for (let d = today(); d <= horizon; d = addDays(d, 1)) dayItems(d).forEach((it) => upcoming.push({ date: d, ...it }));
  const evById = Object.fromEntries(S.events.map((e) => [e.date + e.title, e.id]));
  const updated = earningsData.fetchedAt ? new Date(earningsData.fetchedAt).toLocaleString() : null;

  main().innerHTML = `
    <div class="row between"><div><h1>Calendar ${marketPill()}</h1><p class="sub">Your trading days, upcoming earnings for stocks you trade, and forex events for your currencies.</p></div>
      <div class="row"><button class="btn" id="cal-prev">←</button><b style="min-width:150px;text-align:center">${monthName}</b><button class="btn" id="cal-next">→</button><button class="btn" id="cal-today">Today</button></div></div>

    <div class="card">
      <div class="cal-grid cal-head">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div>${d}</div>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
      <div class="row muted" style="font-size:12px;margin-top:10px;gap:16px">
        <span><span class="cal-key earn"></span>Earnings</span>${showStocks ? '<span><span class="cal-key exp"></span>Options expiry</span>' : ''}<span><span class="cal-key evt"></span>My events</span><span><span class="cal-dot" style="position:static;display:inline-block"></span> Journal entry</span>
        <span>Click a day to open that day's journal</span></div>
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Coming up (next 60 days)</h2>
        ${upcoming.length ? `<div class="table-wrap"><table><tbody>${upcoming.map((u) => `<tr>
          <td style="white-space:nowrap">${fmtDate(u.date)}</td>
          <td><span class="cal-key ${u.kind}"></span>${esc(u.text)}<br><span class="muted" style="font-size:12px">${esc(u.tip)}</span></td>
          <td>${u.kind === 'evt' && evById[u.date + u.text] ? `<button class="btn small danger" data-del-evt="${evById[u.date + u.text]}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty">Nothing coming up yet.</div>'}
      </div>
      <div class="card"><h2>Add an event</h2>
        <p class="muted" style="margin-top:-6px;font-size:13px">For anything you want on the calendar, e.g. an FOMC decision, a trip, or a day off from trading.</p>
        <div class="grid g2">
          <label class="f">Date<input type="date" id="ev-date" value="${today()}"></label>
          <label class="f">Type<select id="ev-type">${EVENT_TYPES.map((t) => `<option>${t}</option>`).join('')}</select></label>
        </div>
        <label class="f" style="margin-top:10px">Title<input type="text" id="ev-title" placeholder="e.g. FOMC rate decision"></label>
        <label class="f" style="margin-top:10px">Note<input type="text" id="ev-note" placeholder="Optional, e.g. no trades 30 min before"></label>
        <div style="margin-top:12px"><button class="btn primary" id="ev-add">Add event</button></div>
      </div>
    </div>

    ${showStocks ? `<div class="card" style="margin-top:16px"><div class="row between"><h2 style="margin:0">Earnings for my stocks</h2>
        ${S.avKey ? `<button class="btn small" id="earn-refresh">Refresh</button>` : ''}</div>
      ${!S.avKey ? `<div class="notice" style="margin-top:12px">To see earnings dates, get a free API key at <b>alphavantage.co</b> (takes a minute) and paste it in <a href="#settings">Settings → Calendar</a>.</div>` : ''}
      ${earningsData.error ? `<div class="notice neg" style="margin-top:12px">Couldn't update earnings: ${esc(earningsData.error)}</div>` : ''}
      <p class="muted" style="font-size:13px">Watching ${tickers.length ? tickers.map((t) => `<span class="tag">${esc(t)}</span>`).join('') : 'no tickers yet'}. Tickers come from your stock and options trades, plus the watchlist in <a href="#settings">Settings</a>. US-listed companies only.${updated ? ` Updated ${updated}.` : ''}</p>
      ${myEarnings.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Ticker</th><th>Company</th><th>When</th><th class="num">EPS estimate</th></tr></thead><tbody>
        ${myEarnings.sort((a, b) => a.date.localeCompare(b.date)).map((e) => `<tr><td>${fmtDate(e.date)}</td><td><b>${esc(e.symbol)}</b></td><td>${esc(e.name)}</td><td>${esc((e.time || '').replace('-', ' ') || '—')}</td><td class="num">${esc(e.estimate || '—')}</td></tr>`).join('')}
      </tbody></table></div>` : S.avKey && tickers.length ? '<div class="empty">None of your tickers report in the next 3 months.</div>' : ''}
    </div>` : ''}

    ${showFx ? `<div class="card" style="margin-top:16px">
      <div class="row between"><h2 style="margin:0">Forex economic calendar</h2>
        <div class="row" style="gap:8px">${seg('fx-imp', [['1', 'High impact'], ['0,1', 'High + medium'], ['-1,0,1', 'All']], importance)}${seg('fx-theme', [['light', 'Light'], ['dark', 'Dark']], fxTheme)}</div></div>
      <p class="muted" style="font-size:13px">Rate decisions, CPI, jobs data and other releases that move your currencies. Live data from TradingView.</p>
      <div class="chips" id="fx-cur">${Object.keys(FX_COUNTRIES).map((c) => `<span class="chip ${fxCurrencies.includes(c) ? 'on' : ''}" data-v="${c}"${c === 'XAUUSD' ? ' title="Gold: shows US events (Fed, CPI, jobs), which drive gold most"' : ''}>${c}</span>`).join('')}</div>
      <div id="fx-widget" class="fx-widget ${fxTheme}"></div>
    </div>` : ''}`;

  $('#cal-prev').onclick = () => go('calendar', prevM);
  $('#cal-next').onclick = () => go('calendar', nextM);
  $('#cal-today').onclick = () => go('calendar', today().slice(0, 7));
  $$('[data-cal-day]').forEach((c) => {
    c.onclick = () => go('journal', c.dataset.calDay);
    c.onkeydown = (e) => { if (e.key === 'Enter') c.click(); };
  });
  $('#ev-add').onclick = async () => {
    const title = $('#ev-title').value.trim(), date = $('#ev-date').value;
    if (!title || !date) return toast('Add a date and a title');
    S.events.push({ id: uid(), date, title, type: $('#ev-type').value, note: $('#ev-note').value.trim() });
    await DB.setMeta('events', S.events); toast('Event added'); viewCalendar(ym);
  };
  $$('[data-del-evt]').forEach((b) => (b.onclick = async () => {
    S.events = S.events.filter((e) => e.id !== b.dataset.delEvt); await DB.setMeta('events', S.events); viewCalendar(ym);
  }));
  if ($('#earn-refresh')) $('#earn-refresh').onclick = async () => { $('#earn-refresh').disabled = true; await loadEarnings(true); viewCalendar(ym); };
  if (showFx) {
    const remount = () => {
      const picked = $$('#fx-cur .chip.on').map((x) => x.dataset.v);
      mountEconomicCalendar($('#fx-widget'), picked.length ? picked : currenciesFromTrades(), segVal('fx-imp'), segVal('fx-theme'));
    };
    remount();
    $$('#fx-cur .chip').forEach((c) => (c.onclick = async () => {
      c.classList.toggle('on');
      const picked = $$('#fx-cur .chip.on').map((x) => x.dataset.v);
      await DB.setMeta('fxCurrencies', picked.length ? picked : null);
      remount();
    }));
    bindSeg('fx-imp', async (v) => {
      await DB.setMeta('fxImportance', v); remount();
    });
    bindSeg('fx-theme', async (v) => { await DB.setMeta('fxTheme', v); remount(); });
  }
}
