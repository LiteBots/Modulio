import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT, config } from './config.js';
import { connectDb, closeDb, findOne, insert, nowIso, usingMemory } from './db/index.js';
import { handleApi } from './api/index.js';
import { getSession, isStaff, hashPassword } from './lib/auth.js';
import { securityHeaders, redirect } from './lib/http.js';
import { flag, setting, loadSettings } from './lib/settings.js';
import { render, renderHome, renderIndustry, sitemapXml, robotsTxt, esc } from './web/pages.js';
import { seedIfEmpty } from './db/seed.js';
import { newUserDoc } from './api/public.js';

const PUBLIC = path.join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};
const COMPRESSIBLE = /^(text\/|application\/(json|xml|manifest)|image\/svg)/;

// ---------- odpowiedzi z kompresją ----------
function sendBody(req, res, status, body, type, cacheControl, extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const headers = { 'Content-Type': type, 'Cache-Control': cacheControl, Vary: 'Accept-Encoding', ...extra };
  const ae = String(req.headers['accept-encoding'] || '');
  let out = buf;
  if (COMPRESSIBLE.test(type) && buf.length > 1024) {
    if (/\bbr\b/.test(ae)) {
      out = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
      headers['Content-Encoding'] = 'br';
    } else if (/\bgzip\b/.test(ae)) {
      out = zlib.gzipSync(buf, { level: 6 });
      headers['Content-Encoding'] = 'gzip';
    }
  }
  headers['Content-Length'] = out.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : out);
}

const html = (req, res, body, status = 200) =>
  sendBody(req, res, status, body, MIME['.html'], 'no-cache');

// ---------- pliki statyczne ----------
const staticCache = new Map(); // ścieżka -> { mtime, buf, br, gz, etag }
function serveStatic(req, res, pathname) {
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return false;
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;

  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); res.end(); return true; }

  // Pliki wersjonowane (?v=) można cache'ować długo
  const versioned = /[?&]v=/.test(req.url);
  const cacheControl = versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=3600, must-revalidate';

  let entry = staticCache.get(file);
  if (!entry || entry.mtime !== st.mtimeMs) {
    entry = { mtime: st.mtimeMs, buf: fs.readFileSync(file) };
    if (COMPRESSIBLE.test(type) && entry.buf.length > 1024) {
      entry.br = zlib.brotliCompressSync(entry.buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } });
      entry.gz = zlib.gzipSync(entry.buf, { level: 9 });
    }
    staticCache.set(file, entry);
  }
  const ae = String(req.headers['accept-encoding'] || '');
  const headers = { 'Content-Type': type, 'Cache-Control': cacheControl, ETag: etag, Vary: 'Accept-Encoding' };
  let out = entry.buf;
  if (entry.br && /\bbr\b/.test(ae)) { out = entry.br; headers['Content-Encoding'] = 'br'; }
  else if (entry.gz && /\bgzip\b/.test(ae)) { out = entry.gz; headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = out.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : out);
  return true;
}

// ---------- strony ----------
const notFound = (req, res) => html(req, res, render('site/404', { path: req.url, title: 'Nie znaleziono strony — Modulio', robots: 'noindex', bodyClass: 'subpage' }), 404);

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  res.on('finish', () => {
    if (!config.isProd || res.statusCode >= 500) console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
  });
  securityHeaders(res);

  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  const p = url.pathname;

  try {
    if (p.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }

    // Usuwanie końcowego ukośnika (kanoniczne adresy)
    if (p.length > 1 && p.endsWith('/')) return redirect(res, p.replace(/\/+$/, '') + url.search, 301);

    // ---------- Panel zarządzania /admin ----------
    if (p === '/admin/logowanie') {
      const s = await getSession(req);
      if (s && isStaff(s.user) && !s.impersonatorId) return redirect(res, '/admin');
      return html(req, res, render('admin/login', { path: p, title: 'Logowanie — Modulio Admin', robots: 'noindex, nofollow', bodyClass: 'auth-page admin-auth' }));
    }
    if (p === '/admin' || p.startsWith('/admin/')) {
      const s = await getSession(req);
      if (!s || !isStaff(s.user) || s.impersonatorId) return redirect(res, `/admin/logowanie?next=${encodeURIComponent(p + url.search)}`);
      return html(req, res, render('admin/app', { path: '/admin', title: 'Modulio Admin', robots: 'noindex, nofollow', bodyClass: 'app-page admin-page' }));
    }

    // ---------- Tryb serwisowy (strona publiczna i panel klienta) ----------
    if (flag('maintenance_mode') && !p.startsWith('/assets/') && !['/robots.txt', '/healthz', '/site.webmanifest', '/logowanie'].includes(p)) {
      const s = await getSession(req);
      if (!s || !isStaff(s.user)) {
        res.setHeader('Retry-After', '3600');
        return html(req, res, render('site/maintenance', { path: p, title: 'Prace techniczne — Modulio', robots: 'noindex', raw: { MESSAGE: esc(setting('maintenance_message')) } }), 503);
      }
    }

    switch (p) {
      case '/': return html(req, res, renderHome());
      case '/sitemap.xml': return sendBody(req, res, 200, sitemapXml(), MIME['.xml'], 'public, max-age=3600');
      case '/robots.txt': return sendBody(req, res, 200, robotsTxt(), MIME['.txt'], 'public, max-age=3600');
      case '/healthz': return sendBody(req, res, 200, 'ok', MIME['.txt'], 'no-store');
      case '/polityka-prywatnosci':
        return html(req, res, render('site/privacy', { path: p, title: 'Polityka prywatności — Modulio', description: 'Zasady przetwarzania danych osobowych i plików cookies w serwisie Modulio.', bodyClass: 'subpage' }));
      case '/logowanie':
      case '/rejestracja': {
        if (await getSession(req)) return redirect(res, '/panel');
        return html(req, res, render('auth/login', {
          path: p, robots: 'noindex, follow',
          title: p === '/logowanie' ? 'Logowanie do panelu klienta — Modulio' : 'Załóż konto w panelu klienta — Modulio',
          description: 'Panel klienta Modulio: projekty, zgłoszenia, faktury i dokumenty w jednym miejscu.',
          bodyClass: 'auth-page',
          raw: {
            AUTH_MODE: p === '/logowanie' ? 'login' : 'register',
            ALLOW_REG: String(flag('allow_registration')),
            DEMO_HINT: config.seedDemo
              ? '<button type="button" class="demo-hint" data-demo><span class="demo-ic"><i data-lucide="sparkles"></i></span><span><b>Zobacz panel na danych demo</b><small>demo@modulio.pl · Demo1234!</small></span><i data-lucide="arrow-right"></i></button>'
              : '',
          },
        }));
      }
    }

    if (p === '/panel' || p.startsWith('/panel/')) {
      if (!(await getSession(req))) return redirect(res, `/logowanie?next=${encodeURIComponent(p + url.search)}`);
      return html(req, res, render('client/panel', { path: '/panel', title: 'Panel klienta — Modulio', robots: 'noindex, nofollow', bodyClass: 'app-page' }));
    }

    if (p === '/branze') return redirect(res, '/#rozwiazania', 301);
    const ind = p.match(/^\/branze\/([a-z-]+)$/);
    if (ind) {
      const page = renderIndustry(ind[1]);
      return page ? html(req, res, page) : notFound(req, res);
    }

    // favicon.ico → svg
    if (p === '/favicon.ico') return redirect(res, '/assets/img/favicon.svg', 301);

    if (serveStatic(req, res, p)) return;
    return notFound(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Błąd serwera'); }
  }
});

server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

// ---------- Start: baza → ustawienia → dane demo → konto admina → serwer ----------
try {
  await connectDb();
} catch (err) {
  console.error('\n  ✖ Nie udało się połączyć z MongoDB:', err.message);
  console.error('    Sprawdź zmienną MONGO_URL (Railway → Variables).\n');
  process.exit(1);
}
await loadSettings();
if (config.seedDemo) await seedIfEmpty();

// Pierwsze konto administratora ze zmiennych ADMIN_EMAIL / ADMIN_PASSWORD (tworzone tylko, gdy nie istnieje)
if (config.admin.email && config.admin.password) {
  const mail = config.admin.email.trim().toLowerCase();
  if (!(await findOne('users', { email: mail }))) {
    await insert('users', newUserDoc({ email: mail, password_hash: await hashPassword(config.admin.password), name: config.admin.name, company: 'Modulio', role: 'admin', created_at: nowIso() }));
    console.log(`  [admin] Utworzono konto administratora: ${mail}`);
  }
}

server.listen(config.port, config.host, () => {
  console.log(`\n  Modulio działa na porcie ${config.port}  →  ${config.siteUrl}`);
  console.log(`  Tryb: ${config.isProd ? 'produkcja' : 'deweloperski'}${config.onRailway ? ' (Railway)' : ''} · baza: ${usingMemory ? 'w pamięci' : 'MongoDB'}`);
  if (config.adminQuickLogin) console.log('  ⚠ ADMIN_QUICK_LOGIN=true — logowanie do /admin bez hasła jest WŁĄCZONE');
  if (config.seedDemo) {
    console.log('  Klient demo:   demo@modulio.pl  / Demo1234!   → /panel');
    console.log('  Administrator: admin@modulio.pl / Admin1234!  → /admin\n');
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(async () => { await closeDb().catch(() => {}); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); });
