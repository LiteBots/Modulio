/* =========================================================
   Modulio Admin — panel zarządzania platformą (SPA, bez zależności)
   ========================================================= */
(() => {
  'use strict';
  document.documentElement.classList.remove('no-js');

  // =======================================================
  // Narzędzia
  // =======================================================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const V = (document.currentScript?.src.match(/[?&]v=([^&]+)/) || [])[1] || '';
  const icon = (n, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="/assets/icons.svg?v=${V}#${n}"></use></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const view = $('#view');

  const money = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
  const money0 = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
  const nf = new Intl.NumberFormat('pl-PL');
  const fmtMoney = (v) => money.format(v || 0);
  const fmtMoney0 = (v) => money0.format(v || 0);
  const toDate = (s) => new Date(String(s).length === 10 ? `${s}T12:00:00` : s);
  const fmtDate = (s) => (s ? new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' }).format(toDate(s)) : '—');
  const fmtDateTime = (s) => (s ? new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(toDate(s)) : '—');
  const fmtMonth = (k, long = false) => new Intl.DateTimeFormat('pl-PL', { month: long ? 'long' : 'short', year: long ? 'numeric' : undefined }).format(new Date(`${k}-15T12:00:00`));
  const rtf = new Intl.RelativeTimeFormat('pl', { numeric: 'auto' });
  function fmtRel(s) {
    if (!s) return '—';
    const diff = (toDate(s) - Date.now()) / 1000, abs = Math.abs(diff);
    if (abs < 60) return 'przed chwilą';
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
    return fmtDate(s);
  }
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const initials = (n) => String(n || '?').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  const plural = (n, one, few, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

  // ---------- Słowniki ----------
  const TICKET_STATUS = { nowe: ['Nowe', 'info'], w_toku: ['W toku', 'warn'], oczekuje_na_klienta: ['Czeka na klienta', ''], rozwiazane: ['Rozwiązane', 'ok'], zamkniete: ['Zamknięte', ''] };
  const TICKET_CAT = { pytanie: ['Pytanie', 'circle-help'], blad: ['Błąd', 'bug'], zmiana: ['Zmiana', 'pencil-line'], nowa_funkcja: ['Nowa funkcja', 'sparkles'], rozliczenia: ['Rozliczenia', 'receipt'] };
  const PRIORITY = { niski: ['Niski', ''], normalny: ['Normalny', 'info'], wysoki: ['Wysoki', 'warn'], krytyczny: ['Krytyczny', 'coral'] };
  const INV_STATUS = { oczekuje: ['Do zapłaty', 'warn'], oplacona: ['Opłacona', 'ok'], po_terminie: ['Po terminie', 'coral'], anulowana: ['Anulowana', ''] };
  const LEAD_STATUS = { nowy: ['Nowy', 'info', '#3d64a0'], w_kontakcie: ['W kontakcie', 'warn', '#a86a14'], oferta: ['Oferta wysłana', 'coral', '#ff7b1c'], wygrany: ['Wygrany', 'ok', '#3f7d57'], przegrany: ['Przegrany', '', '#87928c'] };
  const SOFT_STATUS = { aktywne: ['Aktywne', 'ok'], zawieszone: ['Zawieszone', 'warn'], wygasle: ['Wygasłe', 'coral'] };
  const ROLE = { client: ['Klient', ''], staff: ['Zespół', 'info'], admin: ['Administrator', 'dark'] };
  const DOC_CAT = { umowa: 'Umowa', specyfikacja: 'Specyfikacja', protokol: 'Protokół', instrukcja: 'Instrukcja', inne: 'Inne' };
  const PAY_METHOD = { przelew: 'Przelew', karta: 'Karta', gotowka: 'Gotówka', blik: 'BLIK', inne: 'Inne' };
  const badge = (label, tone = '') => `<span class="badge ${tone}">${esc(label)}</span>`;
  const bdg = (map, key) => badge(...(map[key] || [key]));
  const opts = (map) => Object.entries(map).map(([value, v]) => ({ value, label: Array.isArray(v) ? v[0] : v }));

  // ---------- API ----------
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json', 'X-Requested-With': 'modulio' } : { 'X-Requested-With': 'modulio' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { location.assign(`/admin/logowanie?next=${encodeURIComponent(location.pathname)}`); throw new Error('401'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Wystąpił błąd.'); e.status = res.status; e.fields = data.fields; throw e; }
    return data;
  }

  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${icon(type === 'ok' ? 'circle-check' : 'circle-alert')}<span></span>`;
    el.querySelector('span').textContent = msg;
    $('#toast-host').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 4200);
  }
  const fail = (err) => { if (err?.message !== '401') toast(err?.message || 'Wystąpił błąd.', 'err'); };

  // =======================================================
  // Okna dialogowe i formularze
  // =======================================================
  function dialog(html, { wide = false, label = 'Okno' } = {}) {
    const dlg = document.createElement('dialog');
    dlg.className = `app-dialog${wide ? ' wide' : ''}`;
    dlg.setAttribute('aria-label', label);
    dlg.innerHTML = html;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
    return dlg;
  }

  function fieldHtml(f, v) {
    const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
    const val = v ?? f.value ?? '';
    const req = f.required ? ' required' : '';
    const full = f.full || ['textarea', 'items', 'file', 'checkbox', 'info'].includes(f.type) ? ' full' : '';
    const help = f.help ? `<span class="field-help">${esc(f.help)}</span>` : '';
    switch (f.type) {
      case 'info': return `<div class="field full"><p style="font-size:13px">${f.html}</p></div>`;
      case 'textarea': return `<div class="field${full}"><label for="${id}">${esc(f.label)}</label><textarea id="${id}" name="${f.name}" rows="${f.rows || 4}"${req} placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>${help}</div>`;
      case 'select': return `<div class="field${full}"><label for="${id}">${esc(f.label)}</label><select id="${id}" name="${f.name}"${req}>${f.empty !== undefined ? `<option value="">${esc(f.empty)}</option>` : ''}${(f.options || []).map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(val) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>${help}</div>`;
      case 'checkbox': return `<label class="check-row full" style="grid-column:1/-1;margin:4px 0"><input type="checkbox" name="${f.name}"${val === true || val === 1 || val === '1' ? ' checked' : ''}> <span>${esc(f.label)}</span></label>`;
      case 'items': return `<div class="field full"><label>${esc(f.label)}</label><div class="items-editor" data-items="${f.name}"></div><button type="button" class="button button-light btn-sm" data-add-item style="align-self:flex-start;margin-top:6px">${icon('plus')} Dodaj pozycję</button><div class="items-total" data-items-total></div></div>`;
      case 'file': return `<div class="field full"><label class="file-drop" for="${id}">${icon('upload')}<b>Wybierz plik lub upuść go tutaj</b><small>${esc(f.help || 'Maks. 10 MB')}</small><input id="${id}" type="file" name="${f.name}" accept="${esc(f.accept || '')}"></label><span class="field-help" data-file-name></span></div>`;
      default: return `<div class="field${full}"><label for="${id}">${esc(f.label)}</label><input id="${id}" type="${f.type || 'text'}" name="${f.name}" value="${esc(val)}"${req}${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''}${f.step ? ` step="${f.step}"` : ''} placeholder="${esc(f.placeholder || '')}" autocomplete="${f.autocomplete || 'off'}">${help}</div>`;
    }
  }

  /** Uniwersalny formularz w oknie dialogowym. onSubmit(data) → może rzucić błąd z .fields */
  function openForm({ title, intro = '', fields, values = {}, submitLabel = 'Zapisz', onSubmit, wide = false, danger, extraButtons = [] }) {
    return new Promise((resolve) => {
      const dlg = dialog(`
        <div class="dialog-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon('x')}</button></div>
        <form class="dialog-body" novalidate>
          ${intro ? `<p>${intro}</p>` : ''}
          <div class="form-grid">${fields.map((f) => fieldHtml(f, values[f.name])).join('')}</div>
          <div class="inline-error" data-err></div>
          <div class="form-actions">${danger ? `<button type="button" class="button btn-danger btn-sm" data-danger style="margin-right:auto">${icon('trash-2')} ${esc(danger.label)}</button>` : ''}${extraButtons.map((b, i) => `<button type="button" class="button button-coral btn-sm" data-extra="${i}">${icon(b.icon || 'sparkles')} ${esc(b.label)}</button>`).join('')}<button type="button" class="button button-light btn-sm" data-close>Anuluj</button><button type="submit" class="button button-dark btn-sm">${icon('check')} ${esc(submitLabel)}</button></div>
        </form>`, { wide, label: title });
      const form = $('form', dlg);
      // edytor pozycji faktury
      const itemsField = fields.find((f) => f.type === 'items');
      if (itemsField) setupItemsEditor(form, itemsField, values[itemsField.name]);
      // plik
      const fileField = fields.find((f) => f.type === 'file');
      if (fileField) {
        const input = form.elements[fileField.name];
        const drop = input.closest('.file-drop');
        const show = () => { $('[data-file-name]', form).textContent = input.files[0] ? `${input.files[0].name} · ${(input.files[0].size / 1024).toFixed(0)} KB` : ''; };
        input.addEventListener('change', show);
        ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
        ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
        drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) { input.files = e.dataTransfer.files; show(); } });
      }
      $$('[data-extra]', dlg).forEach((b) => b.addEventListener('click', () => { dlg.close(); extraButtons[Number(b.dataset.extra)].onClick(); }));
      $('[data-danger]', dlg)?.addEventListener('click', async () => {
        if (await confirmDialog({ title: danger.confirm || 'Na pewno?', text: danger.text || 'Tej operacji nie można cofnąć.', confirmLabel: danger.label, danger: true })) {
          try { await danger.onClick(); dlg.close(); resolve('deleted'); } catch (e) { fail(e); }
        }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('[data-err]', form);
        err.innerHTML = '';
        $$('.field', form).forEach((f) => f.classList.remove('has-error'));
        const data = {};
        for (const f of fields) {
          if (f.type === 'info') continue;
          const el = form.elements[f.name];
          if (f.type === 'checkbox') data[f.name] = el.checked;
          else if (f.type === 'items') data[f.name] = readItems(form, f.name);
          else if (f.type === 'file') data[f.name] = el.files[0] || null;
          else if (f.type === 'number') data[f.name] = el.value === '' ? '' : Number(el.value);
          else data[f.name] = el.value.trim();
          if (f.required && (data[f.name] === '' || data[f.name] === null)) {
            el?.closest?.('.field')?.classList.add('has-error');
            err.innerHTML = `${icon('circle-alert')} Uzupełnij pole „${esc(f.label)}”.`;
            return;
          }
        }
        const btn = $('button[type=submit]', form);
        btn.disabled = true;
        try {
          const r = await onSubmit(data);
          dlg.close();
          resolve(r ?? true);
        } catch (ex) {
          if (ex.message !== '401') {
            err.innerHTML = `${icon('circle-alert')} ${esc(ex.message)}`;
            Object.keys(ex.fields || {}).forEach((k) => form.elements[k]?.closest?.('.field')?.classList.add('has-error'));
          }
          btn.disabled = false;
        }
      });
      dlg.addEventListener('close', () => resolve(null));
      setTimeout(() => $('input:not([type=hidden]):not([type=checkbox]), select, textarea', form)?.focus(), 40);
    });
  }

  function setupItemsEditor(form, field, initial) {
    const box = $(`[data-items="${field.name}"]`, form);
    const totalBox = $('[data-items-total]', form);
    const addRow = (it = { name: '', qty: 1, unit_net: '', vat: 23 }) => {
      const row = document.createElement('div');
      row.className = 'item-row';
      row.innerHTML = `<input placeholder="Nazwa usługi" data-k="name" value="${esc(it.name)}" aria-label="Nazwa">
        <input type="number" min="0.01" step="0.01" data-k="qty" value="${esc(it.qty)}" aria-label="Ilość">
        <input type="number" min="0" step="0.01" data-k="unit_net" value="${esc(it.unit_net)}" placeholder="Cena netto" aria-label="Cena netto">
        <select data-k="vat" class="vat" aria-label="VAT">${[23, 8, 5, 0].map((v) => `<option value="${v}"${Number(it.vat) === v ? ' selected' : ''}>${v}%</option>`).join('')}</select>
        <button type="button" class="icon-btn del" aria-label="Usuń pozycję">${icon('trash-2')}</button>`;
      row.querySelector('.del').addEventListener('click', () => { row.remove(); recalc(); });
      row.addEventListener('input', recalc);
      box.appendChild(row);
    };
    const recalc = () => {
      const items = readItems(form, field.name);
      const disc = Number(form.elements.discountPct?.value || 0);
      let net = 0, vat = 0;
      items.forEach((i) => { const n = i.qty * i.unit_net * (1 - disc / 100); net += n; vat += (n * i.vat) / 100; });
      totalBox.innerHTML = `<span>Netto: <b>${fmtMoney(net)}</b></span><span>VAT: <b>${fmtMoney(vat)}</b></span><span>Brutto: <b>${fmtMoney(net + vat)}</b></span>`;
    };
    (initial?.length ? initial : [undefined]).forEach((i) => addRow(i));
    $('[data-add-item]', form).addEventListener('click', () => { addRow(); recalc(); });
    recalc();
  }
  function readItems(form, name) {
    return $$(`[data-items="${name}"] .item-row`, form).map((r) => ({
      name: $('[data-k=name]', r).value.trim(), qty: Number($('[data-k=qty]', r).value || 0),
      unit_net: Number($('[data-k=unit_net]', r).value || 0), vat: Number($('[data-k=vat]', r).value),
    })).filter((i) => i.name || i.unit_net);
  }

  function confirmDialog({ title, text = '', confirmLabel = 'Potwierdź', danger = false }) {
    return new Promise((resolve) => {
      const dlg = dialog(`
        <div class="dialog-head"><h2>${esc(title)}</h2></div>
        <div class="dialog-body"><p>${esc(text)}</p>
          <div class="form-actions"><button type="button" class="button button-light btn-sm" data-no>Anuluj</button><button type="button" class="button ${danger ? 'btn-danger' : 'button-dark'} btn-sm" data-yes>${esc(confirmLabel)}</button></div></div>`, { label: title });
      let done = false;
      $('[data-yes]', dlg).addEventListener('click', () => { done = true; dlg.close(); resolve(true); });
      $('[data-no]', dlg).addEventListener('click', () => dlg.close());
      dlg.addEventListener('close', () => { if (!done) resolve(false); });
      setTimeout(() => $('[data-yes]', dlg).focus(), 30);
    });
  }

  function showSecret(title, text, secret) {
    const dlg = dialog(`
      <div class="dialog-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon('x')}</button></div>
      <div class="dialog-body"><p>${esc(text)}</p>
        <div class="secret-box"><code>${esc(secret)}</code><button type="button" class="button button-light btn-sm" data-copy>${icon('copy')} Kopiuj</button></div>
        <p class="field-help" style="margin-top:10px">Hasło jest widoczne tylko teraz — nie zapisujemy go w jawnej postaci.</p>
        <div class="form-actions"><button type="button" class="button button-dark btn-sm" data-close>Gotowe</button></div></div>`, { label: title });
    $('[data-copy]', dlg).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(secret); toast('Skopiowano do schowka.'); } catch { toast('Skopiuj ręcznie.', 'err'); }
    });
  }

  const fileToBase64 = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(new Error('Nie udało się odczytać pliku.'));
    r.readAsDataURL(file);
  });

  // =======================================================
  // Tabela danych (wyszukiwanie, filtry, sortowanie, stronicowanie)
  // =======================================================
  function dataTable(container, { columns, rows, searchKeys = [], filters = [], pageSize = 25, onRow, empty = 'Brak danych.', toolbarExtra = '', rowClass }) {
    const state = { q: '', sort: null, dir: 1, page: 1, filters: Object.fromEntries(filters.map((f) => [f.key, f.value ?? ''])) };
    container.innerHTML = `
      <div class="dt-toolbar">
        <div class="dt-left">
          <label class="search">${icon('search')}<span class="sr-only">Szukaj</span><input type="search" data-dt-q placeholder="Szukaj…"></label>
          ${filters.map((f) => `<select class="select-sm" data-dt-f="${f.key}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: wszystkie</option>${f.options.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(state.filters[f.key]) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`).join('')}
        </div>
        <div class="dt-left"><span class="dt-count" data-dt-count></span>${toolbarExtra}</div>
      </div>
      <div class="table-wrap"><table class="table responsive"><thead><tr>${columns.map((c, i) => `<th class="${c.sort ? 'sortable' : ''} ${c.cls || ''}" data-col="${i}" scope="col">${esc(c.label)}${c.sort ? '<span class="sort-ic"></span>' : ''}</th>`).join('')}</tr></thead><tbody data-dt-body></tbody></table></div>
      <div data-dt-empty></div>
      <div class="dt-foot" data-dt-foot></div>`;
    const body = $('[data-dt-body]', container);
    const filtered = () => {
      const qv = state.q.toLowerCase();
      let out = rows.filter((r) => (!qv || searchKeys.some((k) => String(typeof k === 'function' ? k(r) : r[k] ?? '').toLowerCase().includes(qv)))
        && filters.every((f) => !state.filters[f.key] || String(f.get ? f.get(r) : r[f.key]) === String(state.filters[f.key])));
      if (state.sort !== null) {
        const c = columns[state.sort];
        out = [...out].sort((a, b) => { const x = c.sort(a), y = c.sort(b); return (x > y ? 1 : x < y ? -1 : 0) * state.dir; });
      }
      return out;
    };
    const render = () => {
      const list = filtered();
      const pages = Math.max(1, Math.ceil(list.length / pageSize));
      state.page = Math.min(state.page, pages);
      const slice = list.slice((state.page - 1) * pageSize, state.page * pageSize);
      body.innerHTML = slice.map((r, i) => `<tr class="${onRow ? 'clickable' : ''} ${rowClass ? rowClass(r) : ''}" data-i="${rows.indexOf(r)}">${columns.map((c) => `<td class="${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('');
      $('[data-dt-empty]', container).innerHTML = list.length ? '' : `<div class="empty"><div class="empty-ic">${icon('inbox')}</div><h3>${esc(empty)}</h3></div>`;
      $('[data-dt-count]', container).textContent = `${nf.format(list.length)} ${plural(list.length, 'wynik', 'wyniki', 'wyników')}`;
      $$('th', container).forEach((th) => { const s = $('.sort-ic', th); if (s) s.textContent = Number(th.dataset.col) === state.sort ? (state.dir > 0 ? '▲' : '▼') : ''; });
      const foot = $('[data-dt-foot]', container);
      if (pages <= 1) { foot.hidden = true; return; }
      foot.hidden = false;
      const nums = [...new Set([1, state.page - 1, state.page, state.page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
      foot.innerHTML = `<span>Strona ${state.page} z ${pages}</span><div class="dt-pages"><button type="button" data-p="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''} aria-label="Poprzednia">‹</button>${nums.map((n) => `<button type="button" data-p="${n}" class="${n === state.page ? 'on' : ''}">${n}</button>`).join('')}<button type="button" data-p="${state.page + 1}" ${state.page === pages ? 'disabled' : ''} aria-label="Następna">›</button></div>`;
    };
    $('[data-dt-q]', container).addEventListener('input', (e) => { state.q = e.target.value; state.page = 1; render(); });
    $$('[data-dt-f]', container).forEach((s) => s.addEventListener('change', () => { state.filters[s.dataset.dtF] = s.value; state.page = 1; render(); }));
    $$('th.sortable', container).forEach((th) => th.addEventListener('click', () => {
      const c = Number(th.dataset.col);
      state.dir = state.sort === c ? -state.dir : 1; state.sort = c; render();
    }));
    container.addEventListener('click', (e) => {
      const p = e.target.closest('[data-p]');
      if (p) { state.page = Number(p.dataset.p); render(); return; }
      if (!onRow || e.target.closest('a, button, input, select')) return;
      const tr = e.target.closest('tr[data-i]');
      if (tr) onRow(rows[Number(tr.dataset.i)]);
    });
    render();
    return { render, setRows: (r) => { rows = r; render(); } };
  }

  // =======================================================
  // Wykresy SVG (jedna seria, kolor marki, podpowiedzi po najechaniu)
  // =======================================================
  const tip = $('#chart-tip');
  const showTip = (e, html) => { tip.innerHTML = html; tip.hidden = false; const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8); tip.style.left = `${x}px`; tip.style.top = `${e.clientY - tip.offsetHeight - 12}px`; };
  const hideTip = () => { tip.hidden = true; };
  const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };
  const nf1 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });
  const shortNum = (v) => (v >= 1e6 ? `${nf1.format(v / 1e6)} mln` : v >= 1e3 ? `${nf1.format(v / 1e3)} tys.` : nf1.format(v));

  function barChart(data, { format = fmtMoney, height = 220, label = 'Wykres', width = 640 } = {}) {
    const W = Math.max(300, Math.round(width)), H = height, pl = 52, pb = 26, pt = 10;
    const max = niceMax(Math.max(...data.map((d) => d.value), 0));
    const bw = (W - pl) / data.length;
    const y = (v) => pt + (H - pt - pb) * (1 - v / max);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => max * t);
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      ${ticks.map((t) => `<line class="grid-line" x1="${pl}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-label" x="${pl - 8}" y="${y(t) + 4}" text-anchor="end">${shortNum(t)}</text>`).join('')}
      ${data.map((d, i) => {
        const h = Math.max(0, H - pb - y(d.value));
        const x = pl + i * bw + bw * 0.2, w = bw * 0.6;
        const r = Math.min(4, w / 2, h);
        const path = h > 0 ? `M${x},${H - pb} V${y(d.value) + r} Q${x},${y(d.value)} ${x + r},${y(d.value)} H${x + w - r} Q${x + w},${y(d.value)} ${x + w},${y(d.value) + r} V${H - pb} Z` : '';
        return `<path class="bar" d="${path}"/><rect class="bar-hit" x="${pl + i * bw}" y="${pt}" width="${bw}" height="${H - pt - pb}" data-i="${i}"/>
          ${data.length <= 12 || i % 2 === 0 ? `<text class="axis-label" x="${pl + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>` : ''}`;
      }).join('')}
    </svg>`;
    const wrap = document.createElement('div');
    wrap.className = 'chart';
    wrap.innerHTML = svg;
    const bars = $$('.bar', wrap);
    $$('.bar-hit', wrap).forEach((hit) => {
      const i = Number(hit.dataset.i);
      hit.addEventListener('mousemove', (e) => { bars.forEach((b, j) => b.classList.toggle('dim', j !== i)); showTip(e, `${esc(data[i].full || data[i].label)}<b>${esc(format(data[i].value))}</b>`); });
      hit.addEventListener('mouseleave', () => { bars.forEach((b) => b.classList.remove('dim')); hideTip(); });
    });
    return wrap;
  }

  function lineChart(data, { format = (v) => nf.format(v), height = 220, label = 'Wykres', width = 640 } = {}) {
    const W = Math.max(300, Math.round(width)), H = height, pl = 44, pb = 26, pt = 12, pr = 10;
    const max = niceMax(Math.max(...data.map((d) => d.value), 0));
    const x = (i) => pl + (data.length === 1 ? (W - pl - pr) / 2 : (i * (W - pl - pr)) / (data.length - 1));
    const y = (v) => pt + (H - pt - pb) * (1 - v / max);
    const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
    const ticks = [0, 0.5, 1].map((t) => max * t);
    const wrap = document.createElement('div');
    wrap.className = 'chart';
    wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      ${ticks.map((t) => `<line class="grid-line" x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-label" x="${pl - 8}" y="${y(t) + 4}" text-anchor="end">${shortNum(t)}</text>`).join('')}
      <polygon class="area" points="${x(0)},${H - pb} ${pts} ${x(data.length - 1)},${H - pb}"/>
      <polyline class="line" points="${pts}"/>
      <line class="crosshair" y1="${pt}" y2="${H - pb}" x1="-10" x2="-10"/>
      <circle class="dot" r="5" cx="-10" cy="-10" style="opacity:0"/>
      ${data.map((d, i) => (data.length <= 12 || i % 2 === 0 ? `<text class="axis-label" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>` : '')).join('')}
      <rect x="${pl}" y="0" width="${W - pl}" height="${H}" fill="transparent" data-hit/>
    </svg>`;
    const svg = $('svg', wrap), hit = $('[data-hit]', wrap), cross = $('.crosshair', wrap), dot = $('.dot', wrap);
    hit.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(data.length - 1, Math.round(((px - pl) / (W - pl - pr)) * (data.length - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(data[i].value)); dot.style.opacity = 1;
      showTip(e, `${esc(data[i].full || data[i].label)}<b>${esc(format(data[i].value))}</b>`);
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); dot.style.opacity = 0; hideTip(); });
    return wrap;
  }

  const hbars = (rows, { format = (v) => nf.format(v) } = {}) => {
    const max = Math.max(...rows.map((r) => r.value), 1);
    return `<div class="hbars">${rows.map((r) => `<div class="hbar"><span title="${esc(r.label)}">${esc(r.label)}</span><div class="track"><div class="fill" style="width:${(r.value / max) * 100}%"></div></div><b>${esc(format(r.value))}</b></div>`).join('') || '<p class="dt-count">Brak danych.</p>'}</div>`;
  };
  const monthSeries = (arr) => arr.map((d) => ({ label: fmtMonth(d.month), full: fmtMonth(d.month, true), value: d.value }));

  // =======================================================
  // Układ: nagłówek, nawigacja, liczniki
  // =======================================================
  const state = { user: null, meta: null };
  function setHeader(title, crumbs = []) {
    $('#page-title').textContent = title;
    $('#crumbs').innerHTML = crumbs.length
      ? crumbs.map(([l, h]) => (h ? `<a href="${h}" data-link>${esc(l)}</a>` : `<span>${esc(l)}</span>`)).join(icon('chevron-right'))
      : '<span>Panel zarządzania</span>';
    document.title = `${title} — Modulio Admin`;
  }
  function setNav(key) {
    $$('[data-nav]').forEach((a) => { const on = a.dataset.nav === key; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }
  async function loadMeta(force = false) {
    if (state.meta && !force) return state.meta;
    state.meta = await api('/api/admin/meta');
    const c = state.meta.counters;
    Object.entries(c).forEach(([k, v]) => $$(`[data-badge="${k}"]`).forEach((b) => { b.hidden = !v; b.textContent = v; }));
    return state.meta;
  }
  const refreshMeta = () => loadMeta(true).catch(() => {});
  const clientOptions = () => state.meta.clients.map((c) => ({ value: c.id, label: c.company ? `${c.company} (${c.name})` : `${c.name} · ${c.email}` }));
  const projectOptions = (userId) => state.meta.projects.filter((p) => !userId || p.userId === Number(userId)).map((p) => ({ value: p.id, label: p.name }));
  const teamOptions = () => state.meta.team.map((t) => ({ value: t.id, label: t.name }));
  const isAdmin = () => state.user?.role === 'admin';

  const pageHead = (text, actions = '') => `<div class="page-head view-enter"><p>${text}</p><div class="page-actions">${actions}</div></div>`;
  const emptyState = (ic, title, text, action = '') => `<div class="empty"><div class="empty-ic">${icon(ic)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
  const skeleton = () => `<div class="grid grid-4">${'<div class="skeleton" style="height:118px"></div>'.repeat(4)}</div><div class="grid grid-main mt"><div class="skeleton" style="height:320px"></div><div class="skeleton" style="height:320px"></div></div>`;
  const kpi = (label, value, ic, tone, sub = '', href) => `<${href ? `a href="${href}" data-link` : 'div'} class="card kpi tone-${tone}"><div class="kpi-top"><span>${esc(label)}</span><span class="kpi-ic">${icon(ic)}</span></div><strong>${value}</strong><small>${sub}</small></${href ? 'a' : 'div'}>`;
  const userCell = (name, sub, id) => `<div class="cell-user"><span class="avatar">${esc(initials(name))}</span><div>${id ? `<a href="/admin/uzytkownicy/${id}" data-link><b>${esc(name)}</b></a>` : `<b>${esc(name)}</b>`}<small>${esc(sub || '')}</small></div></div>`;
  const exportBtn = (type, label = 'CSV') => `<a class="button button-light btn-sm" href="/api/admin/export/${type}" download>${icon('file-down')} ${label}</a>`;

  // =======================================================
  // Szybkie akcje (formularze wielokrotnego użytku)
  // =======================================================
  const actions = {
    async user(values = {}) {
      const r = await openForm({
        title: 'Nowy użytkownik', submitLabel: 'Utwórz konto', values: { role: 'client', ...values },
        intro: 'Jeśli nie podasz hasła, system wygeneruje hasło tymczasowe do przekazania klientowi.',
        fields: [
          { name: 'name', label: 'Imię i nazwisko *', required: true }, { name: 'email', label: 'E-mail *', type: 'email', required: true },
          { name: 'company', label: 'Firma' }, { name: 'nip', label: 'NIP' }, { name: 'phone', label: 'Telefon', type: 'tel' },
          { name: 'role', label: 'Rola', type: 'select', options: isAdmin() ? opts(ROLE) : [{ value: 'client', label: 'Klient' }] },
          { name: 'password', label: 'Hasło (opcjonalnie)', type: 'text', help: 'Min. 8 znaków, litera i cyfra' },
          { name: 'notes', label: 'Notatki wewnętrzne', type: 'textarea', rows: 3 },
        ],
        onSubmit: (d) => api('/api/admin/users', { method: 'POST', body: d }),
      });
      if (!r) return null;
      toast('Konto utworzone.');
      if (r.password) showSecret('Hasło tymczasowe', 'Przekaż klientowi dane logowania. Po zalogowaniu może zmienić hasło w ustawieniach konta.', r.password);
      await refreshMeta();
      return r;
    },
    async lead() {
      const r = await openForm({
        title: 'Nowy lead', submitLabel: 'Dodaj lead',
        fields: [
          { name: 'name', label: 'Osoba / firma *', required: true }, { name: 'email', label: 'E-mail *', type: 'email', required: true },
          { name: 'phone', label: 'Telefon' }, { name: 'company', label: 'Firma' },
          { name: 'source', label: 'Źródło', type: 'select', options: ['telefon', 'polecenie', 'targi', 'linkedin', 'reczny'].map((v) => ({ value: v, label: v })) },
          { name: 'value', label: 'Szacowana wartość (zł)', type: 'number', min: 0 },
          { name: 'message', label: 'Opis potrzeb', type: 'textarea' },
        ],
        onSubmit: (d) => api('/api/admin/leads', { method: 'POST', body: d }),
      });
      if (r) { toast('Lead dodany.'); refreshMeta(); }
      return r;
    },
    async project(values = {}) {
      await loadMeta();
      const r = await openForm({
        title: 'Nowy projekt', submitLabel: 'Utwórz projekt', wide: true, values: { stage: 'do_zrobienia', priority: 'normalny', kind: 'Pakiet Business', manager: state.user.name, ...values },
        fields: [
          { name: 'userId', label: 'Klient *', type: 'select', options: clientOptions(), required: true, empty: '— wybierz —' },
          { name: 'name', label: 'Nazwa projektu *', required: true },
          { name: 'kind', label: 'Typ', type: 'select', options: ['Pakiet Start', 'Pakiet Business', 'Custom', 'Rozszerzenie', 'Integracja'].map((v) => ({ value: v, label: v })) },
          { name: 'stage', label: 'Etap', type: 'select', options: state.meta.stages.map((s) => ({ value: s.key, label: s.label })) },
          { name: 'priority', label: 'Priorytet', type: 'select', options: opts(PRIORITY) },
          { name: 'manager', label: 'Opiekun', type: 'select', options: state.meta.team.map((t) => ({ value: t.name, label: t.name })) },
          { name: 'budget', label: 'Budżet (zł netto)', type: 'number', min: 0 }, { name: 'startDate', label: 'Start', type: 'date' },
          { name: 'dueDate', label: 'Termin', type: 'date' }, { name: 'modules', label: 'Moduły (po przecinku)', placeholder: 'CRM, Zlecenia, Raporty' },
          { name: 'description', label: 'Opis zakresu', type: 'textarea' },
        ],
        onSubmit: (d) => api('/api/admin/projects', { method: 'POST', body: d }),
      });
      if (r) { toast('Projekt utworzony.'); await refreshMeta(); navigate(`/admin/projekty/${r.id}`); }
      return r;
    },
    async software(values = {}, id) {
      await loadMeta();
      const r = await openForm({
        title: id ? 'Edytuj oprogramowanie' : 'Nowe aktywne oprogramowanie', submitLabel: id ? 'Zapisz' : 'Dodaj', wide: true,
        values: { status: 'aktywne', plan: 'Business', version: '1.0', usersLimit: 10, startedAt: todayStr(), renewalDate: addDays(30), ...values, modules: (values.modules || []).join?.(', ') ?? values.modules },
        fields: [
          { name: 'userId', label: 'Klient *', type: 'select', options: clientOptions(), required: true, empty: '— wybierz —' },
          { name: 'name', label: 'Nazwa systemu *', required: true },
          { name: 'plan', label: 'Plan', type: 'select', options: ['Start', 'Business', 'Custom', 'Enterprise'].map((v) => ({ value: v, label: v })) },
          { name: 'status', label: 'Status', type: 'select', options: opts(SOFT_STATUS) },
          { name: 'monthlyFee', label: 'Abonament (zł netto / mies.)', type: 'number', min: 0, step: '0.01' }, { name: 'usersLimit', label: 'Limit użytkowników', type: 'number', min: 1 },
          { name: 'url', label: 'Adres systemu', type: 'url', placeholder: 'https://firma.app.modulio.pl' }, { name: 'version', label: 'Wersja' },
          { name: 'startedAt', label: 'Uruchomiono', type: 'date' }, { name: 'renewalDate', label: 'Odnowienie', type: 'date' },
          { name: 'projectId', label: 'Projekt źródłowy', type: 'select', options: projectOptions(), empty: '— brak —' },
          { name: 'modules', label: 'Moduły (po przecinku)' },
        ],
        danger: id && isAdmin() ? { label: 'Usuń', confirm: 'Usunąć oprogramowanie?', onClick: () => api(`/api/admin/software/${id}`, { method: 'DELETE' }) } : undefined,
        onSubmit: (d) => api(id ? `/api/admin/software/${id}` : '/api/admin/software', { method: id ? 'PATCH' : 'POST', body: d }),
      });
      if (r) toast(r === 'deleted' ? 'Usunięto.' : 'Zapisano.');
      return r;
    },
    async invoice(values = {}) {
      await loadMeta();
      const r = await openForm({
        title: 'Nowa faktura', submitLabel: 'Wystaw fakturę', wide: true,
        intro: 'Numer nadawany automatycznie (FV/RRRR/MM/NNN). Faktura od razu pojawi się w panelu klienta.',
        values: { issueDate: todayStr(), dueDate: addDays(14), ...values },
        fields: [
          { name: 'userId', label: 'Klient *', type: 'select', options: clientOptions(), required: true, empty: '— wybierz —' },
          { name: 'projectId', label: 'Projekt', type: 'select', options: projectOptions(), empty: '— brak —' },
          { name: 'issueDate', label: 'Data wystawienia', type: 'date' }, { name: 'dueDate', label: 'Termin płatności', type: 'date' },
          { name: 'discountCode', label: 'Kod rabatowy', placeholder: 'np. START10' },
          { name: 'items', label: 'Pozycje', type: 'items' },
        ],
        onSubmit: (d) => api('/api/admin/invoices', { method: 'POST', body: d }),
      });
      if (r) { toast(`Wystawiono fakturę ${r.number}.`); refreshMeta(); }
      return r;
    },
    async payment(values = {}) {
      await loadMeta();
      const { invoices } = await api('/api/admin/invoices');
      const open = invoices.filter((i) => ['oczekuje', 'po_terminie'].includes(i.status));
      const r = await openForm({
        title: 'Zarejestruj wpłatę', submitLabel: 'Zapisz wpłatę', values: { paidAt: todayStr(), method: 'przelew', ...values },
        intro: 'Wpłata pokrywająca całą kwotę automatycznie oznaczy fakturę jako opłaconą. Puste pole kwoty = pozostała kwota faktury.',
        fields: [
          { name: 'invoiceId', label: 'Faktura', type: 'select', options: open.map((i) => ({ value: i.id, label: `${i.number} · ${i.clientName} · ${fmtMoney(i.gross - (i.paidAmount || 0))}` })), empty: '— bez faktury —' },
          { name: 'userId', label: 'Klient (gdy bez faktury)', type: 'select', options: clientOptions(), empty: '— z faktury —' },
          { name: 'amount', label: 'Kwota (zł)', type: 'number', min: 0, step: '0.01' },
          { name: 'method', label: 'Metoda', type: 'select', options: opts(PAY_METHOD) },
          { name: 'paidAt', label: 'Data wpłaty', type: 'date' }, { name: 'note', label: 'Notatka' },
        ],
        onSubmit: (d) => api('/api/admin/payments', { method: 'POST', body: { ...d, amount: d.amount === '' ? undefined : d.amount } }),
      });
      if (r) { toast('Wpłata zapisana.'); refreshMeta(); }
      return r;
    },
    async document(values = {}) {
      await loadMeta();
      const r = await openForm({
        title: 'Dodaj dokument dla klienta', submitLabel: 'Wyślij plik', values: { category: 'inne', ...values },
        fields: [
          { name: 'userId', label: 'Klient *', type: 'select', options: clientOptions(), required: true, empty: '— wybierz —' },
          { name: 'projectId', label: 'Projekt', type: 'select', options: projectOptions(), empty: '— ogólny —' },
          { name: 'category', label: 'Kategoria', type: 'select', options: opts(DOC_CAT) }, { name: 'name', label: 'Nazwa (opcjonalnie)' },
          { name: 'file', label: 'Plik', type: 'file', required: true, accept: '.pdf,.png,.jpg,.jpeg,.webp,.zip,.txt,.csv,.docx,.xlsx,.pptx', help: 'PDF, obrazy, DOCX, XLSX, PPTX, ZIP · maks. 10 MB' },
        ],
        onSubmit: async (d) => {
          if (!d.file) throw new Error('Wybierz plik.');
          if (d.file.size > 10 * 1024 * 1024) throw new Error('Plik jest większy niż 10 MB.');
          return api('/api/admin/documents', { method: 'POST', body: { userId: d.userId, projectId: d.projectId, category: d.category, name: d.name, filename: d.file.name, data: await fileToBase64(d.file) } });
        },
      });
      if (r) toast('Dokument dodany — klient widzi go w panelu.');
      return r;
    },
  };

  // Szybkie dodawanie
  const qa = $('#quick-add');
  const qaBtn = $('button', qa), qaMenu = $('.dropdown-menu', qa);
  qaBtn.addEventListener('click', (e) => { e.stopPropagation(); const o = qaMenu.hidden; qaMenu.hidden = !o; qaBtn.setAttribute('aria-expanded', String(o)); });
  document.addEventListener('click', () => { qaMenu.hidden = true; qaBtn.setAttribute('aria-expanded', 'false'); });
  $$('[data-quick]', qa).forEach((b) => b.addEventListener('click', async () => {
    qaMenu.hidden = true;
    try { const r = await actions[b.dataset.quick](); if (r && !['project'].includes(b.dataset.quick)) router(); } catch (e) { fail(e); }
  }));

  // Wyszukiwarka globalna
  const gsInput = $('#gs-input'), gsBox = $('#gs-results');
  const GS_ICON = { user: 'user-round', lead: 'target', ticket: 'life-buoy', project: 'kanban', invoice: 'receipt' };
  const GS_LABEL = { user: 'Użytkownik', lead: 'Lead', ticket: 'Zgłoszenie', project: 'Projekt', invoice: 'Faktura' };
  let gsTimer, gsIndex = -1;
  gsInput.addEventListener('input', () => {
    clearTimeout(gsTimer);
    const v = gsInput.value.trim();
    if (v.length < 2) { gsBox.hidden = true; return; }
    gsTimer = setTimeout(async () => {
      try {
        const { results } = await api(`/api/admin/search?q=${encodeURIComponent(v)}`);
        gsIndex = -1;
        gsBox.innerHTML = results.length ? results.map((r) => `<a class="gs-item" href="${r.href}" data-link><span class="li-ic">${icon(GS_ICON[r.type])}</span><span><b>${esc(r.title)}</b><small>${esc(r.sub || '')}</small></span><span class="type">${GS_LABEL[r.type]}</span></a>`).join('') : '<div class="gs-empty">Brak wyników</div>';
        gsBox.hidden = false;
      } catch (e) { fail(e); }
    }, 200);
  });
  gsInput.addEventListener('keydown', (e) => {
    const items = $$('.gs-item', gsBox);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      gsIndex = (gsIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(items.length, 1);
      items.forEach((x, i) => x.classList.toggle('on', i === gsIndex));
    } else if (e.key === 'Enter' && items[gsIndex]) { e.preventDefault(); items[gsIndex].click(); }
    else if (e.key === 'Escape') { gsBox.hidden = true; gsInput.blur(); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#global-search')) gsBox.hidden = true; });
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); gsInput.focus(); gsInput.select(); } });
  gsBox.addEventListener('click', () => { gsBox.hidden = true; gsInput.value = ''; });

  const views = {};
  const onView = (fn) => view.addEventListener('click', fn, { signal: state.ac.signal });

  // =======================================================
  // PULPIT
  // =======================================================
  views.dashboard = async () => {
    setHeader('Pulpit'); setNav('pulpit');
    const d = await api('/api/admin/overview');
    const k = d.kpis;
    const delta = k.revenuePrev ? Math.round(((k.revenueMonth - k.revenuePrev) / k.revenuePrev) * 100) : null;
    const h = new Date().getHours();
    view.innerHTML = `
      <section class="welcome view-enter">
        <div><small>${esc(new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()))}</small>
          <h2>${h < 18 ? 'Dzień dobry' : 'Dobry wieczór'}, ${esc(state.user.name.split(' ')[0])}!</h2>
          <p>${k.newLeads} ${plural(k.newLeads, 'nowy lead', 'nowe leady', 'nowych leadów')}, ${k.openTickets} ${plural(k.openTickets, 'otwarte zgłoszenie', 'otwarte zgłoszenia', 'otwartych zgłoszeń')}, ${k.overdueCount} ${plural(k.overdueCount, 'faktura', 'faktury', 'faktur')} po terminie i ${k.projectsQueued} ${plural(k.projectsQueued, 'projekt', 'projekty', 'projektów')} w kolejce.</p></div>
        <div class="actions"><a class="button button-coral btn-sm" href="/admin/leady" data-link>${icon('target')} Leady</a><a class="button button-ghost btn-sm" href="/admin/zgloszenia" data-link>${icon('life-buoy')} Zgłoszenia</a></div>
      </section>
      <section class="grid grid-4 mt">
        ${kpi('Przychód w tym miesiącu', fmtMoney0(k.revenueMonth), 'banknote', 'green', delta === null ? 'brak danych z poprz. miesiąca' : `<span class="delta ${delta >= 0 ? 'up' : 'down'}">${icon(delta >= 0 ? 'trending-up' : 'trending-down')} ${delta >= 0 ? '+' : ''}${delta}%</span> vs poprzedni miesiąc`, '/admin/statystyki')}
        ${kpi('MRR (abonamenty)', fmtMoney0(k.mrr), 'repeat', 'coral', `${k.activeSoftware} aktywnych systemów · ARR ${fmtMoney0(k.mrr * 12)}`, '/admin/oprogramowanie')}
        ${kpi('Klienci', nf.format(k.clients), 'users', 'blue', `+${k.newClients30} w ostatnich 30 dniach`, '/admin/uzytkownicy')}
        ${kpi('Do zebrania', fmtMoney0(k.toCollect), 'wallet-cards', 'amber', k.overdueCount ? `<span class="alert" style="color:var(--accent-ink);font-weight:700">${fmtMoney0(k.overdueAmount)} po terminie</span>` : 'brak zaległości', '/admin/platnosci')}
      </section>
      <div class="grid grid-main mt">
        <div class="stack">
          <section class="card" id="rev-card"><div class="chart-head"><div><h3>Przychody (wpłaty)</h3><small>Ostatnie 12 miesięcy</small></div><div class="big">${fmtMoney0(d.revenue12.reduce((s, x) => s + x.value, 0))}</div></div></section>
          <section class="card"><div class="card-head"><h2>${icon('target')} Lejek sprzedaży</h2><a href="/admin/leady" data-link>Leady ${icon('arrow-right')}</a></div>
            <div class="funnel">${d.leadPipeline.map((l) => { const max = Math.max(...d.leadPipeline.map((x) => x.count), 1); return `<div class="funnel-step"><small>${esc(LEAD_STATUS[l.status][0])}</small><strong>${l.count}</strong><i class="fillbar" style="width:${(l.count / max) * 100}%"></i></div>`; }).join('')}</div>
          </section>
          <section class="card"><div class="card-head"><h2>${icon('life-buoy')} Zgłoszenia do obsłużenia</h2><a href="/admin/zgloszenia" data-link>Wszystkie ${icon('arrow-right')}</a></div>
            ${d.ticketsWaiting.length ? `<ul class="list">${d.ticketsWaiting.map((t) => `<li><a class="list-item" href="/admin/zgloszenia/${t.id}" data-link><span class="li-ic ${t.priority === 'krytyczny' || t.priority === 'wysoki' ? 'coral' : ''}">${icon((TICKET_CAT[t.category] || TICKET_CAT.pytanie)[1])}</span><div><b>${esc(t.subject)}</b><small>${esc(t.number)} · ${esc(t.clientName)} · ${fmtRel(t.updatedAt)}</small></div><div class="li-right">${bdg(PRIORITY, t.priority)}</div></a></li>`).join('')}</ul>` : emptyState('circle-check', 'Wszystko obsłużone', 'Brak zgłoszeń czekających na zespół.')}
          </section>
        </div>
        <div class="stack">
          <section class="card" id="users-card"><div class="chart-head"><div><h3>Nowi klienci</h3><small>Ostatnie 12 miesięcy</small></div><div class="big">${d.users12.reduce((s, x) => s + x.value, 0)}</div></div></section>
          <section class="card"><div class="card-head"><h2>${icon('circle-alert')} Faktury po terminie</h2><a href="/admin/platnosci" data-link>Płatności ${icon('arrow-right')}</a></div>
            ${d.overdue.length ? `<ul class="list">${d.overdue.map((i) => `<li class="list-item"><span class="li-ic coral">${icon('receipt')}</span><div><b class="mono">${esc(i.number)}</b><small>${esc(i.clientName)} · termin ${fmtDate(i.dueDate)}</small></div><div class="li-right"><strong>${fmtMoney(i.gross)}</strong><button class="button button-light btn-sm" data-pay="${i.id}" style="margin-top:6px">${icon('banknote')} Wpłata</button></div></li>`).join('')}</ul>` : emptyState('circle-check', 'Brak zaległości', 'Wszystkie faktury są opłacane w terminie.')}
          </section>
          <section class="card"><div class="card-head"><h2>${icon('calendar-clock')} Odnowienia (30 dni)</h2></div>
            ${d.renewals.length ? `<ul class="list">${d.renewals.map((s) => `<li class="list-item"><span class="li-ic blue">${icon('app-window')}</span><div><b>${esc(s.name)}</b><small>${esc(s.clientName)} · ${fmtMoney(s.monthlyFee)}/mies.</small></div><div class="li-right"><strong>${fmtDate(s.renewalDate)}</strong></div></li>`).join('')}</ul>` : emptyState('calendar-check', 'Brak odnowień', 'W najbliższych 30 dniach nic nie wygasa.')}
          </section>
          <section class="card"><div class="card-head"><h2>${icon('activity')} Ostatnie zdarzenia</h2><a href="/admin/dziennik" data-link>Dziennik ${icon('arrow-right')}</a></div>
            <ul class="feed">${d.activity.map((a) => `<li><span class="li-ic">${icon(auditIcon(a.action))}</span><div><b>${esc(auditLabel(a.action))}</b><p>${esc(a.user_name)}${a.details ? ` · ${esc(a.details)}` : ''}</p><small>${fmtRel(a.created_at)}</small></div></li>`).join('')}</ul>
          </section>
        </div>
      </div>`;
    $('#rev-card').appendChild(barChart(monthSeries(d.revenue12), { format: fmtMoney, label: 'Przychody miesięczne', width: $('#rev-card').clientWidth - 44 }));
    $('#users-card').appendChild(barChart(monthSeries(d.users12), { format: (v) => `${v} ${plural(v, 'klient', 'klientów', 'klientów')}`, height: 200, width: $('#users-card').clientWidth - 44, label: 'Nowi klienci miesięcznie' }));
    $$('[data-pay]', view).forEach((b) => b.addEventListener('click', async () => { if (await actions.payment({ invoiceId: b.dataset.pay }).catch(fail)) router(); }));
  };

  const AUDIT = {
    'auth.login': ['Logowanie klienta', 'log-in'], 'auth.admin_login': ['Logowanie do panelu admina', 'shield-check'], 'auth.logout': ['Wylogowanie', 'log-out'],
    'auth.login_failed': ['Nieudane logowanie', 'shield-alert'], 'user.registered': ['Rejestracja konta', 'user-round-plus'], 'user.created': ['Utworzono użytkownika', 'user-round-plus'],
    'user.updated': ['Edycja użytkownika', 'user-cog'], 'user.blocked': ['Zablokowano konto', 'lock'], 'user.unblocked': ['Odblokowano konto', 'lock-open'],
    'user.password_reset': ['Reset hasła', 'key-round'], 'user.sessions_revoked': ['Wylogowano sesje', 'log-out'], 'user.deleted': ['Usunięto użytkownika', 'trash-2'],
    'user.impersonation_start': ['Podgląd konta klienta', 'eye'], 'user.impersonation_end': ['Koniec podglądu', 'eye-off'], 'lead.created': ['Nowy lead', 'target'],
    'lead.status': ['Zmiana statusu leada', 'target'], 'lead.updated': ['Edycja leada', 'target'], 'lead.converted': ['Lead → klient', 'user-check'], 'lead.deleted': ['Usunięto lead', 'trash-2'],
    'ticket.created': ['Nowe zgłoszenie', 'life-buoy'], 'ticket.reply': ['Odpowiedź w zgłoszeniu', 'message-square'], 'ticket.note': ['Notatka wewnętrzna', 'sticky-note'],
    'ticket.updated': ['Zmiana zgłoszenia', 'life-buoy'], 'project.created': ['Nowy projekt', 'kanban'], 'project.stage': ['Zmiana etapu projektu', 'kanban'],
    'project.updated': ['Edycja projektu', 'kanban'], 'project.update_posted': ['Aktualizacja dla klienta', 'megaphone'], 'invoice.created': ['Wystawiono fakturę', 'receipt'],
    'invoice.oplacona': ['Faktura opłacona', 'receipt'], 'invoice.anulowana': ['Anulowano fakturę', 'receipt'], 'payment.recorded': ['Zarejestrowano wpłatę', 'banknote'],
    'payment.deleted': ['Usunięto wpłatę', 'trash-2'], 'document.uploaded': ['Dodano dokument', 'upload'], 'document.deleted': ['Usunięto dokument', 'trash-2'],
    'software.created': ['Nowe oprogramowanie', 'app-window'], 'software.updated': ['Edycja oprogramowania', 'app-window'], 'settings.updated': ['Zmiana ustawień', 'settings'],
    'export': ['Eksport danych', 'file-down'], 'broadcast.sent': ['Komunikat do klientów', 'send'], 'account.password_changed': ['Zmiana hasła', 'key-round'], seed: ['Dane demo', 'database'],
  };
  const auditLabel = (a) => AUDIT[a]?.[0] || a;
  const auditIcon = (a) => AUDIT[a]?.[1] || 'activity';

  // =======================================================
  // STATYSTYKI
  // =======================================================
  let statMonths = 12;
  views.stats = async () => {
    setHeader('Statystyki', [['Pulpit', '/admin'], ['Statystyki']]); setNav('statystyki');
    const d = await api(`/api/admin/stats?months=${statMonths}`);
    const s = d.summary;
    view.innerHTML = `
      <div class="toolbar view-enter"><div class="segmented" role="tablist" aria-label="Zakres">${[3, 6, 12, 24].map((m) => `<button type="button" data-m="${m}" class="${m === statMonths ? 'on' : ''}">${m} mies.</button>`).join('')}</div>
        <div class="page-actions">${exportBtn('wplaty', 'Wpłaty CSV')}${exportBtn('faktury', 'Faktury CSV')}</div></div>
      <section class="grid grid-6">
        ${kpi('Przychód', fmtMoney0(s.totalRevenue), 'banknote', 'green', `zafakturowano ${fmtMoney0(s.totalInvoiced)}`)}
        ${kpi('MRR', fmtMoney0(s.mrr), 'repeat', 'coral', `ARR ${fmtMoney0(s.mrr * 12)}`)}
        ${kpi('Średnia wpłata', fmtMoney0(s.avgPayment), 'calculator', 'blue', 'na transakcję')}
        ${kpi('Nowi klienci', nf.format(s.newClients), 'user-round-plus', 'blue', `w ciągu ${d.months} mies.`)}
        ${kpi('Konwersja leadów', `${nf.format(s.conversion)}%`, 'target', 'amber', `${s.leadsWon} z ${s.leads} leadów`)}
        ${kpi('Utraceni', nf.format(s.churned), 'user-x', 'coral', 'zawieszone i wygasłe systemy')}
      </section>
      <div class="grid grid-2 mt">
        <section class="card" id="c-rev"><div class="chart-head"><div><h3>Przychody (wpłaty)</h3><small>Suma wpłat w miesiącu</small></div></div></section>
        <section class="card" id="c-inv"><div class="chart-head"><div><h3>Wartość wystawionych faktur</h3><small>Brutto, bez anulowanych</small></div></div></section>
        <section class="card" id="c-users"><div class="chart-head"><div><h3>Liczba klientów</h3><small>Łącznie, narastająco</small></div></div></section>
        <section class="card" id="c-leads"><div class="chart-head"><div><h3>Nowe leady</h3><small>Zapytania w miesiącu</small></div></div></section>
      </div>
      <div class="grid grid-2 mt">
        <section class="card"><div class="card-head"><h2>${icon('radar')} Leady wg źródła</h2></div>${hbars(d.leadsBySource.map((r) => ({ label: `${r.source} (${r.won} wygr.)`, value: r.count })))}</section>
        <section class="card"><div class="card-head"><h2>${icon('package')} Przychód wg usługi</h2></div>${hbars(d.revenueByProduct.map((r) => ({ label: r.name, value: r.value })), { format: fmtMoney0 })}</section>
        <section class="card"><div class="card-head"><h2>${icon('crown')} Najwięksi klienci</h2></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Klient</th><th class="num">Wpłaty</th><th class="num">Suma</th></tr></thead><tbody>${d.topClients.map((c) => `<tr><td>${userCell(c.company || c.name, c.company ? c.name : '', c.id)}</td><td class="num">${c.payments}</td><td class="num strong">${fmtMoney(c.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Brak danych</td></tr>'}</tbody></table></div></section>
        <section class="card"><div class="card-head"><h2>${icon('app-window')} Abonamenty wg planu</h2></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Plan</th><th class="num">Systemy</th><th class="num">MRR</th></tr></thead><tbody>${d.softwareByPlan.map((p) => `<tr><td class="strong">${esc(p.plan)}</td><td class="num">${p.count}</td><td class="num strong">${fmtMoney(p.mrr)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Brak aktywnych abonamentów</td></tr>'}</tbody></table></div></section>
      </div>`;
    const cw = $('#c-rev').clientWidth - 44;
    $('#c-rev').appendChild(barChart(monthSeries(d.revenue), { format: fmtMoney, label: 'Przychody', width: cw }));
    $('#c-inv').appendChild(barChart(monthSeries(d.invoiced), { format: fmtMoney, label: 'Faktury', width: cw }));
    $('#c-users').appendChild(lineChart(monthSeries(d.totalUsers), { format: (v) => `${v} klientów`, label: 'Klienci', width: cw }));
    $('#c-leads').appendChild(barChart(monthSeries(d.newLeads), { format: (v) => `${v} leadów`, label: 'Leady', width: cw }));
    $$('[data-m]', view).forEach((b) => b.addEventListener('click', () => { statMonths = Number(b.dataset.m); router(); }));
  };

  // =======================================================
  // UŻYTKOWNICY
  // =======================================================
  views.users = async () => {
    setHeader('Użytkownicy', [['Pulpit', '/admin'], ['Użytkownicy']]); setNav('uzytkownicy');
    const { users, counts } = await api('/api/admin/users');
    view.innerHTML = `${pageHead(`Klienci: <b>${counts.client || 0}</b> · Zespół: <b>${(counts.staff || 0) + (counts.admin || 0)}</b>. Kliknij wiersz, aby zarządzać kontem, hasłem, sesjami i danymi.`,
      `${exportBtn('uzytkownicy')}<button class="button button-dark btn-sm" data-new>${icon('user-round-plus')} Nowy użytkownik</button>`)}<section class="card" id="users-table"></section>`;
    dataTable($('#users-table'), {
      rows: users, searchKeys: ['name', 'email', 'company', 'phone'], pageSize: 20,
      filters: [{ key: 'role', label: 'Rola', options: opts(ROLE) }, { key: 'status', label: 'Status', options: [{ value: 'active', label: 'Aktywne' }, { value: 'blocked', label: 'Zablokowane' }] }],
      onRow: (u) => navigate(`/admin/uzytkownicy/${u.id}`),
      columns: [
        { label: 'Użytkownik', render: (u) => userCell(u.company || u.name, u.company ? `${u.name} · ${u.email}` : u.email, u.id), sort: (u) => (u.company || u.name).toLowerCase() },
        { label: 'Rola', render: (u) => `${bdg(ROLE, u.role)} ${u.status === 'blocked' ? badge('Zablokowany', 'coral') : ''}`, sort: (u) => u.role },
        { label: 'Projekty', cls: 'num hide-sm', render: (u) => u.projects, sort: (u) => u.projects },
        { label: 'MRR', cls: 'num hide-sm', render: (u) => (u.mrr ? fmtMoney(u.mrr) : '—'), sort: (u) => u.mrr },
        { label: 'Wpłaty', cls: 'num hide-sm', render: (u) => (u.paid ? fmtMoney0(u.paid) : '—'), sort: (u) => u.paid },
        { label: 'Ostatnie logowanie', cls: 'num hide-sm muted', render: (u) => fmtRel(u.lastLoginAt), sort: (u) => u.lastLoginAt || '' },
      ],
    });
    $('[data-new]', view).addEventListener('click', async () => { const r = await actions.user().catch(fail); if (r) navigate(`/admin/uzytkownicy/${r.id}`); });
  };

  views.user = async ({ id }) => {
    setNav('uzytkownicy');
    const d = await api(`/api/admin/users/${id}`);
    const u = d.user;
    setHeader(u.company || u.name, [['Użytkownicy', '/admin/uzytkownicy'], [u.company || u.name]]);
    const mrr = d.software.filter((s) => s.status === 'aktywne').reduce((s, x) => s + x.monthlyFee, 0);
    const paid = d.payments.reduce((s, p) => s + p.amount, 0);
    const due = d.invoices.filter((i) => ['oczekuje', 'po_terminie'].includes(i.status)).reduce((s, i) => s + i.gross, 0);
    const client = u.role === 'client';
    view.innerHTML = `
      <section class="card view-enter">
        <div class="detail-head">
          <span class="avatar">${esc(initials(u.name))}</span>
          <div><h2>${esc(u.company || u.name)}</h2>
            <div class="sub"><span>${icon('user-round')} ${esc(u.name)}</span><span>${icon('mail')} <a href="mailto:${esc(u.email)}">${esc(u.email)}</a></span>${u.phone ? `<span>${icon('phone')} <a href="tel:${esc(u.phone)}">${esc(u.phone)}</a></span>` : ''}${u.nip ? `<span>${icon('landmark')} NIP ${esc(u.nip)}</span>` : ''}</div>
            <div style="display:flex;gap:6px;margin-top:10px">${bdg(ROLE, u.role)} ${u.status === 'blocked' ? badge('Zablokowany', 'coral') : badge('Aktywny', 'ok')} <span class="chip">od ${fmtDate(u.createdAt)}</span></div>
          </div>
          <div class="actions">
            <button class="button button-light btn-sm" data-act="edit">${icon('pencil')} Edytuj dane</button>
            <div class="dropdown" id="user-more"><button class="button button-dark btn-sm" aria-haspopup="true">${icon('ellipsis')} Akcje</button>
              <div class="dropdown-menu" hidden>
                <button data-act="pw-gen">${icon('key-round')} Wygeneruj nowe hasło</button>
                <button data-act="pw-set">${icon('rectangle-ellipsis')} Ustaw hasło ręcznie</button>
                <button data-act="logout">${icon('log-out')} Wyloguj ze wszystkich urządzeń</button>
                ${client && isAdmin() ? `<button data-act="impersonate">${icon('eye')} Zaloguj jako klient (podgląd)</button>` : ''}
                <hr>
                ${client ? `<button data-act="project">${icon('kanban')} Nowy projekt</button><button data-act="software">${icon('app-window')} Dodaj oprogramowanie</button><button data-act="invoice">${icon('receipt')} Wystaw fakturę</button><button data-act="payment">${icon('banknote')} Zarejestruj wpłatę</button><button data-act="document">${icon('upload')} Dodaj dokument</button><hr>` : ''}
                <button data-act="block" class="${u.status === 'blocked' ? '' : 'danger'}">${icon(u.status === 'blocked' ? 'lock-open' : 'lock')} ${u.status === 'blocked' ? 'Odblokuj konto' : 'Zablokuj konto'}</button>
                ${isAdmin() ? `<button data-act="delete" class="danger">${icon('trash-2')} Usuń konto i dane</button>` : ''}
              </div></div>
          </div>
        </div>
        <div class="mini-stats"><div><small>MRR</small><strong>${fmtMoney(mrr)}</strong></div><div><small>Wpłacono łącznie</small><strong>${fmtMoney(paid)}</strong></div><div><small>Do zapłaty</small><strong>${fmtMoney(due)}</strong></div><div><small>Ostatnie logowanie</small><strong style="font-size:15px">${fmtRel(u.lastLoginAt)}</strong></div></div>
      </section>
      <div class="tabs mt" role="tablist">${[['projects', 'Projekty', d.projects.length], ['software', 'Oprogramowanie', d.software.length], ['finance', 'Faktury i wpłaty', d.invoices.length], ['tickets', 'Zgłoszenia', d.tickets.length], ['docs', 'Dokumenty', d.documents.length], ['sessions', 'Sesje', d.sessions.length], ['activity', 'Aktywność', d.activity.length], ['notes', 'Notatki', '']]
        .map(([k, l, c], i) => `<button type="button" role="tab" data-tab="${k}" class="${i === 0 ? 'on' : ''}">${l}${c !== '' ? ` <span class="count">${c}</span>` : ''}</button>`).join('')}</div>
      <div id="user-tab"></div>`;

    const tabs = {
      projects: () => (d.projects.length ? `<div class="grid grid-2">${d.projects.map((p) => `<a class="card project-card" href="/admin/projekty/${p.id}" data-link><div class="top"><div><h3>${esc(p.name)}</h3><div class="kind">${esc(p.kind)} · ${esc(p.manager || '—')}</div></div>${badge(p.stageLabel, '')}</div><div class="progress-row"><div class="progress"><i style="width:${p.progress}%"></i></div><b>${p.progress}%</b></div><div class="meta-row"><span>${icon('calendar-days')} ${fmtDate(p.dueDate)}</span><span>${icon('wallet-cards')} ${fmtMoney0(p.budget)}</span></div></a>`).join('')}</div>` : `<section class="card">${emptyState('kanban', 'Brak projektów', 'Utwórz projekt dla tego klienta.', `<button class="button button-dark btn-sm" data-act="project">${icon('plus')} Nowy projekt</button>`)}</section>`),
      software: () => `<section class="card">${d.software.length ? `<div class="table-wrap"><table class="table responsive"><thead><tr><th>System</th><th>Status</th><th class="num">Abonament</th><th class="num hide-sm">Odnowienie</th></tr></thead><tbody>${d.software.map((s) => `<tr class="clickable" data-sw="${s.id}"><td><b>${esc(s.name)}</b><span class="t-sub">${esc(s.plan)} · v${esc(s.version)}${s.url ? ` · ${esc(s.url)}` : ''}</span></td><td>${bdg(SOFT_STATUS, s.status)}</td><td class="num strong">${fmtMoney(s.monthlyFee)}</td><td class="num hide-sm muted">${fmtDate(s.renewalDate)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('app-window', 'Brak uruchomionych systemów', 'Dodaj oprogramowanie, gdy wdrożenie zostanie uruchomione.', `<button class="button button-dark btn-sm" data-act="software">${icon('plus')} Dodaj</button>`)}</section>`,
      finance: () => `<div class="grid grid-main"><section class="card"><div class="card-head"><h2>${icon('receipt')} Faktury</h2><button class="button button-light btn-sm" data-act="invoice">${icon('plus')} Faktura</button></div>${d.invoices.length ? `<div class="table-wrap"><table class="table responsive"><thead><tr><th>Numer</th><th>Status</th><th class="num">Brutto</th><th class="num hide-sm">Termin</th></tr></thead><tbody>${d.invoices.map((i) => `<tr class="clickable" data-inv="${i.id}"><td class="mono strong">${esc(i.number)}</td><td>${bdg(INV_STATUS, i.status)}</td><td class="num strong">${fmtMoney(i.gross)}</td><td class="num hide-sm muted">${fmtDate(i.dueDate)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('receipt', 'Brak faktur', '')}</section>
        <section class="card"><div class="card-head"><h2>${icon('banknote')} Wpłaty</h2><button class="button button-light btn-sm" data-act="payment">${icon('plus')} Wpłata</button></div>${d.payments.length ? `<ul class="list">${d.payments.map((p) => `<li class="list-item"><span class="li-ic green">${icon('banknote')}</span><div><b>${fmtMoney(p.amount)}</b><small>${fmtDate(p.paid_at)} · ${esc(PAY_METHOD[p.method] || p.method)}${p.number ? ` · ${esc(p.number)}` : ''}</small></div></li>`).join('')}</ul>` : emptyState('banknote', 'Brak wpłat', '')}</section></div>`,
      tickets: () => `<section class="card">${d.tickets.length ? `<ul class="list">${d.tickets.map((t) => `<li><a class="list-item" href="/admin/zgloszenia/${t.id}" data-link><span class="li-ic">${icon((TICKET_CAT[t.category] || TICKET_CAT.pytanie)[1])}</span><div><b>${esc(t.subject)}</b><small>${esc(t.number)} · ${fmtRel(t.updatedAt)}</small></div>${bdg(TICKET_STATUS, t.status)}</a></li>`).join('')}</ul>` : emptyState('life-buoy', 'Brak zgłoszeń', '')}</section>`,
      docs: () => `<section class="card"><div class="card-head"><h2>${icon('folder-open')} Dokumenty klienta</h2><button class="button button-light btn-sm" data-act="document">${icon('upload')} Dodaj</button></div>${d.documents.length ? `<ul class="list">${d.documents.map((x) => `<li class="list-item"><span class="li-ic coral">${icon('file-text')}</span><div><b>${esc(x.name)}</b><small>${esc(DOC_CAT[x.category] || x.category)} · ${fmtDate(x.createdAt)} · ${(x.size / 1024).toFixed(0)} KB</small></div><a class="icon-btn" href="/api/admin/documents/${x.id}/download" download aria-label="Pobierz">${icon('download')}</a></li>`).join('')}</ul>` : emptyState('folder-open', 'Brak dokumentów', '')}</section>`,
      sessions: () => `<section class="card"><div class="card-head"><h2>${icon('monitor-smartphone')} Aktywne sesje</h2><button class="button btn-danger btn-sm" data-act="logout">${icon('log-out')} Wyloguj wszystkie</button></div>${d.sessions.length ? `<ul class="list">${d.sessions.map((s) => `<li class="list-item"><span class="li-ic">${icon(/Mobile|Android|iPhone/.test(s.userAgent) ? 'smartphone' : 'monitor')}</span><div><b>${esc(s.userAgent.slice(0, 80) || 'Nieznane urządzenie')}</b><small>${esc(s.ip)} · utworzona ${fmtDateTime(s.createdAt)} · aktywna ${fmtRel(s.lastSeenAt)}${s.impersonatorId ? ' · podgląd administratora' : ''}</small></div></li>`).join('')}</ul>` : emptyState('monitor-smartphone', 'Brak aktywnych sesji', 'Użytkownik nie jest nigdzie zalogowany.')}</section>`,
      activity: () => `<section class="card">${d.activity.length ? `<ul class="feed">${d.activity.map((a) => `<li><span class="li-ic">${icon(auditIcon(a.action))}</span><div><b>${esc(auditLabel(a.action))}</b><p>${esc(a.user_name)}${a.details ? ` · ${esc(a.details)}` : ''} · IP ${esc(a.ip || '—')}</p><small>${fmtDateTime(a.created_at)}</small></div></li>`).join('')}</ul>` : emptyState('activity', 'Brak zdarzeń', '')}${d.leads.length ? `<div class="card-body" style="border-top:1px solid var(--border)"><b style="font-size:13px">Powiązane leady:</b> ${d.leads.map((l) => `<a class="chip" href="/admin/leady?id=${l.id}" data-link>#${l.id} ${esc(LEAD_STATUS[l.status]?.[0] || l.status)}</a>`).join(' ')}</div>` : ''}</section>`,
      notes: () => `<section class="card"><form class="card-body" id="notes-form"><div class="field"><label for="u-notes">Notatki wewnętrzne (niewidoczne dla klienta)</label><textarea id="u-notes" rows="8">${esc(u.notes || '')}</textarea></div><div class="form-actions"><button class="button button-dark btn-sm" type="submit">${icon('save')} Zapisz notatki</button></div></form></section>`,
    };
    const showTab = (k) => {
      $$('[data-tab]', view).forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
      $('#user-tab').innerHTML = tabs[k]();
      $('#notes-form')?.addEventListener('submit', async (e) => { e.preventDefault(); try { await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { notes: $('#u-notes').value } }); toast('Notatki zapisane.'); } catch (ex) { fail(ex); } });
      $$('[data-sw]', view).forEach((r) => r.addEventListener('click', async () => { const s = d.software.find((x) => x.id === Number(r.dataset.sw)); if (await actions.software(s, s.id).catch(fail)) router(); }));
      $$('[data-inv]', view).forEach((r) => r.addEventListener('click', () => openInvoice(Number(r.dataset.inv))));
    };
    $$('[data-tab]', view).forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    showTab('projects');

    const more = $('#user-more'), moreMenu = $('.dropdown-menu', more);
    $('button', more).addEventListener('click', (e) => { e.stopPropagation(); moreMenu.hidden = !moreMenu.hidden; });
    document.addEventListener('click', () => { moreMenu.hidden = true; }, { signal: state.ac.signal });

    onView(async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      moreMenu.hidden = true;
      const a = b.dataset.act;
      try {
        if (a === 'edit') {
          const r = await openForm({
            title: 'Edytuj użytkownika', values: u,
            fields: [
              { name: 'name', label: 'Imię i nazwisko *', required: true }, { name: 'email', label: 'E-mail *', type: 'email', required: true },
              { name: 'company', label: 'Firma' }, { name: 'nip', label: 'NIP' }, { name: 'phone', label: 'Telefon' },
              { name: 'role', label: 'Rola', type: 'select', options: isAdmin() ? opts(ROLE) : opts(ROLE).filter((o) => o.value === u.role) },
              { name: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Aktywne' }, { value: 'blocked', label: 'Zablokowane' }] },
            ],
            onSubmit: (data) => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: data }),
          });
          if (r) { toast('Zapisano zmiany.'); router(); }
        } else if (a === 'pw-gen') {
          if (!(await confirmDialog({ title: 'Wygenerować nowe hasło?', text: 'Obecne hasło przestanie działać, a użytkownik zostanie wylogowany ze wszystkich urządzeń.', confirmLabel: 'Generuj hasło' }))) return;
          const r = await api(`/api/admin/users/${u.id}/password`, { method: 'POST', body: {} });
          showSecret('Nowe hasło', `Nowe hasło dla ${u.email}:`, r.password);
        } else if (a === 'pw-set') {
          const r = await openForm({ title: 'Ustaw hasło', submitLabel: 'Ustaw hasło', fields: [{ name: 'password', label: 'Nowe hasło *', type: 'text', required: true, help: 'Min. 8 znaków, litera i cyfra' }, { name: 'logout', label: 'Wyloguj użytkownika ze wszystkich urządzeń', type: 'checkbox', value: true }], onSubmit: (data) => api(`/api/admin/users/${u.id}/password`, { method: 'POST', body: data }) });
          if (r) toast('Hasło zmienione.');
        } else if (a === 'logout') {
          const r = await api(`/api/admin/users/${u.id}/logout`, { method: 'POST', body: {} });
          toast(`Zakończono ${r.removed} ${plural(r.removed, 'sesję', 'sesje', 'sesji')}.`); router();
        } else if (a === 'impersonate') {
          if (!(await confirmDialog({ title: 'Podgląd konta klienta', text: 'Zostaniesz zalogowany jako ten klient. Zdarzenie zostanie zapisane w dzienniku. Wrócisz przyciskiem na górze panelu klienta.', confirmLabel: 'Przejdź do podglądu' }))) return;
          const r = await api(`/api/admin/users/${u.id}/impersonate`, { method: 'POST', body: {} });
          location.assign(r.redirect);
        } else if (a === 'block') {
          const block = u.status !== 'blocked';
          if (block && !(await confirmDialog({ title: 'Zablokować konto?', text: 'Użytkownik zostanie wylogowany i nie będzie mógł się zalogować.', confirmLabel: 'Zablokuj', danger: true }))) return;
          await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { status: block ? 'blocked' : 'active' } });
          toast(block ? 'Konto zablokowane.' : 'Konto odblokowane.'); router();
        } else if (a === 'delete') {
          if (!(await confirmDialog({ title: 'Usunąć konto?', text: `Zostaną usunięte wszystkie dane użytkownika ${u.email}: projekty, zgłoszenia, faktury, wpłaty i dokumenty. Tej operacji nie można cofnąć.`, confirmLabel: 'Usuń bezpowrotnie', danger: true }))) return;
          await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
          toast('Konto usunięte.'); await refreshMeta(); navigate('/admin/uzytkownicy');
        } else if (actions[a]) {
          const r = await actions[a]({ userId: u.id });
          if (r && a !== 'project') router();
        }
      } catch (ex) { fail(ex); }
    });
  };

  // =======================================================
  // KANBAN (wspólny dla leadów i projektów)
  // =======================================================
  function kanban(container, { columns, items, colOf, card, onMove, onOpen }) {
    container.innerHTML = `<div class="kanban">${columns.map((c) => {
      const list = items.filter((it) => colOf(it) === c.key);
      return `<section class="kanban-col" data-col="${c.key}" aria-label="${esc(c.label)}">
        <div class="kanban-head"><b><span class="dotc" style="background:${c.color || 'var(--text-3)'}"></span>${esc(c.label)}</b><small>${list.length}${c.sum ? ` · ${c.sum(list)}` : ''}</small></div>
        <div class="kanban-list">${list.map((it) => `<button type="button" class="k-card ${it.priority ? `prio-${it.priority}` : ''}" draggable="true" data-id="${it.id}">${card(it)}</button>`).join('') || '<div class="k-empty">Przeciągnij tutaj</div>'}</div>
      </section>`;
    }).join('')}</div>`;
    let dragId = null;
    $$('.k-card', container).forEach((el) => {
      el.addEventListener('dragstart', (e) => { dragId = el.dataset.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); $$('.kanban-col', container).forEach((c) => c.classList.remove('drop')); });
      el.addEventListener('click', () => onOpen(items.find((x) => String(x.id) === el.dataset.id)));
    });
    $$('.kanban-col', container).forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
      col.addEventListener('drop', async (e) => {
        e.preventDefault(); col.classList.remove('drop');
        const it = items.find((x) => String(x.id) === (dragId || e.dataTransfer.getData('text/plain')));
        if (it && colOf(it) !== col.dataset.col) await onMove(it, col.dataset.col);
      });
    });
  }

  // =======================================================
  // LEADY
  // =======================================================
  let leadMode = 'kanban';
  views.leads = async () => {
    setHeader('Leady', [['Pulpit', '/admin'], ['Leady']]); setNav('leady');
    await loadMeta();
    const { leads } = await api('/api/admin/leads');
    const pipelineValue = leads.filter((l) => ['nowy', 'w_kontakcie', 'oferta'].includes(l.status)).reduce((s, l) => s + l.value, 0);
    view.innerHTML = `${pageHead(`Wartość otwartego lejka: <b>${fmtMoney0(pipelineValue)}</b>. Przeciągaj karty między kolumnami, aby zmieniać status. Wygrany lead zamienisz jednym kliknięciem w konto klienta.`,
      `<div class="segmented"><button type="button" data-mode="kanban" class="${leadMode === 'kanban' ? 'on' : ''}">${icon('kanban')} Tablica</button><button type="button" data-mode="table" class="${leadMode === 'table' ? 'on' : ''}">${icon('list')} Lista</button></div>${exportBtn('leady')}<button class="button button-dark btn-sm" data-new>${icon('plus')} Nowy lead</button>`)}<div id="leads-body"></div>`;
    const body = $('#leads-body');
    if (leadMode === 'kanban') {
      kanban(body, {
        items: leads, colOf: (l) => l.status,
        columns: Object.entries(LEAD_STATUS).map(([key, v]) => ({ key, label: v[0], color: v[2], sum: (list) => fmtMoney0(list.reduce((s, l) => s + l.value, 0)) })),
        card: (l) => `<b>${esc(l.name)}</b><small>${esc(l.company || l.email)}</small><div class="k-meta"><span>${esc(l.utmSource || l.source)} · ${fmtRel(l.createdAt)}</span><b>${l.value ? fmtMoney0(l.value) : ''}</b></div>`,
        onMove: async (l, status) => { try { await api(`/api/admin/leads/${l.id}`, { method: 'PATCH', body: { status } }); toast(`Status: ${LEAD_STATUS[status][0]}`); refreshMeta(); router(); } catch (e) { fail(e); } },
        onOpen: (l) => openLead(l),
      });
    } else {
      $('#leads-body').innerHTML = '<section class="card" id="leads-table"></section>';
      dataTable($('#leads-table'), {
        rows: leads, searchKeys: ['name', 'email', 'company', 'topic', 'phone'],
        filters: [{ key: 'status', label: 'Status', options: opts(LEAD_STATUS) }, { key: 'source', label: 'Źródło', options: [...new Set(leads.map((l) => l.source))].map((v) => ({ value: v, label: v })) }],
        onRow: openLead,
        columns: [
          { label: 'Lead', render: (l) => userCell(l.name, `${l.email}${l.company ? ' · ' + l.company : ''}`), sort: (l) => l.name.toLowerCase() },
          { label: 'Status', render: (l) => bdg(LEAD_STATUS, l.status), sort: (l) => l.status },
          { label: 'Temat', cls: 'hide-sm muted', render: (l) => esc(l.topic) },
          { label: 'Źródło', cls: 'hide-sm muted', render: (l) => esc(l.utmSource || l.source), sort: (l) => l.source },
          { label: 'Wartość', cls: 'num', render: (l) => (l.value ? fmtMoney0(l.value) : '—'), sort: (l) => l.value },
          { label: 'Data', cls: 'num muted hide-sm', render: (l) => fmtDate(l.createdAt), sort: (l) => l.createdAt },
        ],
      });
    }
    $$('[data-mode]', view).forEach((b) => b.addEventListener('click', () => { leadMode = b.dataset.mode; router(); }));
    $('[data-new]', view).addEventListener('click', async () => { if (await actions.lead().catch(fail)) router(); });
    const openId = new URLSearchParams(location.search).get('id');
    if (openId) { const l = leads.find((x) => x.id === Number(openId)); if (l) openLead(l); }
  };

  async function openLead(l) {
    await loadMeta();
    const r = await openForm({
      title: l.name, submitLabel: 'Zapisz', wide: true, values: { ...l, assignedTo: l.assignedTo ?? '' },
      intro: `<span class="chip">${icon('calendar-days')} ${fmtDateTime(l.createdAt)}</span> <span class="chip">${icon('radar')} ${esc(l.utmSource || l.source)}</span> <span class="chip">${esc(l.topic)}</span>
        <a class="chip" href="mailto:${esc(l.email)}?subject=${encodeURIComponent('Modulio — ' + l.topic)}">${icon('mail')} Napisz e-mail</a>${l.phone ? ` <a class="chip" href="tel:${esc(l.phone)}">${icon('phone')} Zadzwoń</a>` : ''}${l.userId ? ` <a class="chip" href="/admin/uzytkownicy/${l.userId}" data-link>${icon('user-check')} Konto klienta</a>` : ''}
        <div class="lead-msg" style="margin-top:12px">${esc(l.message)}</div>`,
      fields: [
        { name: 'status', label: 'Status', type: 'select', options: opts(LEAD_STATUS) },
        { name: 'value', label: 'Wartość (zł)', type: 'number', min: 0 },
        { name: 'assignedTo', label: 'Opiekun', type: 'select', options: teamOptions(), empty: '— nieprzypisany —' },
        { name: 'name', label: 'Nazwa', required: true }, { name: 'email', label: 'E-mail', type: 'email', required: true },
        { name: 'phone', label: 'Telefon' }, { name: 'company', label: 'Firma' },
        { name: 'notes', label: 'Notatki z rozmów', type: 'textarea', rows: 4, placeholder: 'Ustalenia, budżet, kolejny krok…' },
      ],
      danger: { label: 'Usuń lead', confirm: 'Usunąć lead?', onClick: () => api(`/api/admin/leads/${l.id}`, { method: 'DELETE' }) },
      extraButtons: l.userId ? [] : [{ label: 'Zamień w klienta', icon: 'user-check', onClick: () => convertLead(l).catch(fail) }],
      onSubmit: (d) => api(`/api/admin/leads/${l.id}`, { method: 'PATCH', body: d }),
    });
    if (r) { toast(r === 'deleted' ? 'Lead usunięty.' : 'Zapisano.'); refreshMeta(); router(); }
  }
  async function convertLead(l) {
    const r = await openForm({
      title: `Zamień „${l.name}” w klienta`, submitLabel: 'Utwórz klienta',
      intro: 'Utworzymy konto klienta (lub podepniemy istniejące po adresie e-mail) i opcjonalnie projekt w kolejce „Do zrobienia”.',
      values: { projectName: `Wdrożenie — ${l.company || l.name}` },
      fields: [{ name: 'projectName', label: 'Nazwa projektu (puste = bez projektu)' }],
      onSubmit: (d) => api(`/api/admin/leads/${l.id}/convert`, { method: 'POST', body: d }),
    });
    if (!r) return;
    await refreshMeta();
    if (r.password) showSecret('Konto klienta utworzone', `Dane logowania dla ${l.email} — przekaż je klientowi:`, r.password);
    else toast('Lead podpięty do istniejącego konta.');
    navigate(`/admin/uzytkownicy/${r.userId}`);
  }

  // =======================================================
  // PROJEKTY (Do zrobienia / w realizacji)
  // =======================================================
  let projMode = 'kanban';
  views.projects = async () => {
    setHeader('Oprogramowanie do zrobienia', [['Pulpit', '/admin'], ['Projekty']]); setNav('projekty');
    const { projects, stages } = await api('/api/admin/projects');
    const active = projects.filter((p) => !['uruchomiony', 'rozwoj'].includes(p.stage));
    view.innerHTML = `${pageHead(`W kolejce: <b>${projects.filter((p) => p.stage === 'do_zrobienia').length}</b> · w realizacji: <b>${active.length - projects.filter((p) => p.stage === 'do_zrobienia').length}</b> · uruchomione: <b>${projects.length - active.length}</b>. Zmiana etapu tworzy automatyczną aktualizację w panelu klienta.`,
      `<div class="segmented"><button type="button" data-mode="kanban" class="${projMode === 'kanban' ? 'on' : ''}">${icon('kanban')} Tablica</button><button type="button" data-mode="table" class="${projMode === 'table' ? 'on' : ''}">${icon('list')} Lista</button></div><button class="button button-dark btn-sm" data-new>${icon('plus')} Nowy projekt</button>`)}<div id="proj-body"></div>`;
    if (projMode === 'kanban') {
      kanban($('#proj-body'), {
        items: projects, colOf: (p) => p.stage,
        columns: stages.map((s, i) => ({ key: s.key, label: s.label, color: ['#87928c', '#3d64a0', '#3d64a0', '#ff7b1c', '#a86a14', '#3f7d57', '#3f7d57'][i] })),
        card: (p) => `<b>${esc(p.name)}</b><small>${esc(p.clientName)} · ${esc(p.kind)}</small><div class="progress"><i style="width:${p.progress}%"></i></div><div class="k-meta"><span>${icon('calendar-days')} ${fmtDate(p.dueDate)}</span><span>${esc(p.manager || '—')}</span></div>`,
        onMove: async (p, stage) => { try { await api(`/api/admin/projects/${p.id}`, { method: 'PATCH', body: { stage } }); toast(`Etap: ${stages.find((s) => s.key === stage).label}`); refreshMeta(); router(); } catch (e) { fail(e); } },
        onOpen: (p) => navigate(`/admin/projekty/${p.id}`),
      });
    } else {
      $('#proj-body').innerHTML = '<section class="card" id="proj-table"></section>';
      dataTable($('#proj-table'), {
        rows: projects, searchKeys: ['name', 'clientName', 'manager', 'kind'],
        filters: [{ key: 'stage', label: 'Etap', options: stages.map((s) => ({ value: s.key, label: s.label })) }, { key: 'priority', label: 'Priorytet', options: opts(PRIORITY) }],
        onRow: (p) => navigate(`/admin/projekty/${p.id}`),
        columns: [
          { label: 'Projekt', render: (p) => `<b>${esc(p.name)}</b><span class="t-sub">${esc(p.clientName)} · ${esc(p.kind)}</span>`, sort: (p) => p.name },
          { label: 'Etap', render: (p) => badge(p.stageLabel, ['uruchomiony', 'rozwoj'].includes(p.stage) ? 'ok' : p.stage === 'do_zrobienia' ? '' : 'warn'), sort: (p) => stages.findIndex((s) => s.key === p.stage) },
          { label: 'Postęp', cls: 'hide-sm', render: (p) => `<div class="progress-row" style="min-width:120px"><div class="progress"><i style="width:${p.progress}%"></i></div><b>${p.progress}%</b></div>`, sort: (p) => p.progress },
          { label: 'Priorytet', cls: 'hide-sm', render: (p) => bdg(PRIORITY, p.priority), sort: (p) => ['niski', 'normalny', 'wysoki', 'krytyczny'].indexOf(p.priority) },
          { label: 'Budżet', cls: 'num hide-sm', render: (p) => fmtMoney0(p.budget), sort: (p) => p.budget },
          { label: 'Termin', cls: 'num muted', render: (p) => fmtDate(p.dueDate), sort: (p) => p.dueDate || '9999' },
        ],
      });
    }
    $$('[data-mode]', view).forEach((b) => b.addEventListener('click', () => { projMode = b.dataset.mode; router(); }));
    $('[data-new]', view).addEventListener('click', () => actions.project().catch(fail));
  };

  views.project = async ({ id }) => {
    setNav('projekty');
    await loadMeta();
    const d = await api(`/api/admin/projects/${id}`);
    const p = d.project;
    setHeader(p.name, [['Projekty', '/admin/projekty'], [p.name]]);
    const idx = d.stages.findIndex((s) => s.key === p.stage);
    view.innerHTML = `
      <section class="card project-hero view-enter">
        <div class="top">
          <div><div style="display:flex;gap:6px;flex-wrap:wrap">${badge(p.stageLabel, 'info')} ${bdg(PRIORITY, p.priority)} <span class="chip">${esc(p.kind)}</span></div>
            <h2 style="margin-top:12px">${esc(p.name)}</h2>
            <p style="margin-top:6px">Klient: <a href="/admin/uzytkownicy/${p.userId}" data-link><b>${esc(p.clientName)}</b></a> · opiekun: ${esc(p.manager || '—')} · budżet: ${fmtMoney0(p.budget)}</p></div>
          <div class="page-actions">
            <select class="select-sm" id="stage-select" aria-label="Zmień etap">${d.stages.map((s) => `<option value="${s.key}"${s.key === p.stage ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
            <button class="button button-light btn-sm" data-act="edit">${icon('pencil')} Edytuj</button>
            <button class="button button-dark btn-sm" data-act="software">${icon('rocket')} Uruchom jako oprogramowanie</button>
          </div>
        </div>
        <ol class="stepper">${d.stages.map((s, i) => `<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}">${esc(s.label)}</li>`).join('')}</ol>
        <div style="margin-top:16px" class="progress-row"><div class="progress"><i style="width:${p.progress}%"></i></div><b>${p.progress}%</b></div>
        ${p.description ? `<p style="margin-top:14px;font-size:13.5px">${esc(p.description)}</p>` : ''}
        ${p.modules.length ? `<div class="chips" style="margin-top:12px">${p.modules.map((m) => `<span class="chip">${icon('blocks')} ${esc(m)}</span>`).join('')}</div>` : ''}
      </section>
      <div class="grid grid-main mt">
        <div class="stack">
          <section class="card"><div class="card-head"><h2>${icon('flag')} Kamienie milowe</h2><span class="chip">${d.milestones.filter((m) => m.done).length}/${d.milestones.length} · postęp liczony automatycznie</span></div>
            <ul class="check-list-admin">${d.milestones.map((m) => `<li class="${m.done ? 'done' : ''}"><input type="checkbox" data-ms="${m.id}" ${m.done ? 'checked' : ''} aria-label="Wykonane: ${esc(m.title)}"><b>${esc(m.title)}</b><small>${fmtDate(m.dueDate)}</small><button class="icon-btn" data-ms-del="${m.id}" aria-label="Usuń">${icon('trash-2')}</button></li>`).join('') || '<li><small>Brak etapów — dodaj pierwszy poniżej.</small></li>'}</ul>
            <form class="inline-add" id="ms-form"><input name="title" placeholder="Nowy kamień milowy…" required aria-label="Tytuł"><input name="dueDate" type="date" aria-label="Termin"><button class="button button-dark btn-sm" type="submit">${icon('plus')} Dodaj</button></form>
          </section>
          <section class="card"><div class="card-head"><h2>${icon('megaphone')} Aktualizacje dla klienta</h2></div>
            <form class="card-body" id="upd-form" style="display:grid;gap:10px;border-bottom:1px solid var(--border)"><div class="field"><label for="upd-title">Tytuł</label><input id="upd-title" name="title" required placeholder="Np. Import danych zakończony"></div><div class="field"><label for="upd-body">Treść</label><textarea id="upd-body" name="body" rows="3"></textarea></div><div class="form-actions" style="margin-top:0"><button class="button button-coral btn-sm" type="submit">${icon('send')} Opublikuj w panelu klienta</button></div></form>
            ${d.updates.length ? `<ul class="feed">${d.updates.map((u) => `<li><span class="li-ic green">${icon('megaphone')}</span><div><b>${esc(u.title)}</b><p>${esc(u.body)}</p><small>${esc(u.author)} · ${fmtDateTime(u.createdAt)} · <button class="link" data-upd-del="${u.id}" style="font-size:11.5px">usuń</button></small></div></li>`).join('')}</ul>` : ''}
          </section>
        </div>
        <div class="stack">
          <section class="card"><div class="card-head"><h2>${icon('life-buoy')} Zgłoszenia</h2></div>${d.tickets.length ? `<ul class="list">${d.tickets.map((t) => `<li><a class="list-item" href="/admin/zgloszenia/${t.id}" data-link><span class="li-ic">${icon('life-buoy')}</span><div><b>${esc(t.subject)}</b><small>${esc(t.number)} · ${fmtRel(t.updatedAt)}</small></div>${bdg(TICKET_STATUS, t.status)}</a></li>`).join('')}</ul>` : emptyState('life-buoy', 'Brak zgłoszeń', '')}</section>
          <section class="card"><div class="card-head"><h2>${icon('receipt')} Faktury</h2><button class="button button-light btn-sm" data-act="invoice">${icon('plus')}</button></div>${d.invoices.length ? `<ul class="list">${d.invoices.map((i) => `<li><button class="list-item" style="width:100%;border:0;background:none;text-align:left;color:inherit;cursor:pointer" data-inv="${i.id}"><span class="li-ic">${icon('receipt')}</span><div><b class="mono">${esc(i.number)}</b><small>${fmtDate(i.issueDate)}</small></div><div class="li-right"><strong>${fmtMoney(i.gross)}</strong>${bdg(INV_STATUS, i.status)}</div></button></li>`).join('')}</ul>` : emptyState('receipt', 'Brak faktur', '')}</section>
          <section class="card"><div class="card-head"><h2>${icon('folder-open')} Dokumenty</h2><button class="button button-light btn-sm" data-act="document">${icon('upload')}</button></div>${d.documents.length ? `<ul class="list">${d.documents.map((x) => `<li class="list-item"><span class="li-ic coral">${icon('file-text')}</span><div><b>${esc(x.name)}</b><small>${esc(DOC_CAT[x.category])} · ${fmtDate(x.createdAt)}</small></div><a class="icon-btn" href="/api/admin/documents/${x.id}/download" download aria-label="Pobierz">${icon('download')}</a></li>`).join('')}</ul>` : emptyState('folder-open', 'Brak dokumentów', '')}</section>
          ${isAdmin() ? `<button class="button btn-danger btn-sm" data-act="delete">${icon('trash-2')} Usuń projekt</button>` : ''}
        </div>
      </div>`;

    $('#stage-select').addEventListener('change', async (e) => { try { await api(`/api/admin/projects/${p.id}`, { method: 'PATCH', body: { stage: e.target.value } }); toast('Etap zmieniony — klient widzi aktualizację.'); refreshMeta(); router(); } catch (ex) { fail(ex); } });
    $$('[data-ms]', view).forEach((c) => c.addEventListener('change', async () => { try { await api(`/api/admin/milestones/${c.dataset.ms}`, { method: 'PATCH', body: { done: c.checked } }); router(); } catch (ex) { fail(ex); } }));
    $$('[data-ms-del]', view).forEach((b) => b.addEventListener('click', async () => { try { await api(`/api/admin/milestones/${b.dataset.msDel}`, { method: 'DELETE' }); router(); } catch (ex) { fail(ex); } }));
    $$('[data-upd-del]', view).forEach((b) => b.addEventListener('click', async () => { if (await confirmDialog({ title: 'Usunąć aktualizację?', confirmLabel: 'Usuń', danger: true })) { await api(`/api/admin/updates/${b.dataset.updDel}`, { method: 'DELETE' }).catch(fail); router(); } }));
    $$('[data-inv]', view).forEach((b) => b.addEventListener('click', () => openInvoice(Number(b.dataset.inv))));
    $('#ms-form').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; try { await api(`/api/admin/projects/${p.id}/milestones`, { method: 'POST', body: { title: f.title.value, dueDate: f.dueDate.value } }); router(); } catch (ex) { fail(ex); } });
    $('#upd-form').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; try { await api(`/api/admin/projects/${p.id}/updates`, { method: 'POST', body: { title: f.title.value, body: f.body.value } }); toast('Opublikowano w panelu klienta.'); router(); } catch (ex) { fail(ex); } });
    onView(async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      try {
        if (b.dataset.act === 'edit') {
          const r = await openForm({
            title: 'Edytuj projekt', wide: true, values: { ...p, modules: p.modules.join(', ') },
            fields: [
              { name: 'userId', label: 'Klient', type: 'select', options: clientOptions() }, { name: 'name', label: 'Nazwa *', required: true },
              { name: 'kind', label: 'Typ' }, { name: 'priority', label: 'Priorytet', type: 'select', options: opts(PRIORITY) },
              { name: 'manager', label: 'Opiekun', type: 'select', options: [...new Set([p.manager, ...state.meta.team.map((t) => t.name)].filter(Boolean))].map((v) => ({ value: v, label: v })) },
              { name: 'progress', label: 'Postęp (%)', type: 'number', min: 0, max: 100 }, { name: 'budget', label: 'Budżet (zł)', type: 'number', min: 0 },
              { name: 'startDate', label: 'Start', type: 'date' }, { name: 'dueDate', label: 'Termin', type: 'date' },
              { name: 'modules', label: 'Moduły (po przecinku)', full: true }, { name: 'description', label: 'Opis', type: 'textarea' },
            ],
            onSubmit: (data) => api(`/api/admin/projects/${p.id}`, { method: 'PATCH', body: data }),
          });
          if (r) { toast('Zapisano.'); router(); }
        } else if (b.dataset.act === 'software') {
          if (await actions.software({ userId: p.userId, projectId: p.id, name: p.name.replace(/^System\s+/i, 'Modulio '), modules: p.modules, plan: p.kind.replace('Pakiet ', '') })) {
            if (!['uruchomiony', 'rozwoj'].includes(p.stage)) await api(`/api/admin/projects/${p.id}`, { method: 'PATCH', body: { stage: 'uruchomiony', progress: 100 } });
            router();
          }
        } else if (b.dataset.act === 'delete') {
          if (await confirmDialog({ title: 'Usunąć projekt?', text: 'Usunięte zostaną kamienie milowe i aktualizacje. Faktury i zgłoszenia zostaną odpięte.', confirmLabel: 'Usuń', danger: true })) {
            await api(`/api/admin/projects/${p.id}`, { method: 'DELETE' }); await refreshMeta(); navigate('/admin/projekty');
          }
        } else if (actions[b.dataset.act]) {
          if (await actions[b.dataset.act]({ userId: p.userId, projectId: p.id })) router();
        }
      } catch (ex) { fail(ex); }
    });
  };

  // =======================================================
  // AKTYWNE OPROGRAMOWANIE
  // =======================================================
  views.software = async () => {
    setHeader('Aktywne oprogramowanie', [['Pulpit', '/admin'], ['Oprogramowanie']]); setNav('oprogramowanie');
    const { software } = await api('/api/admin/software');
    const active = software.filter((s) => s.status === 'aktywne');
    const mrr = active.reduce((s, x) => s + x.monthlyFee, 0);
    const soon = active.filter((s) => s.renewalDate && s.renewalDate <= addDays(30)).length;
    view.innerHTML = `
      <section class="grid grid-4 view-enter">
        ${kpi('Aktywne systemy', active.length, 'app-window', 'green', `z ${software.length} wszystkich`)}
        ${kpi('MRR', fmtMoney0(mrr), 'repeat', 'coral', `ARR ${fmtMoney0(mrr * 12)}`)}
        ${kpi('Średni abonament', fmtMoney0(active.length ? mrr / active.length : 0), 'calculator', 'blue', 'na system')}
        ${kpi('Odnowienia (30 dni)', soon, 'calendar-clock', 'amber', 'do potwierdzenia')}
      </section>
      <div class="page-head mt"><p>Systemy uruchomione u klientów wraz z planem, abonamentem i terminem odnowienia. Klient widzi je na swoim pulpicie.</p><div class="page-actions">${exportBtn('oprogramowanie')}<button class="button button-dark btn-sm" data-new>${icon('plus')} Dodaj</button></div></div>
      <section class="card" id="sw-table"></section>`;
    dataTable($('#sw-table'), {
      rows: software, searchKeys: ['name', 'clientName', 'plan', 'url'],
      filters: [{ key: 'status', label: 'Status', options: opts(SOFT_STATUS) }, { key: 'plan', label: 'Plan', options: [...new Set(software.map((s) => s.plan))].map((v) => ({ value: v, label: v })) }],
      onRow: async (s) => { if (await actions.software(s, s.id).catch(fail)) router(); },
      columns: [
        { label: 'System', render: (s) => `<b>${esc(s.name)}</b><span class="t-sub">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.replace(/^https?:\/\//, ''))}</a>` : 'brak adresu'} · v${esc(s.version)}</span>`, sort: (s) => s.name },
        { label: 'Klient', cls: 'hide-sm', render: (s) => `<a href="/admin/uzytkownicy/${s.userId}" data-link>${esc(s.clientName)}</a>`, sort: (s) => s.clientName },
        { label: 'Status', render: (s) => bdg(SOFT_STATUS, s.status), sort: (s) => s.status },
        { label: 'Plan', cls: 'hide-sm', render: (s) => `${esc(s.plan)} <span class="t-sub">do ${s.usersLimit} użytk.</span>`, sort: (s) => s.plan },
        { label: 'Abonament', cls: 'num', render: (s) => `<b>${fmtMoney(s.monthlyFee)}</b>`, sort: (s) => s.monthlyFee },
        { label: 'Odnowienie', cls: 'num hide-sm', render: (s) => (s.renewalDate ? `${fmtDate(s.renewalDate)}${s.status === 'aktywne' && s.renewalDate < todayStr() ? ` ${badge('po terminie', 'coral')}` : ''}` : '—'), sort: (s) => s.renewalDate || '9999' },
      ],
    });
    $('[data-new]', view).addEventListener('click', async () => { if (await actions.software().catch(fail)) router(); });
  };

  // =======================================================
  // ZGŁOSZENIA
  // =======================================================
  let ticketFilter = 'otwarte';
  views.tickets = async () => {
    setHeader('Zgłoszenia od klientów', [['Pulpit', '/admin'], ['Zgłoszenia']]); setNav('zgloszenia');
    await loadMeta();
    const { tickets } = await api('/api/admin/tickets');
    const groups = {
      otwarte: ['Otwarte', (t) => !['rozwiazane', 'zamkniete'].includes(t.status)],
      obsluga: ['Wymaga odpowiedzi', (t) => ['nowe', 'w_toku'].includes(t.status)],
      moje: ['Przypisane do mnie', (t) => t.assignedTo === state.user.id && !['rozwiazane', 'zamkniete'].includes(t.status)],
      zamkniete: ['Zamknięte', (t) => ['rozwiazane', 'zamkniete'].includes(t.status)],
      wszystkie: ['Wszystkie', () => true],
    };
    view.innerHTML = `<div class="tabs view-enter" role="tablist">${Object.entries(groups).map(([k, [l, f]]) => `<button type="button" role="tab" data-g="${k}" class="${k === ticketFilter ? 'on' : ''}">${l} <span class="count">${tickets.filter(f).length}</span></button>`).join('')}</div><section class="card" id="t-table"></section>`;
    const render = () => dataTable($('#t-table'), {
      rows: tickets.filter(groups[ticketFilter][1]), searchKeys: ['subject', 'number', 'clientName', 'clientEmail'], pageSize: 25,
      filters: [{ key: 'priority', label: 'Priorytet', options: opts(PRIORITY) }, { key: 'category', label: 'Kategoria', options: opts(TICKET_CAT) }, { key: 'assignedTo', label: 'Opiekun', options: teamOptions() }],
      onRow: (t) => navigate(`/admin/zgloszenia/${t.id}`),
      rowClass: (t) => `prio-${t.priority}`,
      columns: [
        { label: 'Zgłoszenie', render: (t) => `<b>${esc(t.subject)}</b><span class="t-sub mono">${esc(t.number)} · ${esc(TICKET_CAT[t.category]?.[0] || t.category)}${t.lastAuthor === 'client' && ['nowe', 'w_toku'].includes(t.status) ? ' · <b style="color:var(--accent-ink)">nowa wiadomość klienta</b>' : ''}</span>`, sort: (t) => t.subject },
        { label: 'Klient', cls: 'hide-sm', render: (t) => `<a href="/admin/uzytkownicy/${t.userId}" data-link>${esc(t.clientName)}</a>`, sort: (t) => t.clientName },
        { label: 'Status', render: (t) => bdg(TICKET_STATUS, t.status), sort: (t) => t.status },
        { label: 'Priorytet', cls: 'hide-sm', render: (t) => bdg(PRIORITY, t.priority), sort: (t) => ['niski', 'normalny', 'wysoki', 'krytyczny'].indexOf(t.priority) },
        { label: 'Opiekun', cls: 'hide-sm muted', render: (t) => esc(t.assignedName || '—') },
        { label: 'Aktualizacja', cls: 'num muted', render: (t) => fmtRel(t.updatedAt), sort: (t) => t.updatedAt },
      ],
    });
    render();
    $$('[data-g]', view).forEach((b) => b.addEventListener('click', () => { ticketFilter = b.dataset.g; $$('[data-g]', view).forEach((x) => x.classList.toggle('on', x === b)); render(); }));
  };

  views.ticket = async ({ id }) => {
    setNav('zgloszenia');
    await loadMeta();
    const d = await api(`/api/admin/tickets/${id}`);
    const t = d.ticket;
    setHeader(t.number, [['Zgłoszenia', '/admin/zgloszenia'], [t.number]]);
    const TEMPLATES = [
      ['Przyjęte', 'Dziękujemy za zgłoszenie. Analizujemy sprawę i wrócimy z informacją najpóźniej w ciągu jednego dnia roboczego.'],
      ['Prośba o szczegóły', 'Czy możesz przesłać więcej szczegółów (kroki, zrzut ekranu, godzinę wystąpienia)? Pomoże nam to szybciej rozwiązać problem.'],
      ['Rozwiązane', 'Poprawka została wdrożona. Sprawdź proszę, czy wszystko działa — jeśli tak, zamkniemy zgłoszenie.'],
    ];
    view.innerHTML = `
      <div class="grid grid-main view-enter">
        <section class="card">
          <div class="card-head" style="flex-wrap:wrap;align-items:flex-start"><div><h2 style="font-size:19px">${esc(t.subject)}</h2><div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">${bdg(TICKET_STATUS, t.status)} ${bdg(PRIORITY, t.priority)} <span class="chip">${icon((TICKET_CAT[t.category] || TICKET_CAT.pytanie)[1])} ${esc(TICKET_CAT[t.category]?.[0] || t.category)}</span></div></div></div>
          <div class="thread">${d.messages.map((m) => {
            if (m.authorType === 'system') return `<div class="msg system"><div class="bubble">${esc(m.body)}</div></div>`;
            if (m.authorType === 'internal') return `<div class="msg internal"><div class="who">${icon('lock')} <b>Notatka wewnętrzna</b> · ${esc(m.authorName)} · ${fmtDateTime(m.createdAt)}</div><div class="bubble">${esc(m.body)}</div></div>`;
            const mine = m.authorType === 'team';
            return `<div class="msg ${mine ? 'client' : 'team'}"><div class="who"><b>${esc(m.authorName)}</b> · ${mine ? 'Modulio' : 'klient'} · ${fmtDateTime(m.createdAt)}</div><div class="bubble">${esc(m.body)}</div></div>`;
          }).join('')}</div>
          <form class="composer" id="reply-form">
            <div class="chips">${TEMPLATES.map(([l], i) => `<button type="button" class="chip" data-tpl="${i}" style="border:0;cursor:pointer">${icon('text-quote')} ${esc(l)}</button>`).join('')}</div>
            <label class="sr-only" for="reply">Odpowiedź</label>
            <textarea id="reply" placeholder="Odpowiedź dla klienta… (Ctrl+Enter wysyła)"></textarea>
            <div class="composer-row">
              <label class="check-row" style="margin:0"><input type="checkbox" id="internal"> Notatka wewnętrzna (niewidoczna dla klienta)</label>
              <div class="page-actions"><select class="select-sm" id="reply-status" aria-label="Status po wysłaniu">${[['oczekuje_na_klienta', 'Czeka na klienta'], ['w_toku', 'W toku'], ['rozwiazane', 'Rozwiązane'], ['zamkniete', 'Zamknięte']].map(([v, l]) => `<option value="${v}">Po wysłaniu: ${l}</option>`).join('')}</select>
              <button class="button button-dark btn-sm" type="submit">${icon('send')} Wyślij</button></div>
            </div>
          </form>
        </section>
        <aside class="stack">
          <section class="card"><div class="card-head"><h2>${icon('sliders-horizontal')} Obsługa</h2></div>
            <div class="card-body form-grid" style="grid-template-columns:1fr">
              <div class="field"><label for="t-status">Status</label><select id="t-status">${opts(TICKET_STATUS).map((o) => `<option value="${o.value}"${o.value === t.status ? ' selected' : ''}>${o.label}</option>`).join('')}</select></div>
              <div class="field"><label for="t-prio">Priorytet</label><select id="t-prio">${opts(PRIORITY).map((o) => `<option value="${o.value}"${o.value === t.priority ? ' selected' : ''}>${o.label}</option>`).join('')}</select></div>
              <div class="field"><label for="t-assign">Opiekun</label><select id="t-assign"><option value="">— nieprzypisany —</option>${state.meta.team.map((m) => `<option value="${m.id}"${m.id === t.assignedTo ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
            </div></section>
          <section class="card"><div class="card-head"><h2>${icon('user-round')} Klient</h2></div>
            <dl class="dl"><div><dt>Firma</dt><dd><a href="/admin/uzytkownicy/${t.userId}" data-link>${esc(t.clientName)}</a></dd></div><div><dt>E-mail</dt><dd><a href="mailto:${esc(t.clientEmail)}">${esc(t.clientEmail)}</a></dd></div><div><dt>Projekt</dt><dd>${t.projectId ? `<a href="/admin/projekty/${t.projectId}" data-link>${esc(t.projectName)}</a>` : '—'}</dd></div><div><dt>Utworzone</dt><dd>${fmtDateTime(t.createdAt)}</dd></div></dl></section>
          ${d.otherTickets.length ? `<section class="card"><div class="card-head"><h2>${icon('history')} Inne zgłoszenia klienta</h2></div><ul class="list">${d.otherTickets.map((o) => `<li><a class="list-item" href="/admin/zgloszenia/${o.id}" data-link><span class="li-ic">${icon('life-buoy')}</span><div><b>${esc(o.subject)}</b><small>${esc(o.number)}</small></div>${bdg(TICKET_STATUS, o.status)}</a></li>`).join('')}</ul></section>` : ''}
          ${isAdmin() ? `<button class="button btn-danger btn-sm" id="t-del">${icon('trash-2')} Usuń zgłoszenie</button>` : ''}
        </aside>
      </div>`;
    $('.thread', view).lastElementChild?.scrollIntoView({ block: 'nearest' });
    const ta = $('#reply');
    $$('[data-tpl]', view).forEach((b) => b.addEventListener('click', () => { ta.value = TEMPLATES[b.dataset.tpl][1]; if (b.dataset.tpl === '2') $('#reply-status').value = 'rozwiazane'; ta.focus(); }));
    $('#internal').addEventListener('change', (e) => { $('#reply-status').disabled = e.target.checked; ta.placeholder = e.target.checked ? 'Notatka dla zespołu…' : 'Odpowiedź dla klienta…'; });
    ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') $('#reply-form').requestSubmit(); });
    $('#reply-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (ta.value.trim().length < 2) return toast('Wpisz treść wiadomości.', 'err');
      const internal = $('#internal').checked;
      try { await api(`/api/admin/tickets/${t.id}/reply`, { method: 'POST', body: { message: ta.value, internal, status: internal ? undefined : $('#reply-status').value } }); toast(internal ? 'Notatka dodana.' : 'Odpowiedź wysłana do klienta.'); refreshMeta(); router(); } catch (ex) { fail(ex); }
    });
    const patch = async (body) => { try { await api(`/api/admin/tickets/${t.id}`, { method: 'PATCH', body }); toast('Zapisano.'); refreshMeta(); router(); } catch (ex) { fail(ex); } };
    $('#t-status').addEventListener('change', (e) => patch({ status: e.target.value }));
    $('#t-prio').addEventListener('change', (e) => patch({ priority: e.target.value }));
    $('#t-assign').addEventListener('change', (e) => patch({ assignedTo: e.target.value || null }));
    $('#t-del')?.addEventListener('click', async () => { if (await confirmDialog({ title: 'Usunąć zgłoszenie?', text: 'Cały wątek zostanie usunięty.', confirmLabel: 'Usuń', danger: true })) { await api(`/api/admin/tickets/${t.id}`, { method: 'DELETE' }).catch(fail); refreshMeta(); navigate('/admin/zgloszenia'); } });
  };

  // =======================================================
  // PŁATNOŚCI
  // =======================================================
  let payTab = 'faktury';
  views.payments = async () => {
    setHeader('Płatności', [['Pulpit', '/admin'], ['Płatności']]); setNav('platnosci');
    await loadMeta();
    const [{ invoices }, { payments }] = await Promise.all([api('/api/admin/invoices'), api('/api/admin/payments')]);
    const sum = (arr, f = (i) => i.gross) => arr.reduce((s, i) => s + f(i), 0);
    const month = todayStr().slice(0, 7);
    const pending = invoices.filter((i) => i.status === 'oczekuje');
    const overdue = invoices.filter((i) => i.status === 'po_terminie');
    view.innerHTML = `
      <section class="grid grid-4 view-enter">
        ${kpi('Wpłaty w tym miesiącu', fmtMoney0(sum(payments.filter((p) => p.paid_at.startsWith(month)), (p) => p.amount)), 'banknote', 'green', `${payments.filter((p) => p.paid_at.startsWith(month)).length} transakcji`)}
        ${kpi('Oczekujące', fmtMoney0(sum(pending)), 'clock-3', 'amber', `${pending.length} ${plural(pending.length, 'faktura', 'faktury', 'faktur')} w terminie`)}
        ${kpi('Po terminie', fmtMoney0(sum(overdue)), 'circle-alert', 'coral', `${overdue.length} do windykacji`)}
        ${kpi('Wystawione (miesiąc)', fmtMoney0(sum(invoices.filter((i) => i.issueDate.startsWith(month) && i.status !== 'anulowana'))), 'receipt', 'blue', 'brutto')}
      </section>
      <div class="page-head mt"><div class="tabs" style="margin:0;border:0" role="tablist"><button type="button" data-t="faktury" class="${payTab === 'faktury' ? 'on' : ''}">Faktury <span class="count">${invoices.length}</span></button><button type="button" data-t="wplaty" class="${payTab === 'wplaty' ? 'on' : ''}">Wpłaty <span class="count">${payments.length}</span></button></div>
        <div class="page-actions">${exportBtn(payTab === 'faktury' ? 'faktury' : 'wplaty')}<button class="button button-light btn-sm" data-act="payment">${icon('banknote')} Wpłata</button><button class="button button-dark btn-sm" data-act="invoice">${icon('plus')} Faktura</button></div></div>
      <section class="card" id="pay-table"></section>
      <p class="contact-only" style="margin-top:14px">${icon('info')} Strona nie pobiera płatności online — wpłaty (przelew, BLIK, gotówka) rejestrujesz tutaj, a status faktury u klienta aktualizuje się automatycznie.</p>`;
    if (payTab === 'faktury') {
      dataTable($('#pay-table'), {
        rows: invoices, searchKeys: ['number', 'clientName', 'projectName'], pageSize: 25,
        filters: [{ key: 'status', label: 'Status', options: opts(INV_STATUS) }, { key: 'userId', label: 'Klient', options: clientOptions() }],
        onRow: (i) => openInvoice(i.id),
        columns: [
          { label: 'Numer', render: (i) => `<b class="mono">${esc(i.number)}</b><span class="t-sub">${esc(i.projectName || '—')}</span>`, sort: (i) => i.number },
          { label: 'Klient', cls: 'hide-sm', render: (i) => `<a href="/admin/uzytkownicy/${i.userId}" data-link>${esc(i.clientName)}</a>`, sort: (i) => i.clientName },
          { label: 'Status', render: (i) => bdg(INV_STATUS, i.status) + (i.paidAmount > 0 && i.paidAmount < i.gross - 0.01 ? ` ${badge('częściowo', 'info')}` : ''), sort: (i) => i.status },
          { label: 'Wystawiona', cls: 'hide-sm muted', render: (i) => fmtDate(i.issueDate), sort: (i) => i.issueDate },
          { label: 'Termin', cls: 'hide-sm muted', render: (i) => fmtDate(i.dueDate), sort: (i) => i.dueDate },
          { label: 'Brutto', cls: 'num', render: (i) => `<b>${fmtMoney(i.gross)}</b>${i.discountPct ? `<span class="t-sub">rabat ${i.discountPct}%</span>` : ''}`, sort: (i) => i.gross },
        ],
      });
    } else {
      dataTable($('#pay-table'), {
        rows: payments, searchKeys: ['number', 'client_name', 'note'], pageSize: 25,
        filters: [{ key: 'method', label: 'Metoda', options: opts(PAY_METHOD) }],
        columns: [
          { label: 'Data', render: (p) => `<b>${fmtDate(p.paid_at)}</b>`, sort: (p) => p.paid_at },
          { label: 'Klient', render: (p) => `<a href="/admin/uzytkownicy/${p.user_id}" data-link>${esc(p.client_name)}</a>`, sort: (p) => p.client_name },
          { label: 'Faktura', cls: 'hide-sm mono', render: (p) => esc(p.number || '—') },
          { label: 'Metoda', cls: 'hide-sm', render: (p) => badge(PAY_METHOD[p.method] || p.method, 'plain') },
          { label: 'Kwota', cls: 'num', render: (p) => `<b>${fmtMoney(p.amount)}</b>`, sort: (p) => p.amount },
          { label: '', cls: 'num', render: (p) => (isAdmin() ? `<button class="icon-btn" data-del-pay="${p.id}" aria-label="Usuń wpłatę">${icon('trash-2')}</button>` : '') },
        ],
      });
      $('#pay-table').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-del-pay]');
        if (b && await confirmDialog({ title: 'Usunąć wpłatę?', text: 'Status powiązanej faktury zostanie przeliczony.', confirmLabel: 'Usuń', danger: true })) {
          try { await api(`/api/admin/payments/${b.dataset.delPay}`, { method: 'DELETE' }); toast('Wpłata usunięta.'); router(); } catch (ex) { fail(ex); }
        }
      });
    }
    $$('[data-t]', view).forEach((b) => b.addEventListener('click', () => { payTab = b.dataset.t; router(); }));
    $$('[data-act]', view).forEach((b) => b.addEventListener('click', async () => { if (await actions[b.dataset.act]().catch(fail)) router(); }));
    const inv = new URLSearchParams(location.search).get('invoice');
    if (inv) openInvoice(Number(inv));
  };

  async function openInvoice(id) {
    try {
      const { invoice: inv, seller, buyer, payments } = await api(`/api/admin/invoices/${id}`);
      const left = Math.max(0, inv.gross - (inv.paidAmount || 0));
      const dlg = dialog(`
        <div class="dialog-head"><h2>Faktura ${esc(inv.number)}</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon('x')}</button></div>
        <div class="dialog-body">
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${bdg(INV_STATUS, inv.status)} ${inv.discountCode ? badge(`kod ${inv.discountCode} −${inv.discountPct}%`, 'info') : ''} <span class="chip">wystawiona ${fmtDate(inv.issueDate)}</span> <span class="chip">termin ${fmtDate(inv.dueDate)}</span></div>
          <div class="grid grid-2" style="gap:12px"><div class="card card-pad"><small class="dt-count">Sprzedawca</small><p style="font-size:13px;margin-top:4px"><b>${esc(seller.legalName)}</b><br>NIP ${esc(seller.nip)}</p></div><div class="card card-pad"><small class="dt-count">Nabywca</small><p style="font-size:13px;margin-top:4px"><b>${esc(buyer.name)}</b><br>${esc(buyer.email)}${buyer.nip ? `<br>NIP ${esc(buyer.nip)}` : ''}</p></div></div>
          <div class="table-wrap mt"><table class="table"><thead><tr><th>Pozycja</th><th class="num">Ilość</th><th class="num">Netto</th><th class="num">VAT</th></tr></thead><tbody>${inv.items.map((it) => `<tr><td>${esc(it.name)}</td><td class="num">${it.qty}</td><td class="num">${fmtMoney(it.qty * it.unit_net)}</td><td class="num">${it.vat}%</td></tr>`).join('')}</tbody></table></div>
          <div class="items-total" style="font-size:14px"><span>Netto <b>${fmtMoney(inv.net)}</b></span><span>VAT <b>${fmtMoney(inv.vat)}</b></span><span>Brutto <b>${fmtMoney(inv.gross)}</b></span></div>
          <h3 style="font-size:14px;margin-top:18px">Wpłaty</h3>
          ${payments.length ? `<ul class="list">${payments.map((p) => `<li class="list-item" style="padding:10px 0"><span class="li-ic green">${icon('banknote')}</span><div><b>${fmtMoney(p.amount)}</b><small>${fmtDate(p.paid_at)} · ${esc(PAY_METHOD[p.method] || p.method)}</small></div></li>`).join('')}</ul>` : '<p class="dt-count" style="margin-top:6px">Brak wpłat.</p>'}
          <div class="form-actions">
            ${inv.status !== 'anulowana' ? `<button class="button btn-danger btn-sm" data-i="cancel" style="margin-right:auto">${icon('ban')} Anuluj fakturę</button>` : ''}
            ${isAdmin() ? `<button class="button btn-danger btn-sm" data-i="delete">${icon('trash-2')} Usuń</button>` : ''}
            <a class="button button-light btn-sm" href="/admin/uzytkownicy/${inv.userId}" data-link data-close>${icon('user-round')} Klient</a>
            ${['oczekuje', 'po_terminie'].includes(inv.status) ? `<button class="button button-coral btn-sm" data-i="pay">${icon('banknote')} Zarejestruj wpłatę (${fmtMoney(left)})</button>` : ''}
          </div>
        </div>`, { wide: true, label: `Faktura ${inv.number}` });
      $$('[data-i]', dlg).forEach((b) => b.addEventListener('click', async () => {
        try {
          if (b.dataset.i === 'pay') { dlg.close(); if (await actions.payment({ invoiceId: inv.id })) router(); }
          if (b.dataset.i === 'cancel' && await confirmDialog({ title: 'Anulować fakturę?', text: 'Faktura zniknie z panelu klienta i nie będzie liczona do należności.', confirmLabel: 'Anuluj fakturę', danger: true })) { await api(`/api/admin/invoices/${inv.id}`, { method: 'PATCH', body: { status: 'anulowana' } }); dlg.close(); toast('Faktura anulowana.'); refreshMeta(); router(); }
          if (b.dataset.i === 'delete' && await confirmDialog({ title: 'Usunąć fakturę?', text: 'Wpłaty zostaną odpięte od faktury.', confirmLabel: 'Usuń', danger: true })) { await api(`/api/admin/invoices/${inv.id}`, { method: 'DELETE' }); dlg.close(); toast('Faktura usunięta.'); refreshMeta(); router(); }
        } catch (ex) { fail(ex); }
      }));
    } catch (ex) { fail(ex); }
  }

  // =======================================================
  // DOKUMENTY
  // =======================================================
  views.documents = async () => {
    setHeader('Dokumenty', [['Pulpit', '/admin'], ['Dokumenty']]); setNav('dokumenty');
    await loadMeta();
    const { documents } = await api('/api/admin/documents');
    view.innerHTML = `${pageHead('Umowy, specyfikacje, protokoły i instrukcje udostępnione klientom. Każdy dokument jest widoczny wyłącznie dla przypisanego klienta.', `<button class="button button-dark btn-sm" data-new>${icon('upload')} Dodaj dokument</button>`)}<section class="card" id="doc-table"></section>`;
    dataTable($('#doc-table'), {
      rows: documents, searchKeys: ['name', 'filename', 'clientName', 'projectName'],
      filters: [{ key: 'category', label: 'Kategoria', options: opts(DOC_CAT) }, { key: 'userId', label: 'Klient', options: clientOptions() }],
      columns: [
        { label: 'Dokument', render: (x) => `<b>${esc(x.name)}</b><span class="t-sub">${esc(x.filename)} · ${(x.size / 1024).toFixed(0)} KB</span>`, sort: (x) => x.name },
        { label: 'Klient', cls: 'hide-sm', render: (x) => `<a href="/admin/uzytkownicy/${x.userId}" data-link>${esc(x.clientName)}</a>`, sort: (x) => x.clientName },
        { label: 'Kategoria', cls: 'hide-sm', render: (x) => badge(DOC_CAT[x.category] || x.category, 'plain') },
        { label: 'Dodano', cls: 'num muted hide-sm', render: (x) => fmtDate(x.createdAt), sort: (x) => x.createdAt },
        { label: '', cls: 'num', render: (x) => `<div class="row-actions"><a class="icon-btn" href="/api/admin/documents/${x.id}/download" download aria-label="Pobierz">${icon('download')}</a><button class="icon-btn" data-del-doc="${x.id}" aria-label="Usuń">${icon('trash-2')}</button></div>` },
      ],
    });
    $('#doc-table').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-del-doc]');
      if (b && await confirmDialog({ title: 'Usunąć dokument?', text: 'Plik zostanie trwale usunięty z serwera.', confirmLabel: 'Usuń', danger: true })) {
        try { await api(`/api/admin/documents/${b.dataset.delDoc}`, { method: 'DELETE' }); toast('Usunięto.'); router(); } catch (ex) { fail(ex); }
      }
    });
    $('[data-new]', view).addEventListener('click', async () => { if (await actions.document().catch(fail)) router(); });
  };

  // =======================================================
  // MARKETING
  // =======================================================
  let mkTab = 'ogloszenia';
  views.marketing = async () => {
    setHeader('Marketing', [['Pulpit', '/admin'], ['Marketing']]); setNav('marketing');
    const d = await api('/api/admin/marketing');
    const activeNl = d.newsletter.filter((n) => !n.unsubscribed_at);
    const tabs = [['ogloszenia', 'Ogłoszenia w panelu', d.announcements.length], ['kody', 'Kody rabatowe', d.codes.length], ['newsletter', 'Newsletter', activeNl.length], ['zrodla', 'Źródła pozyskania', d.sources.length], ['komunikat', 'Komunikat do klientów', '']];
    view.innerHTML = `
      <section class="grid grid-4 view-enter">
        ${kpi('Subskrybenci newslettera', activeNl.length, 'mail', 'blue', `+${activeNl.filter((n) => n.created_at >= addDays(-30)).length} w 30 dni`)}
        ${kpi('Aktywne kody', d.codes.filter((c) => c.active).length, 'ticket-percent', 'coral', `${d.codes.reduce((s, c) => s + c.used, 0)} użyć łącznie`)}
        ${kpi('Aktywne ogłoszenia', d.announcements.filter((a) => a.active).length, 'megaphone', 'amber', 'widoczne w panelu klienta')}
        ${kpi('Najlepsze źródło', esc(d.sources[0]?.source || '—'), 'radar', 'green', d.sources[0] ? `${d.sources[0].leads} leadów` : '')}
      </section>
      <div class="tabs mt" role="tablist">${tabs.map(([k, l, c]) => `<button type="button" role="tab" data-mk="${k}" class="${k === mkTab ? 'on' : ''}">${l}${c !== '' ? ` <span class="count">${c}</span>` : ''}</button>`).join('')}</div>
      <div id="mk-body"></div>`;
    let body = $('#mk-body');
    const annForm = (a) => openForm({
      title: a ? 'Edytuj ogłoszenie' : 'Nowe ogłoszenie', values: a ? { ...a, startsAt: a.starts_at, endsAt: a.ends_at, active: !!a.active } : { tone: 'info', active: true },
      intro: 'Ogłoszenie pojawi się na pulpicie panelu klienta (klient może je ukryć).',
      fields: [{ name: 'title', label: 'Tytuł *', required: true, full: true }, { name: 'body', label: 'Treść', type: 'textarea', rows: 3 },
        { name: 'tone', label: 'Typ', type: 'select', options: [{ value: 'info', label: 'Informacja' }, { value: 'success', label: 'Nowość / sukces' }, { value: 'warning', label: 'Ostrzeżenie' }] },
        { name: 'startsAt', label: 'Od (opcjonalnie)', type: 'date' }, { name: 'endsAt', label: 'Do (opcjonalnie)', type: 'date' }, { name: 'active', label: 'Aktywne', type: 'checkbox' }],
      danger: a ? { label: 'Usuń', onClick: () => api(`/api/admin/announcements/${a.id}`, { method: 'DELETE' }) } : undefined,
      onSubmit: (x) => api(a ? `/api/admin/announcements/${a.id}` : '/api/admin/announcements', { method: a ? 'PATCH' : 'POST', body: x }),
    });
    const codeForm = () => openForm({
      title: 'Nowy kod rabatowy', values: { active: true },
      intro: 'Kod stosujesz przy wystawianiu faktury — rabat procentowy nalicza się od wszystkich pozycji.',
      fields: [{ name: 'code', label: 'Kod *', required: true, placeholder: 'np. WIOSNA15' }, { name: 'percent', label: 'Rabat (%) *', type: 'number', min: 1, max: 100, required: true },
        { name: 'maxUses', label: 'Limit użyć (0 = bez limitu)', type: 'number', min: 0 }, { name: 'expiresAt', label: 'Ważny do', type: 'date' },
        { name: 'description', label: 'Opis / kampania', full: true }, { name: 'active', label: 'Aktywny', type: 'checkbox' }],
      onSubmit: (x) => api('/api/admin/codes', { method: 'POST', body: x }),
    });
    const render = () => {
      const fresh = body.cloneNode(false); body.replaceWith(fresh); body = fresh;
      $$('[data-mk]', view).forEach((b) => b.classList.toggle('on', b.dataset.mk === mkTab));
      if (mkTab === 'ogloszenia') {
        body.innerHTML = `<div class="page-head"><p>Komunikaty o nowościach, przerwach technicznych i promocjach dla zalogowanych klientów.</p><button class="button button-dark btn-sm" data-add>${icon('plus')} Nowe ogłoszenie</button></div>
          <section class="card">${d.announcements.length ? `<ul class="list">${d.announcements.map((a) => `<li class="list-item"><span class="li-ic ${a.tone === 'warning' ? 'coral' : a.tone === 'success' ? 'green' : 'blue'}">${icon('megaphone')}</span><div><b>${esc(a.title)}</b><small>${esc(a.body.slice(0, 120))}${a.starts_at || a.ends_at ? ` · ${fmtDate(a.starts_at)} – ${fmtDate(a.ends_at)}` : ''}</small></div><div class="row-actions"><label class="switch" title="Aktywne"><input type="checkbox" data-ann-toggle="${a.id}" ${a.active ? 'checked' : ''} aria-label="Aktywne"><span></span></label><button class="icon-btn" data-ann-edit="${a.id}" aria-label="Edytuj">${icon('pencil')}</button></div></li>`).join('')}</ul>` : emptyState('megaphone', 'Brak ogłoszeń', 'Dodaj pierwsze ogłoszenie dla klientów.')}</section>`;
        $('[data-add]', body).addEventListener('click', async () => { if (await annForm().catch(fail)) router(); });
        $$('[data-ann-edit]', body).forEach((b) => b.addEventListener('click', async () => { if (await annForm(d.announcements.find((a) => a.id === Number(b.dataset.annEdit))).catch(fail)) router(); }));
        $$('[data-ann-toggle]', body).forEach((c) => c.addEventListener('change', async () => { try { await api(`/api/admin/announcements/${c.dataset.annToggle}`, { method: 'PATCH', body: { active: c.checked } }); toast(c.checked ? 'Ogłoszenie włączone.' : 'Ogłoszenie wyłączone.'); } catch (ex) { fail(ex); } }));
      } else if (mkTab === 'kody') {
        body.innerHTML = `<div class="page-head"><p>Kody rabatowe do kampanii, poleceń i ofert specjalnych.</p><button class="button button-dark btn-sm" data-add>${icon('plus')} Nowy kod</button></div><section class="card" id="codes"></section>`;
        dataTable($('#codes', body), {
          rows: d.codes, searchKeys: ['code', 'description'],
          columns: [
            { label: 'Kod', render: (c) => `<b class="mono">${esc(c.code)}</b><span class="t-sub">${esc(c.description)}</span>`, sort: (c) => c.code },
            { label: 'Rabat', cls: 'num', render: (c) => `<b>${nf.format(c.percent)}%</b>`, sort: (c) => c.percent },
            { label: 'Użycia', cls: 'num', render: (c) => `${c.used}${c.max_uses ? ` / ${c.max_uses}` : ''}`, sort: (c) => c.used },
            { label: 'Ważny do', cls: 'num hide-sm muted', render: (c) => fmtDate(c.expires_at) },
            { label: 'Aktywny', cls: 'num', render: (c) => `<div class="row-actions"><label class="switch"><input type="checkbox" data-code-toggle="${c.id}" ${c.active ? 'checked' : ''} aria-label="Aktywny"><span></span></label><button class="icon-btn" data-code-del="${c.id}" aria-label="Usuń">${icon('trash-2')}</button></div>` },
          ],
        });
        $('[data-add]', body).addEventListener('click', async () => { if (await codeForm().catch(fail)) router(); });
        body.addEventListener('change', async (e) => { const c = e.target.closest('[data-code-toggle]'); if (c) { try { await api(`/api/admin/codes/${c.dataset.codeToggle}`, { method: 'PATCH', body: { active: c.checked } }); toast('Zapisano.'); } catch (ex) { fail(ex); } } });
        body.addEventListener('click', async (e) => { const b = e.target.closest('[data-code-del]'); if (b && await confirmDialog({ title: 'Usunąć kod?', confirmLabel: 'Usuń', danger: true })) { await api(`/api/admin/codes/${b.dataset.codeDel}`, { method: 'DELETE' }).catch(fail); router(); } });
      } else if (mkTab === 'newsletter') {
        body.innerHTML = `<div class="page-head"><p>Adresy zapisane przez formularz w stopce strony. Eksport CSV zaimportujesz do MailerLite, Mailchimp lub innego narzędzia.</p>${exportBtn('newsletter', 'Eksport CSV')}</div><section class="card" id="nl"></section>`;
        dataTable($('#nl', body), {
          rows: d.newsletter, searchKeys: ['email', 'source'],
          columns: [
            { label: 'E-mail', render: (n) => `<b>${esc(n.email)}</b>`, sort: (n) => n.email },
            { label: 'Źródło', cls: 'hide-sm', render: (n) => badge(n.source, 'plain') },
            { label: 'Status', render: (n) => (n.unsubscribed_at ? badge('Wypisany', '') : badge('Aktywny', 'ok')) },
            { label: 'Zapisano', cls: 'num muted', render: (n) => fmtDate(n.created_at), sort: (n) => n.created_at },
            { label: '', cls: 'num', render: (n) => `<button class="icon-btn" data-nl-del="${n.id}" aria-label="Usuń">${icon('trash-2')}</button>` },
          ],
        });
        body.addEventListener('click', async (e) => { const b = e.target.closest('[data-nl-del]'); if (b && await confirmDialog({ title: 'Usunąć adres z listy?', confirmLabel: 'Usuń', danger: true })) { await api(`/api/admin/newsletter/${b.dataset.nlDel}`, { method: 'DELETE' }).catch(fail); router(); } });
      } else if (mkTab === 'zrodla') {
        body.innerHTML = `<div class="grid grid-2"><section class="card"><div class="card-head"><h2>${icon('radar')} Leady wg źródła</h2></div>${hbars(d.sources.map((s) => ({ label: s.source, value: s.leads })))}</section>
          <section class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Źródło</th><th class="num">Leady</th><th class="num">Wygrane</th><th class="num">Konwersja</th><th class="num">Wartość</th></tr></thead><tbody>${d.sources.map((s) => `<tr><td class="strong">${esc(s.source)}</td><td class="num">${s.leads}</td><td class="num">${s.won}</td><td class="num">${s.leads ? Math.round((s.won / s.leads) * 100) : 0}%</td><td class="num">${fmtMoney0(s.value)}</td></tr>`).join('')}</tbody></table></div></section></div>
          <p class="contact-only" style="margin-top:14px">${icon('info')} Dodawaj <code>?utm_source=nazwa</code> do linków w kampaniach — źródło zapisze się przy zapytaniu z formularza.</p>`;
      } else {
        body.innerHTML = `<section class="card"><form class="card-body" id="bc-form"><p style="margin-bottom:14px">Wiadomość trafi do każdego aktywnego klienta jako nowe zgłoszenie w jego panelu (może na nie odpowiedzieć). Dla krótkich informacji lepiej użyć ogłoszenia.</p>
          <div class="form-grid"><div class="field full"><label for="bc-title">Temat *</label><input id="bc-title" name="title" required></div><div class="field full"><label for="bc-msg">Treść *</label><textarea id="bc-msg" name="message" rows="6" required></textarea></div></div>
          <div class="form-actions"><button class="button button-coral btn-sm" type="submit" ${isAdmin() ? '' : 'disabled title="Wymaga roli administratora"'}>${icon('send')} Wyślij do wszystkich klientów</button></div></form></section>`;
        $('#bc-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = e.target;
          if (!(await confirmDialog({ title: 'Wysłać komunikat?', text: 'Wiadomość otrzymają wszyscy aktywni klienci.', confirmLabel: 'Wyślij' }))) return;
          try { const r = await api('/api/admin/broadcast', { method: 'POST', body: { title: f.title.value, message: f.message.value } }); toast(`Wysłano do ${r.sent} klientów.`); f.reset(); } catch (ex) { fail(ex); }
        });
      }
    };
    $$('[data-mk]', view).forEach((b) => b.addEventListener('click', () => { mkTab = b.dataset.mk; render(); }));
    render();
  };

  // =======================================================
  // DZIENNIK ZDARZEŃ
  // =======================================================
  views.audit = async () => {
    setHeader('Dziennik zdarzeń', [['Pulpit', '/admin'], ['Dziennik']]); setNav('dziennik');
    const { entries } = await api('/api/admin/audit');
    view.innerHTML = `${pageHead('Ostatnie 500 zdarzeń: logowania, zmiany danych, płatności, eksporty i działania zespołu. Dziennik pomaga w bezpieczeństwie i rozliczalności (RODO).')}<section class="card" id="audit"></section>`;
    dataTable($('#audit'), {
      rows: entries, searchKeys: ['action', 'user_name', 'details', 'ip', (a) => auditLabel(a.action)], pageSize: 30,
      filters: [{ key: 'entity', label: 'Obiekt', options: [...new Set(entries.map((e) => e.entity).filter(Boolean))].map((v) => ({ value: v, label: v })) }],
      columns: [
        { label: 'Zdarzenie', render: (a) => `<div class="cell-user"><span class="li-ic">${icon(auditIcon(a.action))}</span><div><b>${esc(auditLabel(a.action))}</b><small><span class="audit-action">${esc(a.action)}</span></small></div></div>`, sort: (a) => a.action },
        { label: 'Kto', render: (a) => esc(a.user_name), sort: (a) => a.user_name },
        { label: 'Szczegóły', cls: 'hide-sm muted', render: (a) => `${esc(a.details)}${a.entity_id ? ` <span class="t-sub">${esc(a.entity)} #${a.entity_id}</span>` : ''}` },
        { label: 'IP', cls: 'hide-sm mono muted', render: (a) => esc(a.ip || '—') },
        { label: 'Kiedy', cls: 'num muted', render: (a) => `<span title="${esc(a.created_at)}">${fmtDateTime(a.created_at)}</span>`, sort: (a) => a.created_at },
      ],
    });
  };

  // =======================================================
  // USTAWIENIA
  // =======================================================
  views.settings = async () => {
    setHeader('Ustawienia', [['Pulpit', '/admin'], ['Ustawienia']]); setNav('ustawienia');
    const admin = isAdmin();
    const s = admin ? (await api('/api/admin/settings')).settings : null;
    const field = (k, l, type = 'text', help = '') => `<div class="field"><label for="s-${k}">${esc(l)}</label><input id="s-${k}" name="${k}" type="${type}" value="${esc(s[k])}">${help ? `<span class="field-help">${esc(help)}</span>` : ''}</div>`;
    view.innerHTML = `
      <div class="grid grid-main view-enter">
        <div class="stack">
          ${admin ? `
          <section class="card"><div class="card-head"><h2>${icon('building-2')} Dane firmy</h2></div>
            <form class="card-body" id="company-form"><div class="form-grid">
              ${field('company_legal_name', 'Pełna nazwa firmy')}${field('company_nip', 'NIP')}
              <div class="field full"><label for="s-company_address">Adres</label><input id="s-company_address" name="company_address" value="${esc(s.company_address)}"></div>
              ${field('contact_email', 'E-mail kontaktowy', 'email')}${field('contact_phone', 'Telefon')}
              <div class="field full"><label for="s-company_bank">Numer konta (na fakturach)</label><input id="s-company_bank" name="company_bank" value="${esc(s.company_bank)}"></div>
              ${field('invoice_due_days', 'Domyślny termin płatności (dni)', 'number')}
              ${field('lead_webhook_url', 'Webhook dla nowych leadów', 'url', 'Slack, Discord, Make, n8n — powiadomienie o każdym zapytaniu')}
            </div><div class="form-actions"><button class="button button-dark btn-sm" type="submit">${icon('save')} Zapisz dane firmy</button></div></form></section>
          <section class="card"><div class="card-head"><h2>${icon('toggle-right')} Platforma</h2></div>
            <div class="card-body">
              <div class="toggle"><div><b>Rejestracja klientów</b><small>Pozwala zakładać konta samodzielnie na stronie /rejestracja</small></div><label class="switch"><input type="checkbox" data-flag="allow_registration" ${s.allow_registration === '1' ? 'checked' : ''} aria-label="Rejestracja"><span></span></label></div>
              <div class="toggle"><div><b>Tryb serwisowy</b><small>Strona i panel klienta pokazują komunikat o pracach. Panel admina działa normalnie.</small></div><label class="switch"><input type="checkbox" data-flag="maintenance_mode" ${s.maintenance_mode === '1' ? 'checked' : ''} aria-label="Tryb serwisowy"><span></span></label></div>
              <form id="mm-form" class="inline-add" style="padding:14px 0 0"><input name="maintenance_message" value="${esc(s.maintenance_message)}" aria-label="Komunikat trybu serwisowego"><button class="button button-light btn-sm" type="submit">${icon('save')} Zapisz komunikat</button></form>
            </div></section>` : `<section class="card card-pad"><p>Ustawienia firmy i platformy może zmieniać tylko administrator.</p></section>`}
          <section class="card"><div class="card-head"><h2>${icon('key-round')} Moje hasło</h2></div>
            <form class="card-body" id="pw-form"><div class="form-grid">
              <div class="field full"><label for="pw-c">Obecne hasło</label><input id="pw-c" name="current" type="password" autocomplete="current-password"></div>
              <div class="field"><label for="pw-n">Nowe hasło</label><input id="pw-n" name="next" type="password" autocomplete="new-password"></div>
              <div class="field"><label for="pw-r">Powtórz nowe hasło</label><input id="pw-r" name="repeat" type="password" autocomplete="new-password"></div>
            </div><div class="form-actions"><button class="button button-dark btn-sm" type="submit">${icon('shield-check')} Zmień hasło</button></div></form></section>
        </div>
        <div class="stack">
          <section class="card"><div class="card-head"><h2>${icon('file-down')} Eksport danych (CSV)</h2></div>
            <div class="card-body" style="display:grid;gap:8px">${[['uzytkownicy', 'Użytkownicy'], ['leady', 'Leady'], ['faktury', 'Faktury'], ['wplaty', 'Wpłaty'], ['oprogramowanie', 'Aktywne oprogramowanie'], ['newsletter', 'Newsletter']].map(([k, l]) => `<a class="button button-light btn-sm" href="/api/admin/export/${k}" download style="justify-content:flex-start">${icon('file-spreadsheet')} ${l}</a>`).join('')}</div></section>
          <section class="card"><div class="card-head"><h2>${icon('users')} Zespół</h2><a href="/admin/uzytkownicy" data-link>Zarządzaj ${icon('arrow-right')}</a></div>
            <ul class="list">${(await loadMeta()).team.map((t) => `<li class="list-item"><span class="avatar" style="width:34px;height:34px;border-radius:10px;font-size:12px">${esc(initials(t.name))}</span><div><b>${esc(t.name)}</b></div></li>`).join('')}</ul></section>
          <section class="card card-pad"><b style="font-size:14px">Kopie zapasowe</b><p style="font-size:12.5px;margin-top:6px">Wszystkie dane i pliki klientów są w bazie MongoDB. Kopie włączysz w Railway → MongoDB → <b>Backups</b> albo wykonasz <code>mongodump</code> z publicznego adresu bazy.</p></section>
        </div>
      </div>`;
    const save = async (patch, msg = 'Zapisano ustawienia.') => { try { await api('/api/admin/settings', { method: 'PUT', body: patch }); toast(msg); } catch (ex) { fail(ex); } };
    $('#company-form')?.addEventListener('submit', (e) => { e.preventDefault(); save(Object.fromEntries(new FormData(e.target))); });
    $('#mm-form')?.addEventListener('submit', (e) => { e.preventDefault(); save(Object.fromEntries(new FormData(e.target)), 'Komunikat zapisany.'); });
    $$('[data-flag]', view).forEach((c) => c.addEventListener('change', () => save({ [c.dataset.flag]: c.checked ? '1' : '0' }, c.dataset.flag === 'maintenance_mode' ? (c.checked ? 'Tryb serwisowy WŁĄCZONY.' : 'Tryb serwisowy wyłączony.') : 'Zapisano.')));
    $('#pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.next.value !== f.repeat.value) return toast('Nowe hasła nie są identyczne.', 'err');
      try { await api('/api/account/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } }); f.reset(); toast('Hasło zmienione.'); } catch (ex) { fail(ex); }
    });
  };

  // =======================================================
  // ROUTER I START
  // =======================================================
  const routes = [
    [/^\/admin\/?$/, 'dashboard'], [/^\/admin\/statystyki$/, 'stats'],
    [/^\/admin\/uzytkownicy$/, 'users'], [/^\/admin\/uzytkownicy\/(?<id>\d+)$/, 'user'],
    [/^\/admin\/leady$/, 'leads'], [/^\/admin\/projekty$/, 'projects'], [/^\/admin\/projekty\/(?<id>\d+)$/, 'project'],
    [/^\/admin\/oprogramowanie$/, 'software'], [/^\/admin\/zgloszenia$/, 'tickets'], [/^\/admin\/zgloszenia\/(?<id>\d+)$/, 'ticket'],
    [/^\/admin\/platnosci$/, 'payments'], [/^\/admin\/dokumenty$/, 'documents'], [/^\/admin\/marketing$/, 'marketing'],
    [/^\/admin\/dziennik$/, 'audit'], [/^\/admin\/ustawienia$/, 'settings'],
  ];
  let renderId = 0;
  async function router() {
    const my = ++renderId;
    state.ac?.abort();
    state.ac = new AbortController();
    hideTip();
    closeSidebar();
    const match = routes.map(([re, name]) => { const m = location.pathname.match(re); return m && { name, params: m.groups || {} }; }).find(Boolean);
    if (!match) {
      setHeader('Nie znaleziono'); setNav('');
      view.innerHTML = emptyState('map-pin-off', 'Nie ma takiej strony', 'Sprawdź adres.', `<a class="button button-dark btn-sm" href="/admin" data-link>${icon('layout-dashboard')} Pulpit</a>`);
      return;
    }
    if (!view.innerHTML.trim()) view.innerHTML = skeleton();
    view.classList.add('loading');
    try { await views[match.name](match.params); }
    catch (err) { if (err.message !== '401' && my === renderId) view.innerHTML = `<section class="card">${emptyState('cloud-off', 'Nie udało się wczytać danych', err.message, `<button class="button button-light btn-sm" data-reload>${icon('rotate-ccw')} Spróbuj ponownie</button>`)}</section>`; }
    finally { if (my === renderId) view.classList.remove('loading'); }
  }
  function navigate(url) {
    if (url === location.pathname + location.search) { router(); return; }
    history.pushState(null, '', url);
    view.innerHTML = skeleton();
    scrollTo({ top: 0 });
    router().then(() => view.focus({ preventScroll: true }));
  }
  addEventListener('popstate', router);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-logout]')) { e.preventDefault(); logout(); return; }
    if (e.target.closest('[data-reload]')) { router(); return; }
    const a = e.target.closest('a[data-link]');
    if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); $$('dialog[open]').forEach((d) => d.close()); navigate(a.getAttribute('href')); }
  });
  async function logout() { try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* */ } location.assign('/admin/logowanie'); }

  const sidebar = $('#sidebar'), backdrop = $('#sidebar-backdrop'), menuBtn = $('#menu-btn');
  function closeSidebar() { sidebar.classList.remove('open'); backdrop.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', () => { const o = !sidebar.classList.contains('open'); sidebar.classList.toggle('open', o); backdrop.classList.toggle('open', o); menuBtn.setAttribute('aria-expanded', String(o)); });
  backdrop.addEventListener('click', closeSidebar);
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('modulio-theme', t); } catch { /* */ }
    $('#theme-btn').innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
  }
  $('#theme-btn').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
  setTheme(document.documentElement.getAttribute('data-theme') || 'light');
  addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', scrollY > 4), { passive: true });

  (async () => {
    view.innerHTML = skeleton();
    try {
      const { user } = await api('/api/auth/me');
      if (!user || !['admin', 'staff'].includes(user.role)) { location.assign('/admin/logowanie'); return; }
      state.user = user;
      $('[data-user-initials]').textContent = initials(user.name);
      $('[data-user-name]').textContent = user.name;
      $('[data-user-role]').textContent = ROLE[user.role][0];
      state.ac = new AbortController();
      await loadMeta();
      await router();
      setInterval(() => { if (!document.hidden) refreshMeta(); }, 60000);
    } catch (err) { fail(err); }
  })();
})();
