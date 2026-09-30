/* Modulio Admin — logowanie
   Tymczasowo: pola można zostawić puste i kliknąć „Zaloguj się”
   (działa, gdy w .env jest ADMIN_QUICK_LOGIN=true). */
(() => {
  'use strict';
  document.documentElement.classList.remove('no-js');
  const V = (document.currentScript?.src.match(/[?&]v=([^&]+)/) || [])[1] || '';
  const icon = (n) => `<svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=${V}#${n}"></use></svg>`;
  const form = document.getElementById('admin-login-form');
  const err = form.querySelector('.auth-error');
  const next = (() => { const n = new URLSearchParams(location.search).get('next') || ''; return /^\/admin(\/|$|\?)/.test(n) ? n : '/admin'; })();

  // Pola nie są już wymagane
  form.elements.email.required = false;
  form.elements.password.required = false;
  form.elements.email.placeholder = 'Na razie możesz zostawić puste';
  form.elements.password.placeholder = 'Na razie możesz zostawić puste';

  form.querySelector('.pw-toggle').addEventListener('click', (e) => {
    const input = form.elements.password;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    e.currentTarget.innerHTML = icon(show ? 'eye-off' : 'eye');
  });

  const showErr = (m) => { err.hidden = !m; err.innerHTML = m ? `${icon('circle-alert')}<span></span>` : ''; if (m) err.querySelector('span').textContent = m; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showErr('');
    const f = form.elements;
    const email = f.email.value.trim();
    const password = f.password.value;
    const btn = form.querySelector('button[type=submit]');
    const html = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = `${icon('loader-circle')} Logowanie…`;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'modulio' },
        // Puste pola = szybkie logowanie (serwer sprawdza ADMIN_QUICK_LOGIN)
        body: JSON.stringify({ email, password, remember: f.remember.checked, admin: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (!email && !password && res.status === 422) throw new Error('Szybkie logowanie jest wyłączone. Dodaj ADMIN_QUICK_LOGIN=true do pliku .env albo wpisz e-mail i hasło.');
        throw new Error(data.error || 'Nie udało się zalogować.');
      }
      location.assign(next);
    } catch (ex) {
      showErr(ex.message === 'Failed to fetch' ? 'Brak połączenia z serwerem.' : ex.message);
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      btn.disabled = false; btn.innerHTML = html;
    }
  });
  setTimeout(() => form.querySelector('button[type=submit]').focus(), 50);
})();
