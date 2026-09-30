import { q } from '../db/index.js';
import { config } from '../config.js';

// Ustawienia edytowalne z panelu admina (nadpisują wartości z .env)
const DEFAULTS = () => ({
  company_name: 'Modulio',
  company_legal_name: config.company.legalName,
  company_address: config.company.address,
  company_nip: config.company.nip,
  company_bank: config.company.bank,
  contact_email: config.company.email,
  contact_phone: config.company.phone,
  allow_registration: config.allowRegistration ? '1' : '0',
  maintenance_mode: '0',
  maintenance_message: 'Trwają prace techniczne. Wrócimy za chwilę.',
  invoice_due_days: '14',
  lead_webhook_url: config.leadWebhookUrl,
});

let cache = null;
export function getSettings() {
  if (cache) return cache;
  const out = DEFAULTS();
  for (const r of q('SELECT key, value FROM settings').all()) if (r.key in out) out[r.key] = r.value;
  cache = out;
  return out;
}

export function setSettings(patch) {
  const allowed = Object.keys(DEFAULTS());
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue;
    q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v ?? ''));
  }
  cache = null;
  return getSettings();
}

export const setting = (k) => getSettings()[k];
export const flag = (k) => getSettings()[k] === '1';

export function company() {
  const s = getSettings();
  return { name: s.company_name, legalName: s.company_legal_name, address: s.company_address, nip: s.company_nip, bank: s.company_bank, email: s.contact_email, phone: s.contact_phone };
}
