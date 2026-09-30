import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimalny loader .env (bez zależności)
function loadEnv() {
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
loadEnv();

const env = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const port = Number(env.PORT || 3000);
const siteUrl = (env.SITE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
const isProd = env.NODE_ENV === 'production';

export const config = {
  port,
  host: env.HOST || '0.0.0.0',
  siteUrl,
  isProd,
  version: `${pkg.version}-${Date.now().toString(36)}`,
  allowRegistration: bool(env.ALLOW_REGISTRATION, true),
  seedDemo: bool(env.SEED_DEMO, !isProd),
  trustProxy: bool(env.TRUST_PROXY, false),
  cookieSecure: bool(env.COOKIE_SECURE, siteUrl.startsWith('https://')),
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  leadWebhookUrl: env.LEAD_WEBHOOK_URL || '',
  company: {
    name: env.COMPANY_NAME || 'Modulio',
    legalName: env.COMPANY_LEGAL_NAME || 'Modulio sp. z o.o.',
    address: env.COMPANY_ADDRESS || 'ul. Przykładowa 1, 00-001 Warszawa',
    nip: env.COMPANY_NIP || '000-000-00-00',
    bank: env.COMPANY_BANK || '00 0000 0000 0000 0000 0000 0000',
    email: env.CONTACT_EMAIL || 'kontakt@modulio.pl',
    phone: env.CONTACT_PHONE || '+48 000 000 000',
  },
};
