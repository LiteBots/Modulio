import { config } from '../config.js';

export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

export function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

export function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const type = req.headers['content-type'] || '';
    if (!type.includes('application/json')) return reject(new HttpError(415, 'Oczekiwano danych JSON.'));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Za duże żądanie.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Nieprawidłowy JSON.')); }
    });
    req.on('error', reject);
  });
}

export function clientIp(req) {
  if (config.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

export function isSecureRequest(req) {
  if (config.trustProxy && req.headers['x-forwarded-proto'] === 'https') return true;
  return Boolean(req.socket.encrypted);
}

// ---------- Walidacja ----------
export function text(body, key, { label = key, min = 0, max = 500, required = false } = {}) {
  const raw = body?.[key];
  const v = raw === undefined || raw === null ? '' : String(raw).trim();
  if (!v) {
    if (required) throw new HttpError(422, `Pole „${label}” jest wymagane.`, { [key]: 'Wymagane' });
    return '';
  }
  if (v.length < min) throw new HttpError(422, `Pole „${label}” jest za krótkie (min. ${min} znaków).`, { [key]: `Min. ${min} znaków` });
  if (v.length > max) throw new HttpError(422, `Pole „${label}” jest za długie (maks. ${max} znaków).`, { [key]: `Maks. ${max} znaków` });
  return v;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function email(body, key = 'email') {
  const v = text(body, key, { label: 'E-mail', max: 190, required: true }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw new HttpError(422, 'Podaj poprawny adres e-mail.', { [key]: 'Niepoprawny e-mail' });
  return v;
}

export function oneOf(body, key, allowed, fallback) {
  const v = body?.[key];
  if (v === undefined || v === '' || v === null) {
    if (fallback !== undefined) return fallback;
    throw new HttpError(422, `Pole „${key}” jest wymagane.`, { [key]: 'Wymagane' });
  }
  if (!allowed.includes(v)) throw new HttpError(422, `Nieprawidłowa wartość pola „${key}”.`, { [key]: 'Niepoprawna wartość' });
  return v;
}

export function password(body, key = 'password') {
  const v = String(body?.[key] ?? '');
  if (v.length < 8) throw new HttpError(422, 'Hasło musi mieć co najmniej 8 znaków.', { [key]: 'Min. 8 znaków' });
  if (v.length > 200) throw new HttpError(422, 'Hasło jest za długie.', { [key]: 'Za długie' });
  if (!/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/.test(v) || !/\d/.test(v)) {
    throw new HttpError(422, 'Hasło musi zawierać literę i cyfrę.', { [key]: 'Litera + cyfra' });
  }
  return v;
}
