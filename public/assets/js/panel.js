/* =========================================================
   Modulio — panel klienta (SPA, bez zależności)
   ========================================================= */
(() => {
  'use strict';
  document.documentElement.classList.remove('no-js');

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const V = (document.currentScript?.src.match(/[?&]v=([^&]+)/) || [])[1] || '';
  const icon = (n, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="/assets/icons.svg?v=${V}#${n}"></use></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const view = $('#view');

  // ---------- Formatowanie ----------
  const money = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
  const fmtMoney = (v) => money.format(v || 0);
  const fmtDate = (s) => (s ? new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(s.length === 10 ? `${s}T12:00:00` : s)) : '—');
  const fmtDateTime = (s) => (s ? new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(s)) : '—');
  const rtf = new Intl.RelativeTimeFormat('pl', { numeric: 'auto' });
  function fmtRel(s) {
    if (!s) return '—';
    const d = new Date(s.length === 10 ? `${s}T12:00:00` : s);
    const diff = (d - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 60) return 'przed chwilą';
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
    return fmtDate(s);
  }
  const daysUntil = (s) => Math.round((new Date(`${s}T12:00:00`) - new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00')) / 86400000);
  const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1).replace('.', ',')} KB` : `${(b / 1048576).toFixed(1).replace('.', ',')} MB`);
  const plural = (n, one, few, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

  // ---------- Słowniki ----------
  const TICKET_STATUS = {
    nowe: ['Nowe', 'info'], w_toku: ['W toku', 'warn'], oczekuje_na_klienta: ['Czeka na Ciebie', 'coral'],
    rozwiazane: ['Rozwiązane', 'ok'], zamkniete: ['Zamknięte', ''],
  };
  const TICKET_CAT = { pytanie: ['Pytanie', 'circle-help'], blad: ['Błąd', 'bug'], zmiana: ['Zmiana', 'pencil-line'], nowa_funkcja: ['Nowa funkcja', 'sparkles'], rozliczenia: ['Rozliczenia', 'receipt'] };
  const PRIORITY = { niski: 'Niski', normalny: 'Normalny', wysoki: 'Wysoki', krytyczny: 'Krytyczny' };
  const INV_STATUS = { oczekuje: ['Do zapłaty', 'warn'], oplacona: ['Opłacona', 'ok'], po_terminie: ['Po terminie', 'coral'], anulowana: ['Anulowana', ''] };
  const DOC_CAT = { umowa: ['Umowy', 'file-pen-line'], specyfikacja: ['Specyfikacje', 'file-text'], protokol: ['Protokoły', 'clipboard-check'], instrukcja: ['Instrukcje', 'book-open'], inne: ['Inne', 'file'] };
  const STAGE_TONE = { analiza: 'info', projekt: 'info', wdrozenie: 'warn', testy: 'warn', uruchomiony: 'ok', rozwoj: 'ok' };
  const badge = (label, tone = '') => `<span class="badge ${tone}">${esc(label)}</span>`;
  const ticketBadge = (s) => badge(...(TICKET_STATUS[s] || [s]));
  const invBadge = (s) => badge(...(INV_STATUS[s] || [s]));
  let STAGES = [];

  // ---------- API ----------
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'modulio' } : { 'X-Requested-With': 'modulio' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { location.assign(`/logowanie?next=${encodeURIComponent(location.pathname)}`); throw new Error('401'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Wystąpił błąd.'); e.status = res.status; e.fields = data.fields; throw e; }
    return data;
  }

  // ---------- Toast ----------
  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${icon(type === 'ok' ? 'circle-check' : 'circle-alert')}<span></span>`;
    el.querySelector('span').textContent = msg;
    $('#toast-host').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 4000);
  }

  // ---------- Stan ----------
  const state = { user: null };

  function setUser(u) {
    state.user = u;
    const initials = (u.name || u.email).split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    $$('[data-user-initials]').forEach((e) => { e.textContent = initials; });
    $$('[data-user-name]').forEach((e) => { e.textContent = u.name; });
    $$('[data-user-email]').forEach((e) => { e.textContent = u.company || u.email; });
  }

  async function refreshBadges(stats) {
    try {
      const s = stats || (await api('/api/dashboard')).stats;
      const set = (key, n) => {
        $$(`[data-badge="${key}"]`).forEach((b) => { b.hidden = !n; b.textContent = n; });
        $$(`[data-dot="${key}"]`).forEach((b) => { b.hidden = !n; });
      };
      set('tickets', s.awaitingClient);
      set('invoices', s.overdue);
    } catch { /* ignoruj */ }
  }

  // ---------- Layout ----------
  function setHeader(title, crumbs = []) {
    $('#page-title').textContent = title;
    $('#crumbs').innerHTML = crumbs.length
      ? crumbs.map(([label, href]) => (href ? `<a href="${href}" data-link>${esc(label)}</a>` : `<span>${esc(label)}</span>`)).join(icon('chevron-right'))
      : '<span>Panel klienta</span>';
    document.title = `${title} — Panel klienta Modulio`;
  }
  function setNav(key) {
    $$('[data-nav]').forEach((a) => {
      const on = a.dataset.nav === key;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  const skeleton = (rows = 3) => `<div class="grid grid-4">${'<div class="skeleton" style="height:118px"></div>'.repeat(4)}</div>
    <div class="grid grid-main mt"><div class="skeleton" style="height:${rows * 110}px"></div><div class="skeleton" style="height:${rows * 110}px"></div></div>`;
  const emptyState = (ic, title, text, action = '') => `<div class="empty"><div class="empty-ic">${icon(ic)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
  const errorState = (err) => emptyState('cloud-off', 'Nie udało się wczytać danych', err.message || 'Spróbuj odświeżyć stronę.', `<button class="button button-light btn-sm" data-reload>${icon('rotate-ccw')} Spróbuj ponownie</button>`);

  function stepper(stage, compact = false) {
    const idx = STAGES.findIndex((s) => s.key === stage);
    return `<ol class="stepper${compact ? ' compact' : ''}" aria-label="Etap: ${esc(STAGES[idx]?.label || stage)}">${STAGES.map((s, i) =>
      `<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}"${i === idx ? ' aria-current="step"' : ''}>${esc(s.label)}</li>`).join('')}</ol>`;
  }
  const progressBar = (p) => `<div class="progress-row"><div class="progress" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><i data-w="${p}"></i></div><b>${p}%</b></div>`;
  function animateBars() { requestAnimationFrame(() => $$('.progress i[data-w]', view).forEach((b) => { b.style.width = `${b.dataset.w}%`; })); }

  // =========================================================
  // WIDOKI
  // =========================================================
  const views = {};

  // ---------- Pulpit ----------
  views.dashboard = async () => {
    setHeader('Pulpit'); setNav('pulpit');
    const d = await api('/api/dashboard');
    refreshBadges(d.stats);
    const first = (state.user.name || '').split(' ')[0];
    const h = new Date().getHours();
    const hello = h < 5 ? 'Dobry wieczór' : h < 18 ? 'Dzień dobry' : 'Dobry wieczór';
    const s = d.stats;

    const summary = [];
    if (s.awaitingClient) summary.push(`${s.awaitingClient} ${plural(s.awaitingClient, 'zgłoszenie czeka', 'zgłoszenia czekają', 'zgłoszeń czeka')} na Twoją odpowiedź`);
    if (s.overdue) summary.push(`${s.overdue} ${plural(s.overdue, 'faktura jest', 'faktury są', 'faktur jest')} po terminie`);
    const summaryText = summary.length ? `${summary.join(', a ')}.` : (s.totalProjects ? 'Wszystko jest na bieżąco — nic nie wymaga Twojej uwagi.' : 'Twoje konto jest gotowe. Poniżej znajdziesz pierwsze kroki.');

    const nextMs = d.milestones[0];
    const nextDays = nextMs?.dueDate ? daysUntil(nextMs.dueDate) : null;

    let html = `
      <section class="welcome view-enter">
        <div>
          <small>${esc(new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()))}</small>
          <h2>${hello}, ${esc(first)}!</h2>
          <p>${esc(summaryText)}</p>
        </div>
        <div class="actions">
          <button class="button button-coral btn-sm" data-new-ticket>${icon('plus')} Nowe zgłoszenie</button>
          ${s.totalProjects ? `<a class="button button-ghost btn-sm" href="/panel/projekty" data-link>${icon('folder-kanban')} Projekty</a>` : ''}
        </div>
      </section>`;

    if (!s.totalProjects) {
      html += `
        <section class="card mt">
          <div class="card-head"><h2>${icon('rocket')} Pierwsze kroki</h2></div>
          <div class="onboard">
            <div class="onboard-step"><span class="n">1</span><b>Opisz swoje potrzeby</b><p>Utwórz zgłoszenie z kategorią „Pytanie” i opisz, co chcesz usprawnić.</p><a href="#" data-new-ticket>${icon('plus')} Nowe zgłoszenie</a></div>
            <div class="onboard-step"><span class="n">2</span><b>Rozmowa i analiza</b><p>Opiekun Modulio skontaktuje się, dobierze moduły i przygotuje zakres.</p><a href="/#konfigurator">${icon('sliders-horizontal')} Konfigurator</a></div>
            <div class="onboard-step"><span class="n">3</span><b>Śledź wdrożenie</b><p>Po starcie projektu zobaczysz tu etapy, postęp, dokumenty i faktury.</p><a href="/#proces">${icon('info')} Jak działamy</a></div>
          </div>
        </section>`;
    }

    html += `
      <section class="grid grid-4 mt" aria-label="Podsumowanie">
        <a class="card kpi tone-blue" href="/panel/projekty" data-link><div class="kpi-top"><span>Projekty w toku</span><span class="kpi-ic">${icon('folder-kanban')}</span></div><strong>${s.activeProjects}</strong><small>z ${s.totalProjects} ${plural(s.totalProjects, 'projektu', 'projektów', 'projektów')}</small></a>
        <a class="card kpi tone-coral" href="/panel/zgloszenia" data-link><div class="kpi-top"><span>Otwarte zgłoszenia</span><span class="kpi-ic">${icon('life-buoy')}</span></div><strong>${s.openTickets}</strong><small class="${s.awaitingClient ? 'alert' : ''}">${s.awaitingClient ? `${s.awaitingClient} czeka na Ciebie` : 'brak oczekujących'}</small></a>
        <a class="card kpi tone-amber" href="/panel/faktury" data-link><div class="kpi-top"><span>Do zapłaty</span><span class="kpi-ic">${icon('wallet-cards')}</span></div><strong>${fmtMoney(s.amountToPay)}</strong><small class="${s.overdue ? 'alert' : ''}">${s.overdue ? `${s.overdue} po terminie` : `${s.invoicesToPay} ${plural(s.invoicesToPay, 'faktura', 'faktury', 'faktur')}`}</small></a>
        <div class="card kpi tone-green"><div class="kpi-top"><span>Najbliższy etap</span><span class="kpi-ic">${icon('flag')}</span></div><strong>${nextDays === null ? '—' : nextDays <= 0 ? 'dziś' : `${nextDays} ${plural(nextDays, 'dzień', 'dni', 'dni')}`}</strong><small>${esc(nextMs?.title || 'brak zaplanowanych')}</small></div>
      </section>`;

    if (s.totalProjects) {
      html += `
      <div class="grid grid-main mt">
        <div class="stack">
          <section class="card">
            <div class="card-head"><h2>${icon('folder-kanban')} Twoje projekty</h2><a href="/panel/projekty" data-link>Wszystkie ${icon('arrow-right')}</a></div>
            <ul class="list">${d.projects.map((p) => `
              <li><a class="list-item" href="/panel/projekty/${p.id}" data-link style="grid-template-columns:1fr">
                <div style="display:grid;gap:12px">
                  <div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><b>${esc(p.name)}</b><small>${esc(p.kind)} · opiekun: ${esc(p.manager || '—')}</small></div>${badge(p.stageLabel, STAGE_TONE[p.stage])}</div>
                  ${progressBar(p.progress)}
                </div>
              </a></li>`).join('')}
            </ul>
          </section>
          <section class="card">
            <div class="card-head"><h2>${icon('activity')} Ostatnia aktywność</h2></div>
            ${d.activity.length ? `<ul class="feed">${d.activity.map((a) => `
              <li><span class="li-ic ${a.type === 'ticket' ? 'coral' : 'green'}">${icon(a.type === 'ticket' ? 'message-square' : 'megaphone')}</span>
                <div><a href="${a.type === 'ticket' ? `/panel/zgloszenia/${a.refId}` : `/panel/projekty/${a.refId}`}" data-link><b>${esc(a.title)}</b></a>
                <p>${esc(a.body)}</p><small>${esc(a.author)} · ${esc(a.refName)} · ${fmtRel(a.at)}</small></div></li>`).join('')}</ul>`
              : emptyState('activity', 'Brak aktywności', 'Tu pojawią się aktualizacje projektów i odpowiedzi zespołu.')}
          </section>
        </div>
        <div class="stack">
          <section class="card">
            <div class="card-head"><h2>${icon('flag')} Najbliższe kamienie milowe</h2></div>
            ${d.milestones.length ? `<ul class="list">${d.milestones.map((m) => {
              const dd = m.dueDate ? daysUntil(m.dueDate) : null;
              return `<li><a class="list-item" href="/panel/projekty/${m.projectId}" data-link><span class="li-ic ${dd !== null && dd < 0 ? 'coral' : 'blue'}">${icon('calendar-days')}</span><div><b>${esc(m.title)}</b><small>${esc(m.projectName)}</small></div><div class="li-right"><strong>${fmtDate(m.dueDate)}</strong>${dd === null ? '' : dd < 0 ? 'po terminie' : dd === 0 ? 'dziś' : `za ${dd} ${plural(dd, 'dzień', 'dni', 'dni')}`}</div></a></li>`;
            }).join('')}</ul>` : emptyState('flag', 'Brak zaplanowanych etapów', 'Wszystkie kamienie milowe są wykonane.')}
          </section>
          <section class="card">
            <div class="card-head"><h2>${icon('receipt')} Faktury do zapłaty</h2><a href="/panel/faktury" data-link>Wszystkie ${icon('arrow-right')}</a></div>
            ${d.invoices.length ? `<ul class="list">${d.invoices.map((i) => `
              <li><a class="list-item" href="/panel/faktury/${i.id}" data-link><span class="li-ic ${i.status === 'po_terminie' ? 'coral' : ''}">${icon('receipt')}</span><div><b class="mono">${esc(i.number)}</b><small>termin: ${fmtDate(i.dueDate)}</small></div><div class="li-right"><strong>${fmtMoney(i.gross)}</strong>${invBadge(i.status)}</div></a></li>`).join('')}</ul>`
              : emptyState('circle-check', 'Wszystko opłacone', 'Nie masz faktur oczekujących na płatność.')}
          </section>
        </div>
      </div>`;
    }
    view.innerHTML = html;
    animateBars();
  };

  // ---------- Projekty ----------
  views.projects = async () => {
    setHeader('Projekty', [['Pulpit', '/panel'], ['Projekty']]); setNav('projekty');
    const d = await api('/api/projects');
    STAGES = d.stages;
    if (!d.projects.length) {
      view.innerHTML = `<section class="card view-enter">${emptyState('folder-kanban', 'Nie masz jeszcze projektów', 'Gdy rozpoczniemy współpracę, projekt pojawi się tutaj razem z etapami i harmonogramem.', `<button class="button button-dark btn-sm" data-new-ticket>${icon('plus')} Opisz swoje potrzeby</button>`)}</section>`;
      return;
    }
    view.innerHTML = `<div class="grid grid-2 view-enter">${d.projects.map((p) => `
      <a class="card project-card" href="/panel/projekty/${p.id}" data-link>
        <div class="top"><div><h3>${esc(p.name)}</h3><div class="kind">${esc(p.kind)}</div></div>${badge(p.stageLabel, STAGE_TONE[p.stage])}</div>
        <p>${esc(p.description)}</p>
        ${stepper(p.stage)}
        ${progressBar(p.progress)}
        <div class="meta-row">
          <span>${icon('flag')} ${p.milestonesDone}/${p.milestonesTotal} etapów</span>
          <span>${icon('calendar-days')} ${fmtDate(p.dueDate)}</span>
          <span>${icon('user-round')} ${esc(p.manager || '—')}</span>
          ${p.openTickets ? `<span>${icon('life-buoy')} ${p.openTickets} otwarte</span>` : ''}
        </div>
      </a>`).join('')}</div>`;
    animateBars();
  };

  views.project = async ({ id }) => {
    setNav('projekty');
    const d = await api(`/api/projects/${id}`);
    STAGES = d.stages;
    const p = d.project;
    setHeader(p.name, [['Projekty', '/panel/projekty'], [p.name]]);
    const nextIdx = d.milestones.findIndex((m) => !m.done);
    view.innerHTML = `
      <section class="card project-hero view-enter">
        <div class="top">
          <div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${badge(p.stageLabel, STAGE_TONE[p.stage])}<span class="chip">${esc(p.kind)}</span></div>
          <h2 style="margin-top:12px">${esc(p.name)}</h2><p style="margin-top:8px;max-width:720px">${esc(p.description)}</p></div>
          <button class="button button-light btn-sm" data-new-ticket data-project="${p.id}">${icon('life-buoy')} Zgłoś sprawę do projektu</button>
        </div>
        ${stepper(p.stage)}
        <div style="margin-top:18px">${progressBar(p.progress)}</div>
      </section>
      <div class="grid grid-main mt">
        <div class="stack">
          <section class="card">
            <div class="card-head"><h2>${icon('flag')} Kamienie milowe</h2><span class="chip">${d.milestones.filter((m) => m.done).length}/${d.milestones.length}</span></div>
            ${d.milestones.length ? `<ol class="timeline">${d.milestones.map((m, i) => `
              <li class="${m.done ? 'done' : i === nextIdx ? 'next' : ''}"><span class="tl-dot">${m.done ? icon('check') : ''}</span><b>${esc(m.title)}</b><small>${fmtDate(m.dueDate)}</small></li>`).join('')}</ol>`
              : emptyState('flag', 'Harmonogram w przygotowaniu', 'Kamienie milowe pojawią się po zakończeniu analizy.')}
          </section>
          <section class="card">
            <div class="card-head"><h2>${icon('megaphone')} Aktualizacje od zespołu</h2></div>
            ${d.updates.length ? `<ul class="feed">${d.updates.map((u) => `
              <li><span class="li-ic green">${icon('megaphone')}</span><div><b>${esc(u.title)}</b><p>${esc(u.body)}</p><small>${esc(u.author)} · ${fmtDateTime(u.createdAt)}</small></div></li>`).join('')}</ul>`
              : emptyState('megaphone', 'Brak aktualizacji', 'Opiekun projektu będzie publikował tu postępy prac.')}
          </section>
        </div>
        <div class="stack">
          <section class="card">
            <div class="card-head"><h2>${icon('info')} Szczegóły</h2></div>
            <dl class="dl">
              <div><dt>Opiekun</dt><dd>${esc(p.manager || '—')}</dd></div>
              <div><dt>Start</dt><dd>${fmtDate(p.startDate)}</dd></div>
              <div><dt>Planowane uruchomienie</dt><dd>${fmtDate(p.dueDate)}</dd></div>
            </dl>
            ${p.modules.length ? `<div style="padding:0 22px 20px"><div class="chips">${p.modules.map((m) => `<span class="chip">${icon('blocks')} ${esc(m)}</span>`).join('')}</div></div>` : ''}
          </section>
          <section class="card">
            <div class="card-head"><h2>${icon('folder-open')} Dokumenty</h2><a href="/panel/dokumenty" data-link>Wszystkie ${icon('arrow-right')}</a></div>
            ${d.documents.length ? `<ul class="list">${d.documents.map((doc) => `
              <li><a class="list-item" href="/api/documents/${doc.id}/download" download><span class="li-ic coral">${icon((DOC_CAT[doc.category] || DOC_CAT.inne)[1])}</span><div><b>${esc(doc.name)}</b><small>${fmtDate(doc.createdAt)} · ${fmtSize(doc.size)}</small></div>${icon('download')}</a></li>`).join('')}</ul>`
              : emptyState('folder-open', 'Brak dokumentów', 'Umowy i specyfikacje pojawią się tutaj.')}
          </section>
          <section class="card">
            <div class="card-head"><h2>${icon('life-buoy')} Zgłoszenia projektu</h2></div>
            ${d.tickets.length ? `<ul class="list">${d.tickets.map((t) => `
              <li><a class="list-item" href="/panel/zgloszenia/${t.id}" data-link><span class="li-ic">${icon((TICKET_CAT[t.category] || TICKET_CAT.pytanie)[1])}</span><div><b>${esc(t.subject)}</b><small>${esc(t.number)} · ${fmtRel(t.updatedAt)}</small></div>${ticketBadge(t.status)}</a></li>`).join('')}</ul>`
              : emptyState('life-buoy', 'Brak zgłoszeń', 'Masz pytanie do tego projektu? Utwórz zgłoszenie.')}
          </section>
        </div>
      </div>`;
    animateBars();
  };

  // ---------- Zgłoszenia ----------
  let ticketFilter = 'otwarte';
  views.tickets = async () => {
    setHeader('Zgłoszenia', [['Pulpit', '/panel'], ['Zgłoszenia']]); setNav('zgloszenia');
    const d = await api('/api/tickets');
    state.projects = d.projects;
    const groups = {
      otwarte: (t) => !['rozwiazane', 'zamkniete'].includes(t.status),
      czeka: (t) => t.status === 'oczekuje_na_klienta',
      zamkniete: (t) => ['rozwiazane', 'zamkniete'].includes(t.status),
      wszystkie: () => true,
    };
    const labels = { otwarte: 'Otwarte', czeka: 'Czeka na Ciebie', zamkniete: 'Zamknięte', wszystkie: 'Wszystkie' };
    if (!d.tickets.length) {
      view.innerHTML = `<section class="card view-enter">${emptyState('life-buoy', 'Nie masz jeszcze zgłoszeń', 'Zgłoś błąd, poproś o zmianę albo zadaj pytanie — odpowiemy w wątku.', `<button class="button button-dark btn-sm" data-new-ticket>${icon('plus')} Nowe zgłoszenie</button>`)}</section>`;
      return;
    }
    view.innerHTML = `
      <div class="toolbar view-enter">
        <div class="segmented" role="tablist" aria-label="Filtr zgłoszeń">${Object.keys(groups).map((k) =>
          `<button type="button" role="tab" data-filter="${k}" class="${k === ticketFilter ? 'on' : ''}" aria-selected="${k === ticketFilter}">${labels[k]} <span class="count">${d.tickets.filter(groups[k]).length}</span></button>`).join('')}</div>
        <label class="search">${icon('search')}<span class="sr-only">Szukaj zgłoszeń</span><input type="search" id="ticket-search" placeholder="Szukaj po temacie lub numerze…"></label>
      </div>
      <section class="card"><div class="table-wrap"><table class="table responsive">
        <thead><tr><th>Zgłoszenie</th><th class="hide-sm">Projekt</th><th>Status</th><th class="hide-sm">Priorytet</th><th class="num">Aktualizacja</th></tr></thead>
        <tbody id="ticket-rows"></tbody>
      </table></div><div id="ticket-empty"></div></section>`;

    const render = () => {
      const q = ($('#ticket-search').value || '').toLowerCase().trim();
      const rows = d.tickets.filter(groups[ticketFilter]).filter((t) => !q || `${t.number} ${t.subject}`.toLowerCase().includes(q));
      $('#ticket-rows').innerHTML = rows.map((t) => `
        <tr class="clickable" data-href="/panel/zgloszenia/${t.id}">
          <td><a href="/panel/zgloszenia/${t.id}" data-link class="strong">${esc(t.subject)}</a><span class="t-sub mono">${esc(t.number)} · ${esc((TICKET_CAT[t.category] || [t.category])[0])}${t.lastAuthor === 'team' && t.status === 'oczekuje_na_klienta' ? ' · nowa odpowiedź' : ''}</span></td>
          <td class="hide-sm muted">${esc(t.projectName || '—')}</td>
          <td>${ticketBadge(t.status)}</td>
          <td class="hide-sm muted">${esc(PRIORITY[t.priority] || t.priority)}</td>
          <td class="num muted">${fmtRel(t.updatedAt)}</td>
        </tr>`).join('');
      $('#ticket-empty').innerHTML = rows.length ? '' : emptyState('search-x', 'Brak wyników', 'Zmień filtr lub wyszukiwaną frazę.');
    };
    render();
    $$('[data-filter]', view).forEach((b) => b.addEventListener('click', () => {
      ticketFilter = b.dataset.filter;
      $$('[data-filter]', view).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
      render();
    }));
    $('#ticket-search').addEventListener('input', render);
  };

  views.ticket = async ({ id }) => {
    setNav('zgloszenia');
    const d = await api(`/api/tickets/${id}`);
    const t = d.ticket;
    setHeader(t.number, [['Zgłoszenia', '/panel/zgloszenia'], [t.number]]);
    const closed = ['rozwiazane', 'zamkniete'].includes(t.status);
    view.innerHTML = `
      <div class="grid grid-main view-enter">
        <section class="card">
          <div class="card-head" style="align-items:flex-start;flex-wrap:wrap">
            <div><h2 style="font-size:19px">${esc(t.subject)}</h2><div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">${ticketBadge(t.status)}<span class="chip">${icon((TICKET_CAT[t.category] || TICKET_CAT.pytanie)[1])} ${esc((TICKET_CAT[t.category] || [t.category])[0])}</span></div></div>
            ${closed ? '' : `<button class="button button-light btn-sm" id="close-ticket">${icon('circle-check')} Oznacz jako zamknięte</button>`}
          </div>
          <div class="thread" id="thread">${d.messages.map(msgHtml).join('')}</div>
          <form class="composer" id="reply-form">
            <label class="sr-only" for="reply">Twoja odpowiedź</label>
            <textarea id="reply" name="message" placeholder="${closed ? 'Napisz, aby wznowić zgłoszenie…' : 'Napisz odpowiedź…'}" required maxlength="5000"></textarea>
            <div class="composer-row"><small><kbd>Ctrl</kbd> + <kbd>Enter</kbd> wysyła wiadomość</small><button class="button button-dark btn-sm" type="submit">${icon('send')} ${closed ? 'Wznów i wyślij' : 'Wyślij'}</button></div>
            <div class="inline-error" id="reply-error"></div>
          </form>
        </section>
        <aside class="stack">
          <section class="card">
            <div class="card-head"><h2>${icon('info')} Informacje</h2></div>
            <dl class="dl">
              <div><dt>Numer</dt><dd class="mono">${esc(t.number)}</dd></div>
              <div><dt>Priorytet</dt><dd>${esc(PRIORITY[t.priority] || t.priority)}</dd></div>
              <div><dt>Projekt</dt><dd>${t.projectId ? `<a href="/panel/projekty/${t.projectId}" data-link>${esc(t.projectName)}</a>` : '—'}</dd></div>
              <div><dt>Utworzone</dt><dd>${fmtDateTime(t.createdAt)}</dd></div>
              <div><dt>Ostatnia zmiana</dt><dd>${fmtRel(t.updatedAt)}</dd></div>
            </dl>
          </section>
          <section class="card card-pad"><p style="font-size:13px">${icon('clock-3')} Odpowiadamy w dni robocze. W sprawach krytycznych ustaw priorytet „Krytyczny” — trafi od razu do opiekuna.</p></section>
        </aside>
      </div>`;
    const thread = $('#thread');
    thread.lastElementChild?.scrollIntoView({ block: 'nearest' });
    const form = $('#reply-form');
    const ta = $('#reply');
    ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') form.requestSubmit(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = ta.value.trim();
      $('#reply-error').innerHTML = '';
      if (msg.length < 2) { $('#reply-error').innerHTML = `${icon('circle-alert')} Wpisz treść wiadomości.`; return; }
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try {
        await api(`/api/tickets/${t.id}/messages`, { method: 'POST', body: { message: msg } });
        toast('Wiadomość wysłana.');
        await router(); // odśwież wątek
        refreshBadges();
      } catch (err) {
        if (err.message !== '401') $('#reply-error').innerHTML = `${icon('circle-alert')} ${esc(err.message)}`;
        btn.disabled = false;
      }
    });
    $('#close-ticket')?.addEventListener('click', async () => {
      if (!confirmInline($('#close-ticket'), 'Na pewno zamknąć?')) return;
      await api(`/api/tickets/${t.id}/close`, { method: 'POST', body: {} });
      toast('Zgłoszenie zamknięte.');
      refreshBadges();
      router();
    });
  };

  function msgHtml(m) {
    if (m.authorType === 'system') return `<div class="msg system"><div class="bubble">${esc(m.body)}</div></div>`;
    const who = m.authorType === 'team'
      ? `<span class="msg-avatar">${esc(m.authorName.split(' ').map((x) => x[0]).join('').slice(0, 2))}</span><b>${esc(m.authorName)}</b> · Modulio · ${fmtDateTime(m.createdAt)}`
      : `<b>Ty</b> · ${fmtDateTime(m.createdAt)}`;
    return `<div class="msg ${m.authorType}"><div class="who">${who}</div><div class="bubble">${esc(m.body)}</div></div>`;
  }

  // Potwierdzenie dwuklikowe (bez natywnych okien dialogowych)
  function confirmInline(btn, label) {
    if (btn.dataset.confirm === '1') return true;
    btn.dataset.confirm = '1';
    const html = btn.innerHTML;
    btn.innerHTML = `${icon('circle-alert')} ${label}`;
    setTimeout(() => { if (btn.isConnected) { btn.dataset.confirm = ''; btn.innerHTML = html; } }, 3500);
    return false;
  }

  // ---------- Faktury ----------
  views.invoices = async () => {
    setHeader('Faktury', [['Pulpit', '/panel'], ['Faktury']]); setNav('faktury');
    const d = await api('/api/invoices');
    if (!d.invoices.length) {
      view.innerHTML = `<section class="card view-enter">${emptyState('receipt', 'Brak faktur', 'Faktury za wdrożenie i abonament pojawią się tutaj.')}</section>`;
      return;
    }
    view.innerHTML = `
      <section class="grid grid-3 view-enter">
        <div class="card kpi tone-green"><div class="kpi-top"><span>Opłacone</span><span class="kpi-ic">${icon('circle-check')}</span></div><strong>${fmtMoney(d.summary.paid)}</strong><small>łącznie brutto</small></div>
        <div class="card kpi tone-amber"><div class="kpi-top"><span>Do zapłaty</span><span class="kpi-ic">${icon('clock-3')}</span></div><strong>${fmtMoney(d.summary.pending)}</strong><small>w terminie</small></div>
        <div class="card kpi tone-coral"><div class="kpi-top"><span>Po terminie</span><span class="kpi-ic">${icon('circle-alert')}</span></div><strong>${fmtMoney(d.summary.overdue)}</strong><small class="${d.summary.overdue ? 'alert' : ''}">${d.summary.overdue ? 'prosimy o uregulowanie' : 'brak zaległości'}</small></div>
      </section>
      <section class="card mt"><div class="table-wrap"><table class="table responsive">
        <thead><tr><th>Numer</th><th class="hide-sm">Wystawiona</th><th class="hide-sm">Termin</th><th>Status</th><th class="num">Kwota brutto</th></tr></thead>
        <tbody>${d.invoices.map((i) => `
          <tr class="clickable" data-href="/panel/faktury/${i.id}">
            <td><a class="strong mono" href="/panel/faktury/${i.id}" data-link>${esc(i.number)}</a><span class="t-sub">${esc(i.projectName || 'Abonament')}</span></td>
            <td class="hide-sm muted">${fmtDate(i.issueDate)}</td>
            <td class="hide-sm muted">${fmtDate(i.dueDate)}</td>
            <td>${invBadge(i.status)}</td>
            <td class="num strong">${fmtMoney(i.gross)}</td>
          </tr>`).join('')}</tbody>
      </table></div></section>
      <p class="contact-only" style="margin-top:18px">${icon('info')} Płatności realizujesz przelewem — panel nie pobiera płatności online.</p>`;
  };

  views.invoice = async ({ id }) => {
    setNav('faktury');
    const { invoice: inv, seller, buyer } = await api(`/api/invoices/${id}`);
    setHeader(inv.number, [['Faktury', '/panel/faktury'], [inv.number]]);
    view.innerHTML = `
      <div class="invoice-actions view-enter">
        <a class="button button-light btn-sm" href="/panel/faktury" data-link>${icon('arrow-left')} Wróć</a>
        <button class="button button-light btn-sm" id="copy-account">${icon('copy')} Kopiuj nr konta</button>
        <button class="button button-dark btn-sm" id="print-invoice">${icon('printer')} Drukuj / zapisz PDF</button>
      </div>
      <article class="invoice-paper view-enter">
        <div class="inv-head">
          <div><h2>Faktura VAT</h2><div class="mono" style="margin-top:6px">${esc(inv.number)}</div></div>
          <div style="text-align:right">${invBadge(inv.status)}<div style="margin-top:10px;font-family:var(--font-display);font-weight:800;font-size:20px">modulio<span style="color:var(--coral)">.</span></div></div>
        </div>
        <div class="inv-parties">
          <div><h4>Sprzedawca</h4><p><b>${esc(seller.legalName)}</b><br>${esc(seller.address)}<br>NIP: ${esc(seller.nip)}<br>${esc(seller.email)}</p></div>
          <div><h4>Nabywca</h4><p><b>${esc(buyer.name)}</b><br>${esc(buyer.contact)}<br>${esc(buyer.email)}</p></div>
        </div>
        <div class="inv-dates">
          <div><small>Data wystawienia</small><b>${fmtDate(inv.issueDate)}</b></div>
          <div><small>Termin płatności</small><b>${fmtDate(inv.dueDate)}</b></div>
          <div><small>${inv.paidAt ? 'Opłacono' : 'Forma płatności'}</small><b>${inv.paidAt ? fmtDate(inv.paidAt) : 'Przelew'}</b></div>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Lp.</th><th>Nazwa</th><th class="num">Ilość</th><th class="num">Cena netto</th><th class="num">VAT</th><th class="num">Wartość netto</th></tr></thead>
          <tbody>${inv.items.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.name)}</td><td class="num">${it.qty}</td><td class="num">${fmtMoney(it.unit_net)}</td><td class="num">${it.vat}%</td><td class="num">${fmtMoney(it.qty * it.unit_net)}</td></tr>`).join('')}</tbody>
        </table></div>
        <div class="inv-totals">
          <div><span>Razem netto</span><b>${fmtMoney(inv.net)}</b></div>
          <div><span>VAT</span><b>${fmtMoney(inv.vat)}</b></div>
          <div class="grand"><span>Do zapłaty</span><span>${fmtMoney(inv.gross)}</span></div>
        </div>
        ${inv.status === 'oplacona' ? '' : `<div class="inv-pay"><b>Dane do przelewu</b><br>Odbiorca: ${esc(seller.legalName)}<br>Nr konta: <span class="mono" id="acc">${esc(seller.bank)}</span><br>Tytuł: <span class="mono">${esc(inv.number)}</span><br>Kwota: <b>${fmtMoney(inv.gross)}</b></div>`}
        <p class="inv-note">Podgląd dokumentu w panelu klienta. Wiążący jest dokument księgowy przesłany przez Modulio.</p>
      </article>`;
    $('#print-invoice').addEventListener('click', () => print());
    $('#copy-account').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(seller.bank.replace(/\s/g, '')); toast('Numer konta skopiowany.'); }
      catch { toast('Nie udało się skopiować.', 'err'); }
    });
  };

  // ---------- Dokumenty ----------
  let docFilter = 'wszystkie';
  views.documents = async () => {
    setHeader('Dokumenty', [['Pulpit', '/panel'], ['Dokumenty']]); setNav('dokumenty');
    const d = await api('/api/documents');
    if (!d.documents.length) {
      view.innerHTML = `<section class="card view-enter">${emptyState('folder-open', 'Brak dokumentów', 'Umowy, specyfikacje, protokoły i instrukcje pojawią się tutaj.')}</section>`;
      return;
    }
    const cats = ['wszystkie', ...Object.keys(DOC_CAT).filter((k) => d.documents.some((x) => x.category === k))];
    view.innerHTML = `
      <div class="toolbar view-enter">
        <div class="segmented" role="tablist" aria-label="Kategoria dokumentów">${cats.map((c) =>
          `<button type="button" role="tab" data-cat="${c}" class="${c === docFilter ? 'on' : ''}" aria-selected="${c === docFilter}">${c === 'wszystkie' ? 'Wszystkie' : DOC_CAT[c][0]} <span class="count">${c === 'wszystkie' ? d.documents.length : d.documents.filter((x) => x.category === c).length}</span></button>`).join('')}</div>
      </div>
      <div class="grid grid-3" id="doc-grid"></div>`;
    const render = () => {
      const docs = d.documents.filter((x) => docFilter === 'wszystkie' || x.category === docFilter);
      $('#doc-grid').innerHTML = docs.map((doc) => {
        const ext = (doc.filename.split('.').pop() || '').toUpperCase().slice(0, 4);
        return `<article class="card doc-card">
          <div class="doc-top"><span class="file-ic">${icon((DOC_CAT[doc.category] || DOC_CAT.inne)[1])}<span>${esc(ext)}</span></span>
          <div><b>${esc(doc.name)}</b><small>${esc(doc.projectName || 'Ogólne')}</small></div></div>
          <div class="doc-foot"><small>${fmtDate(doc.createdAt)} · ${fmtSize(doc.size)}</small><a class="button button-light btn-sm" href="/api/documents/${doc.id}/download" download aria-label="Pobierz ${esc(doc.name)}">${icon('download')} Pobierz</a></div>
        </article>`;
      }).join('');
    };
    render();
    $$('[data-cat]', view).forEach((b) => b.addEventListener('click', () => {
      docFilter = b.dataset.cat;
      $$('[data-cat]', view).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
      render();
    }));
  };

  // ---------- Konto ----------
  views.account = async () => {
    setHeader('Ustawienia konta', [['Pulpit', '/panel'], ['Ustawienia']]); setNav('konto');
    const [{ user }, { sessions }] = await Promise.all([api('/api/auth/me'), api('/api/account/sessions')]);
    const others = sessions.filter((s) => !s.current).length;
    const ua = (s) => {
      const b = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Przeglądarka';
      const os = /Windows/.test(s) ? 'Windows' : /Mac OS X/.test(s) && !/Mobile/.test(s) ? 'macOS' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Linux/.test(s) ? 'Linux' : '';
      return `${b}${os ? ` · ${os}` : ''}`;
    };
    view.innerHTML = `
      <div class="grid grid-main view-enter">
        <div class="stack">
          <section class="card">
            <div class="card-head"><h2>${icon('user-round')} Dane profilu</h2></div>
            <form class="card-body" id="profile-form" novalidate>
              <div class="form-grid">
                <div class="field"><label for="p-name">Imię i nazwisko</label><input id="p-name" name="name" value="${esc(user.name)}" required autocomplete="name"></div>
                <div class="field"><label for="p-company">Firma</label><input id="p-company" name="company" value="${esc(user.company)}" autocomplete="organization"></div>
                <div class="field"><label for="p-phone">Telefon</label><input id="p-phone" name="phone" type="tel" value="${esc(user.phone)}" autocomplete="tel"></div>
                <div class="field"><label for="p-email">E-mail</label><input id="p-email" value="${esc(user.email)}" readonly><span class="field-help">Zmianę adresu e-mail zgłoś opiekunowi.</span></div>
              </div>
              <div class="inline-error" data-err></div>
              <div class="form-actions"><button class="button button-dark btn-sm" type="submit">${icon('save')} Zapisz zmiany</button></div>
            </form>
          </section>
          <section class="card">
            <div class="card-head"><h2>${icon('key-round')} Zmiana hasła</h2></div>
            <form class="card-body" id="password-form" novalidate>
              <div class="form-grid">
                <div class="field full"><label for="pw-current">Obecne hasło</label><input id="pw-current" name="current" type="password" autocomplete="current-password" required></div>
                <div class="field"><label for="pw-next">Nowe hasło</label><input id="pw-next" name="next" type="password" autocomplete="new-password" required minlength="8"><span class="field-help">Min. 8 znaków, litera i cyfra.</span></div>
                <div class="field"><label for="pw-repeat">Powtórz nowe hasło</label><input id="pw-repeat" name="repeat" type="password" autocomplete="new-password" required></div>
              </div>
              <div class="inline-error" data-err></div>
              <div class="form-actions"><button class="button button-dark btn-sm" type="submit">${icon('shield-check')} Zmień hasło</button></div>
            </form>
          </section>
        </div>
        <div class="stack">
          <section class="card">
            <div class="card-head"><h2>${icon('monitor-smartphone')} Aktywne sesje</h2></div>
            <ul class="list">${sessions.map((s) => `
              <li class="list-item"><span class="li-ic ${s.current ? 'green' : ''}">${icon(/Mobile|Android|iPhone/.test(s.userAgent) ? 'smartphone' : 'monitor')}</span><div><b>${esc(ua(s.userAgent))}</b><small>${esc(s.ip || '—')} · ${s.current ? 'to urządzenie' : `aktywna ${fmtRel(s.lastSeenAt)}`}</small></div>${s.current ? badge('Teraz', 'ok') : ''}</li>`).join('')}</ul>
            ${others ? `<div class="card-body" style="border-top:1px solid var(--border)"><button class="button btn-danger btn-sm button-block" id="logout-others">${icon('log-out')} Wyloguj pozostałe urządzenia (${others})</button></div>` : ''}
          </section>
          <section class="card card-pad">
            <b style="font-size:14px">Wygląd panelu</b>
            <p style="font-size:12.5px;margin-top:4px">Wybierz jasny lub ciemny motyw.</p>
            <div class="pill-choice" style="margin-top:12px">
              <label><input type="radio" name="theme" value="light"><span>${icon('sun')}&nbsp;Jasny</span></label>
              <label><input type="radio" name="theme" value="dark"><span>${icon('moon')}&nbsp;Ciemny</span></label>
            </div>
          </section>
          <section class="card card-pad">
            <b style="font-size:14px">Konto od ${fmtDate(user.createdAt)}</b>
            <p style="font-size:12.5px;margin-top:4px">Ostatnie logowanie: ${fmtDateTime(user.lastLoginAt)}</p>
            <button class="button button-light btn-sm button-block" data-logout style="margin-top:14px">${icon('log-out')} Wyloguj się</button>
          </section>
        </div>
      </div>`;

    const bindForm = (form, handler) => form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('[data-err]', form);
      err.innerHTML = '';
      $$('.field', form).forEach((f) => f.classList.remove('has-error'));
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try { await handler(Object.fromEntries(new FormData(form))); }
      catch (ex) {
        if (ex.message !== '401') {
          err.innerHTML = `${icon('circle-alert')} ${esc(ex.message)}`;
          Object.keys(ex.fields || {}).forEach((k) => form.elements[k]?.closest('.field')?.classList.add('has-error'));
        }
      } finally { btn.disabled = false; }
    });
    bindForm($('#profile-form'), async (data) => {
      const { user: u } = await api('/api/account', { method: 'PATCH', body: data });
      setUser(u); toast('Zapisano dane profilu.');
    });
    bindForm($('#password-form'), async (data) => {
      if (data.next !== data.repeat) { const e = new Error('Nowe hasła nie są identyczne.'); e.fields = { repeat: 1 }; throw e; }
      await api('/api/account/password', { method: 'POST', body: { current: data.current, next: data.next } });
      $('#password-form').reset();
      toast('Hasło zmienione. Pozostałe sesje zostały wylogowane.');
      router();
    });
    $('#logout-others')?.addEventListener('click', async () => {
      const r = await api('/api/account/sessions', { method: 'DELETE', body: {} });
      toast(`Wylogowano ${r.removed} ${plural(r.removed, 'sesję', 'sesje', 'sesji')}.`);
      router();
    });
    const cur = document.documentElement.getAttribute('data-theme');
    $$('input[name=theme]', view).forEach((r) => { r.checked = r.value === cur; r.addEventListener('change', () => setTheme(r.value)); });
  };

  // =========================================================
  // Nowe zgłoszenie (dialog)
  // =========================================================
  async function openNewTicket(projectId) {
    if (!state.projects) { try { state.projects = (await api('/api/tickets')).projects; } catch { state.projects = []; } }
    const dlg = document.createElement('dialog');
    dlg.className = 'app-dialog';
    dlg.setAttribute('aria-labelledby', 'nt-title');
    dlg.innerHTML = `
      <div class="dialog-head"><h2 id="nt-title">Nowe zgłoszenie</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon('x')}</button></div>
      <form class="dialog-body" novalidate>
        <p>Opisz sprawę — opiekun odpowie w wątku zgłoszenia.</p>
        <div class="form-grid">
          <div class="field full"><label for="nt-subject">Temat *</label><input id="nt-subject" name="subject" required minlength="4" maxlength="160" placeholder="Np. Dodanie nowej roli użytkownika"></div>
          <div class="field"><label for="nt-category">Kategoria</label><select id="nt-category" name="category">${Object.entries(TICKET_CAT).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          <div class="field"><label for="nt-project">Projekt</label><select id="nt-project" name="projectId"><option value="">— ogólne —</option>${state.projects.map((p) => `<option value="${p.id}"${String(p.id) === String(projectId) ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <fieldset class="field full" style="border:0;padding:0;margin:0"><legend style="font-size:11px;font-weight:700;color:var(--text-2);margin-bottom:7px">Priorytet</legend>
            <div class="pill-choice">${Object.entries(PRIORITY).map(([k, l]) => `<label><input type="radio" name="priority" value="${k}"${k === 'normalny' ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
          </fieldset>
          <div class="field full"><label for="nt-message">Opis *</label><textarea id="nt-message" name="message" required minlength="10" maxlength="5000" placeholder="Co się dzieje? Czego oczekujesz? Jeśli to błąd — jak go powtórzyć?"></textarea></div>
        </div>
        <div class="inline-error" data-err></div>
        <div class="form-actions"><button type="button" class="button button-light btn-sm" data-close>Anuluj</button><button type="submit" class="button button-coral btn-sm">${icon('send')} Wyślij zgłoszenie</button></div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    const close = () => { dlg.close(); };
    dlg.addEventListener('close', () => dlg.remove());
    $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', close));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    const form = $('form', dlg);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const err = $('[data-err]', form);
      err.innerHTML = '';
      $$('.field', form).forEach((f) => f.classList.remove('has-error'));
      if (data.subject.trim().length < 4) { form.elements.subject.closest('.field').classList.add('has-error'); err.innerHTML = `${icon('circle-alert')} Temat musi mieć min. 4 znaki.`; return; }
      if (data.message.trim().length < 10) { form.elements.message.closest('.field').classList.add('has-error'); err.innerHTML = `${icon('circle-alert')} Opis musi mieć min. 10 znaków.`; return; }
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try {
        const r = await api('/api/tickets', { method: 'POST', body: data });
        close();
        toast(`Zgłoszenie ${r.number} zostało utworzone.`);
        navigate(`/panel/zgloszenia/${r.id}`);
      } catch (ex) {
        if (ex.message !== '401') err.innerHTML = `${icon('circle-alert')} ${esc(ex.message)}`;
        btn.disabled = false;
      }
    });
    setTimeout(() => form.elements.subject.focus(), 50);
  }

  // =========================================================
  // Router
  // =========================================================
  const routes = [
    [/^\/panel\/?$/, 'dashboard'],
    [/^\/panel\/projekty\/?$/, 'projects'],
    [/^\/panel\/projekty\/(?<id>\d+)$/, 'project'],
    [/^\/panel\/zgloszenia\/?$/, 'tickets'],
    [/^\/panel\/zgloszenia\/nowe$/, 'tickets', { newTicket: true }],
    [/^\/panel\/zgloszenia\/(?<id>\d+)$/, 'ticket'],
    [/^\/panel\/faktury\/?$/, 'invoices'],
    [/^\/panel\/faktury\/(?<id>\d+)$/, 'invoice'],
    [/^\/panel\/dokumenty\/?$/, 'documents'],
    [/^\/panel\/konto\/?$/, 'account'],
  ];
  let renderId = 0;
  async function router() {
    const my = ++renderId;
    const path = location.pathname;
    const match = routes.map(([re, name, extra]) => { const m = path.match(re); return m && { name, params: m.groups || {}, extra }; }).find(Boolean);
    closeSidebar();
    if (!match) {
      setHeader('Nie znaleziono'); setNav('');
      view.innerHTML = emptyState('map-pin-off', 'Nie ma takiej strony', 'Sprawdź adres lub wróć do pulpitu.', `<a class="button button-dark btn-sm" href="/panel" data-link>${icon('layout-dashboard')} Pulpit</a>`);
      return;
    }
    if (!view.innerHTML.trim()) view.innerHTML = skeleton();
    view.classList.add('loading');
    try {
      await views[match.name](match.params);
      if (my !== renderId) return;
      if (match.extra?.newTicket) openNewTicket();
    } catch (err) {
      if (err.message === '401') return;
      if (my === renderId) view.innerHTML = `<section class="card">${errorState(err)}</section>`;
    } finally {
      if (my === renderId) view.classList.remove('loading');
    }
  }
  function navigate(url, replace = false) {
    if (url === location.pathname + location.search) { router(); return; }
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
    view.innerHTML = skeleton();
    scrollTo({ top: 0 });
    router().then(() => view.focus({ preventScroll: true }));
  }
  addEventListener('popstate', router);

  document.addEventListener('click', (e) => {
    const nt = e.target.closest('[data-new-ticket]');
    if (nt) { e.preventDefault(); openNewTicket(nt.dataset.project); return; }
    if (e.target.closest('[data-logout]')) { e.preventDefault(); logout(); return; }
    if (e.target.closest('[data-reload]')) { router(); return; }
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a')) { navigate(row.dataset.href); return; }
    const a = e.target.closest('a[data-link]');
    if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); navigate(a.getAttribute('href')); }
  });

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* ignoruj */ }
    location.assign('/logowanie?wylogowano=1');
  }

  // ---------- Menu mobilne i motyw ----------
  const sidebar = $('#sidebar'), backdrop = $('#sidebar-backdrop'), menuBtn = $('#menu-btn');
  function closeSidebar() { sidebar.classList.remove('open'); backdrop.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', () => { const o = !sidebar.classList.contains('open'); sidebar.classList.toggle('open', o); backdrop.classList.toggle('open', o); menuBtn.setAttribute('aria-expanded', String(o)); });
  backdrop.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSidebar(); });

  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('modulio-theme', t); } catch { /* brak dostępu */ }
    $('#theme-btn').innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
    const meta = $('meta[name=theme-color]'); if (meta) meta.content = t === 'dark' ? '#0f1512' : '#f3f4f1';
  }
  $('#theme-btn').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
  setTheme(document.documentElement.getAttribute('data-theme') || 'light');

  const topbar = $('#topbar');
  addEventListener('scroll', () => topbar.classList.toggle('scrolled', scrollY > 4), { passive: true });

  // ---------- Start ----------
  (async () => {
    view.innerHTML = skeleton();
    try {
      const { user } = await api('/api/auth/me');
      if (!user) { location.assign(`/logowanie?next=${encodeURIComponent(location.pathname)}`); return; }
      setUser(user);
      try { STAGES = (await api('/api/projects')).stages; } catch { /* ignoruj */ }
      await router();
      if (location.pathname !== '/panel') refreshBadges();
    } catch (err) {
      if (err.message !== '401') view.innerHTML = `<section class="card">${errorState(err)}</section>`;
    }
  })();
})();
