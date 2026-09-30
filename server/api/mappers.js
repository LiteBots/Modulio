import { today } from '../db/index.js';
import { invoiceTotals, round2 } from '../lib/money.js';
import { STAGES, ticketNo } from './router.js';

const json = (s, d) => { if (Array.isArray(s)) return s; try { return JSON.parse(s ?? ''); } catch { return d; } };

export function invoiceStatus(inv) {
  if (inv.status === 'oczekuje' && inv.due_date < today()) return 'po_terminie';
  return inv.status;
}

export function mapInvoice(inv, withItems = false) {
  const items = json(inv.items, []);
  const totals = invoiceTotals(items, inv.discount_pct);
  const out = {
    id: inv.id, number: inv.number, issueDate: inv.issue_date, dueDate: inv.due_date,
    status: invoiceStatus(inv), paidAt: inv.paid_at, projectId: inv.project_id,
    projectName: inv.project_name || null, userId: inv.user_id, clientName: inv.client_name || undefined,
    discountCode: inv.discount_code || '', discountPct: inv.discount_pct || 0,
    paidAmount: inv.paid_amount !== undefined ? round2(inv.paid_amount) : undefined,
    ...totals,
  };
  if (withItems) out.items = items;
  return out;
}

export function mapProject(p) {
  return {
    id: p.id, userId: p.user_id, clientName: p.client_name || undefined, name: p.name, kind: p.kind, stage: p.stage,
    stageLabel: STAGES.find((s) => s.key === p.stage)?.label || p.stage, priority: p.priority || 'normalny',
    progress: p.progress, budget: p.budget || 0, description: p.description, modules: json(p.modules, []),
    manager: p.manager, startDate: p.start_date, dueDate: p.due_date, createdAt: p.created_at,
    milestonesTotal: p.milestones_total ?? undefined, milestonesDone: p.milestones_done ?? undefined,
    openTickets: p.open_tickets ?? undefined,
  };
}

export function mapTicket(t) {
  return {
    id: t.id, number: ticketNo(t.id), subject: t.subject, category: t.category, priority: t.priority,
    status: t.status, projectId: t.project_id, projectName: t.project_name || null,
    userId: t.user_id, clientName: t.client_name || undefined, clientEmail: t.client_email || undefined,
    assignedTo: t.assigned_to ?? null, assignedName: t.assigned_name || null,
    createdAt: t.created_at, updatedAt: t.updated_at, messagesCount: t.messages_count ?? undefined,
    lastAuthor: t.last_author ?? undefined,
  };
}

export function mapDocument(d) {
  return {
    id: d.id, userId: d.user_id, clientName: d.client_name || undefined, name: d.name, category: d.category,
    filename: d.filename, mime: d.mime, size: d.size, projectId: d.project_id, projectName: d.project_name || null, createdAt: d.created_at,
  };
}

export function mapSoftware(s) {
  return {
    id: s.id, userId: s.user_id, clientName: s.client_name || undefined, projectId: s.project_id, name: s.name, plan: s.plan,
    modules: json(s.modules, []), monthlyFee: s.monthly_fee, usersLimit: s.users_limit, url: s.url, version: s.version,
    status: s.status, startedAt: s.started_at, renewalDate: s.renewal_date, createdAt: s.created_at,
  };
}

export function mapLead(l) {
  return {
    id: l.id, name: l.name, email: l.email, phone: l.phone, company: l.company, topic: l.topic, message: l.message,
    source: l.source, utmSource: l.utm_source, status: l.status, value: l.value, notes: l.notes,
    assignedTo: l.assigned_to, assignedName: l.assigned_name || null, userId: l.user_id, createdAt: l.created_at, updatedAt: l.updated_at,
  };
}

export const itemsOf = (inv) => json(inv.items, []);
export const totalsOf = (inv) => invoiceTotals(itemsOf(inv), inv.discount_pct);
