// Trading Journal — main app. Plain JS, no build step.

const DEFAULT_RULES = [
  ['Only take my A+ setups from the playbook', 'Entry'],
  ['Wait for confirmation (candle close) before entering', 'Entry'],
  ['Trade only during my planned session', 'Entry'],
  ['No entries 15 min either side of high-impact news', 'Entry'],
  ['Stop loss set before entry', 'Risk'],
  ['Risk 1% or less of the account', 'Risk'],
  ['Minimum 1:2 reward-to-risk', 'Risk'],
  ['Never move the stop further away', 'Management'],
  ['Stop trading after 2 losses or daily max loss', 'Psychology'],
  ['Trade matches my pre-market plan', 'Psychology'],
];
const DEFAULT_MISTAKES = [
  'FOMO entry', 'Revenge trade', 'Moved stop loss', 'Oversized position', 'No stop loss',
  'Chased price', 'Early exit (fear)', 'Held loser too long', 'Against my bias/trend',
  'Not in my plan', 'Overtrading', 'Ignored news', 'Boredom trade',
];
const EMOTIONS = ['Calm', 'Confident', 'Focused', 'Patient', 'Anxious', 'Fearful', 'Greedy', 'Frustrated', 'Impatient', 'Bored', 'Euphoric', 'Tired'];
const MARKETS = ['Forex', 'Indices/Futures', 'Stocks', 'Options'];
const SESSIONS = ['Asia', 'London', 'New York', 'London/NY overlap', 'Other'];
const GRADES = ['A', 'B', 'C', 'D', 'F'];
const RULE_CATS = ['Entry', 'Risk', 'Management', 'Psychology', 'Other'];

const S = { trades: [], journal: [], weekly: [], rules: [], coach: [], settings: {}, mistakes: [], setups: [] };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const main = () => $('#main');

// ---------- utils ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v === '' || v === null || v === undefined || isNaN(+v) ? null : +v);
const today = () => localDate(new Date());
function localDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDays(dateStr, n) { const d = new Date(dateStr + 'T12:00'); d.setDate(d.getDate() + n); return localDate(d); }
function weekStart(dateStr) { const d = new Date(dateStr + 'T12:00'); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return localDate(d); }
function fmtDate(s) { return s ? new Date(s + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : ''; }
function fmtR(r) { return r === null || r === undefined ? '—' : (r > 0 ? '+' : '') + r.toFixed(2) + 'R'; }
function fmtMoney(v) {
  if (v === null || v === undefined) return '—';
  const cur = S.settings.currency || 'USD';
  try { return (v > 0 ? '+' : '') + new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(v); }
  catch { return (v > 0 ? '+' : '') + v.toFixed(2); }
}
const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}
function lightbox(src) {
  const lb = document.createElement('div'); lb.className = 'lightbox';
  lb.innerHTML = `<img src="${src}" alt="Screenshot">`; lb.onclick = () => lb.remove();
  document.body.appendChild(lb);
}
function md(text) {
  // Minimal Markdown → HTML (headings, bold, italics, lists, paragraphs). Input is escaped first.
  const lines = esc(text).split('\n');
  let html = '', list = null;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>').replace(/`(.+?)`/g, '<code>$1</code>');
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { close(); const n = Math.min(m[1].length + 1, 4); html += `<h${n}>${inline(m[2])}</h${n}>`; }
    else if ((m = l.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if (!l.trim()) { close(); }
    else { close(); html += `<p>${inline(l)}</p>`; }
  }
  close();
  return html;
}
async function compressImage(file, maxW = 1600) {
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const scale = Math.min(1, maxW / img.width);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

// ---------- trade math & stats ----------
// Trades are entered either as price levels (entry/stop/target/exit) or as
// dollar amounts (money at risk at the stop, money at the take profit, result).
const isDollar = (t) => t.inputMode === 'dollar';
function tradeR(t) {
  if (num(t.rManual) !== null) return num(t.rManual);
  if (isDollar(t)) {
    const risk = num(t.riskAmt), pnl = num(t.pnl);
    return risk && pnl !== null ? pnl / Math.abs(risk) : null;
  }
  const e = num(t.entry), s = num(t.stop), x = num(t.exit);
  if (e === null || s === null || x === null || e === s) return null;
  const dir = t.direction === 'Short' ? -1 : 1;
  return ((x - e) * dir) / Math.abs(e - s);
}
function plannedRR(t) {
  if (isDollar(t)) {
    const risk = num(t.riskAmt), reward = num(t.rewardAmt);
    return risk && reward !== null ? Math.abs(reward) / Math.abs(risk) : null;
  }
  const e = num(t.entry), s = num(t.stop), tp = num(t.target);
  if (e === null || s === null || tp === null || e === s) return null;
  return Math.abs(tp - e) / Math.abs(e - s);
}
// Money at risk: entered directly in dollar mode, otherwise derived from P&L ÷ R.
function riskMoney(t) {
  if (isDollar(t)) return num(t.riskAmt) !== null ? Math.abs(num(t.riskAmt)) : null;
  const r = tradeR(t), pnl = num(t.pnl);
  return r && pnl !== null ? Math.abs(pnl / r) : null;
}
const outcome = (t) => { const r = tradeR(t); const v = r !== null ? r : num(t.pnl); return v === null ? 0 : Math.sign(v); };
const brokenRules = (t) => Object.entries(t.ruleChecks || {}).filter(([, ok]) => ok === false).map(([id]) => id);
const isClean = (t) => brokenRules(t).length === 0 && !(t.mistakes || []).length;
// Open = no exit recorded yet (no exit price, P&L or R). Open trades stay out of performance stats.
const isOpen = (t) => num(t.exit) === null && num(t.pnl) === null && num(t.rManual) === null;
// Reviewed = the rules checklist or mistakes were filled in. Only reviewed trades count toward discipline.
const isReviewed = (t) => Object.keys(t.ruleChecks || {}).length > 0 || (t.mistakes || []).length > 0;
const ruleName = (id) => (S.rules.find((r) => r.id === id) || {}).text || '(deleted rule)';
const sortTrades = (arr) => [...arr].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));

// Live (real-money) and paper (demo) trades are kept apart. Every view shows the active account only.
const ACCOUNTS = { live: 'Real money trading', paper: 'Paper trading' };
const acctOf = (t) => t.account || 'live';
const accountSize = (a) => num(a === 'paper' ? S.settings.paperAccountSize : S.settings.accountSize);

// Forex and stocks/options (plus indices/futures) are tracked as separate market groups.
const MARKET_GROUPS = { all: 'All markets', forex: 'Forex', stocks: 'Stocks & options', indices: 'Indices & futures' };
const GROUP_DEFAULT_MARKET = { forex: 'Forex', stocks: 'Stocks', indices: 'Indices/Futures' };
const groupOf = (market) => (market === 'Forex' ? 'forex' : market === 'Stocks' || market === 'Options' ? 'stocks' : 'indices');
const inGroup = (t) => S.marketGroup === 'all' || groupOf(t.market) === S.marketGroup;
const T = () => S.trades.filter((t) => acctOf(t) === S.account && inGroup(t));
const marketPill = () => (S.marketGroup && S.marketGroup !== 'all' ? `<span class="acct-pill mkt">${MARKET_GROUPS[S.marketGroup]}</span>` : '');

// Pips for forex trades entered as prices (JPY pairs quote to 2 decimals, gold to 1).
const pipSize = (inst) => (/JPY/i.test(inst || '') ? 0.01 : /^XAU/i.test(inst || '') ? 0.1 : 0.0001);
function tradePips(t) {
  if (t.market !== 'Forex') return null;
  if (num(t.pipsManual) !== null) return num(t.pipsManual);
  const e = num(t.entry), x = num(t.exit);
  if (isDollar(t) || e === null || x === null) return null;
  return ((x - e) * (t.direction === 'Short' ? -1 : 1)) / pipSize(t.instrument);
}
function stopPips(t) {
  const e = num(t.entry), s = num(t.stop);
  return t.market !== 'Forex' || isDollar(t) || e === null || s === null ? null : Math.abs(e - s) / pipSize(t.instrument);
}
const fmtPips = (p) => (p === null ? '' : `${p > 0 ? '+' : ''}${p.toFixed(1)} pips`);
function optionLabel(t) {
  if (t.market !== 'Options') return '';
  const exp = t.expiry ? new Date(t.expiry + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
  return [t.strike ?? '', t.optionType ? t.optionType[0] : ''].join('') + (exp ? ` · exp ${exp}` : '');
}

function stats(trades) {
  const all = sortTrades(trades);
  const T = all.filter((t) => !isOpen(t));
  const rs = T.map(tradeR);
  const withR = rs.filter((r) => r !== null);
  const wins = T.filter((t) => outcome(t) > 0), losses = T.filter((t) => outcome(t) < 0);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const avg = (a) => (a.length ? sum(a) / a.length : null);
  const winR = withR.filter((r) => r > 0), lossR = withR.filter((r) => r < 0);
  const pnls = T.map((t) => num(t.pnl)).filter((v) => v !== null);
  let cum = 0, peak = 0, dd = 0;
  for (const r of withR) { cum += r; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  const reviewed = T.filter(isReviewed);
  const clean = reviewed.filter(isClean), dirty = reviewed.filter((t) => !isClean(t));
  const groupBy = (keyFn) => {
    const g = {};
    for (const t of T) {
      for (const k of [].concat(keyFn(t)).filter(Boolean)) {
        g[k] ||= { key: k, n: 0, wins: 0, R: 0, pnl: 0 };
        g[k].n++; if (outcome(t) > 0) g[k].wins++;
        g[k].R += tradeR(t) || 0; g[k].pnl += num(t.pnl) || 0;
      }
    }
    return Object.values(g).sort((a, b) => a.R - b.R);
  };
  return {
    n: T.length, openN: all.length - T.length, unreviewedN: T.length - reviewed.length, wins: wins.length, losses: losses.length,
    winRate: T.length ? wins.length / (wins.length + losses.length || 1) : null,
    totalR: sum(withR), avgR: avg(withR), avgWinR: avg(winR), avgLossR: avg(lossR),
    profitFactor: lossR.length ? sum(winR) / Math.abs(sum(lossR)) : winR.length ? Infinity : null,
    totalPnl: pnls.length ? sum(pnls) : null, maxDD: dd,
    cleanRate: reviewed.length ? clean.length / reviewed.length : null,
    cleanAvgR: avg(clean.map(tradeR).filter((r) => r !== null)),
    dirtyAvgR: avg(dirty.map(tradeR).filter((r) => r !== null)),
    cleanN: clean.length, dirtyN: dirty.length,
    byMistake: groupBy((t) => t.mistakes || []),
    byRuleBroken: groupBy((t) => brokenRules(t).map(ruleName)),
    bySetup: groupBy((t) => t.setup || '(no setup)'),
    bySession: groupBy((t) => t.session || '(no session)'),
    byMarket: groupBy((t) => t.market),
    byInstrument: groupBy((t) => t.instrument || '(none)'),
    byDay: groupBy((t) => new Date(t.date + 'T12:00').toLocaleDateString('en', { weekday: 'long' })),
    byEmotion: groupBy((t) => t.emotionBefore || []),
    sorted: T,
  };
}
function periodTrades(days) {
  if (!days) return T();
  const from = addDays(today(), -days + 1);
  return T().filter((t) => t.date >= from);
}

// ---------- boot ----------
async function load() {
  [S.trades, S.journal, S.weekly, S.rules, S.coach] = await Promise.all(['trades', 'journal', 'weekly', 'rules', 'coach'].map((s) => DB.all(s)));
  S.settings = await DB.getMeta('settings', { currency: 'USD', accountSize: '', riskPct: 1, theme: 'system' });
  S.notes = await DB.all('notes');
  S.apiKey = await DB.getMeta('apiKey', '');
  S.inputMode = await DB.getMeta('inputMode', 'price');
  S.account = await DB.getMeta('account', 'live');
  S.marketGroup = await DB.getMeta('marketGroup', 'all');
  S.avKey = await DB.getMeta('avKey', '');
  S.tdKey = await DB.getMeta('tdKey', '');
  S.events = await DB.getMeta('events', []);
  S.todos = null; S.todoRoutine = null; S.todoCats = null; // reloaded on demand by todo.js
  S.mistakes = await DB.getMeta('mistakes', null);
  if (!S.mistakes) { S.mistakes = DEFAULT_MISTAKES; await DB.seedMeta('mistakes', S.mistakes); }
  if (!S.rules.length && !(await DB.getMeta('rulesSeeded', false))) {
    S.rules = DEFAULT_RULES.map(([text, category], i) => ({ id: 'rule-default-' + i, text, category, active: true, order: i, _ts: 0 }));
    for (const r of S.rules) await DB.seed('rules', r);
    await DB.setMeta('rulesSeeded', true);
  }
  // A starter rule that was never edited (_ts 0) is dropped when the same rule arrives from
  // a backup or another device, so defaults don't show up twice.
  for (const r of S.rules.filter((x) => x._ts === 0)) {
    if (S.rules.some((o) => o !== r && o._ts !== 0 && o.text === r.text)) { await DB.del('rules', r.id, { remote: true }); S.rules = S.rules.filter((x) => x !== r); }
  }
  S.rules.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  applyTheme(); applyAccount();
}
function applyAccount() {
  $$('#acct button, #acct-m button').forEach((b) => b.classList.toggle('on', b.dataset.acct === S.account));
  document.body.classList.toggle('paper', S.account === 'paper');
  $('#acct-banner').hidden = S.account !== 'paper';
  $('#mkt').value = $('#mkt-m').value = S.marketGroup;
}
async function setMarketGroup(g) {
  S.marketGroup = g; await DB.setMeta('marketGroup', g); applyAccount();
  if (location.hash.startsWith('#trade/')) go('trades'); else route();
}
async function setAccount(a) {
  S.account = a; await DB.setMeta('account', a); applyAccount();
  if (location.hash.startsWith('#trade/')) go('trades'); else route();
}
function applyTheme() {
  const t = S.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
const allSetups = () => [...new Set(S.trades.map((t) => t.setup).filter(Boolean))].sort();

// ---------- routing ----------
const VIEWS = { dashboard: viewDashboard, trades: viewTrades, trade: viewTradeForm, journal: viewJournal, weekly: viewWeekly, rules: viewRules, coach: viewCoach, settings: viewSettings, notes: viewNotes, calendar: viewCalendar, news: viewNews, todo: viewTodo };
function go(view, arg) { location.hash = arg ? `${view}/${arg}` : view; }
function route() {
  const [view, arg] = (location.hash.slice(1) || 'dashboard').split('/');
  const fn = VIEWS[view] || viewDashboard;
  const current = view === 'trade' ? 'trades' : view || 'dashboard';
  $$('nav [data-go], .sheet-list [data-go]').forEach((b) => b.classList.toggle('active', b.dataset.go === current));
  // On phones, pages reached through "More" light up the More tab.
  $('#tab-more')?.classList.toggle('active', !!$(`.sheet-list [data-go="${current}"]`));
  if (typeof moreSheet === 'function') moreSheet(false);
  window.scrollTo(0, 0);
  fn(arg ? decodeURIComponent(arg) : undefined);
}

// ---------- dashboard ----------
function viewDashboard() {
  const period = +(sessionStorage.getItem('period') || 30);
  const st = stats(periodTrades(period));
  const todayTrades = T().filter((t) => t.date === today());
  const todayPlan = S.journal.find((j) => j.id === today());
  const pf = st.profitFactor === Infinity ? '∞' : st.profitFactor === null ? '—' : st.profitFactor.toFixed(2);
  const periods = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All time']];
  main().innerHTML = `
    <div class="row between">
      <div><h1>Dashboard <span class="acct-pill ${S.account}">${ACCOUNTS[S.account]}</span>${marketPill()}</h1><p class="sub">Where you're winning, where you're leaking, and how disciplined you've been.</p></div>
      <div class="row">
        <div class="chips">${periods.map(([d, l]) => `<span class="chip ${d === period ? 'on' : ''}" data-period="${d}">${l}</span>`).join('')}</div>
        <button class="btn primary" id="new-trade">+ Log trade</button>
      </div>
    </div>

    ${!todayPlan?.plan?.plan && !todayPlan?.plan?.bias ? `<div class="notice" style="margin-bottom:16px">You haven't written a pre-market plan for today. <a href="#journal">Write it now</a> before you take a trade.</div>` : ''}

    ${compareAccounts(period)}
    ${reviewNotice()}
    <div id="dash-live" style="margin-top:16px"></div>
    <div id="dash-todo" style="margin-top:16px"></div>
    <div class="section-title">Performance</div>
    <div class="grid g4">
      ${statTile('Net result', fmtR(st.totalR), st.totalPnl !== null ? fmtMoney(st.totalPnl) : `${st.n} trades`, cls(st.totalR))}
      ${statTile('Win rate', st.winRate === null ? '—' : Math.round(st.winRate * 100) + '%', `${st.wins}W / ${st.losses}L of ${st.n}`)}
      ${statTile('Expectancy', st.avgR === null ? '—' : fmtR(st.avgR), 'Average R per trade', cls(st.avgR))}
      ${statTile('Profit factor', pf, `Avg win ${fmtR(st.avgWinR)} · avg loss ${fmtR(st.avgLossR)}`)}
    </div>

    <div class="section-title">Discipline</div>
    <div class="grid g3">
      <div class="card stat">
        <div class="label">Discipline score</div>
        <div class="value">${st.cleanRate === null ? '—' : Math.round(st.cleanRate * 100) + '%'}</div>
        <div class="meter" style="margin:6px 0"><div style="width:${Math.round((st.cleanRate || 0) * 100)}%"></div></div>
        <div class="hint">Share of reviewed trades with every rule followed and no mistakes tagged${st.unreviewedN ? ` · ${st.unreviewedN} not reviewed yet` : ''}</div>
      </div>
      <div class="card stat">
        <div class="label">When you follow your rules</div>
        <div class="value ${cls(st.cleanAvgR)}">${fmtR(st.cleanAvgR)}</div>
        <div class="hint">Average per trade across ${st.cleanN} clean trades</div>
      </div>
      <div class="card stat">
        <div class="label">When you break them</div>
        <div class="value ${cls(st.dirtyAvgR)}">${fmtR(st.dirtyAvgR)}</div>
        <div class="hint">Average per trade across ${st.dirtyN} trades with a broken rule or mistake</div>
      </div>
    </div>

    <div class="section-title">Progress and leaks</div>
    <div class="grid g2">
      <div class="card"><h2>Equity curve (cumulative R)</h2><div id="eq"></div>
        <p class="muted" style="margin:8px 0 0;font-size:12px">Max drawdown: ${fmtR(st.maxDD)}</p></div>
      <div class="card"><h2>What your mistakes cost you</h2><div id="mist"></div></div>
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Rules you break most</h2>${breakdownTable(st.byRuleBroken, 'Rule', 'Times broken')}</div>
      <div class="card"><h2>Today</h2>${todayTrades.length ? tradeTable(sortTrades(todayTrades), true) : '<div class="empty">No trades logged today.</div>'}</div>
    </div>

    <div class="section-title">Breakdowns</div>
    <div class="grid g2">
      ${S.marketGroup === 'all' ? `<div class="card"><h2>By market</h2>${breakdownTable([...st.byMarket].reverse(), 'Market')}</div>` : ''}
      <div class="card"><h2>By ${S.marketGroup === 'forex' ? 'currency pair' : S.marketGroup === 'stocks' ? 'ticker' : 'instrument'}</h2>${breakdownTable([...st.byInstrument].reverse(), 'Instrument')}</div>
      <div class="card"><h2>By setup</h2>${breakdownTable([...st.bySetup].reverse(), 'Setup')}</div>
      <div class="card"><h2>By session</h2>${breakdownTable([...st.bySession].reverse(), 'Session')}</div>
      <div class="card"><h2>By emotion before entry</h2>${breakdownTable([...st.byEmotion].reverse(), 'Emotion')}</div>
    </div>
  `;
  $$('[data-period]').forEach((c) => (c.onclick = () => { sessionStorage.setItem('period', c.dataset.period); viewDashboard(); }));
  todoDashboardCard($('#dash-todo'));
  Live.start($('#dash-live'), T().filter(isOpen));
  $('#new-trade').onclick = () => go('trade', 'new');
  bindTradeRows();
  let cum = 0;
  const pts = st.sorted.filter((t) => tradeR(t) !== null).map((t, i) => {
    const r = tradeR(t); cum += r;
    return { y: cum, tip: `<b>#${i + 1} ${esc(t.instrument || '')}</b> · ${fmtDate(t.date)}<br>Trade ${fmtR(r)} · Total ${fmtR(cum)}` };
  });
  Charts.line($('#eq'), pts);
  Charts.bars($('#mist'), st.byMistake.map((m) => ({
    label: m.key, value: m.R,
    tip: `<b>${esc(m.key)}</b><br>${m.n} trade${m.n > 1 ? 's' : ''} · ${fmtR(m.R)}${m.pnl ? ' · ' + fmtMoney(m.pnl) : ''}`,
  })));
}
// Reminder for open positions and trades still missing their rules/emotions review.
function reviewNotice() {
  const mine = T();
  const open = mine.filter(isOpen).length;
  const review = mine.filter((t) => t.needsReview || (!isOpen(t) && !isReviewed(t))).length;
  if (!open && !review) return '';
  return `<div class="notice" style="margin-bottom:4px">
    ${open ? `<b>${open} open position${open > 1 ? 's' : ''}</b>: not counted in your stats until you add the exit. ` : ''}
    ${review ? `<b>${review} trade${review > 1 ? 's' : ''} need${review > 1 ? '' : 's'} review</b>: open each one and fill in the rules checklist, emotions and mistakes. ` : ''}
    <a href="#trades">Go to trades</a></div>`;
}
// Side-by-side live vs paper line, shown once both accounts have trades in the period.
function compareAccounts(days) {
  const from = days ? addDays(today(), -days + 1) : '0000';
  const by = (a) => stats(S.trades.filter((t) => acctOf(t) === a && inGroup(t) && t.date >= from));
  const live = by('live'), paper = by('paper');
  if (!live.n || !paper.n) return '';
  const line = (label, st) => `<span><b>${label}</b> ${st.n} trades · <span class="${cls(st.totalR)}">${fmtR(st.totalR)}</span> · ${Math.round((st.winRate || 0) * 100)}% win · discipline ${Math.round((st.cleanRate || 0) * 100)}%</span>`;
  return `<div class="notice row" style="gap:24px;margin-bottom:4px">${line('Real money', live)}${line('Paper', paper)}</div>`;
}
function statTile(label, value, hint, c = '') {
  return `<div class="card stat"><div class="label">${label}</div><div class="value ${c}">${value}</div><div class="hint">${hint}</div></div>`;
}
function breakdownTable(rows, label, countLabel = 'Trades') {
  if (!rows.length) return '<div class="empty">Nothing yet.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>${label}</th><th class="num">${countLabel}</th><th class="num">Win %</th><th class="num">Net R</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.key)}</td><td class="num">${r.n}</td><td class="num">${Math.round((r.wins / r.n) * 100)}%</td><td class="num ${cls(r.R)}">${fmtR(r.R)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

// ---------- trades list ----------
function tradeRow(t, compact, hideDate = compact) {
  const checks = Object.values(t.ruleChecks || {});
  const ok = checks.filter((v) => v).length;
  const r = tradeR(t);
  return `<tr class="click" data-trade="${t.id}">
    <td>${hideDate ? '' : fmtDate(t.date) + '<br>'}<span class="muted">${esc(t.time || '')}</span></td>
    <td><b>${esc(t.instrument || '—')}</b> <span class="dir ${t.direction === 'Short' ? 'short' : 'long'}">${esc(t.direction || '')}</span>${t.needsReview ? ' <span class="tag review-tag">Needs review</span>' : ''}${t.images?.length ? ' <span title="Has screenshots">📷</span>' : ''}
      <br><span class="muted" style="font-size:12px">${esc(t.market || '')}${t.market === 'Options' && optionLabel(t) ? ' · ' + esc(optionLabel(t)) : ''}</span></td>
    ${compact ? '' : `<td>${esc(t.setup || '')}</td>`}
    ${isOpen(t) ? (() => { const lp = Live.peek(t); return `<td class="num"><span class="tag open-tag">Open</span>${lp?.r != null ? `<br><span class="${cls(lp.r)}" style="font-size:12px">${fmtR(lp.r)} now</span>` : ''}</td><td class="num ${cls(lp?.usd)}">${lp?.usd != null ? fmtMoney(lp.usd) : '—'}</td>`; })() : `<td class="num ${cls(r)}">${fmtR(r)}${tradePips(t) !== null ? `<br><span class="muted" style="font-size:12px">${fmtPips(tradePips(t))}</span>` : ''}</td>
    <td class="num ${cls(num(t.pnl))}">${fmtMoney(num(t.pnl))}</td>`}
    <td>${checks.length ? `${ok}/${checks.length}${ok < checks.length ? ' <span class="tag bad">broken</span>' : ''}` : '<span class="muted">—</span>'}</td>
    ${compact ? '' : `<td>${(t.mistakes || []).map((m) => `<span class="tag bad">${esc(m)}</span>`).join('')}</td><td>${esc(t.grade || '')}</td>`}
  </tr>`;
}
// grouped: insert a header row per day with that day's totals.
function tradeTable(trades, compact = false, grouped = false) {
  const cols = compact ? 5 : 8;
  let body = '';
  if (grouped) {
    const days = [];
    for (const t of trades) { if (days.at(-1)?.date !== t.date) days.push({ date: t.date, trades: [] }); days.at(-1).trades.push(t); }
    for (const d of days) {
      const st = stats(d.trades);
      body += `<tr class="day"><td colspan="${cols}"><span>${fmtDate(d.date)}</span>
        <span class="muted">${st.n + st.openN} trade${st.n + st.openN > 1 ? 's' : ''}${st.openN ? ` (${st.openN} open)` : ''}</span>
        ${st.n ? `<span class="${cls(st.totalR)}">${fmtR(st.totalR)}</span>` : ''}${st.totalPnl !== null ? `<span class="${cls(st.totalPnl)}">${fmtMoney(st.totalPnl)}</span>` : ''}</td></tr>`;
      body += d.trades.map((t) => tradeRow(t, false, true)).join('');
    }
  } else body = trades.map((t) => tradeRow(t, compact)).join('');
  return `<div class="table-wrap"><table class="trade-table ${compact ? '' : 'full'}"><thead><tr>
    <th>${grouped ? 'Time' : 'Date'}</th><th>Instrument</th>${compact ? '' : '<th>Setup</th>'}<th class="num">R</th><th class="num">P&amp;L</th><th>Rules</th>${compact ? '' : '<th>Mistakes</th><th>Grade</th>'}
  </tr></thead><tbody>${body}</tbody></table></div>`;
}
function bindTradeRows() { $$('[data-trade]').forEach((r) => (r.onclick = () => go('trade', r.dataset.trade))); }

function viewTrades() {
  const f = JSON.parse(sessionStorage.getItem('tradeFilter') || '{}');
  const q = (f.q || '').toLowerCase();
  const list = sortTrades(T()).reverse().filter((t) =>
    (!q || [t.instrument, t.setup, t.notes, t.lesson, ...(t.mistakes || [])].join(' ').toLowerCase().includes(q)) &&
    (!f.market || t.market === f.market) &&
    (!f.result || (f.result === 'open' ? isOpen(t) : f.result === 'win' ? outcome(t) > 0 : f.result === 'loss' ? outcome(t) < 0 : !isOpen(t) && outcome(t) === 0)) &&
    (!f.discipline || (f.discipline === 'clean' ? isClean(t) : !isClean(t))));
  const st = stats(list);
  main().innerHTML = `
    <div class="row between"><div><h1>Trades <span class="acct-pill ${S.account}">${ACCOUNTS[S.account]}</span>${marketPill()}</h1><p class="sub">${T().length} ${S.account === 'paper' ? 'paper' : 'real-money'} trades logged, grouped by day. Click a trade to open it.</p></div>
      <button class="btn primary" id="new-trade">+ Log trade</button></div>
    <div class="card" style="margin-bottom:16px"><div class="grid g4">
      <label class="f">Search<input type="text" id="f-q" value="${esc(f.q || '')}" placeholder="Instrument, setup, notes…"></label>
      <label class="f">Market<select id="f-market"><option value="">All</option>${MARKETS.map((m) => `<option ${f.market === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="f">Result<select id="f-result"><option value="">All</option><option value="win" ${f.result === 'win' ? 'selected' : ''}>Wins</option><option value="loss" ${f.result === 'loss' ? 'selected' : ''}>Losses</option><option value="be" ${f.result === 'be' ? 'selected' : ''}>Breakeven</option><option value="open" ${f.result === 'open' ? 'selected' : ''}>Open</option></select></label>
      <label class="f">Discipline<select id="f-disc"><option value="">All</option><option value="clean" ${f.discipline === 'clean' ? 'selected' : ''}>Followed all rules</option><option value="dirty" ${f.discipline === 'dirty' ? 'selected' : ''}>Broke a rule / mistake</option></select></label>
    </div>
    ${list.length ? `<div class="row muted" style="margin-top:12px;font-size:13px">Showing ${st.n} trades · <span class="${cls(st.totalR)}">${fmtR(st.totalR)}</span>${st.totalPnl !== null ? ` · <span class="${cls(st.totalPnl)}">${fmtMoney(st.totalPnl)}</span>` : ''} · win rate ${Math.round((st.winRate || 0) * 100)}%</div>` : ''}
    </div>
    <div class="card">${list.length ? tradeTable(list, false, true) : `<div class="empty">${T().length ? 'No trades match these filters.' : 'No trades yet. Log your first one.'}</div>`}</div>`;
  $('#new-trade').onclick = () => go('trade', 'new');
  const save = () => {
    sessionStorage.setItem('tradeFilter', JSON.stringify({ q: $('#f-q').value, market: $('#f-market').value, result: $('#f-result').value, discipline: $('#f-disc').value }));
    viewTrades(); const i = $('#f-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
  };
  $('#f-q').oninput = save;
  ['#f-market', '#f-result', '#f-disc'].forEach((s) => ($(s).onchange = save));
  bindTradeRows();
}

// ---------- trade form ----------
function seg(id, options, value) {
  return `<div class="seg" id="${id}">${options.map(([v, label]) => `<button type="button" data-val="${v}" class="${v === value ? 'on' : ''}">${label}</button>`).join('')}</div>`;
}
function bindSeg(id, onChange) {
  $$(`#${id} button`).forEach((b) => (b.onclick = () => {
    $$(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b));
    onChange(b.dataset.val);
  }));
}
const segVal = (id) => $(`#${id} button.on`)?.dataset.val;

function viewTradeForm(id) {
  const existing = id && id !== 'new' ? S.trades.find((t) => t.id === id) : null;
  const last = sortTrades(T()).at(-1);
  const t = existing ? structuredClone(existing) : {
    id: uid(), date: today(), time: new Date().toTimeString().slice(0, 5), market: GROUP_DEFAULT_MARKET[S.marketGroup] || last?.market || 'Forex', direction: 'Long',
    session: last?.session || '', inputMode: S.inputMode || 'price', account: S.account,
    ruleChecks: {}, mistakes: [], emotionBefore: [], emotionAfter: [], images: [], confidence: 3,
  };
  t.inputMode ||= 'price';
  t.account = acctOf(t);
  const activeRules = S.rules.filter((r) => r.active || t.ruleChecks[r.id] !== undefined);
  const cur = esc(S.settings.currency || 'USD');
  const money = (fid, label, hint, val) => `<label class="f">${label}<div class="money"><span>${cur}</span><input type="number" step="any" min="0" id="${fid}" value="${esc(val ?? '')}"></div>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
  const price = (fid, label, val) => `<label class="f">${label}<input type="number" step="any" id="${fid}" value="${esc(val ?? '')}"></label>`;
  const section = (n, title, sub, body) => `<section class="card fsec"><div class="sec-h"><span class="n">${n}</span><div><h2>${title}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}</div></div>${body}</section>`;

  main().innerHTML = `
    <div><h1>${existing ? 'Edit trade' : 'Log a trade'} <span class="acct-pill ${t.account}">${ACCOUNTS[t.account]}</span></h1>
      <p class="sub">Work through the steps from top to bottom. Be honest: the journal is only useful if it records what actually happened.</p></div>
    <div class="form-layout">
      <div class="form-main">
        ${section(1, 'Trade details', 'What you traded and when', `
          <label class="f" style="margin-bottom:12px">Account${seg('account', [['live', 'Real money'], ['paper', 'Paper (demo)']], t.account)}</label>
          <div class="grid g3">
            <label class="f">Date<input type="date" id="date" value="${esc(t.date)}"></label>
            <label class="f">Time<input type="time" id="time" value="${esc(t.time || '')}"></label>
            <label class="f">Market<select id="market">${MARKETS.map((m) => `<option ${t.market === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
            <label class="f">Instrument<input type="text" id="instrument" value="${esc(t.instrument || '')}" placeholder="EURUSD, NAS100, AAPL…"></label>
            <label class="f">Direction${seg('direction', [['Long', '▲ Long'], ['Short', '▼ Short']], t.direction)}</label>
            <label class="f">Session<select id="session"><option value="">—</option>${SESSIONS.map((s) => `<option ${t.session === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
            <label class="f">Setup<input type="text" id="setup" list="setups" value="${esc(t.setup || '')}" placeholder="Breakout, pullback…"><datalist id="setups">${allSetups().map((s) => `<option value="${esc(s)}">`).join('')}</datalist></label>
            <label class="f">Timeframe<input type="text" id="timeframe" value="${esc(t.timeframe || '')}" placeholder="M5, H1…"></label>
          </div>
          <div class="mkt-fields" data-for="Forex" ${t.market === 'Forex' ? '' : 'hidden'}><div class="grid g3">
            <label class="f">Lot size<input type="text" id="size-Forex" value="${esc(t.size || '')}" placeholder="e.g. 0.50"></label>
            <label class="f">Pips override<input type="number" step="any" id="pipsManual" value="${esc(t.pipsManual ?? '')}" placeholder="auto"><span class="hint">Worked out from entry and exit prices</span></label>
          </div></div>
          <div class="mkt-fields" data-for="Stocks" ${t.market === 'Stocks' ? '' : 'hidden'}><div class="grid g3">
            <label class="f">Shares<input type="text" id="size-Stocks" value="${esc(t.size || '')}" placeholder="e.g. 100"></label>
          </div></div>
          <div class="mkt-fields" data-for="Options" ${t.market === 'Options' ? '' : 'hidden'}><div class="grid g4">
            <label class="f">Call / Put${seg('optionType', [['Call', 'Call'], ['Put', 'Put']], t.optionType || 'Call')}</label>
            <label class="f">Strike<input type="number" step="any" id="strike" value="${esc(t.strike ?? '')}"></label>
            <label class="f">Expiry<input type="date" id="expiry" value="${esc(t.expiry || '')}"></label>
            <label class="f">Contracts<input type="text" id="size-Options" value="${esc(t.size || '')}" placeholder="e.g. 2"></label>
          </div><p class="hint" style="margin:6px 0 0">Put the underlying ticker (e.g. AAPL) as the instrument, and the option's premium as the entry and exit prices.</p></div>
          <div class="mkt-fields" data-for="Indices/Futures" ${t.market === 'Indices/Futures' ? '' : 'hidden'}><div class="grid g3">
            <label class="f">Contracts / lots<input type="text" id="size-Indices/Futures" value="${esc(t.size || '')}" placeholder="e.g. 1"></label>
          </div></div>`)}

        ${section(2, 'Entry, stop loss and take profit', 'Enter them as chart prices or as dollar amounts, whichever is easier', `
          <div class="row" style="margin-bottom:14px">${seg('mode', [['price', 'Price levels'], ['dollar', `Dollar amounts (${cur})`]], t.inputMode)}</div>
          <div id="mode-price" ${t.inputMode === 'price' ? '' : 'hidden'}>
            <div class="grid g4">${price('entry', 'Entry price', t.entry)}${price('stop', 'Stop loss price', t.stop)}${price('target', 'Take profit price', t.target)}${price('exit', 'Exit price', t.exit)}</div>
          </div>
          <div id="mode-dollar" ${t.inputMode === 'dollar' ? '' : 'hidden'}>
            <div class="grid g3">
              ${money('entryAmt', 'Entry value', 'Amount put into the trade (optional)', t.entryAmt)}
              ${money('riskAmt', 'Stop loss', 'What you lose if the stop is hit', t.riskAmt)}
              ${money('rewardAmt', 'Take profit', 'What you make if the target is hit', t.rewardAmt)}
            </div>
          </div>
          <div class="grid g3" style="margin-top:14px">
            <label class="f"><span id="pnl-label">Actual P&amp;L</span><div class="money"><span>${cur}</span><input type="number" step="any" id="pnl" value="${esc(t.pnl ?? '')}" placeholder="-50 or 120"></div><span class="hint">After fees. Use a minus sign for a loss.</span></label>
            <label class="f">R-multiple override<input type="number" step="any" id="rManual" value="${esc(t.rManual ?? '')}" placeholder="auto"><span class="hint">Only for options or partial exits</span></label>
          </div>`)}

        ${section(3, 'Rules checklist', 'Tick every rule you followed. Anything left unticked counts as broken.', `
          <div class="checklist">${activeRules.length ? activeRules.map((r) => `
            <label class="check"><input type="checkbox" data-rule="${r.id}" ${t.ruleChecks[r.id] ? 'checked' : ''}> <span>${esc(r.text)}</span><span class="cat">${esc(r.category)}</span></label>`).join('')
            : '<div class="empty">No rules yet. <a href="#rules">Add your rules</a>.</div>'}</div>
          <div class="row" style="margin-top:10px"><button class="btn small" id="all-rules">Tick all</button><button class="btn small" id="no-rules">Clear</button></div>`)}

        ${section(4, 'Mistakes and mindset', 'Tag anything that went wrong and how you felt', `
          <h3 style="margin-top:0">Mistakes</h3>
          <div class="chips" id="mistakes">${S.mistakes.map((m) => `<span class="chip bad ${t.mistakes.includes(m) ? 'on' : ''}" data-v="${esc(m)}">${esc(m)}</span>`).join('')}</div>
          <div class="row" style="margin-top:8px"><input type="text" id="new-mistake" placeholder="Add another mistake tag…" style="max-width:260px"><button class="btn small" id="add-mistake">Add</button></div>
          <div class="grid g2" style="margin-top:6px">
            <div><h3>Before entry I felt</h3><div class="chips" id="emo-before">${EMOTIONS.map((e) => `<span class="chip ${t.emotionBefore.includes(e) ? 'on' : ''}" data-v="${e}">${e}</span>`).join('')}</div></div>
            <div><h3>After the trade I felt</h3><div class="chips" id="emo-after">${EMOTIONS.map((e) => `<span class="chip ${t.emotionAfter.includes(e) ? 'on' : ''}" data-v="${e}">${e}</span>`).join('')}</div></div>
          </div>
          <div class="grid g2" style="margin-top:14px">
            <label class="f">Confidence in the setup${seg('confidence', [1, 2, 3, 4, 5].map((n) => [String(n), String(n)]), String(t.confidence ?? 3))}</label>
            <label class="f">Execution grade${seg('grade', GRADES.map((g) => [g, g]), t.grade || '')}</label>
          </div>`)}

        ${section(5, 'Notes and screenshots', '', `
          <div class="grid g2">
            <label class="f">Why I took it / what happened<textarea id="notes" rows="4">${esc(t.notes || '')}</textarea></label>
            <label class="f">Lesson learned<textarea id="lesson" rows="4">${esc(t.lesson || '')}</textarea></label>
          </div>
          <h3>Chart screenshots</h3>
          <div class="shots" id="shots"></div>
          <div class="drop" id="drop" style="margin-top:8px">Drop images here, click to choose, or paste with ⌘V<input type="file" id="file" accept="image/*" multiple hidden></div>
          <h3>GoodNotes notes</h3>
          ${notesPanel('trade-notes', 'Attach GoodNotes notes to this trade')}`)}
      </div>

      <aside class="form-side">
        <div class="card summary">
          <div class="muted" style="font-size:12px">Trade summary</div>
          <div id="sum-title" class="sum-title"></div>
          <div id="sum-r" class="sum-r"></div>
          <div id="sum-pnl" class="muted"></div>
          <dl id="sum-list"></dl>
          <div class="meter" style="margin:4px 0 2px"><div id="sum-meter"></div></div>
          <div id="sum-warn"></div>
          <button class="btn primary" id="save" style="width:100%;margin-top:12px">Save trade</button>
          <div class="row" style="margin-top:8px"><button class="btn" id="cancel" style="flex:1">Cancel</button>${existing ? '<button class="btn danger" id="del">Delete</button>' : ''}</div>
        </div>
      </aside>
    </div>`;

  // Collect the form into a trade object (used for live summary and saving).
  const read = () => {
    const x = { ...t };
    for (const k of ['date', 'time', 'market', 'instrument', 'session', 'setup', 'timeframe', 'notes', 'lesson', 'expiry']) x[k] = $('#' + k).value.trim();
    for (const k of ['entry', 'stop', 'target', 'exit', 'entryAmt', 'riskAmt', 'rewardAmt', 'pnl', 'rManual', 'pipsManual', 'strike']) x[k] = num($('#' + k).value);
    x.size = document.getElementById('size-' + x.market).value.trim();
    x.optionType = x.market === 'Options' ? segVal('optionType') : '';
    if (x.market !== 'Options') { x.strike = null; x.expiry = ''; }
    if (x.market !== 'Forex') x.pipsManual = null;
    x.direction = segVal('direction'); x.inputMode = segVal('mode'); x.account = segVal('account');
    x.confidence = num(segVal('confidence')); x.grade = segVal('grade') || '';
    x.ruleChecks = {}; $$('[data-rule]').forEach((b) => (x.ruleChecks[b.dataset.rule] = b.checked));
    return x;
  };
  const refresh = () => {
    const x = read();
    const r = tradeR(x), rr = plannedRR(x), risk = riskMoney(x);
    const acct = accountSize(x.account), limit = num(S.settings.riskPct);
    const riskPct = risk !== null && acct ? (risk / acct) * 100 : null;
    const boxes = Object.values(x.ruleChecks), ok = boxes.filter(Boolean).length;
    $('#sum-title').innerHTML = `${esc(x.instrument.toUpperCase() || 'New trade')} <span class="dir ${x.direction === 'Short' ? 'short' : 'long'}">${x.direction}</span>`;
    $('#sum-r').innerHTML = `<span class="${cls(r)}">${fmtR(r)}</span>`;
    $('#sum-pnl').innerHTML = x.pnl !== null ? `<span class="${cls(x.pnl)}">${fmtMoney(x.pnl)}</span>` : 'Enter the result to see R';
    $('#sum-list').innerHTML = [
      ['Planned R:R', rr !== null ? '1 : ' + rr.toFixed(2) : '—'],
      ['Risk', risk !== null ? fmtMoney(risk).replace('+', '') + (riskPct !== null ? ` · ${riskPct.toFixed(2)}%` : '') : '—'],
      ...(x.market === 'Forex' ? [['Pips', tradePips(x) !== null ? fmtPips(tradePips(x)) : '—'], ['Stop distance', stopPips(x) !== null ? stopPips(x).toFixed(1) + ' pips' : '—']] : []),
      ...(x.market === 'Options' && optionLabel(x) ? [['Option', esc(optionLabel(x))]] : []),
      ['Rules followed', boxes.length ? `${ok} / ${boxes.length}` : '—'],
      ['Mistakes', t.mistakes.length || 'None'],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('#sum-meter').style.width = boxes.length ? (ok / boxes.length) * 100 + '%' : '0';
    const warns = [];
    if (riskPct !== null && limit && riskPct > limit + 1e-9) warns.push(`Risk is ${riskPct.toFixed(2)}%, above your ${limit}% limit`);
    if (rr !== null && rr < 1) warns.push('Target is smaller than the risk');
    $('#sum-warn').innerHTML = warns.map((w) => `<div class="warn">⚠ ${w}</div>`).join('');
    $('#pnl-label').textContent = x.inputMode === 'dollar' ? 'Actual result (P&L)' : 'Actual P&L';
  };

  bindSeg('account', (a) => { $('h1 .acct-pill').className = 'acct-pill ' + a; $('h1 .acct-pill').textContent = ACCOUNTS[a]; refresh(); });
  bindSeg('direction', refresh); bindSeg('confidence', () => {}); bindSeg('grade', () => {}); bindSeg('optionType', refresh);
  const showMarketFields = () => {
    const m = $('#market').value;
    $$('.mkt-fields').forEach((b) => (b.hidden = b.dataset.for !== m));
    $('#instrument').placeholder = { Forex: 'EURUSD, GBPJPY, XAUUSD…', Stocks: 'AAPL, TSLA…', Options: 'Underlying, e.g. AAPL', 'Indices/Futures': 'NAS100, US30, ES…' }[m];
  };
  $('#market').addEventListener('change', () => { showMarketFields(); refresh(); });
  showMarketFields();
  bindSeg('mode', async (m) => {
    $('#mode-price').hidden = m !== 'price'; $('#mode-dollar').hidden = m !== 'dollar';
    S.inputMode = m; await DB.setMeta('inputMode', m); refresh();
  });
  $$('.form-main input, .form-main select').forEach((e) => e.addEventListener('input', refresh));

  const chipGroup = (sel, arr) => $$(`${sel} .chip`).forEach((c) => (c.onclick = () => {
    const v = c.dataset.v; const i = arr.indexOf(v);
    i >= 0 ? arr.splice(i, 1) : arr.push(v); c.classList.toggle('on'); refresh();
  }));
  chipGroup('#mistakes', t.mistakes); chipGroup('#emo-before', t.emotionBefore); chipGroup('#emo-after', t.emotionAfter);
  $('#add-mistake').onclick = async () => {
    const v = $('#new-mistake').value.trim(); if (!v || S.mistakes.includes(v)) return;
    S.mistakes.push(v); await DB.setMeta('mistakes', S.mistakes); t.mistakes.push(v);
    const c = document.createElement('span'); c.className = 'chip bad on'; c.dataset.v = v; c.textContent = v;
    $('#mistakes').appendChild(c); chipGroup('#mistakes', t.mistakes); $('#new-mistake').value = ''; refresh();
  };
  $('#all-rules').onclick = () => { $$('[data-rule]').forEach((b) => (b.checked = true)); refresh(); };
  $('#no-rules').onclick = () => { $$('[data-rule]').forEach((b) => (b.checked = false)); refresh(); };
  refresh();

  const renderShots = () => {
    $('#shots').innerHTML = t.images.map((src, i) => `<div class="shot"><img src="${src}" alt="Screenshot ${i + 1}"><button class="btn small" data-rm="${i}">✕</button></div>`).join('');
    $$('#shots img').forEach((im) => (im.onclick = () => lightbox(im.src)));
    $$('#shots [data-rm]').forEach((b) => (b.onclick = () => { t.images.splice(+b.dataset.rm, 1); renderShots(); }));
  };
  const addFiles = async (files) => {
    for (const f of files) if (f.type.startsWith('image/')) t.images.push(await compressImage(f));
    renderShots();
  };
  renderShots();
  bindNotesPanel('trade-notes', () => S.notes.filter((n) => n.tradeId === t.id), () => ({ date: $('#date').value || t.date, tradeId: t.id }));
  const drop = $('#drop');
  drop.onclick = () => $('#file').click();
  $('#file').onchange = (e) => addFiles(e.target.files);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('hover'); };
  drop.ondragleave = () => drop.classList.remove('hover');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('hover'); addFiles(e.dataTransfer.files); };
  document.onpaste = (e) => {
    if (!location.hash.startsWith('#trade/')) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files); }
  };

  $('#cancel').onclick = () => history.back();
  if (existing) $('#del').onclick = async () => {
    if (!confirm('Delete this trade? This cannot be undone.')) return;
    await DB.del('trades', t.id); S.trades = S.trades.filter((x) => x.id !== t.id); toast('Trade deleted'); go('trades');
  };
  $('#save').onclick = async () => {
    const x = read();
    if (!x.date) return toast('Add a date');
    if (!x.instrument) { $('#instrument').focus(); return toast('Add the instrument'); }
    x.instrument = x.instrument.toUpperCase();
    x.needsReview = false; // saving from the form counts as reviewing it
    x.updatedAt = new Date().toISOString(); x.createdAt ||= x.updatedAt;
    await DB.put('trades', x);
    S.trades = S.trades.filter((y) => y.id !== x.id).concat(x);
    toast(x.account === S.account ? 'Trade saved' : `Trade saved to ${ACCOUNTS[x.account]}`);
    go('trades');
  };
}

// ---------- daily journal ----------
function viewJournal(date) {
  date ||= today();
  const j = structuredClone(S.journal.find((x) => x.id === date) || { id: date, date, plan: {}, review: { emotions: [] } });
  j.review.emotions ||= [];
  const dayTrades = sortTrades(T().filter((t) => t.date === date));
  const st = stats(dayTrades);
  const recent = [...S.journal].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 14);
  const field = (sec, key, label, rows = 2, ph = '') => `<label class="f">${label}<textarea data-s="${sec}" data-k="${key}" rows="${rows}" placeholder="${ph}">${esc(j[sec][key] || '')}</textarea></label>`;
  const input = (sec, key, label, type = 'text', ph = '') => `<label class="f">${label}<input type="${type}" step="any" data-s="${sec}" data-k="${key}" value="${esc(j[sec][key] ?? '')}" placeholder="${ph}"></label>`;
  main().innerHTML = `
    <div class="row between"><div><h1>Daily journal</h1><p class="sub">Plan before the session, then review after it. Same questions every day.</p></div>
      <div class="row"><button class="btn" id="prev">←</button><input type="date" id="jdate" value="${date}" style="width:auto"><button class="btn" id="next">→</button><button class="btn primary" id="save">Save</button></div></div>
    <div class="grid g2">
      <div class="card"><h2>Pre-market plan</h2>
        <div class="grid g3">${input('plan', 'sleep', 'Sleep (hours)', 'number')}${input('plan', 'mood', 'Mood (1–10)', 'number')}${input('plan', 'maxTrades', 'Max trades today', 'number')}</div>
        <div class="grid g2" style="margin-top:10px">${input('plan', 'maxLoss', 'Daily max loss', 'text', 'e.g. 2R or $200')}${input('plan', 'bias', 'Market bias', 'text', 'Bullish USD, range on NAS…')}</div>
        <div class="grid" style="margin-top:10px">
          ${field('plan', 'levels', 'Key levels and news events', 3)}
          ${field('plan', 'plan', 'My plan: which setups, where and when', 3, 'I will only trade…')}
          ${field('plan', 'intent', 'Intention for today', 1, 'e.g. Be patient, wait for my level')}
        </div>
      </div>
      <div class="card"><h2>End-of-day review</h2>
        <div class="stat" style="margin-bottom:10px"><span class="label">Today's trades:</span> ${st.n} · <span class="${cls(st.totalR)}">${fmtR(st.totalR)}</span>${st.totalPnl !== null ? ' · ' + fmtMoney(st.totalPnl) : ''} · discipline ${st.cleanRate === null ? '—' : Math.round(st.cleanRate * 100) + '%'}</div>
        <div class="grid g2">
          <label class="f">Did I follow my plan?<select data-s="review" data-k="followedPlan">${['', 'Yes', 'Partly', 'No'].map((o) => `<option ${j.review.followedPlan === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
          ${input('review', 'rating', 'Discipline rating (1–10)', 'number')}
        </div>
        <h3>How I felt</h3>
        <div class="chips" id="emo">${EMOTIONS.map((e) => `<span class="chip ${j.review.emotions.includes(e) ? 'on' : ''}" data-v="${e}">${e}</span>`).join('')}</div>
        <div class="grid" style="margin-top:10px">
          ${field('review', 'good', 'What went well')}
          ${field('review', 'bad', 'What went wrong, and why')}
          ${field('review', 'tomorrow', 'Tomorrow I will…')}
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:16px"><h2>GoodNotes for this day</h2>${notesPanel('day-notes', 'Add GoodNotes notes for this day')}</div>
    ${dayTrades.length ? `<div class="card" style="margin-top:16px"><h2>Trades on this day</h2>${tradeTable(dayTrades)}</div>` : ''}
    <div class="card" style="margin-top:16px"><h2>Recent entries</h2>
      ${recent.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Plan followed</th><th class="num">Rating</th><th>Tomorrow I will…</th></tr></thead><tbody>
      ${recent.map((r) => `<tr class="click" data-day="${r.id}"><td>${fmtDate(r.id)}</td><td>${esc(r.review?.followedPlan || '—')}</td><td class="num">${esc(r.review?.rating ?? '—')}</td><td>${esc(r.review?.tomorrow || '')}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No journal entries yet.</div>'}</div>`;

  $$('#emo .chip').forEach((c) => (c.onclick = () => {
    const a = j.review.emotions, i = a.indexOf(c.dataset.v); i >= 0 ? a.splice(i, 1) : a.push(c.dataset.v); c.classList.toggle('on');
  }));
  const save = async (silent) => {
    $$('[data-s]').forEach((e) => (j[e.dataset.s][e.dataset.k] = e.type === 'number' ? num(e.value) : e.value));
    const hasContent = [...Object.values(j.plan), ...Object.values(j.review)].some((v) => (Array.isArray(v) ? v.length : v !== null && v !== ''));
    if (silent && !hasContent) return;
    j.updatedAt = new Date().toISOString();
    await DB.put('journal', j);
    S.journal = S.journal.filter((x) => x.id !== j.id).concat(j);
    if (!silent) toast('Journal saved');
  };
  $('#save').onclick = () => save();
  const nav = async (d) => { await save(true); go('journal', d); };
  $('#prev').onclick = () => nav(addDays(date, -1));
  $('#next').onclick = () => nav(addDays(date, 1));
  $('#jdate').onchange = (e) => e.target.value && nav(e.target.value);
  $$('[data-day]').forEach((r) => (r.onclick = () => nav(r.dataset.day)));
  bindNotesPanel('day-notes', () => S.notes.filter((n) => n.date === date), () => ({ date }));
  bindTradeRows();
}

// ---------- GoodNotes ----------
// A panel with note cards and an add button. It re-renders in place so unsaved form fields are kept.
function notesPanel(id, addLabel) {
  return `<div id="${id}"><div class="notes-list"></div>
    <div class="drop notes-drop" style="margin-top:8px">${addLabel}: drop a PDF or image exported from GoodNotes, or click to choose
      <input type="file" accept="application/pdf,image/*" multiple hidden></div></div>`;
}
function bindNotesPanel(id, list, context) {
  const root = $('#' + id); if (!root) return;
  const render = () => {
    const notes = list().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    $('.notes-list', root).innerHTML = notes.length ? Notes.cards(notes) : '<p class="muted" style="margin:0 0 4px;font-size:13px">No notes attached yet.</p>';
    bindNoteCards(root);
  };
  const drop = $('.notes-drop', root), input = $('input[type=file]', root);
  const add = async (files) => { if (await addNotes(files, context())) render(); };
  drop.onclick = () => input.click();
  input.onchange = () => { add(input.files); input.value = ''; };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('hover'); };
  drop.ondragleave = () => drop.classList.remove('hover');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('hover'); add(e.dataTransfer.files); };
  render();
}
async function addNotes(files, ctx) {
  const notes = await Notes.fromFiles([...files], ctx);
  for (const n of notes) { await DB.put('notes', n); S.notes.push(n); }
  if (notes.length) toast(`Added ${notes.length} note${notes.length > 1 ? 's' : ''}`);
  else if (files.length) toast('Choose a PDF or image exported from GoodNotes');
  return notes.length;
}
function bindNoteCards(root = document) {
  $$('[data-note]', root).forEach((c) => {
    c.onclick = (e) => { if (!e.target.closest('button')) Notes.view(S.notes.find((n) => n.id === c.dataset.note)); };
    c.onkeydown = (e) => { if (e.key === 'Enter') c.click(); };
  });
}

function viewNotes(editId) {
  const f = sessionStorage.getItem('notesQuery') || '';
  const notes = [...S.notes].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .filter((n) => !f || n.title.toLowerCase().includes(f.toLowerCase()));
  const editing = editId && S.notes.find((n) => n.id === editId);
  const tradeOpts = (sel) => `<option value="">— none —</option>` + sortTrades(S.trades).reverse().slice(0, 200)
    .map((t) => `<option value="${t.id}" ${sel === t.id ? 'selected' : ''}>${t.date} · ${esc(t.instrument)} ${esc(t.direction)} (${acctOf(t) === 'paper' ? 'paper' : 'real'})</option>`).join('');
  main().innerHTML = `
    <h1>GoodNotes</h1>
    <p class="sub">Your handwritten GoodNotes pages, kept next to your journal. They open view-only here; to change them, edit in GoodNotes and add the new export.</p>
    <div class="grid g2">
      <div class="card"><h2>Add notes</h2>
        <div class="grid g2">
          <label class="f">Date<input type="date" id="n-date" value="${today()}"></label>
          <label class="f">Link to a trade (optional)<select id="n-trade">${tradeOpts('')}</select></label>
        </div>
        <div class="drop" id="n-drop" style="margin-top:12px">Drop PDFs or images exported from GoodNotes here, or click to choose
          <input type="file" id="n-file" accept="application/pdf,image/*" multiple hidden></div>
      </div>
      <div class="card"><h2>How to export from GoodNotes</h2>
        <ol style="margin:0;padding-left:20px;line-height:1.8">
          <li>Open the notebook or page in GoodNotes.</li>
          <li>Tap the <b>Share / Export</b> button and choose <b>Export</b> (a page or the whole notebook).</li>
          <li>Pick <b>PDF</b> and save it to Files, iCloud Drive or your Mac.</li>
          <li>Add that file here. On a Mac, iCloud Drive files show up in Finder.</li>
        </ol>
      </div>
    </div>
    ${editing ? `<div class="card" style="margin-top:16px" id="n-edit"><h2>Edit note details</h2>
      <div class="grid g4">
        <label class="f">Title<input type="text" id="e-title" value="${esc(editing.title)}"></label>
        <label class="f">Date<input type="date" id="e-date" value="${esc(editing.date)}"></label>
        <label class="f">Linked trade<select id="e-trade">${tradeOpts(editing.tradeId)}</select></label>
        <label class="f">GoodNotes link (optional)<input type="text" id="e-link" value="${esc(editing.link || '')}" placeholder="Paste a link copied from GoodNotes"></label>
      </div>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="e-save">Save</button><button class="btn" id="e-cancel">Cancel</button></div></div>` : ''}
    <div class="card" style="margin-top:16px">
      <div class="row between"><h2 style="margin:0">All notes <span class="muted" style="font-weight:400">(${S.notes.length})</span></h2>
        <input type="text" id="n-q" value="${esc(f)}" placeholder="Search titles…" style="max-width:240px"></div>
      <div style="margin-top:12px">${notes.length ? Notes.cards(notes, { manage: true }) : `<div class="empty">${S.notes.length ? 'No notes match.' : 'No GoodNotes notes yet. Export a page from GoodNotes and add it above.'}</div>`}</div>
    </div>`;

  const drop = $('#n-drop'), input = $('#n-file');
  const add = async (files) => { if (await addNotes(files, { date: $('#n-date').value, tradeId: $('#n-trade').value })) viewNotes(); };
  drop.onclick = () => input.click();
  input.onchange = () => add(input.files);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('hover'); };
  drop.ondragleave = () => drop.classList.remove('hover');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('hover'); add(e.dataTransfer.files); };
  $('#n-q').oninput = (e) => { sessionStorage.setItem('notesQuery', e.target.value); viewNotes(); const q = $('#n-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); };
  bindNoteCards();
  $$('[data-note-edit]').forEach((b) => (b.onclick = () => viewNotes(b.dataset.noteEdit)));
  $$('[data-note-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Delete this note from the journal? Your original in GoodNotes is not affected.')) return;
    await DB.del('notes', b.dataset.noteDel); S.notes = S.notes.filter((n) => n.id !== b.dataset.noteDel); viewNotes();
  }));
  if (editing) {
    $('#n-edit').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#e-cancel').onclick = () => viewNotes();
    $('#e-save').onclick = async () => {
      Object.assign(editing, { title: $('#e-title').value.trim() || editing.title, date: $('#e-date').value || editing.date, tradeId: $('#e-trade').value || null, link: $('#e-link').value.trim() });
      await DB.put('notes', editing); toast('Note updated'); viewNotes();
    };
  }
}

// ---------- weekly review ----------
function viewWeekly(ws) {
  ws = weekStart(ws || today());
  const we = addDays(ws, 6);
  const w = structuredClone(S.weekly.find((x) => x.id === ws) || { id: ws });
  const tr = T().filter((t) => t.date >= ws && t.date <= we);
  const st = stats(tr);
  const days = S.journal.filter((j) => j.id >= ws && j.id <= we);
  const worstRule = st.byRuleBroken.sort((a, b) => b.n - a.n)[0];
  const worstMistake = [...st.byMistake][0];
  const f = (k, label, ph = '') => `<label class="f">${label}<textarea data-k="${k}" rows="3" placeholder="${ph}">${esc(w[k] || '')}</textarea></label>`;
  main().innerHTML = `
    <div class="row between"><div><h1>Weekly review</h1><p class="sub">${fmtDate(ws)} – ${fmtDate(we)}. Step back and look at the whole week.</p></div>
      <div class="row"><button class="btn" id="prev">← Prev week</button><button class="btn" id="next">Next week →</button><button class="btn primary" id="save">Save</button></div></div>
    <div class="grid g4">
      ${statTile('Net', fmtR(st.totalR), st.totalPnl !== null ? fmtMoney(st.totalPnl) : `${st.n} trades`, cls(st.totalR))}
      ${statTile('Win rate', st.winRate === null ? '—' : Math.round(st.winRate * 100) + '%', `${st.wins}W / ${st.losses}L`)}
      ${statTile('Discipline', st.cleanRate === null ? '—' : Math.round(st.cleanRate * 100) + '%', `${st.cleanN} of ${st.n} clean trades`)}
      ${statTile('Journal days', days.length, 'Days with a plan or review')}
    </div>
    <div class="notice" style="margin:16px 0">
      ${worstRule ? `Rule broken most: <b>${esc(worstRule.key)}</b> (${worstRule.n}×, ${fmtR(worstRule.R)}). ` : 'No rules broken this week. '}
      ${worstMistake ? `Costliest mistake: <b>${esc(worstMistake.key)}</b> (${fmtR(worstMistake.R)}).` : ''}
    </div>
    <div class="grid g2">
      <div class="card grid">
        ${f('best', 'Best trade by process, not profit, and why')}
        ${f('worst', 'Worst decision of the week, and what triggered it')}
        ${f('patterns', 'Patterns I notice (time, setup, emotion)')}
      </div>
      <div class="card grid">
        ${f('change', 'One thing I will change next week', 'Specific and measurable')}
        ${f('goals', 'Process goals for next week', 'e.g. 0 trades without a stop; journal every day')}
        <label class="f">Week rating (1–10)<input type="number" data-k="rating" min="1" max="10" value="${esc(w.rating ?? '')}"></label>
      </div>
    </div>
    ${tr.length ? `<div class="card" style="margin-top:16px"><h2>This week's trades</h2>${tradeTable(sortTrades(tr), false, true)}</div>` : ''}`;
  const save = async (silent) => {
    $$('[data-k]').forEach((e) => (w[e.dataset.k] = e.type === 'number' ? num(e.value) : e.value));
    await DB.put('weekly', w); S.weekly = S.weekly.filter((x) => x.id !== w.id).concat(w);
    if (!silent) toast('Weekly review saved');
  };
  $('#save').onclick = () => save();
  $('#prev').onclick = async () => { await save(true); go('weekly', addDays(ws, -7)); };
  $('#next').onclick = async () => { await save(true); go('weekly', addDays(ws, 7)); };
  bindTradeRows();
}

// ---------- rules ----------
function viewRules() {
  const st = stats(T());
  const brokenCount = Object.fromEntries(st.byRuleBroken.map((r) => [r.key, r]));
  const checked = (id) => T().filter((t) => t.ruleChecks && t.ruleChecks[id] !== undefined).length;
  main().innerHTML = `
    <h1>Rules and mistakes</h1><p class="sub">Your trading plan as a checklist. Every trade is scored against the active rules.</p>
    <div class="card"><h2>My rules</h2>
      <div class="table-wrap"><table><thead><tr><th>Rule</th><th>Category</th><th class="num">Adherence</th><th class="num">R when broken</th><th>Active</th><th></th></tr></thead><tbody>
      ${S.rules.map((r, i) => {
        const b = brokenCount[r.text], n = checked(r.id);
        const adh = n ? Math.round(((n - (b?.n || 0)) / n) * 100) + '%' : '—';
        return `<tr><td><input type="text" data-edit="${r.id}" value="${esc(r.text)}"></td>
          <td><select data-cat="${r.id}">${RULE_CATS.map((c) => `<option ${r.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
          <td class="num">${adh}${n ? `<br><span class="muted" style="font-size:12px">${n} trades</span>` : ''}</td>
          <td class="num ${cls(b?.R)}">${b ? fmtR(b.R) : '—'}</td>
          <td><input type="checkbox" data-active="${r.id}" ${r.active ? 'checked' : ''}></td>
          <td class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn small" data-up="${i}" ${i ? '' : 'disabled'}>↑</button><button class="btn small danger" data-delrule="${r.id}">✕</button></td></tr>`;
      }).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:12px"><input type="text" id="new-rule" placeholder="New rule, e.g. No trades in the first 5 minutes of the open" style="flex:1;min-width:220px">
        <select id="new-cat" style="width:auto">${RULE_CATS.map((c) => `<option>${c}</option>`).join('')}</select><button class="btn primary" id="add-rule">Add rule</button></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Mistake tags</h2>
      <div class="chips">${S.mistakes.map((m) => `<span class="chip">${esc(m)} <a href="#" data-delm="${esc(m)}" style="color:inherit;text-decoration:none" aria-label="Remove">✕</a></span>`).join('')}</div>
      <div class="row" style="margin-top:12px"><input type="text" id="new-m" placeholder="New mistake tag" style="max-width:280px"><button class="btn" id="add-m">Add tag</button></div>
    </div>`;
  const saveRule = async (r) => { await DB.put('rules', r); };
  $$('[data-edit]').forEach((e) => (e.onchange = () => { const r = S.rules.find((x) => x.id === e.dataset.edit); r.text = e.value.trim(); saveRule(r); toast('Rule updated'); }));
  $$('[data-cat]').forEach((e) => (e.onchange = () => { const r = S.rules.find((x) => x.id === e.dataset.cat); r.category = e.value; saveRule(r); }));
  $$('[data-active]').forEach((e) => (e.onchange = () => { const r = S.rules.find((x) => x.id === e.dataset.active); r.active = e.checked; saveRule(r); }));
  $$('[data-up]').forEach((b) => (b.onclick = async () => {
    const i = +b.dataset.up; [S.rules[i - 1], S.rules[i]] = [S.rules[i], S.rules[i - 1]];
    S.rules.forEach((r, k) => (r.order = k)); for (const r of S.rules) await saveRule(r); viewRules();
  }));
  $$('[data-delrule]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Delete this rule? Past trades keep their checklist results, but the rule name will show as deleted. To keep history, untick Active instead.')) return;
    await DB.del('rules', b.dataset.delrule); S.rules = S.rules.filter((r) => r.id !== b.dataset.delrule); viewRules();
  }));
  $('#add-rule').onclick = async () => {
    const text = $('#new-rule').value.trim(); if (!text) return;
    const r = { id: uid(), text, category: $('#new-cat').value, active: true, order: S.rules.length };
    await saveRule(r); S.rules.push(r); viewRules();
  };
  $$('[data-delm]').forEach((a) => (a.onclick = async (e) => { e.preventDefault(); S.mistakes = S.mistakes.filter((m) => m !== a.dataset.delm); await DB.setMeta('mistakes', S.mistakes); viewRules(); }));
  $('#add-m').onclick = async () => { const v = $('#new-m').value.trim(); if (!v || S.mistakes.includes(v)) return; S.mistakes.push(v); await DB.setMeta('mistakes', S.mistakes); viewRules(); };
}

// ---------- AI coach ----------
const r2 = (v) => (v === null || v === undefined || !isFinite(v) ? v : Math.round(v * 100) / 100);
function tradeForCoach(t) {
  return {
    date: t.date, time: t.time, market: t.market, instrument: t.instrument, direction: t.direction, setup: t.setup, session: t.session, timeframe: t.timeframe,
    enteredAs: isDollar(t) ? 'dollar amounts' : 'price levels', entry: t.entry, stop: t.stop, target: t.target, exit: t.exit,
    entryValue: t.entryAmt, stopLossAmount: t.riskAmt, takeProfitAmount: t.rewardAmt, riskAmount: r2(riskMoney(t)), size: t.size, plannedRR: r2(plannedRR(t)), R: r2(tradeR(t)), pnl: t.pnl,
    status: isOpen(t) ? 'open' : 'closed', reviewed: isReviewed(t),
    rulesBroken: brokenRules(t).map(ruleName), mistakes: t.mistakes, emotionBefore: t.emotionBefore, emotionAfter: t.emotionAfter,
    pips: t.market === 'Forex' ? r2(tradePips(t)) : undefined, stopPips: r2(stopPips(t)) ?? undefined,
    option: t.market === 'Options' ? { type: t.optionType, strike: t.strike, expiry: t.expiry } : undefined,
    confidence: t.confidence, grade: t.grade, notes: t.notes, lesson: t.lesson,
  };
}
function coachPayload(days) {
  const from = days ? addDays(today(), -days + 1) : '0000';
  const trades = sortTrades(T().filter((t) => t.date >= from));
  const st = stats(trades);
  const grp = (g) => g.map((x) => ({ key: x.key, trades: x.n, wins: x.wins, netR: r2(x.R) }));
  return {
    period: days ? `last ${days} days (${from} to ${today()})` : 'all time',
    account: { type: S.account === 'paper' ? 'paper trading (simulated money)' : 'live trading (real money)', currency: S.settings.currency, size: accountSize(S.account), plannedRiskPct: S.settings.riskPct || null },
    markets: MARKET_GROUPS[S.marketGroup],
    rules: S.rules.filter((r) => r.active).map((r) => `[${r.category}] ${r.text}`),
    summary: {
      trades: st.n, wins: st.wins, losses: st.losses, winRate: r2(st.winRate), netR: r2(st.totalR), expectancyR: r2(st.avgR),
      avgWinR: r2(st.avgWinR), avgLossR: r2(st.avgLossR), profitFactor: r2(st.profitFactor), netPnl: r2(st.totalPnl), maxDrawdownR: r2(st.maxDD),
      disciplineRate: r2(st.cleanRate), avgR_whenAllRulesFollowed: r2(st.cleanAvgR), avgR_whenRulesBrokenOrMistake: r2(st.dirtyAvgR),
      byMistake: grp(st.byMistake), byRuleBroken: grp(st.byRuleBroken), bySetup: grp(st.bySetup), bySession: grp(st.bySession),
      byMarket: grp(st.byMarket), byInstrument: grp(st.byInstrument), byWeekday: grp(st.byDay), byEmotionBefore: grp(st.byEmotion),
    },
    trades: trades.map(tradeForCoach),
    dailyJournal: S.journal.filter((j) => j.id >= from).sort((a, b) => a.id.localeCompare(b.id)).map((j) => ({ date: j.id, plan: j.plan, review: j.review })),
    weeklyReviews: S.weekly.filter((w) => addDays(w.id, 6) >= from),
  };
}
function coachPrompt(days) {
  return `Here is my ${S.account === 'paper' ? 'PAPER trading (demo, simulated money)' : 'REAL-MONEY trading'} journal for the ${days ? `last ${days} days` : 'full history'} as JSON.${S.account === 'paper' ? ' Also tell me whether my process looks ready to move to real money, and what to prove first.' : ''} Review it and coach me.\n\n<journal>\n${JSON.stringify(coachPayload(days), null, 1)}\n</journal>`;
}

let coachConvo = null; // { messages, reportId }
function viewCoach() {
  const hasKey = !!S.apiKey;
  const reports = [...S.coach].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const recentTrades = sortTrades(T()).reverse().slice(0, 50);
  main().innerHTML = `
    <h1>AI coach</h1><p class="sub">Claude reads your trades, rules and journal, then tells you where you're leaking and what to work on next.</p>
    ${hasKey ? '' : `<div class="notice" style="margin-bottom:16px">To run reviews here, add your Anthropic API key in <a href="#settings">Settings</a>. Without a key you can still use <b>Copy for Claude.ai</b> and paste the result into a chat on claude.ai.</div>`}
    <div class="grid g2">
      <div class="card"><h2>Performance review</h2>
        <p class="muted" style="margin-top:-6px">Looks at every trade, rule break, mistake, emotion and journal entry in the period.</p>
        <div class="row"><select id="c-days" style="width:auto"><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option><option value="0">All time</option></select>
          <button class="btn primary" id="c-run" ${hasKey ? '' : 'disabled'}>Run review</button><button class="btn" id="c-copy">Copy for Claude.ai</button></div>
      </div>
      <div class="card"><h2>Review a single trade</h2>
        <p class="muted" style="margin-top:-6px">Includes your chart screenshots so Claude can comment on the entry, stop and exit.</p>
        <div class="row"><select id="c-trade" style="flex:1;min-width:200px">${recentTrades.map((t) => `<option value="${t.id}">${t.date} · ${esc(t.instrument)} ${esc(t.direction)} · ${fmtR(tradeR(t))}</option>`).join('') || '<option value="">No trades yet</option>'}</select>
          <button class="btn primary" id="c-trade-run" ${hasKey && recentTrades.length ? '' : 'disabled'}>Review trade</button></div>
      </div>
    </div>
    <div class="card" id="c-out-card" style="margin-top:16px;display:none">
      <div id="c-thread"></div>
      <div class="coach-out" id="c-out"></div>
      <div class="row" id="c-follow" style="margin-top:12px;display:none"><input type="text" id="c-q" placeholder="Ask a follow-up, e.g. How do I stop revenge trading after a loss?" style="flex:1"><button class="btn primary" id="c-ask">Ask</button></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Past reviews</h2>
      ${reports.length ? `<div class="table-wrap"><table><tbody>${reports.map((r) => `<tr class="click" data-rep="${r.id}"><td>${new Date(r.createdAt).toLocaleString()}</td><td>${esc(r.title)}</td><td><button class="btn small danger" data-delrep="${r.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No reviews yet.</div>'}
    </div>
    <p class="muted" style="font-size:12px">Uses ${Coach.MODEL}. A 30-day review usually costs a few cents to a few tens of cents in API usage. This is coaching on process and discipline, not financial advice.</p>`;

  const out = $('#c-out'), card = $('#c-out-card');
  const showThread = (messages) => {
    // Earlier turns (after the first prompt) shown above the live output.
    $('#c-thread').innerHTML = messages.slice(1).map((m) => m.role === 'user'
      ? `<div class="msg user"><b>You:</b> ${esc(typeof m.content === 'string' ? m.content : m.content.find((b) => b.type === 'text')?.text)}</div>`
      : `<div class="coach-out">${md(m.content.filter((b) => b.type === 'text').map((b) => b.text).join(''))}</div><hr style="border:0;border-top:1px solid var(--border)">`).join('');
  };
  const run = async (messages, title, reportId) => {
    card.style.display = 'block'; $('#c-follow').style.display = 'none';
    showThread(messages);
    out.innerHTML = '<p class="muted">Claude is reading your journal…</p>';
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $$('#c-run, #c-trade-run, #c-ask').forEach((b) => (b.disabled = true));
    let text = '';
    try {
      const res = await Coach.run({ apiKey: S.apiKey, messages, onText: (t) => { text += t; out.innerHTML = md(text); } });
      out.innerHTML = md(res.text);
      messages.push({ role: 'assistant', content: res.content.filter((b) => b.type === 'text') });
      const rep = { id: reportId || uid(), createdAt: reportId ? S.coach.find((r) => r.id === reportId)?.createdAt || new Date().toISOString() : new Date().toISOString(), title, messages: stripImages(messages) };
      await DB.put('coach', rep); S.coach = S.coach.filter((r) => r.id !== rep.id).concat(rep);
      coachConvo = { messages, reportId: rep.id, title };
      $('#c-follow').style.display = 'flex';
    } catch (err) {
      out.innerHTML = `<div class="notice neg">${esc(Coach.explainError(err))}</div>` + (text ? md(text) : '');
      messages.pop();
    } finally {
      $$('#c-run, #c-trade-run, #c-ask').forEach((b) => (b.disabled = !S.apiKey));
    }
  };

  $('#c-run').onclick = () => {
    const d = +$('#c-days').value;
    const label = `${S.account === 'paper' ? 'Paper' : 'Real money'} review: ${d ? `last ${d} days` : 'all time'}`;
    run([{ role: 'user', content: coachPrompt(d) }], label);
  };
  $('#c-copy').onclick = async () => {
    const d = +$('#c-days').value;
    const txt = `Act as my trading performance coach. Focus on discipline, rule adherence, risk management and psychology, not trade calls. Use evidence from the data, measure in R, and finish with 3 concrete actions for next week plus the one rule to protect above all.\n\n` + coachPrompt(d);
    try { await navigator.clipboard.writeText(txt); toast('Copied. Paste it into a chat on claude.ai'); }
    catch { const w = window.open('', '_blank'); w.document.write(`<pre style="white-space:pre-wrap">${esc(txt)}</pre>`); }
  };
  $('#c-trade-run').onclick = () => {
    const t = S.trades.find((x) => x.id === $('#c-trade').value); if (!t) return;
    const data = tradeForCoach(t);
    const content = [
      ...(t.images || []).slice(0, 4).map((src) => ({ type: 'image', source: { type: 'base64', media_type: src.slice(5, src.indexOf(';')), data: src.split(',')[1] } })),
      { type: 'text', text: `Review this single trade in depth${t.images?.length ? ' (chart screenshots attached)' : ''}. Assess the entry, stop placement, target, management and exit against my rules, and tell me what an A+ version of this trade would have looked like. For this single-trade review, use the sections: ## Verdict, ## Entry, ## Risk & stop, ## Management & exit, ## Psychology, ## Lesson to carry forward.\n\nMy rules:\n${S.rules.filter((r) => r.active).map((r) => '- ' + r.text).join('\n')}\n\nTrade:\n${JSON.stringify(data, null, 1)}` },
    ];
    run([{ role: 'user', content }], `${acctOf(t) === 'paper' ? 'Paper trade' : 'Trade'} review: ${t.date} ${t.instrument} ${t.direction}`);
  };
  $('#c-ask').onclick = () => {
    const q = $('#c-q').value.trim(); if (!q || !coachConvo) return;
    coachConvo.messages.push({ role: 'user', content: q }); $('#c-q').value = '';
    run(coachConvo.messages, coachConvo.title, coachConvo.reportId);
  };
  $('#c-q').onkeydown = (e) => { if (e.key === 'Enter') $('#c-ask').click(); };
  $$('[data-rep]').forEach((row) => (row.onclick = (e) => {
    if (e.target.dataset.delrep) return;
    const r = S.coach.find((x) => x.id === row.dataset.rep);
    const last = r.messages.at(-1);
    card.style.display = 'block';
    showThread(r.messages.slice(0, -1));
    out.innerHTML = md(last.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
    coachConvo = { messages: structuredClone(r.messages), reportId: r.id, title: r.title };
    $('#c-follow').style.display = S.apiKey ? 'flex' : 'none';
    card.scrollIntoView({ behavior: 'smooth' });
  }));
  $$('[data-delrep]').forEach((b) => (b.onclick = async () => {
    await DB.del('coach', b.dataset.delrep); S.coach = S.coach.filter((r) => r.id !== b.dataset.delrep); viewCoach();
  }));
}
function stripImages(messages) {
  // Keep saved reviews small: replace screenshots with a placeholder when storing.
  return messages.map((m) => (Array.isArray(m.content) && m.role === 'user'
    ? { ...m, content: m.content.map((b) => (b.type === 'image' ? { type: 'text', text: '[chart screenshot]' } : b)) }
    : m));
}

// ---------- settings ----------
function viewSettings() {
  const s = S.settings;
  main().innerHTML = `
    <h1>Settings</h1><p class="sub">${Sync.user() ? 'Your journal is saved on this device and synced to your cloud database.' : 'Everything is stored in this browser on this device. Export a backup regularly, or turn on cloud sync.'}</p>
    <div class="grid g2">
      <div class="card grid"><h2>Account</h2>
        <div class="grid g3">
          <label class="f">Currency<input type="text" id="currency" value="${esc(s.currency || 'USD')}" maxlength="3"></label>
          <label class="f">Real money account size<input type="number" id="accountSize" value="${esc(s.accountSize || '')}"></label>
          <label class="f">Paper account size<input type="number" id="paperAccountSize" value="${esc(s.paperAccountSize || '')}"></label>
          <label class="f">Risk per trade (%)<input type="number" step="any" id="riskPct" value="${esc(s.riskPct ?? 1)}"></label>
        </div>
        <label class="f">Theme<select id="theme">${['system', 'light', 'dark'].map((t) => `<option ${s.theme === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <div><button class="btn primary" id="save-s">Save settings</button></div>
      </div>
      <div class="card grid" id="sync-card"></div>
      <div class="card grid"><h2>AI coach (Anthropic API key)</h2>
        <p class="muted" style="margin:0">Get a key at console.anthropic.com. The key is stored only in this browser, is sent only to Anthropic, and is left out of backups.</p>
        <label class="f">API key<input type="password" id="apiKey" value="${esc(S.apiKey)}" placeholder="sk-ant-…" autocomplete="off"></label>
        <div class="row"><button class="btn primary" id="save-key">Save key</button>${S.apiKey ? '<button class="btn danger" id="rm-key">Remove key</button>' : ''}</div>
      </div>
      <div class="card grid"><h2>Calendar</h2>
        <p class="muted" style="margin:0">Earnings dates come from Alpha Vantage. Get a free key at alphavantage.co and paste it here. Like your Claude key, it's left out of backups.</p>
        <label class="f">Alpha Vantage API key<input type="password" id="avKey" value="${esc(S.avKey)}" autocomplete="off"></label>
        <label class="f">Extra tickers to watch<input type="text" id="watchTickers" value="${esc(s.watchTickers || '')}" placeholder="e.g. NVDA, MSFT, SPY"><span class="hint">Stocks you trade are added automatically</span></label>
        <div><button class="btn primary" id="save-cal">Save calendar settings</button></div>
      </div>
      <div class="card grid"><h2>Live prices</h2>
        <p class="muted" style="margin:0">Shows whether your open trades are winning or losing right now. Get a free key at twelvedata.com (Sign up → API key). Like your other keys, it stays on this device.</p>
        <label class="f">Twelve Data API key<input type="password" id="tdKey" value="${esc(S.tdKey || '')}" autocomplete="off"></label>
        <div><button class="btn primary" id="save-td">Save key</button></div>
      </div>
      <div class="card grid"><h2>App version</h2>
        <p class="muted" style="margin:0">Version ${APP_VERSION}. The app checks for a newer version each time you open it. If something looks out of date, tap below.</p>
        <div><button class="btn" id="check-update">Check for updates</button> <button class="btn" id="force-update">Reload latest version</button></div>
      </div>
      <div class="card grid"><h2>Backup</h2>
        <p class="muted" style="margin:0">Export everything (trades, screenshots, journal, rules, reviews) to one file. Import merges a backup back in.</p>
        <div class="row"><button class="btn" id="export">Export backup</button><button class="btn" id="import">Import backup</button><input type="file" id="import-file" accept="application/json" hidden></div>
        <div class="row"><button class="btn" id="csv">Export trades as CSV</button></div>
      </div>
      <div class="card grid"><h2>Danger zone</h2>
        <p class="muted" style="margin:0">Permanently delete all journal data from this browser. Export a backup first.</p>
        <div><button class="btn danger" id="wipe">Delete all data</button></div>
      </div>
    </div>`;
  renderSyncCard();
  $('#check-update').onclick = () => checkForUpdate(true);
  $('#save-td').onclick = async () => { S.tdKey = $('#tdKey').value.trim(); await DB.setMeta('tdKey', S.tdKey); toast(S.tdKey ? 'Live prices key saved' : 'Live prices key removed'); };
  $('#force-update').onclick = applyUpdate;
  $('#save-s').onclick = async () => {
    S.settings = { ...S.settings, currency: ($('#currency').value || 'USD').toUpperCase(), accountSize: num($('#accountSize').value), paperAccountSize: num($('#paperAccountSize').value), riskPct: num($('#riskPct').value), theme: $('#theme').value };
    await DB.setMeta('settings', S.settings); applyTheme(); toast('Settings saved');
  };
  $('#save-cal').onclick = async () => {
    const key = $('#avKey').value.trim();
    if (key !== S.avKey) await DB.setMeta('earnings', null); // new key: fetch fresh
    S.avKey = key; await DB.setMeta('avKey', key);
    S.settings = { ...S.settings, watchTickers: $('#watchTickers').value.trim() };
    await DB.setMeta('settings', S.settings); toast('Calendar settings saved');
  };
  $('#save-key').onclick = async () => { S.apiKey = $('#apiKey').value.trim(); await DB.setMeta('apiKey', S.apiKey); toast('API key saved'); viewSettings(); };
  if (S.apiKey) $('#rm-key').onclick = async () => { S.apiKey = ''; await DB.setMeta('apiKey', ''); toast('API key removed'); viewSettings(); };
  const download = (name, text, type) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#export').onclick = async () => download(`trading-journal-backup-${today()}.json`, JSON.stringify(await DB.exportAll()), 'application/json');
  $('#import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = async (e) => {
    try { await DB.importAll(JSON.parse(await e.target.files[0].text())); await load(); toast('Backup imported'); route(); }
    catch (err) { alert('Import failed: ' + err.message); }
  };
  $('#csv').onclick = () => {
    const cols = ['account', 'date', 'time', 'market', 'instrument', 'direction', 'setup', 'session', 'timeframe', 'size', 'inputMode', 'entry', 'stop', 'target', 'exit', 'entryAmt', 'riskAmt', 'rewardAmt', 'pnl', 'R', 'pips', 'optionType', 'strike', 'expiry', 'rulesBroken', 'mistakes', 'emotionBefore', 'emotionAfter', 'confidence', 'grade', 'notes', 'lesson'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = sortTrades(S.trades).map((t) => cols.map((c) => q(
      c === 'account' ? acctOf(t) : c === 'R' ? tradeR(t)?.toFixed(2) : c === 'pips' ? tradePips(t)?.toFixed(1) : c === 'rulesBroken' ? brokenRules(t).map(ruleName).join('; ') : Array.isArray(t[c]) ? t[c].join('; ') : t[c])).join(','));
    download(`trades-${today()}.csv`, [cols.join(','), ...rows].join('\n'), 'text/csv');
  };
  $('#wipe').onclick = async () => {
    const cloud = !!Sync.user();
    const msg = cloud ? 'Type DELETE to permanently erase all journal data on this device AND in your cloud sync (every device).' : 'Type DELETE to permanently erase all journal data in this browser.';
    if (prompt(msg) !== 'DELETE') return;
    if (cloud) { try { await Sync.deleteCloudData(); } catch (e) { return alert('Could not delete the cloud copy: ' + e.message); } }
    const keep = await DB.getMeta('syncConfig', null); // stay connected to the same project
    for (const s of DB.STORES) await DB.clear(s);
    if (keep) await DB.setMeta('syncConfig', keep);
    await load(); toast('All data deleted'); go('dashboard');
  };
}

// Cloud sync panel in Settings: connect a Supabase project, sign in, see status.
function renderSyncCard() {
  const card = $('#sync-card'); if (!card) return;
  const st = Sync.status(), cfg = Sync.config(), user = Sync.user();
  const when = st.at ? new Date(st.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  card.innerHTML = `<h2>Cloud sync (Mac ↔ iPhone)</h2>
    ${!cfg ? `
      <p class="muted" style="margin:0">Keep one journal on all your devices using your own free Supabase database. Follow <b>SETUP-IPHONE.md</b> in the trading-journal folder, then paste your project's details here.</p>
      <label class="f">Project URL<input type="text" id="sb-url" placeholder="https://abcd1234.supabase.co" autocomplete="off"></label>
      <label class="f">Anon public key<input type="password" id="sb-key" placeholder="eyJ… or sb_publishable_…" autocomplete="off"></label>
      <div><button class="btn primary" id="sb-save">Connect</button></div>`
    : !user ? `
      <p class="muted" style="margin:0">Connected to <b>${esc(cfg.url.replace('https://', ''))}</b>. Sign in with the same email and password on every device.</p>
      <label class="f">Email<input type="email" id="sb-email" autocomplete="username"></label>
      <label class="f">Password<input type="password" id="sb-pass" autocomplete="current-password"></label>
      <div class="row"><button class="btn primary" id="sb-in">Sign in</button><button class="btn" id="sb-up">Create account</button><button class="btn danger" id="sb-forget">Disconnect project</button></div>`
    : `
      <p style="margin:0">Signed in as <b>${esc(user.email)}</b></p>
      <p class="muted" style="margin:0">${st.state === 'syncing' ? 'Syncing…' : st.state === 'synced' ? `Up to date · last synced ${when}` : st.state === 'offline' ? 'Offline: changes are saved here and will sync when you reconnect.' : st.state === 'error' ? '' : ''}
        ${Sync.pending() ? ` · ${Sync.pending()} change${Sync.pending() > 1 ? 's' : ''} waiting to upload` : ''}</p>
      <div class="row"><button class="btn primary" id="sb-now">Sync now</button><button class="btn" id="sb-out">Sign out</button></div>`}
    ${st.error ? `<div class="notice neg" style="margin:0">${esc(st.error)}</div>` : ''}
    <p class="muted" style="margin:0;font-size:12px">Your API keys (Claude, Alpha Vantage) never leave this device. Enter them on each device.</p>`;
  const run = (btn, fn) => async () => {
    btn.disabled = true;
    try { await fn(); } catch (e) { alert(e.message || String(e)); } finally { renderSyncCard(); }
  };
  if (!cfg) $('#sb-save').onclick = run($('#sb-save'), () => Sync.configure($('#sb-url').value, $('#sb-key').value));
  else if (!user) {
    const creds = () => { const e = $('#sb-email').value.trim(), p = $('#sb-pass').value; if (!e || p.length < 8) throw new Error('Enter your email and a password of at least 8 characters.'); return [e, p]; };
    $('#sb-in').onclick = run($('#sb-in'), async () => { await Sync.signIn(...creds()); toast('Signed in. Syncing your journal…'); });
    $('#sb-up').onclick = run($('#sb-up'), async () => {
      const r = await Sync.signUp(...creds());
      if (r === 'confirm') alert('Account created. Check your email and click the confirmation link, then come back and sign in.');
      else toast('Account created. Syncing your journal…');
    });
    $('#sb-forget').onclick = run($('#sb-forget'), async () => { if (confirm('Disconnect this device from the Supabase project? Your data stays on this device.')) await Sync.forget(); });
  } else {
    $('#sb-now').onclick = run($('#sb-now'), () => Sync.syncNow());
    $('#sb-out').onclick = run($('#sb-out'), async () => { if (confirm('Sign out of cloud sync on this device? Your data stays on this device.')) await Sync.signOut(); });
  }
}
// Small sync status button in the top bar (hidden until sync is set up).
function renderSyncPill(st) {
  const pill = $('#sync-pill'); if (!pill) return;
  pill.hidden = st.state === 'off';
  pill.dataset.state = st.state;
  pill.textContent = { 'signed-out': 'Sync: signed out', syncing: 'Syncing…', synced: 'Synced', offline: 'Offline', error: 'Sync problem' }[st.state] || '';
  pill.title = st.error || (st.at ? `Last synced ${new Date(st.at).toLocaleTimeString()}` : '');
  // Refresh the Settings panel too, unless you're typing in it.
  if (location.hash.startsWith('#settings') && !$('#sync-card')?.contains(document.activeElement)) renderSyncCard();
}

// ---------- app updates ----------
// Bump APP_VERSION (and version.json, and the ?v= in index.html) with every release. The installed app compares
// itself to version.json, which is always fetched fresh, and offers a one-tap update that clears the saved copy.
const APP_VERSION = '2026-09-30.6';
async function checkForUpdate(manual = false) {
  if (location.protocol !== 'https:') { if (manual) toast('Updates apply to the online app only'); return; }
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    const { version } = await res.json();
    if (version && version !== APP_VERSION) showUpdateBanner();
    else if (manual) toast('You have the latest version');
  } catch { if (manual) toast("Couldn't check for updates. Are you online?"); }
}
function showUpdateBanner() {
  if ($('#update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'update-banner'; bar.className = 'update-banner';
  bar.innerHTML = '<span>A new version of your journal is ready.</span><button class="btn small primary">Update now</button>';
  bar.querySelector('button').onclick = applyUpdate;
  $('header.topbar').appendChild(bar);
}
async function applyUpdate() {
  try {
    for (const r of (await navigator.serviceWorker?.getRegistrations?.()) || []) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  } catch { /* nothing cached */ }
  location.replace(location.pathname + '?v=' + Date.now() + location.hash);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });

// ---------- start ----------
window.addEventListener('hashchange', route);
document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) { moreSheet(false); go(b.dataset.go); } });
$$('#acct button, #acct-m button').forEach((b) => (b.onclick = () => setAccount(b.dataset.acct)));
$('#mkt').onchange = $('#mkt-m').onchange = (e) => setMarketGroup(e.target.value);
$('#top-log').onclick = $('#tab-log').onclick = () => go('trade', 'new');
// Phone "More" sheet.
const moreSheet = (open) => { $('#more-sheet').hidden = !open; document.body.classList.toggle('sheet-open', open); };
$('#tab-more').onclick = () => moreSheet($('#more-sheet').hidden);
$('[data-close-sheet]').onclick = () => moreSheet(false);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#more-sheet').hidden) moreSheet(false); });
$('#sync-pill').onclick = () => go('settings');
load().then(async () => {
  route();
  checkForUpdate();
  Sync.onStatus(renderSyncPill);
  await Sync.init();
}).catch((err) => {
  main().innerHTML = `<div class="notice neg">Could not open the local database: ${esc(err.message)}. Try opening this file in Chrome.</div>`;
});
// Service worker: lets the installed app open offline. Only works on https (e.g. GitHub Pages), not file://.
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

