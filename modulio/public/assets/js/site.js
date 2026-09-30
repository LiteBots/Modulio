/* Modulio — skrypty strony publicznej (bez zależności) */
(() => {
  'use strict';
  document.documentElement.classList.remove('no-js');

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const V = (document.currentScript?.src.match(/[?&]v=([^&]+)/) || [])[1] || '';
  const icon = (name) => `<svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=${V}#${name}"></use></svg>`;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Toast ----------
  function toast(msg, type = 'ok') {
    const host = $('#toast-host') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'toast-host', className: 'toast-host' }));
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${icon(type === 'ok' ? 'circle-check' : 'circle-alert')}<span></span>`;
    el.querySelector('span').textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 4200);
  }

  // ---------- Nagłówek ----------
  const header = $('#site-header');
  let lastY = scrollY;
  addEventListener('scroll', () => {
    const y = scrollY;
    header?.classList.toggle('is-scrolled', y > 20);
    header?.classList.toggle('is-hidden', y > 500 && y > lastY + 4 && !$('#main-nav')?.classList.contains('open'));
    if (y < lastY - 4 || y < 500) header?.classList.remove('is-hidden');
    lastY = y;
  }, { passive: true });

  const menuToggle = $('#menu-toggle');
  const nav = $('#main-nav');
  const setMenu = (open) => {
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Zamknij menu' : 'Otwórz menu');
    menuToggle.innerHTML = icon(open ? 'x' : 'menu');
    nav.classList.toggle('open', open);
  };
  menuToggle?.addEventListener('click', () => setMenu(menuToggle.getAttribute('aria-expanded') !== 'true'));
  $$('a', nav).forEach((a) => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav?.classList.contains('open')) setMenu(false); });

  // Wskaźnik aktywnej pozycji menu (desktop)
  const indicator = $('.nav-indicator');
  const moveIndicator = (el) => {
    if (!indicator || innerWidth <= 960) return;
    const r = el.getBoundingClientRect(), pr = nav.getBoundingClientRect();
    indicator.style.width = `${r.width}px`;
    indicator.style.left = `${r.left - pr.left}px`;
    indicator.style.opacity = '1';
  };
  $$('a:not(.nav-mobile-only)', nav).forEach((a) => a.addEventListener('mouseenter', () => moveIndicator(a)));
  nav?.addEventListener('mouseleave', () => { if (indicator) indicator.style.opacity = '0'; });

  // Scrollspy
  const navLinks = $$('a[href^="/#"]', nav);
  const sections = navLinks.map((a) => document.getElementById(a.getAttribute('href').slice(2))).filter(Boolean);
  if (sections.length && 'IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        navLinks.forEach((a) => a.classList.toggle('is-current', a.getAttribute('href') === `/#${en.target.id}`));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => spy.observe(s));
  }

  // Stan zalogowania w nagłówku
  fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => r.json()).then(({ user }) => {
    if (!user) return;
    $$('[data-auth-link]').forEach((a) => { a.href = '/panel'; if (!a.querySelector('[data-auth-label]')) a.textContent = 'Panel klienta'; });
    $$('[data-auth-label]').forEach((s) => { s.textContent = 'Panel klienta'; });
  }).catch(() => {});

  // ---------- Animacje wejścia ----------
  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window && !reduced) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    reveals.forEach((el) => io.observe(el));
  } else reveals.forEach((el) => el.classList.add('is-in'));

  // Liczniki
  const fmt = new Intl.NumberFormat('pl-PL');
  const counters = $$('[data-count]');
  const runCounter = (el) => {
    const target = Number(el.dataset.count);
    if (reduced) { el.textContent = fmt.format(target); return; }
    const t0 = performance.now(), dur = 1400;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = fmt.format(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window) {
    const co = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { runCounter(en.target); co.unobserve(en.target); } }), { threshold: 0.4 });
    counters.forEach((c) => co.observe(c));
  }
  setTimeout(() => document.body.classList.add('is-ready'), 50);

  // Dzisiejsza data w podglądzie
  const todayEl = $('[data-today]');
  if (todayEl) todayEl.textContent = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).replace(/^\w/, (c) => c.toUpperCase()).replace(',', ' ·');

  // ---------- Zakładki branż (ARIA tabs) ----------
  const tablist = $('#industry-tabs');
  if (tablist) {
    const tabs = $$('[role="tab"]', tablist);
    const activate = (tab, focus) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        panel.hidden = !on;
        if (on) { panel.classList.remove('is-entering'); void panel.offsetWidth; panel.classList.add('is-entering'); }
      });
      if (focus) tab.focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => activate(t));
      t.addEventListener('keydown', (e) => {
        const k = e.key;
        let n = null;
        if (k === 'ArrowDown' || k === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
        if (k === 'ArrowUp' || k === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
        if (k === 'Home') n = tabs[0];
        if (k === 'End') n = tabs[tabs.length - 1];
        if (n) { e.preventDefault(); activate(n, true); }
      });
    });
  }

  // ---------- Moduły w przepływie ----------
  const moduleButtons = $$('.module-button');
  const flowSteps = $$('.flow-step');
  let autoFlow = null;
  const setFlow = (idx) => {
    moduleButtons.forEach((b, i) => { b.classList.toggle('active', i === idx); b.setAttribute('aria-pressed', String(i === idx)); });
    flowSteps.forEach((s, i) => s.classList.toggle('active', i === idx));
  };
  moduleButtons.forEach((b, i) => b.addEventListener('click', () => { clearInterval(autoFlow); setFlow(i); }));
  if (flowSteps.length && !reduced && 'IntersectionObserver' in window) {
    let idx = 0;
    const fo = new IntersectionObserver(([en]) => {
      clearInterval(autoFlow);
      if (en.isIntersecting) autoFlow = setInterval(() => { idx = (idx + 1) % flowSteps.length; setFlow(idx); }, 2600);
    }, { threshold: 0.4 });
    fo.observe($('.process-canvas'));
    moduleButtons.forEach((b) => b.addEventListener('click', () => fo.disconnect(), { once: true }));
  }

  // ---------- Kontakt ----------
  const topic = $('#topic');
  function goToContact(type) {
    const contact = $('#kontakt');
    if (!contact) { location.href = '/#kontakt'; return; }
    if (type && topic) {
      const match = [...topic.options].find((o) => o.textContent === type);
      topic.value = match ? match.textContent : 'Dobór systemu Modulio';
    }
    contact.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    setTimeout(() => $('#name')?.focus({ preventScroll: true }), 650);
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open-contact]');
    if (!btn) return;
    if (!$('#kontakt')) return; // podstrona — link prowadzi do /#kontakt
    e.preventDefault();
    goToContact(btn.dataset.contactType || '');
  });

  const form = $('#contact-form');
  const status = $('#form-status');
  const wrap = $('#contact-wrap');
  const setFieldError = (name, msg) => {
    const f = form.elements[name]?.closest('.field');
    if (f) f.classList.toggle('has-error', !!msg);
    const out = $(`[data-error-for="${name}"]`, form);
    if (out) out.textContent = msg || '';
  };
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    ['name', 'email', 'message'].forEach((n) => setFieldError(n, ''));
    status.className = 'form-status'; status.textContent = '';
    let bad = false;
    if (form.elements.name.value.trim().length < 2) { setFieldError('name', 'Podaj imię i nazwisko lub nazwę firmy.'); bad = true; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.elements.email.value.trim())) { setFieldError('email', 'Podaj poprawny adres e-mail.'); bad = true; }
    if (form.elements.message.value.trim().length < 10) { setFieldError('message', 'Opisz proces w kilku zdaniach (min. 10 znaków).'); bad = true; }
    if (!form.elements.consent.checked) { status.className = 'form-status err'; status.innerHTML = `${icon('circle-alert')} Zaznacz zgodę na kontakt.`; bad = true; }
    if (bad) { form.querySelector('.has-error input, .has-error textarea')?.focus(); return; }

    const btn = form.querySelector('button[type=submit]');
    const original = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = `${icon('loader-circle')} Wysyłanie…`;
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.consent = form.elements.consent.checked;
    try {
      const res = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'modulio' }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        Object.entries(data.fields || {}).forEach(([k, v]) => setFieldError(k, v));
        throw new Error(data.error || 'Nie udało się wysłać wiadomości.');
      }
      form.reset();
      wrap.classList.add('is-sent');
      $('.form-success', wrap)?.focus();
    } catch (err) {
      status.className = 'form-status err';
      status.innerHTML = `${icon('circle-alert')} <span></span>`;
      status.querySelector('span').textContent = err.message === 'Failed to fetch' ? 'Brak połączenia. Spróbuj ponownie.' : err.message;
    } finally { btn.disabled = false; btn.innerHTML = original; }
  });
  $('[data-reset-contact]')?.addEventListener('click', () => { wrap.classList.remove('is-sent'); $('#name')?.focus(); });

  // ---------- Konfigurator ----------
  const modal = $('#config-modal');
  if (modal) {
    const steps = $$('.config-step', modal);
    const progress = $$('.progress-step', modal);
    const nextBtn = $('#config-next'), backBtn = $('#config-back');
    const timeline = $('#timeline'), timelineLabel = $('#timeline-label');
    const timelineMap = { 1: 'Jak najszybciej', 2: '1–2 miesiące', 3: '2–4 miesiące', 4: 'Bez presji czasowej' };
    let current = 1, lastFocus = null;
    timeline.addEventListener('input', () => { timelineLabel.textContent = timelineMap[timeline.value]; });

    const open = () => {
      lastFocus = document.activeElement;
      modal.hidden = false; modal.classList.add('is-open'); document.body.classList.add('modal-open');
      show(1);
      setTimeout(() => $('input, button', steps[0])?.focus(), 50);
      if (location.hash !== '#konfigurator') history.replaceState(null, '', '#konfigurator');
    };
    const close = () => {
      modal.classList.remove('is-open'); modal.hidden = true; document.body.classList.remove('modal-open');
      if (location.hash === '#konfigurator') history.replaceState(null, '', location.pathname + location.search);
      lastFocus?.focus?.();
    };
    function show(step) {
      current = step;
      steps.forEach((s) => s.classList.toggle('active', Number(s.dataset.step) === step));
      progress.forEach((p) => { const n = Number(p.dataset.progress); p.classList.toggle('active', n === step); p.classList.toggle('done', n < step); });
      $('#config-bar').style.width = `${step * 20}%`;
      $('#config-step-label').textContent = `Krok ${step} z 5 · Wstępny brief`;
      backBtn.style.visibility = step === 1 ? 'hidden' : 'visible';
      nextBtn.innerHTML = step === 5 ? `${icon('send')} Przenieś do formularza` : `Dalej ${icon('arrow-right')}`;
      if (step === 5) buildSummary();
    }
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-open-config]');
      if (!b) return;
      e.preventDefault(); open();
    });
    $('[data-close-config]', modal).addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => {
      if (!modal.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') { // pułapka fokusu
        const f = $$('button, input, select, textarea, a[href]', modal).filter((x) => x.offsetParent !== null && !x.disabled);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    nextBtn.addEventListener('click', () => {
      if (current < 5) return show(current + 1);
      const text = buildSummary(true);
      close();
      topic.value = 'Dobór systemu Modulio';
      $('#message').value = `Wstępna konfiguracja Modulio:\n\n${text}\n\nDodatkowe informacje: `;
      form.elements.source.value = 'konfigurator';
      goToContact();
      toast('Brief przeniesiony do formularza — uzupełnij dane kontaktowe.');
    });
    backBtn.addEventListener('click', () => { if (current > 1) show(current - 1); });
    if (location.hash === '#konfigurator') open();

    const checked = (sel) => $$(`${sel} input:checked`).map((x) => x.value);
    function buildSummary(asText = false) {
      const type = $('input[name=solutionType]:checked').value;
      const industry = $('#cfg-industry').value;
      const sizeSel = $('#cfg-company-size'), locSel = $('#cfg-locations');
      const users = Math.max(1, Number($('#cfg-users').value || 1));
      const modules = checked('#module-choices');
      const integrations = checked('#integration-choices');
      const custom = /dedykowane|rozszerzenia/.test(type);
      const complexity = Number(sizeSel.value) + Number(locSel.value) + modules.length + integrations.length * 2 + (custom ? 4 : 0) + (users > 25 ? 3 : 0);
      let estimate = 'od 99 zł / mies.', note = 'Najmniejszy wariant modułowy. Wdrożenie wyceniane osobno po rozmowie.';
      if (type === 'Oprogramowanie dedykowane' || complexity >= 15) { estimate = 'wycena indywidualna'; note = 'Zakres wskazuje na projekt dedykowany lub mocno rozszerzony. Cena zależy od analizy funkcji i integracji.'; }
      else if (complexity >= 8 || users > 3) { estimate = 'od 199 zł / mies.'; note = 'Najbardziej prawdopodobny punkt startowy to wariant Business lub rozszerzony zestaw modułów.'; }
      const rows = [
        ['Kierunek', type], ['Branża', industry], ['Skala', sizeSel.selectedOptions[0].textContent], ['Lokalizacje', locSel.selectedOptions[0].textContent],
        ['Użytkownicy', users], ['Moduły', modules.length ? modules.join(', ') : 'do ustalenia'],
        ['Integracje', integrations.length ? integrations.join(', ') : 'brak wskazanych'], ['Tempo', timelineMap[timeline.value]],
      ];
      const list = $('#config-summary');
      list.textContent = '';
      rows.forEach(([k, v]) => {
        const row = document.createElement('div'); row.className = 'summary-row';
        const a = document.createElement('span'); a.textContent = k;
        const b = document.createElement('b'); b.textContent = v;
        row.append(a, b); list.append(row);
      });
      $('#estimate-price').textContent = estimate;
      $('#estimate-note').textContent = note;
      $('#estimate-meter').style.width = `${Math.min(100, 12 + complexity * 5)}%`;
      return asText ? rows.map(([k, v]) => `${k}: ${v}`).join('\n') : undefined;
    }
  } else {
    // Podstrony: przyciski konfiguratora prowadzą na stronę główną
    $$('[data-open-config]').forEach((a) => { if (a.tagName === 'A') a.setAttribute('href', '/#konfigurator'); });
  }
})();
