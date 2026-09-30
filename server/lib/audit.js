import { q, nowIso } from '../db/index.js';
import { clientIp } from './http.js';

/** Zapisuje zdarzenie w dzienniku (kto, co, na czym). */
export function audit(req, user, action, entity = '', entityId = null, details = '') {
  try {
    q(`INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, details, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      user?.id ?? null, user?.name ?? 'system', action, entity, entityId,
      typeof details === 'string' ? details.slice(0, 500) : JSON.stringify(details).slice(0, 500),
      req ? clientIp(req) : '', nowIso(),
    );
  } catch (e) { console.warn('[audit]', e.message); }
}
