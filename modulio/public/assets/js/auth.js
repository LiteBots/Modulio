/* Modulio — logowanie i rejestracja */
(() => {
  'use strict';
  document.documentElement.classList.remove('no-js');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const V = (document.currentScript?.src.match(/[?&]v=([^&]+)/) || [])[1] || '';
  const icon = (n) => `<svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=${V}#${n}"></use></svg>`;

  const root = $('.auth-layout');
  const allowReg = root.dataset.allowReg === 'true';
  const loginForm = $('#form-login'), regForm = $('#form-register'), disabled = $('.auth-disabled');
  const tabs = $$('[role=tab]');
  const pill = $('.auth-tabs-pill');

  const params = new URLSearchParams(location.search);
  const next = (() => { const n = params.get('next') || ''; return /^\/panel(\/|$|\?)/.test(n) ? n : '/panel'; })();

  function setMode(mode, push = true) {
    const isLogin = mode === 'login';
    tabs.forEach((t) => {
      const on = t.dataset.tab === mode;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      t.classList.toggle('on', on);
    });
    pill.style.transform = isLogin ? 'translateX(0)' : 'translateX(100%)';
    loginForm.hidden = !isLogin;
    regForm.hidden = isLogin || !allowReg;
    disabled.hidden = isLogin || allowReg;
    document.title = isLogin ? 'Logowanie do panelu klienta — Modulio' : 'Załóż konto w panelu klienta — Modulio';
    if (push) history.replaceState(null, '', (isLogin ? '/logowanie' : '/rejestracja') + location.search);
    const first = (isLogin ? loginForm : regForm).querySelector('input:not([type=checkbox])');
    if (push && first && !(isLogin ? loginForm : regForm).hidden) setTimeout(() => first.focus(), 30);
  }
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.tab)));
  if (!allowReg) $$('[data-reg-only]').forEach((e) => { e.hidden = true; });
  setMode(root.dataset.mode, false);
  if (params.get('wylogowano')) showError(loginForm, 'Wylogowano pomyślnie.', true);
  if (params.get('next')) showError(loginForm, 'Zaloguj się, aby przejść do panelu.', true);

  // Pokaż / ukryj hasło
  $$('.pw-toggle').forEach((b) => b.addEventListener('click', () => {
    const input = b.previousElementSibling;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.innerHTML = icon(show ? 'eye-off' : 'eye');
    b.setAttribute('aria-label', show ? 'Ukryj hasło' : 'Pokaż hasło');
  }));

  // Siła hasła
  const pw = $('#reg-password'), meter = $$('.pw-meter i');
  pw?.addEventListener('input', () => {
    const v = pw.value;
    let s = 0;
    if (v.length >= 8) s++;
    if (/[a-ząćęłńóśźż]/i.test(v) && /\d/.test(v)) s++;
    if (/[A-ZĄĆĘŁŃÓŚŹŻ]/.test(v) && /[a-ząćęłńóśźż]/.test(v)) s++;
    if (v.length >= 12 || /[^\w\s]/.test(v)) s++;
    if (!v) s = 0;
    meter.forEach((m, i) => { m.className = i < s ? `on s${s}` : ''; });
  });

  function showError(form, msg, info = false) {
    const box = $('.auth-error', form);
    box.hidden = !msg;
    box.classList.toggle('info', info);
    box.innerHTML = msg ? `${icon(info ? 'info' : 'circle-alert')}<span></span>` : '';
    if (msg) box.querySelector('span').textContent = msg;
  }

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'modulio' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Coś poszło nie tak.'); e.fields = data.fields; throw e; }
    return data;
  }

  async function submit(form, url, body) {
    showError(form, '');
    $$('.field', form).forEach((f) => f.classList.remove('has-error'));
    const btn = $('button[type=submit]', form);
    const html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${icon('loader-circle')} Chwileczkę…`;
    try {
      await post(url, body);
      btn.innerHTML = `${icon('circle-check')} Gotowe`;
      location.assign(next);
    } catch (err) {
      showError(form, err.message === 'Failed to fetch' ? 'Brak połączenia z serwerem.' : err.message);
      Object.keys(err.fields || {}).forEach((k) => form.elements[k]?.closest('.field')?.classList.add('has-error'));
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      btn.disabled = false; btn.innerHTML = html;
    }
  }

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = loginForm.elements;
    if (!f.email.value.trim() || !f.password.value) return showError(loginForm, 'Podaj e-mail i hasło.');
    submit(loginForm, '/api/auth/login', { email: f.email.value.trim(), password: f.password.value, remember: f.remember.checked });
  });

  regForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = regForm.elements;
    if (!f.consent.checked) return showError(regForm, 'Zaakceptuj politykę prywatności.');
    submit(regForm, '/api/auth/register', { name: f.name.value, company: f.company.value, email: f.email.value.trim(), password: f.password.value, consent: true });
  });

  $('[data-demo]')?.addEventListener('click', () => {
    loginForm.elements.email.value = 'demo@modulio.pl';
    loginForm.elements.password.value = 'Demo1234!';
    loginForm.requestSubmit();
  });
})();
