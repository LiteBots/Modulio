import { insert, nowIso } from '../db/index.js';
import { clientIp } from './http.js';

/** Zapisuje zdarzenie w dzienniku (kto, co, na czym). Nie blokuje odpowiedzi. */
export function audit(req, user, action, entity = '', entityId = null, details = '') {
  insert('audit_log', {
    user_id: user?.id ?? null, user_name: user?.name ?? 'system', action, entity, entity_id: entityId,
    details: typeof details === 'string' ? details.slice(0, 500) : JSON.stringify(details).slice(0, 500),
    ip: req ? clientIp(req) : '', created_at: nowIso(),
  }).catch((e) => console.warn('[audit]', e.message));
}
