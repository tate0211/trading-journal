// To-do: a simple Today / Tomorrow checklist. Your routine is added to each new day automatically;
// categories, repeat days, reordering and deleting live behind "Edit list".
// Stored in meta:
//   'todo:YYYY-MM-DD' = [{ id, text, tag, time, note, done, routine }]   (one record per day; tag = category name)
//   'todoRoutine' = [{ id, text, tag, time, days }]   (days: 0=Mon … 6=Sun; empty = every day)
//   'todoCats'    = [{ id, name, color }]
//   'todoRoutineVersion' = which built-in routine this journal has been moved to

const TODO_COLORS = ['#3987e5', '#1baf7a', '#7b6fd6', '#e87ba4', '#eb6834', '#2f9e44', '#eda100', '#e34948'];
const DEFAULT_CATS = [['Personal', 3], ['Health', 1], ['Study', 2], ['Trading', 5], ['Family', 4], ['Pre-market', 0]];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MY_ROUTINE = [
  { text: 'Read a book', tag: 'Personal', days: [] },
  { text: 'Take creatine', tag: 'Health', days: [] },
  { text: 'Check emails', tag: 'Personal', days: [] },
  { text: 'Check assignments', tag: 'Study', days: [] },
  { text: 'Study for upcoming exams', tag: 'Study', days: [] },
  { text: 'Check trades', tag: 'Trading', days: [] },
  { text: 'Check in with the family', tag: 'Family', days: [] },
  { text: 'Do laundry', tag: 'Personal', days: [2, 6] }, // Wednesdays and Sundays
];
const ROUTINE_VERSION = 2;
const OLD_STARTER_ITEMS = ['Check the forex calendar for high-impact news', 'Write my pre-market plan', 'Journal every trade and review it'];
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
    const version = await DB.getMeta('todoRoutineVersion', S.todoRoutine ? 1 : ROUTINE_VERSION);
    if (!S.todoRoutine) {
      S.todoRoutine = routineFrom(MY_ROUTINE);
      await DB.seedMeta('todoRoutine', S.todoRoutine);
      await DB.seedMeta('todoRoutineVersion', ROUTINE_VERSION);
    }
    else if (version < ROUTINE_VERSION) await switchToMyRoutine();
  }
}
const routineFrom = (list) => list.map((r) => ({ id: uid(), time: '', ...r }));

// One-time move from the old three trading starter items to your personal routine.
// Today's and future lists get the new items; anything already ticked is kept.
async function switchToMyRoutine() {
  S.todoRoutine = routineFrom(MY_ROUTINE);
  await saveRoutine();
  if (!S.todoCats.some((c) => c.name === 'Study')) {
    const used = new Set(S.todoCats.map((c) => c.color));
    S.todoCats.push({ id: uid(), name: 'Study', color: TODO_COLORS.find((c) => !used.has(c)) || TODO_COLORS[2] });
    await saveCats();
  }
  for (const d of Object.keys(S.todos)) {
    if (d < today()) continue;
    const others = S.todos[d].filter((i) => !(OLD_STARTER_ITEMS.includes(i.text) && !i.done) && !S.todoRoutine.some((r) => r.text === i.text));
    const fromRoutine = S.todoRoutine.filter((r) => routineApplies(r, d)).map((r) => {
      const existing = S.todos[d].find((i) => i.text === r.text);
      return existing || { id: uid(), text: r.text, tag: r.tag, time: '', note: '', done: false, routine: true };
    });
    S.todos[d] = [...fromRoutine, ...others];
    await saveTodos(d);
  }
  await DB.setMeta('todoRoutineVersion', ROUTINE_VERSION);
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
    ${'days' in i ? `<div class="day-picks"><span class="hint" style="flex-basis:100%">Repeat on (none ticked = every day):</span>${DAY_NAMES.map((n, d) => `<label><input type="checkbox" class="te-day" value="${d}" ${i.days?.includes(d) ? 'checked' : ''}>${n}</label>`).join('')}</div>` : ''}
    <div class="row" style="gap:6px"><button class="btn small primary" data-act="save">Save</button><button class="btn small" data-act="cancel">Cancel</button></div>
  </div></li>`;
}

function itemRow(i, date, idx, len, editing) {
  if (todoEdit?.kind === 'item' && todoEdit.date === date && todoEdit.id === i.id) return itemEditForm(i, `data-date="${date}" data-id="${i.id}"`);
  const a = `data-date="${date}" data-id="${i.id}"`;
  return `<li class="todo-item ${i.done ? 'done' : ''}">
    <label><input type="checkbox" data-check ${a} ${i.done ? 'checked' : ''}><span class="todo-text">${esc(i.text)}</span></label>
    ${i.time ? `<span class="todo-time">${esc(i.time)}</span>` : ''}
    ${editing ? `${catChip(i.tag)}<span class="todo-actions">
      <button data-act="edit" ${a} title="Edit" aria-label="Edit">✎</button>
      <button data-act="up" ${a} ${idx ? '' : 'disabled'} title="Move up" aria-label="Move up">↑</button>
      <button data-act="down" ${a} ${idx < len - 1 ? '' : 'disabled'} title="Move down" aria-label="Move down">↓</button>
      <button data-act="del" ${a} class="danger" title="Delete" aria-label="Delete">✕</button>
    </span>` : ''}
    ${i.note ? `<div class="todo-note">${esc(i.note)}</div>` : ''}
  </li>`;
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

async function viewTodo(arg) {
  await loadTodos();
  const t0 = today(), t1 = addDays(t0, 1);
  if (arg === t1 || arg === 'tomorrow') sessionStorage.setItem('todoDay', 'tomorrow');
  else if (arg) sessionStorage.setItem('todoDay', 'today');
  const which = sessionStorage.getItem('todoDay') === 'tomorrow' ? 'tomorrow' : 'today';
  const d = which === 'tomorrow' ? t1 : t0;
  const editing = sessionStorage.getItem('todoEditing') === '1';
  const items = todoList(d);
  const done = items.filter((i) => i.done).length;
  const left = items.length - done;
  const dateLabel = (x) => new Date(x + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  main().innerHTML = `<div id="todo-page" class="todo-simple">
    <div class="row between" style="margin-bottom:14px"><h1 style="margin:0">To-do</h1>
      <button class="btn small ${editing ? 'primary' : ''}" data-act="toggle-edit">${editing ? 'Done editing' : 'Edit list'}</button></div>
    <div class="day-switch" role="tablist" aria-label="Day">
      <button role="tab" data-act="day" data-day="today" class="${which === 'today' ? 'on' : ''}" aria-selected="${which === 'today'}">Today<small>${dateLabel(t0)}</small></button>
      <button role="tab" data-act="day" data-day="tomorrow" class="${which === 'tomorrow' ? 'on' : ''}" aria-selected="${which === 'tomorrow'}">Tomorrow<small>${dateLabel(t1)}</small></button>
    </div>

    <div class="card todo-card" data-card="${d}">
      <div class="row between"><b>${items.length ? (left ? `${left} left` : 'All done ✓') : 'Nothing on the list'}</b>
        <span class="muted" style="font-size:13px">${items.length ? `${done} of ${items.length} done` : ''}</span></div>
      ${items.length ? `<div class="meter" style="margin:10px 0 14px"><div style="width:${(done / items.length) * 100}%"></div></div>` : '<div style="height:12px"></div>'}
      <ul class="todo-items">${items.map((i, n) => itemRow(i, d, n, items.length, editing)).join('')}</ul>
      <div class="todo-add simple" data-date="${d}">
        <input type="text" class="ta-text" placeholder="Add something for ${which}…" aria-label="New item">
        <button class="btn primary" data-act="add" data-date="${d}">Add</button>
      </div>
      ${editing ? `<div class="row" style="margin-top:12px;gap:8px">
        ${which === 'today' && left ? `<button class="btn small" data-act="carry" data-date="${d}">Move unfinished to tomorrow</button>` : ''}
        ${items.some((i) => i.time) ? `<button class="btn small" data-act="sort" data-date="${d}">Sort by time</button>` : ''}
        ${done ? `<button class="btn small" data-act="clear" data-date="${d}">Clear done items</button>` : ''}
      </div>` : ''}
    </div>

    ${editing ? `
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Every day list</h2>
        <p class="muted" style="margin-top:-6px;font-size:13px">These are added to each new day automatically. Tap ✎ to change an item or pick which days it repeats on.</p>
        <ul class="todo-items">${S.todoRoutine.map(routineRow).join('') || '<li class="muted" style="list-style:none">No routine items.</li>'}</ul>
        <div class="todo-add" data-routine-add>
          <input type="text" class="ta-text" placeholder="Add to every day, e.g. Go to the gym" aria-label="New routine item">
          <select class="ta-tag" aria-label="Category">${catOptions('')}</select>
          <button class="btn" data-act="rt-add">Add</button>
        </div>
        <p class="hint" style="margin:8px 0 0">Changes apply to days you haven't opened yet. Today and tomorrow are updated too.</p>
      </div>
      <div class="card"><h2>Categories</h2>
        <p class="muted" style="margin-top:-6px;font-size:13px">Rename by typing, tap a colour to change it.</p>
        <ul class="todo-items">${S.todoCats.map((c) => `<li class="todo-item">
          <i class="dot big" style="background:${c.color}"></i>
          <input type="text" class="cat-name" data-cat="${c.id}" value="${esc(c.name)}" aria-label="Category name">
          <span class="swatches">${TODO_COLORS.map((col) => `<button data-act="cat-color" data-cat="${c.id}" data-color="${col}" class="${col === c.color ? 'on' : ''}" style="background:${col}" aria-label="Colour"></button>`).join('')}</span>
          <button class="todo-del" data-act="cat-del" data-cat="${c.id}" aria-label="Delete category">✕</button></li>`).join('')}</ul>
        <div class="todo-add"><input type="text" id="cat-new" placeholder="New category, e.g. Gym"><button class="btn" data-act="cat-add">Add category</button></div>
      </div>
    </div>` : ''}
  </div>`;

  const page = $('#todo-page');
  const rerender = async (focusSel) => { await viewTodo(); if (focusSel) $(focusSel)?.focus(); };
  const list = (dt) => todoList(dt);
  const find = (dt, id) => list(dt).find((i) => i.id === id);
  const move = (arr, i, j) => { if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
  const readForm = (form) => ({
    text: $('.te-text', form).value.trim(), tag: $('.te-tag', form).value, time: $('.te-time', form).value, note: $('.te-note', form).value.trim(),
    ...($('.te-day', form) ? { days: $$('.te-day:checked', form).map((x) => +x.value) } : {}),
  });
  // A routine change also updates today's and tomorrow's lists (keeping anything already ticked).
  const applyRoutineToOpenDays = async (oldText, r) => {
    for (const dt of [t0, t1]) {
      if (!S.todos[dt]) continue;
      const arr = S.todos[dt], idx = arr.findIndex((i) => i.routine && i.text === (oldText ?? r?.text));
      if (!r) { if (idx >= 0 && !arr[idx].done) arr.splice(idx, 1); }
      else if (!routineApplies(r, dt)) { if (idx >= 0 && !arr[idx].done) arr.splice(idx, 1); }
      else if (idx >= 0) Object.assign(arr[idx], { text: r.text, tag: r.tag, time: r.time || '' });
      else arr.push({ id: uid(), text: r.text, tag: r.tag, time: r.time || '', note: '', done: false, routine: true });
      await saveTodos(dt);
    }
  };

  page.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.matches('[data-check]')) {
      const it = find(t.dataset.date, t.dataset.id);
      if (!it) return rerender(); // list changed underneath (e.g. a sync); just redraw
      it.done = t.checked; await saveTodos(t.dataset.date); return rerender();
    }
    if (t.matches('.cat-name')) {
      const cat = S.todoCats.find((c) => c.id === t.dataset.cat), name = t.value.trim();
      if (!name || S.todoCats.some((c) => c !== cat && c.name === name)) { t.value = cat.name; return toast('Use a different name'); }
      const old = cat.name; cat.name = name;
      for (const items of Object.values(S.todos)) items.forEach((i) => { if (i.tag === old) i.tag = name; });
      S.todoRoutine.forEach((r) => { if (r.tag === old) r.tag = name; });
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
    const b = e.target.closest('[data-act]'); if (!b) return;
    const { act, date: dt, id } = b.dataset;
    switch (act) {
      case 'day': sessionStorage.setItem('todoDay', b.dataset.day); todoEdit = null; return rerender();
      case 'toggle-edit': sessionStorage.setItem('todoEditing', editing ? '' : '1'); todoEdit = null; return rerender();
      case 'add': {
        const box = b.closest('.todo-add'), text = $('.ta-text', box).value.trim();
        if (!text) return $('.ta-text', box).focus();
        list(dt).push({ id: uid(), text, tag: '', time: '', note: '', done: false });
        await saveTodos(dt); return rerender('.todo-add.simple .ta-text');
      }
      case 'edit': todoEdit = { kind: 'item', date: dt, id }; await rerender(); return $('.todo-edit .te-text')?.focus();
      case 'cancel': todoEdit = null; return rerender();
      case 'save': {
        const form = b.closest('.todo-edit'), v = readForm(form);
        if (!v.text) return $('.te-text', form).focus();
        if (form.dataset.routine) {
          const r = S.todoRoutine.find((x) => x.id === form.dataset.routine), oldText = r.text;
          Object.assign(r, v); await saveRoutine(); await applyRoutineToOpenDays(oldText, r);
        } else { Object.assign(find(form.dataset.date, form.dataset.id), v); await saveTodos(form.dataset.date); }
        todoEdit = null; return rerender();
      }
      case 'up': case 'down': { const arr = list(dt), i = arr.findIndex((x) => x.id === id); move(arr, i, act === 'up' ? i - 1 : i + 1); await saveTodos(dt); return rerender(); }
      case 'del': S.todos[dt] = list(dt).filter((i) => i.id !== id); await saveTodos(dt); return rerender();
      case 'sort': list(dt).sort((a, b2) => (a.time || '99:99').localeCompare(b2.time || '99:99')); await saveTodos(dt); return rerender();
      case 'clear': S.todos[dt] = list(dt).filter((i) => !i.done); await saveTodos(dt); return rerender();
      case 'carry': {
        const nx = addDays(dt, 1), target = list(nx);
        const moving = list(dt).filter((i) => !i.done && !(i.routine && target.some((t) => t.routine && t.text === i.text)));
        target.push(...moving.map((i) => ({ ...i, id: uid() })));
        S.todos[dt] = list(dt).filter((i) => i.done || i.routine);
        await Promise.all([saveTodos(dt), saveTodos(nx)]); toast(`Moved ${moving.length} item${moving.length === 1 ? '' : 's'} to tomorrow`); return rerender();
      }
      case 'rt-add': {
        const box = b.closest('.todo-add'), text = $('.ta-text', box).value.trim();
        if (!text) return $('.ta-text', box).focus();
        const r = { id: uid(), text, tag: $('.ta-tag', box).value, time: '', days: [] };
        S.todoRoutine.push(r); await saveRoutine(); await applyRoutineToOpenDays(null, r);
        return rerender('[data-routine-add] .ta-text');
      }
      case 'rt-edit': todoEdit = { kind: 'routine', id: b.dataset.routine }; await rerender(); return $('.todo-edit .te-text')?.focus();
      case 'rt-up': { const i = S.todoRoutine.findIndex((r) => r.id === b.dataset.routine); move(S.todoRoutine, i, i - 1); await saveRoutine(); return rerender(); }
      case 'rt-del': {
        const r = S.todoRoutine.find((x) => x.id === b.dataset.routine);
        S.todoRoutine = S.todoRoutine.filter((x) => x !== r); await saveRoutine(); await applyRoutineToOpenDays(r.text, null);
        return rerender();
      }
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
      ${left.length ? `<ul class="todo-mini">${left.slice(0, 6).map((i) => `<li><label><input type="checkbox" data-mini="${i.id}">${i.time ? `<span class="todo-time">${esc(i.time)}</span>` : ''}${esc(i.text)}</label></li>`).join('')}</ul>${left.length > 6 ? `<div class="muted" style="font-size:12px">+${left.length - 6} more</div>` : ''}` : '<p style="margin:0">All done for today ✓</p>'}`
      : '<p class="muted" style="margin:8px 0 0">No list for today. <a href="#todo">Add some items</a>.</p>'}</div>`;
  $$('[data-mini]', el).forEach((b) => (b.onchange = async () => {
    const it = items.find((i) => i.id === b.dataset.mini);
    if (it) { it.done = true; await saveTodos(today()); }
    todoDashboardCard(el);
  }));
}
