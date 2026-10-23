// Cross-record data-quality checks, run on every sync and shown to internal users.
import { fmtDate } from './dates';
import { Issue, norm, Rec, splitIds } from './model';
import { Project } from './project';
import { TableKey } from './schema';

const PLACEHOLDER = /^(.)\1{2,}$|^(tbd|tbc|xxx+|test|lorem.*)$/i;

export function crossValidate(p: Project): Issue[] {
  const out: Issue[] = [];
  const add = (i: Omit<Issue, 'table'> & { table?: TableKey }) => out.push({ table: 'deliverables', ...i } as Issue);
  const unscheduled = p.deliverables.filter(x => !x.complete && (!x.start || !x.end));
  if (unscheduled.length)
    add({ severity: 'warning', code: 'dates-unconfirmed', message: `${unscheduled.length} open deliverable(s) have no confirmed planned dates. They are shown as "Date not confirmed" and excluded from overdue / due-soon tracking until dates are entered.` });

  for (const x of p.deliverables) {
    const id = x.key;
    if (x.dateError) add({ severity: 'error', code: 'end-before-start', recordId: id, field: 'plannedEnd', message: `Planned End Date ${fmtDate(x.end)} is before Planned Start Date ${fmtDate(x.start)}.` });
    if (!x.complete && (!x.start || !x.end)) add({ severity: 'info', code: 'not-scheduled', recordId: id, field: !x.start ? 'plannedStart' : 'plannedEnd', message: `${!x.start && !x.end ? 'Planned dates' : !x.start ? 'Planned Start Date' : 'Planned End Date'} not confirmed.` });
    if (!x.rec.status) add({ severity: 'error', code: 'blank-status', recordId: id, field: 'status', message: 'Status is blank (as in the source checklist). Choose one of the eight statuses.' });
    else if (x.category === 'Unmapped') add({ severity: 'error', code: 'unknown-status', recordId: id, field: 'status', message: `Status "${x.rec.status}" is not one of the configured statuses; it is excluded from the status KPIs until corrected.` });
    if (!x.oamOwner && !x.sunOwner) add({ severity: 'warning', code: 'no-owner', recordId: id, field: 'oamOwner', message: 'No OneAlphaMed or Sun Pharma owner assigned.' });
    if (x.category === 'Unassigned' && (x.oamOwner || x.sunOwner)) add({ severity: 'info', code: 'unassigned-with-owner', recordId: id, field: 'status', message: `Status is "${x.status}" but an owner is recorded (${x.owner}).` });
    if (!x.type) add({ severity: 'warning', code: 'no-type', recordId: id, field: 'type', message: 'Type is blank.' });
    if (x.durationWd === null) add({ severity: 'warning', code: 'no-duration', recordId: id, field: 'durationWd', message: 'Duration (Working Days) is blank.' });
    if (x.windowWd !== null && x.durationWd !== null && x.windowWd !== x.durationWd)
      add({ severity: x.windowWd < x.durationWd ? 'warning' : 'info', code: 'duration-mismatch', recordId: id, field: 'plannedEnd', message: `Planned dates span ${x.windowWd} working day(s); Duration (Working Days) is ${x.durationWd}.` });
    const desc = String(x.rec.description ?? '').trim();
    if (desc && PLACEHOLDER.test(desc)) add({ severity: 'warning', code: 'placeholder-text', recordId: id, field: 'description', message: `Description "${desc}" looks like placeholder text (kept exactly as in the source).` });
    if (x.complete && !x.actualEnd) add({ severity: 'info', code: 'complete-no-actual', recordId: id, field: 'actualEnd', message: 'Completion confirmed but Actual Completion Date is blank.' });
    if (!x.complete && x.actualEnd) add({ severity: 'warning', code: 'actual-not-confirmed', recordId: id, field: 'completionConfirmed', message: `Actual Completion Date is set (${fmtDate(x.actualEnd)}) but completion is not confirmed — it is not counted as complete.` });
    if (x.actualStart && x.actualEnd && x.actualEnd < x.actualStart) add({ severity: 'error', code: 'actual-end-before-start', recordId: id, field: 'actualEnd', message: 'Actual Completion Date is before Actual Start Date.' });
    if (norm(x.rec.approvalStatus) === 'approved' && !x.complete)
      add({ severity: 'info', code: 'approved-not-complete', recordId: id, field: 'completionConfirmed', message: 'Client Approval Status is "Approved" — confirm completion if the deliverable is done.' });
  }
  for (const u of p.graph.unknownRefs) add({ severity: 'warning', code: 'unknown-dependency', recordId: u.id, field: 'predecessors', message: `Dependency "${u.ref}" does not match any deliverable ID.` });
  for (const id of p.graph.selfRefs) add({ severity: 'error', code: 'self-dependency', recordId: id, field: 'predecessors', message: 'Deliverable lists itself as a dependency.' });
  for (const c of p.graph.cycles) add({ severity: 'error', code: 'circular-dependency', recordId: c[0], field: 'predecessors', message: `Circular dependency: ${[...c, c[0]].join(' → ')}. Critical path is disabled until this is fixed.` });
  for (const c of p.graph.conflicts)
    add({ severity: 'warning', code: 'dependency-conflict', recordId: c.succ, field: 'plannedStart', message: `Starts before dependency ${c.pred} finishes (${c.overlapWd} WD overlap).` });

  const statusRecs = (p.tables.statuses ?? []) as Rec[];
  if (!statusRecs.length) out.push({ severity: 'warning', code: 'status-config-missing', table: 'statuses', message: 'Status Config tab is empty — built-in defaults are in use.' });
  const known = (id: string) => p.byId.has(id) || (p.tables.deliverables ?? []).some(r => r._key === id);
  for (const r of p.tables.actions ?? []) {
    const rel = String(r.related ?? '').trim();
    if (rel && !known(rel)) out.push({ severity: 'warning', code: 'unknown-deliverable', table: 'actions', recordId: r._key, field: 'related', message: `Linked deliverable "${rel}" not found.` });
    if (r.meetingId && !(p.tables.meetings ?? []).some(m => m._key === r.meetingId))
      out.push({ severity: 'info', code: 'unknown-meeting', table: 'actions', recordId: r._key, field: 'meetingId', message: `Meeting "${r.meetingId}" not found (it may be internal-only or archived).` });
  }
  for (const r of p.tables.comments ?? []) {
    if (r.deliverableId && !known(String(r.deliverableId)))
      out.push({ severity: 'warning', code: 'unknown-deliverable', table: 'comments', recordId: r._key, field: 'deliverableId', message: `Deliverable "${r.deliverableId}" not found.` });
  }
  for (const t of ['raid', 'decisions'] as const) {
    for (const r of p.tables[t] ?? []) {
      for (const rel of splitIds(r.related as string)) if (!known(rel)) out.push({ severity: 'warning', code: 'unknown-deliverable', table: t, recordId: r._key, field: 'related', message: `Related deliverable "${rel}" not found.` });
    }
  }
  return out;
}
