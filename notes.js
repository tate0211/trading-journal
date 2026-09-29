// GoodNotes exports (PDF or images) stored in the journal and shown in a view-only reader.
// Pages are drawn as pictures on a canvas, so nothing in the reader can be edited.
const Notes = (() => {
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  let pdfjsReady;

  function loadPdfJs() {
    if (pdfjsReady) return pdfjsReady;
    pdfjsReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js';
      s.onload = async () => {
        try {
          // Load the worker through a blob URL so it also works when the page is opened as a local file.
          const code = await (await fetch(PDFJS + 'pdf.worker.min.js')).text();
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
          resolve(window.pdfjsLib);
        } catch (e) { reject(e); }
      };
      s.onerror = () => reject(new Error('Could not load the PDF viewer. Check your internet connection.'));
      document.head.appendChild(s);
    });
    pdfjsReady.catch(() => (pdfjsReady = null));
    return pdfjsReady;
  }

  const dataUrlToBytes = (url) => Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0));
  const readAsDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });

  // Turn picked files into note records (not yet saved).
  async function fromFiles(files, { date, tradeId }) {
    const out = [];
    for (const f of files) {
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      if (!isPdf && !f.type.startsWith('image/')) continue;
      if (f.size > 60 * 1024 * 1024) { alert(`${f.name} is over 60 MB. Export fewer pages from GoodNotes and try again.`); continue; }
      const note = {
        id: uid(), title: f.name.replace(/\.[^.]+$/, ''), date: date || today(), tradeId: tradeId || null,
        kind: isPdf ? 'pdf' : 'image', data: isPdf ? await readAsDataURL(f) : await compressImage(f, 2400),
        size: f.size, createdAt: new Date().toISOString(), link: '',
      };
      if (isPdf) {
        try { const lib = await loadPdfJs(); note.pages = (await lib.getDocument({ data: dataUrlToBytes(note.data) }).promise).numPages; }
        catch { note.pages = null; }
      } else note.pages = 1;
      out.push(note);
    }
    return out;
  }

  // Full-screen, read-only reader.
  async function view(note) {
    const box = document.createElement('div');
    box.className = 'reader';
    box.innerHTML = `
      <div class="reader-bar">
        <div class="reader-title"><b>${esc(note.title)}</b> <span class="muted">${fmtDate(note.date)}${note.pages ? ` · ${note.pages} page${note.pages > 1 ? 's' : ''}` : ''} · view only</span></div>
        <div class="row" style="gap:6px">
          <button class="btn small" data-z="-1" aria-label="Zoom out">−</button>
          <span class="muted" id="rz">100%</span>
          <button class="btn small" data-z="1" aria-label="Zoom in">+</button>
          ${/^goodnotes:|^https?:/.test(note.link || '') ? `<a class="btn small" href="${esc(note.link)}" target="_blank" rel="noopener">Open in GoodNotes</a>` : ''}
          <button class="btn small" id="rclose">Close ✕</button>
        </div>
      </div>
      <div class="reader-pages" id="rpages"><p class="muted" style="text-align:center">Loading…</p></div>`;
    document.body.appendChild(box);
    document.body.style.overflow = 'hidden';
    const close = () => { box.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    box.querySelector('#rclose').onclick = close;
    box.addEventListener('contextmenu', (e) => e.preventDefault());

    const pagesEl = box.querySelector('#rpages');
    let zoom = 1;
    const setZoom = (z) => {
      zoom = Math.min(3, Math.max(0.5, z));
      box.querySelector('#rz').textContent = Math.round(zoom * 100) + '%';
      pagesEl.style.setProperty('--zoom', zoom);
    };
    box.querySelectorAll('[data-z]').forEach((b) => (b.onclick = () => setZoom(zoom + 0.25 * +b.dataset.z)));

    // On a second device the file lives in the cloud until it's first opened.
    let src;
    try { src = await Sync.noteData(note); }
    catch (e) { pagesEl.innerHTML = `<div class="notice neg" style="max-width:520px;margin:40px auto">${esc(e.message || String(e))}</div>`; return; }
    if (note.kind === 'image') {
      pagesEl.innerHTML = `<img class="page" src="${src}" alt="${esc(note.title)}" draggable="false">`;
      return;
    }
    try {
      const lib = await loadPdfJs();
      const pdf = await lib.getDocument({ data: dataUrlToBytes(src) }).promise;
      pagesEl.innerHTML = '';
      const width = Math.min(pagesEl.clientWidth - 32, 1000);
      for (let i = 1; i <= pdf.numPages; i++) {
        if (!box.isConnected) return; // closed while rendering
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = (width / base.width) * Math.min(window.devicePixelRatio || 1, 2);
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.className = 'page'; c.width = vp.width; c.height = vp.height;
        c.setAttribute('aria-label', `Page ${i}`);
        pagesEl.appendChild(c);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      }
    } catch (e) {
      pagesEl.innerHTML = `<div class="notice neg" style="max-width:520px;margin:40px auto">${esc(e.message || String(e))}</div>`;
    }
  }

  // Card list used on the GoodNotes page, the daily journal and the trade form.
  function cards(notes, { manage = false } = {}) {
    if (!notes.length) return '';
    return `<div class="note-cards">${notes.map((n) => {
      const trade = n.tradeId && S.trades.find((t) => t.id === n.tradeId);
      return `<div class="note-card" data-note="${n.id}" tabindex="0" role="button" aria-label="View ${esc(n.title)}">
        <div class="note-icon">${n.kind === 'pdf' ? 'PDF' : 'IMG'}</div>
        <div class="note-meta"><b>${esc(n.title)}</b>
          <span class="muted">${fmtDate(n.date)}${n.pages ? ` · ${n.pages} p` : ''}${trade ? ` · ${esc(trade.instrument)} trade` : ''}</span></div>
        ${manage ? `<button class="btn small" data-note-edit="${n.id}">Edit</button><button class="btn small danger" data-note-del="${n.id}">Delete</button>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  return { fromFiles, view, cards };
})();
