// To-do lists: one checklist per day, your own categories, and a routine that repeats on the days you choose.
// Stored in meta:
//   'todo:YYYY-MM-DD' = [{ id, text, tag, time, note, done, routine }]   (one record per day; tag = category name)
//   'todoRoutine' = [{ id, text, tag, time, days }]   (days: 0=Mon … 6=Sun; empty = every day)
//   'todoCats'    = [{ id, name, color }]

const TODO_COLORS = ['#3987e5', '#1baf7a', '#7b6fd6', '#e87ba4', '#eb6834', '#2f9e44', '#eda100', '#e34948'];
const DEFAULT_CATS = [['Pre-market', 0], ['Trading', 5], ['Review', 2], ['Personal', 3], ['Health', 1], ['Family', 4]];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_ROUTINE = [
  { text: 'Check the forex calendar for high-impact news', tag: 'Pre-market', time: '', days: [] },
  { text: 'Write my pre-market plan', tag: 'Pre-market', time: '', days: [] },
  { text: 'Journal every trade and review it', tag: 'Review', time: '', days: [] },
];
let todoEdit = null; // { kind: 'item', date, id } or { kind: 'routine', id } while an edit form is open

async function loadTodos() {
  if (!S.todos) {
    S.todos = {};
    // Older versions kept every day in one record; split it into one record per day.
    const legacy = await DB.getMeta('todos', null);
    if (legacy) { for (const [d, items] of Object.entries(legacy)) await DB.setMeta('todo:' + d, items); await DB.del('meta', 'todos'); }
    for (const m of await DB.listMeta('todo:')) S.todos[m.id.slice(5)] = m.value;
  }
  if (!S.todoCats) {
    S.todoCats = await DB.getMeta('todoCats', null);
    if (!S.todoCats) { S.todoCats = DEFAULT_CATS.map(([name, c]) => ({ id: uid(), name, color: TODO_COLORS[c] })); await DB.seedMeta('todoCats', S.todoCats); }
  }
  if (!S.todoRoutine) {
    S.todoRoutine = await DB.getMeta('todoRoutine', null);
    if (!S.todoRoutine) { S.todoRoutine = DEFAULT_ROUTINE.map((r) => ({ id: uid(), ...r })); await DB.seedMeta('todoRoutine', S.todoRoutine); }
  }
}
// One record per day ('todo:YYYY-MM-DD') so edits to different days never overwrite each other when syncing.
// With no date, every day is saved (only needed after renaming or deleting a category).
const saveTodos = (date) => (date ? DB.setMeta('todo:' + date, S.todos[date] || [])
  : Promise.all(Object.keys(S.todos).map((d) => DB.setMeta('todo:' + d, S.todos[d]))));
const saveRoutine = () => DB.setMeta('todoRoutine', S.todoRoutine);
const saveCats = () => DB.setMeta('todoCats', S.todoCats);

const weekdayIdx = (date) => (new Date(date + 'T12:00').getDay() + 6) % 7;
const routineApplies = (r, date) => !r.days?.length || r.days.includes(weekdayIdx(date));
function daysLabel(days) {
  if (!days?.length || days.length === 7) return 'Every day';
  const s = [...days].sort().join();
  if (s === '0,1,2,3,4') return 'Weekdays';
  if (s === '5,6') return 'Weekends';
  return [...days].sort().map((d) => DAY_NAMES[d]).join(', ');
}
const catColor = (name) => S.todoCats.find((c) => c.name === name)?.color || 'var(--muted)';
const catChip = (name) => (name ? `<span class="cat-chip"><i style="background:${catColor(name)}"></i>${esc(name)}</span>` : '');
const catOptions = (sel) => `<option value="">No category</option>` + S.todoCats.map((c) => `<option ${c.name === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

// A day's list. Today and future days get their routine items the first time they are opened.
function todoList(date) {
  if (!S.todos[date]) {
    if (date < today()) return [];
    S.todos[date] = S.todoRoutine.filter((r) => routineApplies(r, date))
      .map((r) => ({ id: uid(), text: r.text, tag: r.tag, time: r.time || '', note: '', done: false, routine: true }));
    DB.seedMeta('todo:' + date, S.todos[date]); // untouched routine copy: never overrides another device
  }
  return S.todos[date];
}
function dayLabel(d) {
  if (d === today()) return 'Today';
  if (d === addDays(today(), 1)) return 'Tomorrow';
  if (d === addDays(today(), -1)) return 'Yesterday';
  return new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'long' });
}

// ---------- rendering ----------
function itemEditForm(i, attrs) {
  return `<li class="todo-item editing"><div class="todo-edit" ${attrs}>
    <input type="text" class="te-text" value="${esc(i.text)}" aria-label="Item text">
    <select class="te-tag" aria-label="Category">${catOptions(i.tag)}</select>
    <input type="time" class="te-time" value="${esc(i.time || '')}" aria-label="Time (optional)">
    <input type="text" class="te-note" value="${esc(i.note || '')}" placeholder="Note (optional)" aria-label="Note">
    ${'days' in i ? `<div class="day-picks">${DAY_NAMES.map((n, d) => `<label><input type="checkbox" class="te-day" value="${d}" ${i.days?.includes(d) ? 'checked' : ''}>${n}</label>`).join('')}<span class="hint">None ticked = every day</span></div>` : ''}
    <div class="row" style="gap:6px"><button class="btn small primary" data-act="save">Save</button><button class="btn small" data-act="cancel">Cancel</button></div>
  </div></li>`;
}

function itemRow(i, date, idx, len) {
  if (todoEdit?.kind === 'item' && todoEdit.date === date && todoEdit.id === i.id) return itemEditForm(i, `data-date="${date}" data-id="${i.id}"`);
  const a = `data-date="${date}" data-id="${i.id}"`;
  return `<li class="todo-item ${i.done ? 'done' : ''}">
    <label><input type="checkbox" data-check ${a} ${i.done ? 'checked' : ''}><span class="todo-text">${esc(i.text)}</span></label>
    ${i.time ? `<span class="todo-time">${esc(i.time)}</span>` : ''}${catChip(i.tag)}
    <span class="todo-actions">
      <button data-act="edit" ${a} title="Edit" aria-label="Edit">✎</button>
      <button data-act="up" ${a} ${idx ? '' : 'disabled'} title="Move up" aria-label="Move up">↑</button>
      <button data-act="down" ${a} ${idx < len - 1 ? '' : 'disabled'} title="Move down" aria-label="Move down">↓</button>
      <button data-act="del" ${a} class="danger" title="Delete" aria-label="Delete">✕</button>
    </span>
    ${i.note ? `<div class="todo-note">${esc(i.note)}</div>` : ''}
  </li>`;
}

function todoCard(date, filter) {
  const all = todoList(date);
  const items = filter ? all.filter((i) => i.tag === filter) : all;
  const done = items.filter((i) => i.done).length;
  return `<div class="card todo-card" data-card="${date}">
    <div class="row between"><div><h2 style="margin:0">${dayLabel(date)}</h2><span class="muted" style="font-size:13px">${fmtDate(date)}${filter ? ` · ${esc(filter)} only` : ''}</span></div>
      <span class="muted" style="font-size:13px">${items.length ? `${done} of ${items.length} done` : ''}</span></div>
    ${items.length ? `<div class="meter" style="margin:10px 0 12px"><div style="width:${(done / items.length) * 100}%"></div></div>` : '<div style="height:12px"></div>'}
    <ul class="todo-items">${items.map((i) => itemRow(i, date, all.indexOf(i), all.length)).join('')
      || `<li class="muted" style="list-style:none;padding:6px 0">${date < today() ? 'No list for this day.' : filter ? `No ${esc(filter)} items.` : 'Nothing yet. Add your first item below.'}</li>`}</ul>
    <div class="todo-add" data-date="${date}">
      <input type="text" class="ta-text" placeholder="Add an item for ${dayLabel(date).toLowerCase()}…" aria-label="New item">
      <select class="ta-tag" aria-label="Category">${catOptions(filter || '')}</select>
      <input type="time" class="ta-time" aria-label="Time (optional)">
      <button class="btn primary" data-act="add" data-date="${date}">Add</button>
    </div>
    <div class="row" style="margin-top:10px;gap:8px">
      ${all.some((i) => !i.done) && date <= today() ? `<button class="btn small" data-act="carry" data-date="${date}">Move unfinished to next day</button>` : ''}
      ${all.some((i) => i.time) ? `<button class="btn small" data-act="sort" data-date="${date}">Sort by time</button>` : ''}
      ${all.some((i) => i.done) ? `<button class="btn small" data-act="clear" data-date="${date}">Clear done items</button>` : ''}
    </div>
  </div>`;
}

function routineRow(r, idx) {
  if (todoEdit?.kind === 'routine' && todoEdit.id === r.id) return itemEditForm(r, `data-routine="${r.id}"`);
  const a = `data-routine="${r.id}"`;
  return `<li class="todo-item">
    <span class="todo-text" style="flex:1">${esc(r.text)}</span>
    <span class="muted" style="font-size:12px">${daysLabel(r.days)}</span>
    ${r.time ? `<span class="todo-time">${esc(r.time)}</span>` : ''}${catChip(r.tag)}
    <span class="todo-actions">
      <button data-act="rt-edit" ${a} title="Edit" aria-label="Edit">✎</button>
      <button data-act="rt-up" ${a} ${idx ? '' : 'disabled'} aria-label="Move up">↑</button>
      <button data-act="rt-del" ${a} class="danger" aria-label="Remove from routine">✕</button>
    </span>
  </li>`;
}

async function viewTodo(date) {
  await loadTodos();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : today();
  const next = addDays(d, 1);
  let filter = sessionStorage.getItem('todoFilter') || '';
  if (filter && !S.todoCats.some((c) => c.name === filter)) filter = '';
  main().innerHTML = `<div id="todo-page">
    <div class="row between"><div><h1>To-do</h1><p class="sub">Trading, personal life, anything. Plan tomorrow tonight, then tick it off as you go.</p></div>
      <div class="row"><button class="btn" data-act="day" data-to="${addDays(d, -1)}" aria-label="Previous day">←</button><input type="date" id="td-date" value="${d}" style="width:auto">
        <button class="btn" data-act="day" data-to="${next}" aria-label="Next day">→</button><button class="btn" data-act="day" data-to="${today()}">Today</button></div></div>
    <div class="chips" style="margin-bottom:14px"><span class="chip ${filter ? '' : 'on'}" data-filter="">All</span>${S.todoCats.map((c) => `<span class="chip ${filter === c.name ? 'on' : ''}" data-filter="${esc(c.name)}"><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span>`).join('')}</div>
    <div class="grid g2">${todoCard(d, filter)}${todoCard(next, filter)}</div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Routine</h2>
        <p class="muted" style="margin-top:-6px;font-size:13px">Added automatically to each new day's list, on the days you choose. Edit an item (✎) to pick its days.</p>
        <ul class="todo-items">${S.todoRoutine.map(routineRow).join('') || '<li class="muted" style="list-style:none">No routine items.</li>'}</ul>
        <div class="todo-add" data-routine-add>
          <input type="text" class="ta-text" placeholder="e.g. Gym, call family, read 20 pages…" aria-label="New routine item">
          <select class="ta-tag" aria-label="Category">${catOptions('')}</select>
          <input type="time" class="ta-time" aria-label="Time (optional)">
          <button class="btn" data-act="rt-add">Add</button>
        </div>
      </div>
      <div class="card"><h2>Categories</h2>
        <p class="muted" style="margin-top:-6px;font-size:13px">Make your own: Gym, Family, Errands, Study… Rename by typing, click a colour to change it.</p>
        <ul class="todo-items">${S.todoCats.map((c) => `<li class="todo-item">
          <i class="dot big" style="background:${c.color}"></i>
          <input type="text" class="cat-name" data-cat="${c.id}" value="${esc(c.name)}" aria-label="Category name">
          <span class="swatches">${TODO_COLORS.map((col) => `<button data-act="cat-color" data-cat="${c.id}" data-color="${col}" class="${col === c.color ? 'on' : ''}" style="background:${col}" aria-label="Colour"></button>`).join('')}</span>
          <button class="todo-del" data-act="cat-del" data-cat="${c.id}" aria-label="Delete category">✕</button></li>`).join('')}</ul>
        <div class="todo-add"><input type="text" id="cat-new" placeholder="New category, e.g. Gym"><button class="btn" data-act="cat-add">Add category</button></div>
      </div>
    </div></div>`;

  const page = $('#todo-page');
  const rerender = async (focusSel) => { await viewTodo(d); if (focusSel) $(focusSel)?.focus(); };
  const list = (dt) => todoList(dt);
  const find = (dt, id) => list(dt).find((i) => i.id === id);
  const move = (arr, i, j) => { if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
  const readForm = (form) => ({
    text: $('.te-text', form).value.trim(), tag: $('.te-tag', form).value, time: $('.te-time', form).value, note: $('.te-note', form).value.trim(),
    ...($('.te-day', form) ? { days: $$('.te-day:checked', form).map((x) => +x.value) } : {}),
  });

  page.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.matches('[data-check]')) { find(t.dataset.date, t.dataset.id).done = t.checked; await saveTodos(t.dataset.date); return rerender(); }
    if (t.id === 'td-date' && t.value) return go('todo', t.value);
    if (t.matches('.cat-name')) {
      const cat = S.todoCats.find((c) => c.id === t.dataset.cat), name = t.value.trim();
      if (!name || S.todoCats.some((c) => c !== cat && c.name === name)) { t.value = cat.name; return toast('Use a different name'); }
      const old = cat.name; cat.name = name;
      for (const items of Object.values(S.todos)) items.forEach((i) => { if (i.tag === old) i.tag = name; });
      S.todoRoutine.forEach((r) => { if (r.tag === old) r.tag = name; });
      if (sessionStorage.getItem('todoFilter') === old) sessionStorage.setItem('todoFilter', name);
      await Promise.all([saveCats(), saveTodos(), saveRoutine()]); toast('Category renamed'); return rerender();
    }
  });

  page.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.ta-text')) e.target.closest('.todo-add').querySelector('[data-act]').click();
    if (e.key === 'Enter' && e.target.closest('.todo-edit') && e.target.matches('input[type=text], input[type=time]')) e.target.closest('.todo-edit').querySelector('[data-act="save"]').click();
    if (e.key === 'Escape' && e.target.closest('.todo-edit')) { todoEdit = null; rerender(); }
    if (e.key === 'Enter' && e.target.id === 'cat-new') page.querySelector('[data-act="cat-add"]').click();
  });

  page.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-filter]');
    if (chip) { sessionStorage.setItem('todoFilter', chip.dataset.filter); return rerender(); }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const { act, date: dt, id } = b.dataset;
    switch (act) {
      case 'day': return go('todo', b.dataset.to);
      case 'add': {
        const box = b.closest('.todo-add'), text = $('.ta-text', box).value.trim();
        if (!text) return $('.ta-text', box).focus();
        list(dt).push({ id: uid(), text, tag: $('.ta-tag', box).value, time: $('.ta-time', box).value, note: '', done: false });
        await saveTodos(dt); return rerender(`[data-card="${dt}"] .ta-text`);
      }
      case 'edit': todoEdit = { kind: 'item', date: dt, id }; await rerender(); return $('.todo-edit .te-text')?.focus();
      case 'cancel': todoEdit = null; return rerender();
      case 'save': {
        const form = b.closest('.todo-edit'), v = readForm(form);
        if (!v.text) return $('.te-text', form).focus();
        if (form.dataset.routine) Object.assign(S.todoRoutine.find((r) => r.id === form.dataset.routine), v), await saveRoutine();
        else Object.assign(find(form.dataset.date, form.dataset.id), v), await saveTodos(form.dataset.date);
        todoEdit = null; return rerender();
      }
      case 'up': case 'down': { const arr = list(dt), i = arr.findIndex((x) => x.id === id); move(arr, i, act === 'up' ? i - 1 : i + 1); await saveTodos(dt); return rerender(); }
      case 'del': S.todos[dt] = list(dt).filter((i) => i.id !== id); await saveTodos(dt); return rerender();
      case 'sort': list(dt).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')); await saveTodos(dt); return rerender();
      case 'clear': S.todos[dt] = list(dt).filter((i) => !i.done); await saveTodos(dt); return rerender();
      case 'carry': {
        const nx = addDays(dt, 1), target = list(nx);
        const moving = list(dt).filter((i) => !i.done && !(i.routine && target.some((t) => t.routine && t.text === i.text)));
        target.push(...moving.map((i) => ({ ...i, id: uid() })));
        S.todos[dt] = list(dt).filter((i) => i.done);
        await Promise.all([saveTodos(dt), saveTodos(nx)]); toast(`Moved ${moving.length} item${moving.length === 1 ? '' : 's'} to ${fmtDate(nx)}`); return rerender();
      }
      case 'rt-add': {
        const box = b.closest('.todo-add'), text = $('.ta-text', box).value.trim();
        if (!text) return $('.ta-text', box).focus();
        S.todoRoutine.push({ id: uid(), text, tag: $('.ta-tag', box).value, time: $('.ta-time', box).value, days: [] });
        await saveRoutine(); return rerender('[data-routine-add] .ta-text');
      }
      case 'rt-edit': todoEdit = { kind: 'routine', id: b.dataset.routine }; await rerender(); return $('.todo-edit .te-text')?.focus();
      case 'rt-up': { const i = S.todoRoutine.findIndex((r) => r.id === b.dataset.routine); move(S.todoRoutine, i, i - 1); await saveRoutine(); return rerender(); }
      case 'rt-del': S.todoRoutine = S.todoRoutine.filter((r) => r.id !== b.dataset.routine); await saveRoutine(); return rerender();
      case 'cat-color': S.todoCats.find((c) => c.id === b.dataset.cat).color = b.dataset.color; await saveCats(); return rerender();
      case 'cat-add': {
        const name = $('#cat-new').value.trim();
        if (!name) return $('#cat-new').focus();
        if (S.todoCats.some((c) => c.name === name)) return toast('That category already exists');
        const used = new Set(S.todoCats.map((c) => c.color));
        S.todoCats.push({ id: uid(), name, color: TODO_COLORS.find((c) => !used.has(c)) || TODO_COLORS[S.todoCats.length % TODO_COLORS.length] });
        await saveCats(); return rerender('#cat-new');
      }
      case 'cat-del': {
        const cat = S.todoCats.find((c) => c.id === b.dataset.cat);
        if (!confirm(`Delete the "${cat.name}" category? Items keep their text but lose this category.`)) return;
        S.todoCats = S.todoCats.filter((c) => c !== cat);
        for (const items of Object.values(S.todos)) items.forEach((i) => { if (i.tag === cat.name) i.tag = ''; });
        S.todoRoutine.forEach((r) => { if (r.tag === cat.name) r.tag = ''; });
        await Promise.all([saveCats(), saveTodos(), saveRoutine()]); return rerender();
      }
    }
  });
}

// Small dashboard card: today's progress and what's left.
async function todoDashboardCard(el) {
  await loadTodos();
  const items = todoList(today()), done = items.filter((i) => i.done).length;
  const left = items.filter((i) => !i.done);
  el.innerHTML = `<div class="card"><div class="row between"><h2 style="margin:0">Today's to-do</h2><a href="#todo">Open</a></div>
    ${items.length ? `<div class="muted" style="font-size:13px;margin-top:4px">${done} of ${items.length} done</div>
      <div class="meter" style="margin:8px 0 10px"><div style="width:${(done / items.length) * 100}%"></div></div>
      ${left.length ? `<ul class="todo-mini">${left.slice(0, 6).map((i) => `<li><label><input type="checkbox" data-mini="${i.id}">${i.time ? `<span class="todo-time">${esc(i.time)}</span>` : ''}${esc(i.text)}</label>${catChip(i.tag)}</li>`).join('')}</ul>${left.length > 6 ? `<div class="muted" style="font-size:12px">+${left.length - 6} more</div>` : ''}` : '<p style="margin:0">All done for today ✓</p>'}`
      : '<p class="muted" style="margin:8px 0 0">No list for today. <a href="#todo">Add some items</a>.</p>'}</div>`;
  $$('[data-mini]', el).forEach((b) => (b.onchange = async () => {
    items.find((i) => i.id === b.dataset.mini).done = true; await saveTodos(today()); todoDashboardCard(el);
  }));
}
