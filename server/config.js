import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Na Railway wszystkie ustawienia przychodzą jako zmienne środowiskowe (Variables).
// Plik .env jest opcjonalny i służy tylko do pracy lokalnej (nie trafia na GitHuba).
function loadLocalEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadLocalEnv();

const env = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const onRailway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID);
const port = Number(env.PORT || 3000);
const siteUrl = (env.SITE_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`)).replace(/\/+$/, '');
const isProd = env.NODE_ENV === 'production' || onRailway;
const mongoUrl = env.MONGO_URL || env.MONGODB_URI || env.MONGO_PUBLIC_URL || '';

export const config = {
  port,
  host: env.HOST || '0.0.0.0',
  siteUrl,
  isProd,
  onRailway,
  version: `${pkg.version}-${Date.now().toString(36)}`,
  mongoUrl,
  mongoDbName: env.MONGO_DB_NAME || 'modulio',
  // Dane demo: domyślnie tylko lokalnie bez bazy. Na Railway włączysz je zmienną SEED_DEMO=true.
  seedDemo: bool(env.SEED_DEMO, !mongoUrl && !isProd),
  trustProxy: bool(env.TRUST_PROXY, onRailway),
  cookieSecure: bool(env.COOKIE_SECURE, siteUrl.startsWith('https://')),
  allowRegistration: bool(env.ALLOW_REGISTRATION, true),
  adminQuickLogin: bool(env.ADMIN_QUICK_LOGIN, false),
  leadWebhookUrl: env.LEAD_WEBHOOK_URL || '',
  admin: { email: env.ADMIN_EMAIL || '', password: env.ADMIN_PASSWORD || '', name: env.ADMIN_NAME || 'Administrator' },
  company: {
    legalName: env.COMPANY_LEGAL_NAME || 'Modulio sp. z o.o.',
    address: env.COMPANY_ADDRESS || 'ul. Przykładowa 1, 00-001 Warszawa',
    nip: env.COMPANY_NIP || '000-000-00-00',
    bank: env.COMPANY_BANK || '00 0000 0000 0000 0000 0000 0000',
    email: env.CONTACT_EMAIL || 'kontakt@modulio.pl',
    phone: env.CONTACT_PHONE || '+48 000 000 000',
  },
};
