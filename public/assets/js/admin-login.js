/* Modulio Admin — logowanie */
(() => {
  'use strict';
  document.documentElement.classList.remove('no-js');
  const V = (document.currentScript?.src.match(/[?&]v=([^&]+)/) || [])[1] || '';
  const icon = (n) => `<svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=${V}#${n}"></use></svg>`;
  const form = document.getElementById('admin-login-form');
  const err = form.querySelector('.auth-error');
  const next = (() => { const n = new URLSearchParams(location.search).get('next') || ''; return /^\/admin(\/|$|\?)/.test(n) ? n : '/admin'; })();

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
    if (!f.email.value.trim() || !f.password.value) return showErr('Podaj e-mail i hasło.');
    const btn = form.querySelector('button[type=submit]');
    const html = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = `${icon('loader-circle')} Logowanie…`;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'modulio' },
        body: JSON.stringify({ email: f.email.value.trim(), password: f.password.value, remember: f.remember.checked, admin: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Nie udało się zalogować.');
      location.assign(next);
    } catch (ex) {
      showErr(ex.message === 'Failed to fetch' ? 'Brak połączenia z serwerem.' : ex.message);
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      btn.disabled = false; btn.innerHTML = html;
    }
  });
  if (new URLSearchParams(location.search).get('next')) showErr('');
  setTimeout(() => form.elements.email.focus(), 50);
})();
