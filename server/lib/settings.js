import { findAll, col } from '../db/index.js';
import { config } from '../config.js';

// Ustawienia edytowalne z panelu admina (kolekcja `settings`), wartości startowe ze zmiennych środowiskowych
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

let cache = DEFAULTS();

/** Wczytuje ustawienia z bazy do pamięci (przy starcie i po zmianie). */
export async function loadSettings() {
  const out = DEFAULTS();
  for (const r of await findAll('settings')) if (r.key in out) out[r.key] = r.value;
  cache = out;
  return out;
}

export const getSettings = () => cache;

export async function setSettings(patch) {
  const allowed = Object.keys(DEFAULTS());
  for (const [k, v] of Object.entries(patch || {})) {
    if (!allowed.includes(k)) continue;
    await col('settings').updateOne({ key: k }, { $set: { key: k, value: String(v ?? '') } }, { upsert: true });
  }
  return loadSettings();
}

export const setting = (k) => cache[k];
export const flag = (k) => cache[k] === '1';

export function company() {
  const s = cache;
  return { name: s.company_name, legalName: s.company_legal_name, address: s.company_address, nip: s.company_nip, bank: s.company_bank, email: s.contact_email, phone: s.contact_phone };
}
