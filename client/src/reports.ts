// Client-ready report documents built from the same project model as the dashboard.
// Each report renders to one HTML string, used for the on-screen preview, print/PDF
// and a Word download (Word opens this HTML natively in Print Layout).
import { fmtDate } from '../../shared/dates';
import { norm, Rec } from '../../shared/model';
import { Deliverable, HEALTH_LABEL, isArchived, isOpenAction, narrativeText, plainName, Project, riskSeverity, isOpenRaid } from '../../shared/project';

export type ReportKey = 'executive' | 'tracker' | 'phases' | 'milestones' | 'risk' | 'client' | 'minutes' | 'actions';

export const REPORTS: { key: ReportKey; title: string; description: string; table?: 'deliverables' | 'actions' }[] = [
  { key: 'executive', title: 'Executive Summary Report', description: 'Health, KPIs, phase progress, narrative, milestones, risks and client actions.' },
  { key: 'tracker', title: 'Complete Project Deliverables Tracker', description: 'Every deliverable grouped by phase and workstream, with owners, dates and status.', table: 'deliverables' },
  { key: 'phases', title: 'Phase-wise Progress Report', description: 'Completion, status mix, milestones and open items for each of the five phases.' },
  { key: 'milestones', title: 'Upcoming Milestones Report', description: 'Milestones and approval gates in date order; unconfirmed dates listed separately.' },
  { key: 'risk', title: 'Overdue and At-Risk Report', description: 'Overdue and at-risk deliverables with reasons, plus open high-severity risks.' },
  { key: 'client', title: 'Pending Client Inputs and Approvals Report', description: 'Everything awaiting Sun Pharma: inputs, approvals and actions.' },
  { key: 'minutes', title: 'Meeting Minutes', description: 'Client-ready minutes for a selected meeting, including its action items.' },
  { key: 'actions', title: 'Open Action Items Report', description: 'All open meeting actions with owners, target dates and linked deliverables.', table: 'actions' },
];

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nl = (v: unknown) => esc(v).replace(/\n/g, '<br>');
const dt = (v: string | null | undefined, empty = 'Not confirmed') => (v ? fmtDate(v) : `<i>${empty}</i>`);
const table = (head: string[], rows: string[][]) =>
  rows.length ? `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p><i>None.</i></p>';

export interface ReportContext {
  p: Project;
  lastSync: string | null;
  sourceLabel: string;
  generatedBy: string;
  internal: boolean;
}

function header(c: ReportContext, title: string) {
  const s = c.p.settings;
  return `<h1>${esc(title)}</h1>
<p class="report-meta"><b>${esc(s.projectName)}</b>${s.programme ? ` — ${esc(s.programme)}` : ''}<br>
${esc(s.client)} × ${esc(s.agency)} · Reporting date: <b>${fmtDate(c.p.today, { weekday: true })}</b><br>
Data last synchronised: ${c.lastSync ? esc(new Date(c.lastSync).toLocaleString('en-GB')) : 'never'} (${esc(c.sourceLabel)}) · Prepared by ${esc(c.generatedBy)}</p>`;
}

function legend(c: ReportContext) {
  return `<h2>Status legend</h2>${table(['Status', 'Meaning'], c.p.statuses.list.map(s => [esc(s.status), esc(s.definition)]))}
<p class="report-meta">Completion is counted only when “Completion Confirmed” = Yes. Schedule flags: Upcoming, On Track, At Risk, Overdue, Completed (calculated from confirmed dates). “Not confirmed” means the date has not been agreed yet.</p>`;
}

function metrics(p: Project) {
  const k = p.kpis;
  return table(['Total', 'Completed', 'In progress', 'In review', 'Pending approvals', 'Yet to start', 'Overdue', 'Due in 7 days', '% complete'],
    [[k.total, k.completed, k.inProgress, k.inReview, k.pendingApprovals, k.yetToStart, k.overdue, k.dueSoon, `${k.pct}%`].map(String)]);
}

const dRow = (d: Deliverable) => [
  `<b>${esc(d.id)}</b>`, esc(d.name), esc(d.type), esc(d.oamOwner), esc(d.sunOwner), dt(d.start), dt(d.end), esc(d.durationWd ?? ''), esc(d.status) + (d.complete ? ' (complete)' : ''), esc(d.flag),
];
const dHead = ['ID', 'Task / Activity', 'Type', 'OneAlphaMed', 'Sun Pharma', 'Start', 'End', 'WD', 'Status', 'Flag'];

function phaseTable(p: Project) {
  return table(['Phase', 'Total', 'Completed', 'In progress', 'Review / approval', 'Overdue', 'At risk', 'Awaiting dates', '% complete', 'Health'],
    p.phases.map(ph => [esc(ph.name), ph.total, ph.completed, ph.inProgress, ph.reviewApproval, ph.overdue, ph.atRisk, ph.notScheduled, `${ph.pct}%`, HEALTH_LABEL[ph.health]].map(String)));
}

export function buildReport(key: ReportKey, c: ReportContext, opts: { meeting?: Rec } = {}): { title: string; html: string } {
  const p = c.p;
  const meta = REPORTS.find(r => r.key === key)!;
  const open = p.deliverables.filter(d => !d.complete);
  let body = '';
  switch (key) {
    case 'executive': {
      const narrative = p.settings.narrative || narrativeText(p.summary);
      const majors = open.filter(d => d.isMilestone || d.keyMilestone || d.isApprovalGate).sort((a, b) => (a.end ?? '9').localeCompare(b.end ?? '9')).slice(0, 10);
      const attention = p.deliverables.filter(d => d.overdue || d.atRisk);
      body = `<h2>Overall status</h2><p><b>Health: ${HEALTH_LABEL[p.health]}</b> — ${esc((p.settings.healthOverride ? [p.settings.healthOverrideReason] : p.healthReasons).join('; '))}. Current phase: ${esc(p.currentPhase)}. Project dates: ${dt(p.projectStart)} to ${dt(p.projectEnd)}.</p>
<h2>Summary metrics</h2>${metrics(p)}
<h2>Executive narrative${p.settings.narrative ? ` <small>(edited by the Project Manager${p.settings.narrativeUpdated ? `, ${fmtDate(p.settings.narrativeUpdated)}` : ''})</small>` : ' <small>(generated from tracker data)</small>'}</h2><p>${nl(narrative)}</p>
<h2>Phase progress</h2>${phaseTable(p)}
<h2>Upcoming milestones & approval gates</h2>${table(['ID', 'Milestone', 'Type', 'Date', 'Status'], majors.map(d => [esc(d.id), esc(plainName(d.name)), esc(d.type), dt(d.end), esc(d.status)]))}
<h2>Overdue and at-risk</h2>${table(['ID', 'Deliverable', 'Flag', 'Reason', 'Owner'], attention.map(d => [esc(d.id), esc(plainName(d.name)), esc(d.flag), esc(d.overdue ? `${d.overdueDays} day(s) overdue` : d.riskReasons.join('; ')), esc(d.owner)]))}
<h2>Pending with Sun Pharma</h2>${table(['ID', 'Item', 'Type', 'Owner', 'Needed by'], open.filter(d => d.awaiting === 'Sun Pharma').map(d => [esc(d.id), esc(plainName(d.name)), esc(d.type), esc(d.sunOwner), dt(d.end)]))}`;
      break;
    }
    case 'tracker':
      body = `<h2>Summary metrics</h2>${metrics(p)}` + p.phases.map(ph => {
        const items = p.deliverables.filter(d => d.phase === ph.phase);
        return `<h2>${esc(ph.name)} — ${ph.completed}/${ph.total} complete</h2>${table(dHead, items.map(dRow))}`;
      }).join('');
      break;
    case 'phases':
      body = `<h2>Overview</h2>${phaseTable(p)}` + p.phases.map(ph => {
        const items = p.deliverables.filter(d => d.phase === ph.phase);
        const ms = items.filter(d => d.isMilestone || d.keyMilestone || d.isApprovalGate);
        const pend = items.filter(d => !d.complete && (d.overdue || d.atRisk || d.category === 'Active' || d.pendingApproval));
        return `<h2>${esc(ph.name)}</h2><p>${esc(ph.summary || 'No scope summary in the checklist.')}<br>Dates: ${dt(ph.start)} to ${dt(ph.end)} · ${ph.pct}% complete · Workstreams: ${ph.workstreams.map(w => `${esc(w.code)} ${esc(w.name)} (${w.completed}/${w.total})`).join('; ')}</p>
<h3>Milestones & gates</h3>${table(['ID', 'Milestone', 'Date', 'Status'], ms.map(d => [esc(d.id), esc(plainName(d.name)), dt(d.end), esc(d.status)]))}
<h3>Active, approval and at-risk items</h3>${table(dHead, pend.map(dRow))}`;
      }).join('');
      break;
    case 'milestones': {
      const ms = p.deliverables.filter(d => d.isMilestone || d.keyMilestone || d.isApprovalGate);
      const dated = ms.filter(d => d.end).sort((a, b) => a.end!.localeCompare(b.end!));
      body = `<h2>Dated milestones & approval gates</h2>${table(['Date', 'ID', 'Milestone', 'Type', 'Phase', 'Status', 'Flag'], dated.map(d => [dt(d.end), esc(d.id), esc(plainName(d.name)), esc(d.type), esc(d.phase), esc(d.status) + (d.complete ? ' (complete)' : ''), esc(d.flag)]))}
<h2>Date not confirmed</h2>${table(['ID', 'Milestone', 'Type', 'Phase', 'Status'], ms.filter(d => !d.end).map(d => [esc(d.id), esc(plainName(d.name)), esc(d.type), esc(d.phase), esc(d.status)]))}`;
      break;
    }
    case 'risk': {
      const od = p.deliverables.filter(d => d.overdue);
      const ar = p.deliverables.filter(d => d.atRisk);
      const risks = (p.tables.raid ?? []).filter(isOpenRaid);
      body = `<h2>Overdue (${od.length})</h2>${table(['ID', 'Deliverable', 'Planned end', 'Days overdue', 'Owner', 'Status'], od.map(d => [esc(d.id), esc(plainName(d.name)), dt(d.end), String(d.overdueDays), esc(d.owner), esc(d.status)]))}
<h2>At risk (${ar.length})</h2>${table(['ID', 'Deliverable', 'Planned end', 'Reasons', 'Owner'], ar.map(d => [esc(d.id), esc(plainName(d.name)), dt(d.end), esc(d.riskReasons.join('; ')), esc(d.owner)]))}
<h2>Open risks & issues (${risks.length})</h2>${table(['ID', 'Category', 'Description', 'Severity', 'Owner', 'Target', 'Status'], risks.map(r => [esc(r._key), esc(r.category), esc(r.title), esc(riskSeverity(r).value || 'Not assessed'), esc(r.owner), dt(r.targetDate as string, '—'), esc(r.status)]))}
${open.some(d => !d.scheduled) ? `<p class="report-meta">${open.filter(d => !d.scheduled).length} open deliverable(s) have no confirmed dates and cannot be assessed for slippage.</p>` : ''}`;
      break;
    }
    case 'client': {
      const appr = p.approvals.filter(a => !a.decided);
      const inputs = open.filter(d => d.isClientInput);
      const acts = (p.tables.actions ?? []).filter(isOpenAction).filter(a => norm(a.ownerOrg) === 'sun pharma');
      body = `<p>Review turnaround: ${p.settings.reviewTurnaroundWd} working days (${p.settings.reviewTurnaroundConfirmed ? 'confirmed' : 'proposed — awaiting confirmation'}).</p>
<h2>Approvals awaiting a decision (${appr.length})</h2>${table(['ID', 'Deliverable', 'Approver', 'Submitted', 'Due', 'Status', 'Days awaiting', 'Gates'], appr.map(a => [esc(a.d.id), esc(plainName(a.d.name)), esc(a.approver), dt(a.dateSubmitted, 'Not submitted'), dt(a.due), esc(a.approvalStatus), esc(a.daysAwaiting ?? '—'), a.downstream ? `${a.downstream} item(s)` : '—']))}
<h2>Client inputs outstanding (${inputs.length})</h2>${table(['ID', 'Input', 'Description', 'Sun Pharma owner', 'Needed by', 'Status'], inputs.map(d => [esc(d.id), esc(d.name), esc(d.rec.description), esc(d.sunOwner), dt(d.end), esc(d.status)]))}
<h2>Open actions owned by Sun Pharma (${acts.length})</h2>${table(['ID', 'Action', 'Owner', 'Due', 'Status'], acts.map(a => [esc(a._key), esc(a.action), esc(a.owner), dt(a.dueDate as string, '—'), esc(a.status)]))}`;
      break;
    }
    case 'actions': {
      const acts = (p.tables.actions ?? []).filter(isOpenAction).sort((a, b) => String(a.dueDate ?? '9').localeCompare(String(b.dueDate ?? '9')));
      body = `<h2>Open action items (${acts.length})</h2>${table(['ID', 'Action', 'Meeting', 'Deliverable', 'Owner', 'Organisation', 'Target date', 'Priority', 'Status', 'Latest update'], acts.map(a => [esc(a._key), esc(a.action), esc(a.meetingId), esc(a.related), esc(a.owner), esc(a.ownerOrg), (a.dueDate && String(a.dueDate) < p.today ? '<b>OVERDUE</b> ' : '') + dt(a.dueDate as string, '—'), esc(a.priority), esc(a.status), nl(a.latestUpdate)]))}`;
      break;
    }
    case 'minutes':
      return { title: opts.meeting ? `Minutes — ${String(opts.meeting.title)}` : meta.title, html: opts.meeting ? minutesHtml(c, opts.meeting) : `${header(c, meta.title)}<p><i>Select a meeting.</i></p>` };
  }
  return { title: meta.title, html: `${header(c, meta.title)}${body}${legend(c)}` };
}

const MINUTES_SECTIONS: [string, string][] = [
  ['objective', 'Meeting objective'], ['agenda', 'Agenda'], ['summary', 'Executive summary'], ['discussion', 'Key discussion points'],
  ['decisions', 'Decisions made'], ['openQuestions', 'Open questions'], ['risks', 'Risks or concerns raised'], ['clientFeedback', 'Client feedback'],
  ['clarifications', 'Pending clarifications'],
];

export function minutesHtml(c: ReportContext, m: Rec) {
  const actions = (c.p.tables.actions ?? []).filter(a => a.meetingId === m._key && !isArchived(a));
  const s = (k: string) => String(m[k] ?? '').trim();
  const time = [s('startTime'), s('endTime')].filter(Boolean).join('–');
  return `${header(c, `Minutes of meeting — ${s('title')}`)}
${table(['Meeting ID', 'Date', 'Time', 'Type', 'Phase', 'Organiser'], [[esc(m._key), m.date ? fmtDate(s('date'), { weekday: true }) : '—', esc(time || '—'), esc(s('type') || '—'), esc(s('phase') || '—'), esc(s('organiser') || '—')]])}
<h2>Attendees</h2><p><b>Sun Pharma:</b> ${nl(s('clientParticipants') || '—')}<br><b>OneAlphaMed:</b> ${nl(s('oamParticipants') || '—')}${s('attendees') ? `<br><b>Others:</b> ${nl(s('attendees'))}` : ''}</p>
${MINUTES_SECTIONS.filter(([k]) => s(k)).map(([k, label]) => `<h2>${label}</h2><p>${nl(s(k))}</p>`).join('')}
<h2>Action items (${actions.length})</h2>${table(['ID', 'Action', 'Linked deliverable', 'Owner', 'Organisation', 'Target date', 'Priority', 'Status'], actions.map(a => [esc(a._key), esc(a.action), esc(a.related), esc(a.owner), esc(a.ownerOrg), dt(a.dueDate as string, '—'), esc(a.priority), esc(a.status)]))}
<h2>Follow-up</h2><p><b>Next meeting:</b> ${m.nextMeeting ? fmtDate(s('nextMeeting'), { weekday: true }) : 'To be confirmed'}${s('nextAgenda') ? `<br><b>Next agenda:</b> ${nl(s('nextAgenda'))}` : ''}${s('followUp') ? `<br><b>Follow-up communication:</b> ${nl(s('followUp'))}` : ''}${s('links') ? `<br><b>References:</b> ${nl(s('links'))}` : ''}</p>`;
}

const WORD_CSS = 'body{font-family:Calibri,Arial,sans-serif;font-size:10.5pt;color:#111827}h1{font-size:18pt;color:#14285a}h2{font-size:13pt;color:#14285a;margin-top:14pt}h3{font-size:11pt}table{border-collapse:collapse;width:100%}th,td{border:1px solid #9ca3af;padding:3pt 5pt;vertical-align:top;font-size:9pt}th{background:#e5e9f2}.report-meta{color:#4b5563;font-size:9pt}';

/** A .doc file Word opens directly (HTML with Word's print-layout hint). */
export function wordBlob(title: string, html: string): Blob {
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]--><style>@page{size:A4 landscape;margin:1.6cm}${WORD_CSS}</style></head><body>${html}</body></html>`;
  return new Blob(['﻿', doc], { type: 'application/msword' });
}

export const fileSafe = (s: string) => s.replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 80);
