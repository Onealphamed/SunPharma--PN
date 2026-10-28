// The project model: every KPI, flag and summary shown in the dashboard is computed
// here from the same records, so all pages (and exported reports) always agree.
//
// Business rules (documented in README §5):
//   Complete       = "Completion Confirmed" is Yes (or a status configured with
//                    Counts as Complete = Yes — none of the eight default statuses is).
//   % complete     = complete deliverables ÷ all active (non-archived) deliverables.
//   Overdue        = Planned End Date has passed and the deliverable is not complete.
//   Due soon       = not complete, not overdue, Planned End within "Due Soon Days".
//   Schedule flag  = Completed › Overdue › At Risk › On Track › Upcoming (calculated).
//   Missing dates are never filled in: such items are "Date not confirmed".
import {
  addDays, addWorkingDays, diffDays, fmtDate, ISODate, maxDate, minDate, WorkCalendar, workingDayDiff, workingDaysInclusive,
} from './dates';
import { analyseGraph, GraphResult, GraphTask, toGraphTasks } from './graph';
import { norm, Rec, splitIds } from './model';
import { ScheduleFlag, StatusCategory, TableKey } from './schema';
import { StatusMap } from './status';

export type Health = 'green' | 'amber' | 'red' | 'grey';
export const HEALTH_LABEL: Record<Health, string> = { green: 'On track', amber: 'Needs attention', red: 'Off track', grey: 'Schedule not confirmed' };

export interface Settings {
  projectName: string;
  programme: string;
  client: string;
  agency: string;
  startDate: ISODate | null;
  endDate: ISODate | null;
  projectManager: string;
  oamLead: string;
  sunLead: string;
  dueSoonDays: number;
  atRiskWindowWd: number;
  reviewTurnaroundWd: number;
  reviewTurnaroundConfirmed: boolean;
  weekend: number[];
  narrative: string;
  narrativeUpdated: string;
  narrativeUpdatedBy: string;
  healthOverride: Health | null;
  healthOverrideReason: string;
  importedAt: string;
  sourceFile: string;
  raw: Record<string, string>;
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function settingsFromRecords(records: Rec[] | undefined): Settings {
  const raw: Record<string, string> = {};
  for (const r of records ?? []) if (r.key) raw[norm(r.key)] = r.value === null || r.value === undefined ? '' : String(r.value);
  const get = (k: string) => (raw[norm(k)] ?? '').trim();
  const num = (k: string, d: number) => {
    const n = Number(get(k));
    return get(k) !== '' && isFinite(n) && n >= 0 ? n : d;
  };
  const date = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(get(k)) ? get(k) : null);
  const weekend = get('Weekend Days')
    ? get('Weekend Days').split(/[,\s]+/).map(d => DAY_NAMES.indexOf(d.toLowerCase().slice(0, 3))).filter(i => i >= 0)
    : [0, 6];
  const ho = get('Health Override').toLowerCase();
  return {
    projectName: get('Project Name') || 'Sunpharma-DiabetoDashboard',
    programme: get('Programme'),
    client: get('Client') || 'Sun Pharma',
    agency: get('Agency') || 'OneAlphaMed',
    startDate: date('Project Start Date'),
    endDate: date('Project End Date'),
    projectManager: get('Project Manager'),
    oamLead: get('OneAlphaMed Project Lead'),
    sunLead: get('Sun Pharma Project Lead'),
    dueSoonDays: num('Due Soon Days', 7),
    atRiskWindowWd: num('At-Risk Window (WD)', 3),
    reviewTurnaroundWd: num('Review Turnaround (WD)', 5),
    reviewTurnaroundConfirmed: norm(get('Review Turnaround Confirmed')) === 'yes',
    weekend,
    narrative: get('Executive Narrative'),
    narrativeUpdated: get('Executive Narrative Updated'),
    narrativeUpdatedBy: get('Executive Narrative Updated By'),
    healthOverride: (['green', 'amber', 'red'] as Health[]).find(h => h === ho || HEALTH_LABEL[h].toLowerCase() === ho) ?? null,
    healthOverrideReason: get('Health Override Reason'),
    importedAt: get('Checklist Imported At'),
    sourceFile: get('Source Workbook'),
    raw,
  };
}

export type OwnerOrg = 'OneAlphaMed' | 'Sun Pharma' | 'Joint' | 'Vendor' | 'Unknown';
export function ownerOrg(lead: unknown): OwnerOrg {
  switch (norm(lead)) {
    case 'sun': return 'Sun Pharma';
    case 'oam': return 'OneAlphaMed';
    case 'joint': return 'Joint';
    case 'vendor': return 'Vendor';
    default: return 'Unknown';
  }
}

export interface Deliverable {
  rec: Rec;
  key: string;
  id: string;
  name: string;
  phase: string;
  workstream: string;
  wsCode: string;
  type: string;
  lead: string;
  leadFunction: string;
  ownerOrg: OwnerOrg;
  oamOwner: string;
  sunOwner: string;
  /** Primary accountable owner for the lead organisation (display only). */
  owner: string;
  status: string;
  category: StatusCategory;
  complete: boolean;
  start: ISODate | null;
  end: ISODate | null;
  scheduled: boolean;
  dateError: string | null;
  /** Planned effort in working days (source / editable). */
  durationWd: number | null;
  /** Working days between planned start and end (calculated). */
  windowWd: number | null;
  baselineStart: ISODate | null;
  baselineEnd: ISODate | null;
  varianceWd: number | null;
  actualStart: ISODate | null;
  actualEnd: ISODate | null;
  daysRemaining: number | null;
  overdueDays: number;
  overdue: boolean;
  dueSoon: boolean;
  atRisk: boolean;
  riskReasons: string[];
  flag: ScheduleFlag;
  isMilestone: boolean;
  isApprovalGate: boolean;
  isClientInput: boolean;
  keyMilestone: boolean;
  priority: string;
  predecessors: string[];
  successors: string[];
  critical: boolean;
  float: number | null;
  /** Who the next move belongs to while the item is open. */
  awaiting: 'Sun Pharma' | 'OneAlphaMed' | null;
  pendingApproval: boolean;
  nextAction: string;
  actionOwner: string;
  targetDate: ISODate | null;
  lastUpdated: string;
  sortOrder: number;
}

export interface PhaseSummary {
  phase: string;
  name: string;
  summary: string;
  order: number;
  workstreams: { code: string; name: string; total: number; completed: number }[];
  start: ISODate | null;
  end: ISODate | null;
  total: number;
  completed: number;
  inProgress: number;
  reviewApproval: number;
  pending: number;
  overdue: number;
  atRisk: number;
  notScheduled: number;
  awaitingSun: number;
  byCategory: Record<string, number>;
  pct: number;
  health: Health;
  healthReasons: string[];
}

export interface Kpis {
  total: number;
  completed: number;
  inProgress: number;
  inReview: number;
  pendingApprovals: number;
  yetToStart: number;
  yetToAssign: number;
  onHold: number;
  pending: number;
  unmapped: number;
  overdue: number;
  dueSoon: number;
  atRisk: number;
  notScheduled: number;
  awaitingSun: number;
  awaitingOam: number;
  pct: number;
}

export interface Alert {
  id: string;
  kind: 'overdue' | 'due-soon' | 'approval-overdue' | 'client-input' | 'on-hold' | 'blocker' | 'action-overdue' | 'decision-due' | 'risk-high';
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  table: TableKey;
  recordId: string;
  date: ISODate | null;
}

export interface ApprovalItem {
  d: Deliverable;
  owner: string;
  approver: string;
  dateSubmitted: ISODate | null;
  turnaroundWd: number;
  turnaroundBasis: 'deliverable' | 'project default (proposed)' | 'project default (confirmed)';
  due: ISODate | null;
  dueBasis: 'recorded' | 'calculated' | 'planned end' | null;
  approvalStatus: string;
  approvalStatusRecorded: boolean;
  decided: boolean;
  daysAwaiting: number | null;
  feedback: string;
  lastFollowUp: ISODate | null;
  nextFollowUp: string;
  overdue: boolean;
  downstream: number;
}

export interface SummarySection {
  key: string;
  heading: string;
  items: { text: string; refs?: string[]; tone?: 'good' | 'warn' | 'bad' | 'muted' }[];
}

export interface RecentItem {
  kind: 'deliverable' | 'comment' | 'meeting' | 'action' | 'risk' | 'decision';
  id: string;
  title: string;
  detail: string;
  when: string;
  link: string;
}

export interface Project {
  today: ISODate;
  settings: Settings;
  statuses: StatusMap;
  cal: WorkCalendar;
  deliverables: Deliverable[];
  byId: Map<string, Deliverable>;
  graph: GraphResult;
  phases: PhaseSummary[];
  kpis: Kpis;
  health: Health;
  computedHealth: Health;
  healthReasons: string[];
  currentPhase: string;
  projectStart: ISODate | null;
  projectEnd: ISODate | null;
  milestones: Deliverable[];
  approvals: ApprovalItem[];
  alerts: Alert[];
  summary: SummarySection[];
  recent: RecentItem[];
  tables: Partial<Record<TableKey, Rec[]>>;
}

export const isArchived = (r: Rec) => norm(r.archived) === 'yes';
export function isOpenRaid(r: Rec) {
  return !['resolved', 'closed', 'mitigated'].includes(norm(r.status)) && !isArchived(r);
}
export function isOpenAction(r: Rec) {
  return !['done', 'cancelled'].includes(norm(r.status)) && !isArchived(r);
}
export function isOpenDecision(r: Rec) {
  return norm(r.status) === 'open' && !isArchived(r);
}

/** Severity as recorded, or derived from impact × likelihood (never invented when both are blank). */
export function riskSeverity(r: Rec): { value: string; derived: boolean } {
  if (r.severity) return { value: String(r.severity), derived: false };
  const score = (v: unknown) => ({ high: 3, medium: 2, low: 1 })[norm(v) as 'high'] ?? 0;
  const i = score(r.impact);
  const l = score(r.likelihood);
  if (!i || !l) return { value: '', derived: false };
  const p = i * l;
  return { value: p >= 9 ? 'Critical' : p >= 6 ? 'High' : p >= 3 ? 'Medium' : 'Low', derived: true };
}
export const isHighRisk = (r: Rec) => ['critical', 'high'].includes(norm(riskSeverity(r).value));

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const d = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
export const plainName = (name: string) => name.replace(/^◆\s*/, '').trim();

export function buildProject(tables: Partial<Record<TableKey, Rec[]>>, today: ISODate): Project {
  const settings = settingsFromRecords(tables.settings);
  const statuses = StatusMap.fromRecords(tables.statuses as Rec[] | undefined);
  const cal: WorkCalendar = {
    weekend: settings.weekend,
    holidays: new Set((tables.holidays ?? []).map(h => d(h.date)).filter(Boolean) as string[]),
  };

  const recs = (tables.deliverables ?? []).filter(r => !isArchived(r));
  const base = recs.map(r => {
    const start = d(r.plannedStart);
    const end = d(r.plannedEnd);
    const complete = norm(r.completionConfirmed) === 'yes' || statuses.isComplete(r.status);
    return { r, start, end, complete };
  });
  const graphTasks: GraphTask[] = toGraphTasks(base.map(b => ({ id: b.r._key, start: b.start, end: b.end, predecessors: s(b.r.predecessors), complete: b.complete })));
  const graph = analyseGraph(graphTasks, cal);

  const deliverables: Deliverable[] = base.map(({ r, start, end, complete }, i) => {
    const category = statuses.category(r.status);
    const dateError = start && end && end < start ? 'Planned End Date is before Planned Start Date' : null;
    const scheduled = !!(start && end) && !dateError;
    const overdue = !complete && !!end && end < today;
    const overdueDays = overdue ? diffDays(end!, today) : 0;
    const daysRemaining = !complete && end ? diffDays(today, end) : null;
    const dueSoon = !complete && !overdue && !!end && daysRemaining !== null && daysRemaining <= settings.dueSoonDays;
    const type = s(r.type);
    const lead = s(r.lead);
    const org = ownerOrg(lead);
    const oamOwner = s(r.oamOwner);
    const sunOwner = s(r.sunOwner);
    const owner = org === 'Sun Pharma' ? sunOwner || oamOwner : org === 'Joint' ? [oamOwner, sunOwner].filter(Boolean).join(' / ') : oamOwner || sunOwner;
    const baselineEnd = d(r.baselineEnd);
    const isClientInput = norm(type) === 'client input';
    const approvalStatus = norm(r.approvalStatus);
    const pendingApproval = !complete && (category === 'Approval' || approvalStatus === 'pending approval');
    const awaiting: Deliverable['awaiting'] = complete ? null : org === 'Sun Pharma' || isClientInput || approvalStatus === 'pending approval' ? 'Sun Pharma' : 'OneAlphaMed';
    return {
      rec: r,
      key: r._key,
      id: s(r.id) || r._key,
      name: s(r.name),
      phase: s(r.phase),
      workstream: s(r.workstream),
      wsCode: s(r.wsCode),
      type,
      lead,
      leadFunction: s(r.leadFunction),
      ownerOrg: org,
      oamOwner,
      sunOwner,
      owner,
      status: statuses.canonical(r.status),
      category,
      complete,
      start,
      end,
      scheduled,
      dateError,
      durationWd: typeof r.durationWd === 'number' ? r.durationWd : null,
      windowWd: scheduled ? workingDaysInclusive(start!, end!, cal) : null,
      baselineStart: d(r.baselineStart),
      baselineEnd,
      varianceWd: baselineEnd && end ? workingDayDiff(baselineEnd, end, cal) : null,
      actualStart: d(r.actualStart),
      actualEnd: d(r.actualEnd),
      daysRemaining,
      overdueDays,
      overdue,
      dueSoon,
      atRisk: false,
      riskReasons: [],
      flag: 'Upcoming',
      isMilestone: norm(type) === 'milestone',
      isApprovalGate: norm(type) === 'approval gate',
      isClientInput,
      keyMilestone: norm(r.keyMilestone) === 'yes',
      priority: s(r.priority),
      predecessors: splitIds(s(r.predecessors)),
      successors: graph.successors.get(r._key) ?? [],
      critical: graph.critical.has(r._key),
      float: graph.float.has(r._key) ? graph.float.get(r._key)! : null,
      awaiting,
      pendingApproval,
      nextAction: s(r.nextAction),
      actionOwner: s(r.actionOwner),
      targetDate: d(r.targetDate),
      lastUpdated: s(r.lastUpdated),
      sortOrder: typeof r.sortOrder === 'number' ? r.sortOrder : 100000 + i,
    };
  });
  deliverables.sort((a, b) => a.sortOrder - b.sortOrder);
  const byId = new Map(deliverables.map(x => [x.key, x]));

  // At-risk rules apply to items that are neither complete nor already overdue.
  for (const x of deliverables) {
    if (x.complete) {
      x.flag = 'Completed';
      continue;
    }
    const notStarted = (x.category === 'Not started' || x.category === 'Unassigned') && !x.actualStart;
    const reasons: string[] = [];
    if (x.category === 'Blocked') reasons.push('On hold');
    if (x.start && x.start < today && notStarted) reasons.push(`Planned to start ${fmtDate(x.start)} but not started`);
    if (x.end && !x.overdue && notStarted) {
      const wdLeft = workingDayDiff(today, x.end, cal);
      if (wdLeft >= 0 && wdLeft < settings.atRiskWindowWd) reasons.push(`Due in ${wdLeft + 1} working day(s) and not started`);
    }
    if (x.windowWd !== null && x.durationWd !== null && x.windowWd < x.durationWd)
      reasons.push(`Planned window is ${x.windowWd} WD but the task needs ${x.durationWd} WD`);
    if (x.varianceWd !== null && x.varianceWd > 0) reasons.push(`Planned end is ${x.varianceWd} WD later than baseline`);
    if (s(x.rec.risk).trim()) reasons.push('Risk / blocker recorded');
    for (const p of x.predecessors) if (byId.get(p)?.overdue) reasons.push(`Depends on overdue ${p}`);
    if (x.category === 'Unassigned' || (!x.oamOwner && !x.sunOwner)) reasons.push('No owner assigned');
    if (x.targetDate && x.targetDate < today && x.nextAction) reasons.push(`Next action was due ${fmtDate(x.targetDate)}`);
    if (x.dateError) reasons.push(x.dateError);
    x.riskReasons = reasons;
    x.atRisk = !x.overdue && reasons.length > 0;
    const started = !notStarted || (!!x.start && x.start <= today);
    x.flag = x.overdue ? 'Overdue' : x.atRisk ? 'At Risk' : x.scheduled && started ? 'On Track' : 'Upcoming';
  }

  const approvals = buildApprovals(deliverables, graph, settings, cal, today);
  // An approval decision past its due date puts the item at risk.
  for (const a of approvals) {
    if (a.overdue && !a.d.overdue && !a.d.complete) {
      a.d.riskReasons.push(`Approval decision was due ${fmtDate(a.due)}`);
      a.d.atRisk = true;
      a.d.flag = 'At Risk';
    }
  }

  const kpis = computeKpis(deliverables);
  const raid = (tables.raid ?? []).filter(isOpenRaid);
  const highIssues = raid.filter(r => norm(r.category) === 'issue' && isHighRisk(r)).length;
  const highRisks = raid.filter(r => norm(r.category) !== 'issue' && isHighRisk(r)).length;
  const { health: computedHealth, reasons: healthReasons } = scopeHealth(deliverables, { highIssues, highRisks });
  const health = settings.healthOverride ?? computedHealth;

  const phaseRecs = tables.phases ?? [];
  const phaseNames = [...new Set([...phaseRecs.map(r => s(r.phase)), ...deliverables.map(x => x.phase)].filter(Boolean))];
  const phaseOrder = (p: string) => {
    const pr = phaseRecs.find(r => norm(r.phase) === norm(p));
    return typeof pr?.order === 'number' ? pr.order : 1000 + phaseNames.indexOf(p);
  };
  phaseNames.sort((a, b) => phaseOrder(a) - phaseOrder(b));
  const phases: PhaseSummary[] = phaseNames.map(p => {
    const items = deliverables.filter(x => x.phase === p);
    const pr = phaseRecs.find(r => norm(r.phase) === norm(p));
    const k = computeKpis(items);
    const byCategory: Record<string, number> = {};
    for (const x of items) byCategory[x.complete ? 'Completed' : x.category] = (byCategory[x.complete ? 'Completed' : x.category] ?? 0) + 1;
    const h = scopeHealth(items, { highIssues: 0, highRisks: 0 });
    return {
      phase: p,
      name: s(pr?.name) || p,
      summary: s(pr?.summary),
      order: phaseOrder(p),
      workstreams: groupBy(items, x => `${x.wsCode}|${x.workstream}`).map(([k2, xs]) => ({ code: k2.split('|')[0], name: xs[0].workstream, total: xs.length, completed: xs.filter(x => x.complete).length })),
      start: minDate(items.map(x => x.start)),
      end: maxDate(items.map(x => x.end)),
      total: k.total,
      completed: k.completed,
      inProgress: k.inProgress,
      reviewApproval: k.inReview + k.pendingApprovals,
      pending: k.total - k.completed,
      overdue: k.overdue,
      atRisk: k.atRisk,
      notScheduled: k.notScheduled,
      awaitingSun: k.awaitingSun,
      byCategory,
      pct: k.pct,
      health: h.health,
      healthReasons: h.reasons,
    };
  });

  const projectStart = settings.startDate ?? minDate(deliverables.map(x => x.start));
  const projectEnd = settings.endDate ?? maxDate(deliverables.map(x => x.end));
  let currentPhase: string;
  const active = phases.filter(p => p.start && p.end && p.start <= today && today <= p.end && p.pct < 100);
  if (!deliverables.some(x => x.scheduled)) currentPhase = phases.find(p => p.pct < 100)?.name ?? 'Not yet confirmed';
  else if (projectStart && today < projectStart) currentPhase = `Pre-start (planned start ${fmtDate(projectStart)})`;
  else if (active.length) currentPhase = active.map(p => p.name).join(' · ');
  else if (phases.length && phases.every(p => p.pct === 100)) currentPhase = 'Complete';
  else currentPhase = phases.find(p => p.pct < 100)?.name ?? 'Not yet confirmed';

  const milestones = deliverables
    .filter(x => x.keyMilestone || x.isMilestone)
    .sort((a, b) => (a.end ?? '9999').localeCompare(b.end ?? '9999') || a.sortOrder - b.sortOrder);

  const alerts = buildAlerts(deliverables, tables, settings, today, approvals);
  const project: Project = {
    today, settings, statuses, cal, deliverables, byId, graph, phases, kpis, health, computedHealth, healthReasons,
    currentPhase, projectStart, projectEnd, milestones, approvals, alerts, summary: [], recent: [], tables,
  };
  project.summary = buildSummary(project);
  project.recent = buildRecent(project);
  return project;
}

export function computeKpis(items: Deliverable[]): Kpis {
  const open = items.filter(x => !x.complete);
  const by = (c: StatusCategory) => open.filter(x => x.category === c).length;
  const total = items.length;
  const completed = items.length - open.length;
  return {
    total,
    completed,
    inProgress: by('Active'),
    inReview: by('Review'),
    pendingApprovals: open.filter(x => x.pendingApproval).length,
    yetToStart: by('Not started'),
    yetToAssign: by('Unassigned'),
    onHold: by('Blocked'),
    pending: by('Waiting'),
    unmapped: by('Unmapped'),
    overdue: open.filter(x => x.overdue).length,
    dueSoon: open.filter(x => x.dueSoon).length,
    atRisk: open.filter(x => x.atRisk).length,
    notScheduled: open.filter(x => !x.scheduled).length,
    awaitingSun: open.filter(x => x.awaiting === 'Sun Pharma').length,
    awaitingOam: open.filter(x => x.awaiting === 'OneAlphaMed').length,
    pct: total ? Math.round((completed / total) * 1000) / 10 : 0,
  };
}

/**
 * Health rule (documented in README):
 *  Grey  — no open deliverable has confirmed dates yet (health cannot be assessed).
 *  Red   — an overdue milestone / approval gate, >10% of deliverables overdue, or an open high-severity issue.
 *  Amber — anything overdue, at risk or on hold, or an open high-severity risk.
 *  Green — otherwise.
 */
export function scopeHealth(items: Deliverable[], extra: { highIssues: number; highRisks: number }): { health: Health; reasons: string[] } {
  if (!items.length) return { health: 'grey', reasons: ['No deliverables'] };
  const open = items.filter(x => !x.complete);
  const unscheduled = open.filter(x => !x.scheduled).length;
  const note = unscheduled ? [`${unscheduled} of ${open.length} open deliverables awaiting schedule confirmation`] : [];
  if (open.length && open.every(x => !x.scheduled) && !extra.highIssues && !extra.highRisks && !open.some(x => x.category === 'Blocked'))
    return { health: 'grey', reasons: ['No planned dates confirmed yet — overdue and at-risk tracking starts once dates are entered', ...note] };
  const overdue = open.filter(x => x.overdue);
  const overdueGates = overdue.filter(x => x.isMilestone || x.isApprovalGate || x.keyMilestone);
  const red: string[] = [];
  if (overdueGates.length) red.push(`${overdueGates.length} milestone / approval gate(s) overdue`);
  if (overdue.length / items.length > 0.1) red.push(`${overdue.length} of ${items.length} deliverables overdue (>10%)`);
  if (extra.highIssues) red.push(`${extra.highIssues} open high-severity issue(s)`);
  if (red.length) return { health: 'red', reasons: [...red, ...note] };
  const amber: string[] = [];
  if (overdue.length) amber.push(`${overdue.length} deliverable(s) overdue`);
  const atRisk = open.filter(x => x.atRisk).length;
  if (atRisk) amber.push(`${atRisk} deliverable(s) at risk`);
  const hold = open.filter(x => x.category === 'Blocked').length;
  if (hold) amber.push(`${hold} on hold`);
  if (extra.highRisks) amber.push(`${extra.highRisks} open high-severity risk(s)`);
  if (amber.length) return { health: 'amber', reasons: [...amber, ...note] };
  return { health: 'green', reasons: ['No overdue or at-risk deliverables', ...note] };
}

function downstreamCount(id: string, graph: GraphResult): number {
  const seen = new Set<string>();
  const q = [...(graph.successors.get(id) ?? [])];
  while (q.length) {
    const n = q.shift()!;
    if (seen.has(n)) continue;
    seen.add(n);
    q.push(...(graph.successors.get(n) ?? []));
  }
  return seen.size;
}

function buildApprovals(items: Deliverable[], graph: GraphResult, st: Settings, cal: WorkCalendar, today: ISODate): ApprovalItem[] {
  return items
    .filter(x => x.isApprovalGate || x.category === 'Approval' || ['pending approval', 'rejected'].includes(norm(x.rec.approvalStatus)))
    .map(x => {
      const r = x.rec;
      const submitted = d(r.dateSubmitted);
      const own = typeof r.reviewTurnaroundWd === 'number' ? r.reviewTurnaroundWd : null;
      const turnaroundWd = own ?? st.reviewTurnaroundWd;
      const recordedDue = d(r.approvalDue);
      const calcDue = submitted ? addWorkingDays(submitted, turnaroundWd, cal) : null;
      const due = recordedDue ?? calcDue ?? x.end;
      const statusRecorded = s(r.approvalStatus);
      const decided = x.complete || ['approved', 'rejected', 'not required'].includes(norm(statusRecorded));
      return {
        d: x,
        owner: x.oamOwner,
        approver: s(r.clientApprover) || x.sunOwner || x.leadFunction,
        dateSubmitted: submitted,
        turnaroundWd,
        turnaroundBasis: own !== null ? 'deliverable' : st.reviewTurnaroundConfirmed ? 'project default (confirmed)' : 'project default (proposed)',
        due,
        dueBasis: recordedDue ? 'recorded' : calcDue ? 'calculated' : x.end ? 'planned end' : null,
        approvalStatus: statusRecorded || (submitted ? 'Pending Approval' : 'Not Submitted'),
        approvalStatusRecorded: !!statusRecorded,
        decided,
        daysAwaiting: submitted && !decided ? diffDays(submitted, today) : null,
        feedback: s(r.approvalFeedback),
        lastFollowUp: d(r.lastFollowUp),
        nextFollowUp: s(r.nextFollowUp),
        overdue: !decided && !!due && due < today,
        downstream: downstreamCount(x.key, graph),
      } satisfies ApprovalItem;
    })
    .sort((a, b) => Number(a.decided) - Number(b.decided) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.d.sortOrder - b.d.sortOrder);
}

function buildAlerts(items: Deliverable[], tables: Partial<Record<TableKey, Rec[]>>, st: Settings, today: ISODate, approvals: ApprovalItem[]): Alert[] {
  const out: Alert[] = [];
  const push = (a: Omit<Alert, 'id'>) => out.push({ ...a, id: `${a.kind}:${a.recordId}` });
  for (const x of items) {
    if (x.complete) continue;
    if (x.overdue)
      push({ kind: 'overdue', severity: x.isApprovalGate || x.isMilestone || x.keyMilestone ? 'high' : 'medium', title: `${x.id} overdue by ${x.overdueDays} day(s)`, detail: plainName(x.name), table: 'deliverables', recordId: x.key, date: x.end });
    else if (x.dueSoon)
      push({ kind: 'due-soon', severity: x.isMilestone || x.keyMilestone ? 'medium' : 'low', title: `${x.id} due ${fmtDate(x.end)}${x.daysRemaining === 0 ? ' (today)' : ` (in ${x.daysRemaining} day${x.daysRemaining === 1 ? '' : 's'})`}`, detail: plainName(x.name), table: 'deliverables', recordId: x.key, date: x.end });
    if (x.isClientInput && x.end && diffDays(today, x.end) <= st.dueSoonDays && !x.overdue)
      push({ kind: 'client-input', severity: 'medium', title: `Sun Pharma input needed: ${x.id}`, detail: `${x.name} — needed by ${fmtDate(x.end)}`, table: 'deliverables', recordId: x.key, date: x.end });
    if (x.category === 'Blocked') push({ kind: 'on-hold', severity: 'medium', title: `${x.id} on hold`, detail: x.name, table: 'deliverables', recordId: x.key, date: x.end });
    if (s(x.rec.risk).trim() && ['critical', 'high'].includes(norm(x.priority)))
      push({ kind: 'blocker', severity: 'high', title: `High-priority blocker on ${x.id}`, detail: s(x.rec.risk), table: 'deliverables', recordId: x.key, date: x.end });
  }
  for (const a of approvals)
    if (a.overdue && !a.d.overdue)
      push({ kind: 'approval-overdue', severity: a.downstream > 0 ? 'high' : 'medium', title: `Approval decision overdue: ${a.d.id}`, detail: `${plainName(a.d.name)} — due ${fmtDate(a.due)}, approver ${a.approver || 'not set'}`, table: 'deliverables', recordId: a.d.key, date: a.due });
  for (const r of (tables.actions ?? []).filter(isOpenAction)) {
    const due = d(r.dueDate);
    if (due && due < today)
      push({ kind: 'action-overdue', severity: ['critical', 'high'].includes(norm(r.priority)) ? 'high' : 'medium', title: `Action ${r._key} overdue`, detail: `${s(r.action)} — ${s(r.owner) || 'no owner'}`, table: 'actions', recordId: r._key, date: due });
  }
  for (const r of (tables.decisions ?? []).filter(isOpenDecision)) {
    const due = d(r.dueDate);
    if (due && diffDays(today, due) <= st.dueSoonDays)
      push({ kind: 'decision-due', severity: due < today ? 'high' : 'medium', title: `Decision ${due < today ? 'overdue' : 'due'}: ${r._key}`, detail: s(r.decision), table: 'decisions', recordId: r._key, date: due });
  }
  for (const r of (tables.raid ?? []).filter(isOpenRaid).filter(isHighRisk))
    push({ kind: 'risk-high', severity: 'high', title: `${s(r.category)} ${r._key}: ${riskSeverity(r).value}`, detail: s(r.title), table: 'raid', recordId: r._key, date: d(r.targetDate) });
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}

const ids = (xs: Deliverable[], max = 6) => xs.slice(0, max).map(x => x.id);
const more = (n: number, shown: number) => (n > shown ? ` and ${n - shown} more` : '');

/**
 * Executive narrative generated ONLY from tracker data. Where the tracker has no
 * information, the text says so ("not confirmed") instead of inventing an update.
 */
export function buildSummary(p: Project): SummarySection[] {
  const { kpis: k, today, settings } = p;
  const ds = p.deliverables;
  const out: SummarySection[] = [];

  // 1. Overall health
  const dates = p.projectStart || p.projectEnd
    ? `Planned timeline: ${p.projectStart ? fmtDate(p.projectStart) : 'start not confirmed'} to ${p.projectEnd ? fmtDate(p.projectEnd) : 'end not confirmed'}.`
    : 'Project start and end dates are not yet confirmed.';
  out.push({
    key: 'health',
    heading: 'Overall project health',
    items: [
      { text: `${HEALTH_LABEL[p.health]}${settings.healthOverride ? ' (set by the Project Manager)' : ''}: ${(settings.healthOverride ? [settings.healthOverrideReason || 'no reason recorded'] : p.healthReasons).join('; ')}.`, tone: p.health === 'green' ? 'good' : p.health === 'red' ? 'bad' : p.health === 'grey' ? 'muted' : 'warn' },
      { text: `Current phase: ${p.currentPhase}. ${dates}` },
    ],
  });

  // 2. Completion
  out.push({
    key: 'completion',
    heading: 'Deliverables completed',
    items: [
      { text: `${k.completed} of ${k.total} deliverables complete (${k.pct}%). Open: ${k.inProgress} in progress, ${k.inReview} in review, ${k.pendingApprovals} pending approval, ${k.pending} pending an input or decision, ${k.yetToStart} yet to start${k.yetToAssign ? `, ${k.yetToAssign} yet to assign` : ''}${k.onHold ? `, ${k.onHold} on hold` : ''}${k.unmapped ? `, ${k.unmapped} with no recognised status` : ''}.` },
    ],
  });

  // 3. Phases
  out.push({
    key: 'phases',
    heading: 'Progress across the five phases',
    items: p.phases.map(ph => ({
      text: `${ph.name}: ${ph.completed}/${ph.total} complete (${ph.pct}%)${ph.inProgress ? `, ${ph.inProgress} in progress` : ''}${ph.reviewApproval ? `, ${ph.reviewApproval} in review/approval` : ''}${ph.overdue ? `, ${ph.overdue} overdue` : ''}${ph.atRisk ? `, ${ph.atRisk} at risk` : ''}${ph.notScheduled === ph.total - ph.completed && ph.notScheduled ? ' — dates not confirmed' : ''}.`,
      tone: (ph.health === 'red' ? 'bad' : ph.health === 'amber' ? 'warn' : undefined) as 'bad' | 'warn' | undefined,
    })),
  });

  // 4. Accomplishments: completion recorded in the last 14 days
  const since = addDays(today, -14);
  const recent = ds.filter(x => x.complete && x.actualEnd && x.actualEnd >= since && x.actualEnd <= today);
  const undated = ds.filter(x => x.complete && !x.actualEnd);
  const ach: SummarySection['items'] = [];
  if (recent.length) ach.push({ text: `${recent.length} deliverable(s) completed in the last 14 days: ${recent.slice(0, 4).map(x => plainName(x.name)).join('; ')}${more(recent.length, 4)}.`, refs: ids(recent), tone: 'good' });
  if (undated.length) ach.push({ text: `${undated.length} deliverable(s) confirmed complete without an Actual Completion Date.`, refs: ids(undated), tone: 'muted' });
  if (!ach.length) ach.push({ text: 'No deliverables have been confirmed complete in the last 14 days.', tone: 'muted' });
  out.push({ key: 'accomplishments', heading: 'Key accomplishments', items: ach });

  // 5. Upcoming milestones
  const nextMs = p.milestones.filter(x => !x.complete);
  const datedMs = nextMs.filter(x => x.end && x.end >= today).slice(0, 4);
  const undatedMs = nextMs.filter(x => !x.end);
  const ms: SummarySection['items'] = datedMs.map(x => ({ text: `${fmtDate(x.end)} — ${plainName(x.name)}`, refs: [x.id] }));
  if (undatedMs.length) ms.push({ text: `${undatedMs.length} milestone(s) without a confirmed date: ${undatedMs.slice(0, 3).map(x => plainName(x.name)).join('; ')}${more(undatedMs.length, 3)}.`, refs: ids(undatedMs), tone: 'muted' });
  if (!ms.length) ms.push({ text: 'No open milestones.', tone: 'muted' });
  out.push({ key: 'milestones', heading: 'Upcoming milestones', items: ms });

  // 6. Overdue / at risk
  const overdue = ds.filter(x => x.overdue);
  const atRisk = ds.filter(x => x.atRisk);
  const risk: SummarySection['items'] = [];
  if (overdue.length) risk.push({ text: `${overdue.length} overdue: ${overdue.slice(0, 4).map(x => `${plainName(x.name)} (${x.overdueDays}d)`).join('; ')}${more(overdue.length, 4)}.`, refs: ids(overdue), tone: 'bad' });
  if (atRisk.length) risk.push({ text: `${atRisk.length} at risk: ${atRisk.slice(0, 4).map(x => `${plainName(x.name)} — ${x.riskReasons[0]}`).join('; ')}${more(atRisk.length, 4)}.`, refs: ids(atRisk), tone: 'warn' });
  if (!risk.length) risk.push({ text: k.notScheduled ? 'Nothing is overdue or at risk based on the confirmed dates; items without dates cannot be assessed yet.' : 'No deliverables are overdue or at risk.', tone: k.notScheduled ? 'muted' : 'good' });
  out.push({ key: 'risk', heading: 'Overdue or at-risk deliverables', items: risk });

  // 7. Pending client inputs and approvals
  const inputs = ds.filter(x => !x.complete && x.isClientInput);
  const approvals = p.approvals.filter(a => !a.decided);
  const submitted = approvals.filter(a => a.dateSubmitted);
  const clientActions = (p.tables.actions ?? []).filter(isOpenAction).filter(r => norm(r.ownerOrg) === 'sun pharma');
  const cl: SummarySection['items'] = [];
  if (inputs.length) cl.push({ text: `${inputs.length} Sun Pharma input(s) outstanding, including ${inputs.slice(0, 3).map(x => plainName(x.name)).join('; ')}${more(inputs.length, 3)}.`, refs: ids(inputs), tone: inputs.some(x => x.overdue) ? 'bad' : undefined });
  if (approvals.length) cl.push({ text: `${approvals.length} approval(s) open; ${submitted.length} submitted and awaiting a decision${approvals.some(a => a.overdue) ? `, ${approvals.filter(a => a.overdue).length} past due` : ''}.`, refs: approvals.slice(0, 6).map(a => a.d.id), tone: approvals.some(a => a.overdue) ? 'bad' : undefined });
  if (clientActions.length) cl.push({ text: `${clientActions.length} open meeting action(s) owned by Sun Pharma.`, refs: clientActions.slice(0, 6).map(r => r._key) });
  if (!settings.reviewTurnaroundConfirmed) cl.push({ text: `Review turnaround of ${settings.reviewTurnaroundWd} working days is a proposed assumption until Sun Pharma confirms it.`, tone: 'muted' });
  if (!cl.length) cl.push({ text: 'No Sun Pharma inputs or approvals outstanding.', tone: 'good' });
  out.push({ key: 'client', heading: 'Pending client inputs and approvals', items: cl });

  // 8. Decisions / dependencies affecting timelines
  const decisions = (p.tables.decisions ?? []).filter(isOpenDecision);
  const clientDecisionRisks = (p.tables.raid ?? []).filter(isOpenRaid).filter(r => norm(r.clientDecision) === 'yes');
  const blockingApprovals = approvals.filter(a => a.downstream > 0);
  const dec: SummarySection['items'] = decisions.slice(0, 4).map(r => ({ text: `Decision required: ${s(r.decision)}${r.owner ? ` — ${s(r.owner)}` : ''}${r.dueDate ? `, due ${fmtDate(s(r.dueDate))}` : ''}`, refs: [r._key], tone: d(r.dueDate) && d(r.dueDate)! < today ? ('bad' as const) : undefined }));
  for (const r of clientDecisionRisks.slice(0, 3)) dec.push({ text: `${s(r.category)} needing a client decision: ${s(r.title)}`, refs: [r._key] });
  for (const a of blockingApprovals.slice(0, 3)) dec.push({ text: `${plainName(a.d.name)} gates ${a.downstream} downstream deliverable(s).`, refs: [a.d.id] });
  if (!p.graph.linkCount) dec.push({ text: 'No dependencies are recorded in the tracker yet, so downstream impact cannot be calculated.', tone: 'muted' });
  if (!dec.length) dec.push({ text: 'No open decisions or blocking dependencies recorded.', tone: 'good' });
  out.push({ key: 'decisions', heading: 'Key decisions and dependencies', items: dec });

  // 9. Immediate priorities — rule-based recommendations from the data above
  const pr: SummarySection['items'] = [];
  if (overdue.length) pr.push({ text: `Recover the ${overdue.length} overdue deliverable(s), starting with ${plainName(overdue[0].name)}.`, refs: ids(overdue, 3), tone: 'bad' });
  const lateApprovals = approvals.filter(a => a.overdue);
  if (lateApprovals.length) pr.push({ text: `Follow up with Sun Pharma on ${lateApprovals.length} overdue approval decision(s).`, refs: lateApprovals.slice(0, 3).map(a => a.d.id), tone: 'bad' });
  const dueActions = ds.filter(x => !x.complete && x.nextAction && x.targetDate && x.targetDate <= addDays(today, settings.dueSoonDays));
  if (dueActions.length) pr.push({ text: `Complete ${dueActions.length} next action(s) due within ${settings.dueSoonDays} days: ${dueActions.slice(0, 3).map(x => `${x.nextAction} (${x.actionOwner || 'owner not set'})`).join('; ')}${more(dueActions.length, 3)}.`, refs: ids(dueActions, 3) });
  const p1Inputs = inputs.filter(x => x.phase === (p.phases[0]?.phase ?? 'Phase 1'));
  if (p1Inputs.length) pr.push({ text: `Secure the ${p1Inputs.length} outstanding Sun Pharma input(s) for ${p.phases[0]?.name ?? 'Phase 1'}; later phases depend on them.`, refs: ids(p1Inputs, 4) });
  if (k.notScheduled) pr.push({ text: `Confirm planned start and end dates for ${k.notScheduled} deliverable(s) so overdue and at-risk tracking can begin.`, tone: 'warn' });
  const unowned = ds.filter(x => !x.complete && (x.category === 'Unassigned' || (!x.oamOwner && !x.sunOwner)));
  if (unowned.length) pr.push({ text: `Assign owners to ${unowned.length} deliverable(s).`, refs: ids(unowned, 4) });
  if (!pr.length) pr.push({ text: 'No immediate interventions identified from the tracker data.', tone: 'good' });
  out.push({ key: 'priorities', heading: 'Immediate priorities and recommended next actions', items: pr });
  return out;
}

/** Plain-text version of the generated narrative, used as the starting point for PM edits. */
export function narrativeText(summary: SummarySection[]): string {
  return summary.map(sec => `${sec.heading}\n${sec.items.map(i => `• ${i.text}`).join('\n')}`).join('\n\n');
}

function buildRecent(p: Project): RecentItem[] {
  const out: RecentItem[] = [];
  const imported = p.settings.importedAt;
  for (const x of p.deliverables) {
    if (!x.lastUpdated || x.lastUpdated === imported) continue;
    out.push({ kind: 'deliverable', id: x.id, title: plainName(x.name), detail: `${x.status}${x.complete ? ' · complete' : ''}`, when: x.lastUpdated, link: `#/tracker?open=${encodeURIComponent(x.key)}` });
  }
  for (const c of (p.tables.comments ?? []).filter(r => !isArchived(r))) {
    const when = s(c.postedAt) || s(c.lastUpdated);
    if (!when) continue;
    out.push({ kind: 'comment', id: s(c.deliverableId), title: `Comment on ${s(c.deliverableId)}`, detail: `${s(c.author) ? `${s(c.author)}: ` : ''}${s(c.comment)}`, when, link: `#/tracker?open=${encodeURIComponent(s(c.deliverableId))}` });
  }
  for (const m of (p.tables.meetings ?? []).filter(r => !isArchived(r))) {
    if (!m.lastUpdated) continue;
    out.push({ kind: 'meeting', id: m._key, title: s(m.title), detail: `Meeting ${m.date ? fmtDate(s(m.date)) : ''}`, when: s(m.lastUpdated), link: `#/meetings?id=${encodeURIComponent(m._key)}` });
  }
  for (const a of (p.tables.actions ?? []).filter(r => !isArchived(r))) {
    if (!a.lastUpdated) continue;
    out.push({ kind: 'action', id: a._key, title: s(a.action), detail: `Action · ${s(a.status)}`, when: s(a.lastUpdated), link: '#/meetings?tab=actions' });
  }
  for (const r of (p.tables.raid ?? []).filter(x => !isArchived(x) && x.lastUpdated)) out.push({ kind: 'risk', id: r._key, title: s(r.title), detail: `${s(r.category)} · ${s(r.status)}`, when: s(r.lastUpdated), link: '' });
  for (const r of (p.tables.decisions ?? []).filter(x => !isArchived(x) && x.lastUpdated)) out.push({ kind: 'decision', id: r._key, title: s(r.decision), detail: `Decision · ${s(r.status)}`, when: s(r.lastUpdated), link: '' });
  return out.sort((a, b) => b.when.localeCompare(a.when)).slice(0, 25);
}

/** Group preserving first-seen order. */
export function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return [...m.entries()];
}

export { workingDaysInclusive };
