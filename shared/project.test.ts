import { describe, expect, it } from 'vitest';
import { addWorkingDays, parseDate, workingDayDiff, workingDaysInclusive } from './dates';
import { parseTable, Rec } from './model';
import { buildProject, narrativeText } from './project';
import { crossValidate } from './quality';
import { TABLES } from './schema';
import { DEFAULT_STATUSES } from './status';
import { suggestDependencies } from './suggestions';

const cal = { weekend: [0, 6], holidays: new Set(['2026-11-24']) };
const TODAY = '2026-11-10'; // a Tuesday

describe('dates', () => {
  it('parses the shapes found in sheets', () => {
    expect(parseDate(46328).iso).toBe('2026-11-02');
    expect(parseDate('2026-11-02').iso).toBe('2026-11-02');
    expect(parseDate('02/11/2026').iso).toBe('2026-11-02'); // day-first
    expect(parseDate('31/02/2026')).toEqual({ iso: null, invalid: true });
    expect(parseDate('TBC')).toEqual({ iso: null, invalid: false });
  });
  it('counts working days, not calendar days', () => {
    expect(workingDaysInclusive('2026-11-02', '2026-11-06', cal)).toBe(5);
    expect(workingDaysInclusive('2026-11-06', '2026-11-09', cal)).toBe(2); // Fri + Mon
    expect(workingDaysInclusive('2026-11-23', '2026-11-25', cal)).toBe(2); // holiday excluded
    expect(addWorkingDays('2026-11-06', 5, cal)).toBe('2026-11-13');
    expect(workingDayDiff('2026-11-06', '2026-11-09', cal)).toBe(1);
  });
});

const statusRows: Rec[] = DEFAULT_STATUSES.map((s, i) => ({ _row: i + 2, _key: s.status, ...s, countsComplete: 'No', aliases: '', active: 'Yes' }) as unknown as Rec);
const del = (id: string, o: Partial<Rec> = {}): Rec => ({
  _row: 2, _key: id, id, phase: 'Phase 1', wsCode: '1.2', workstream: 'W', name: id, type: 'Task', lead: 'OAM', oamOwner: 'PM', sunOwner: 'Prasad N.',
  status: 'Yet to Start', completionConfirmed: 'No', durationWd: 2, ...o,
});
const settings = (extra: Rec[] = []): Rec[] => [{ _row: 2, _key: 'Review Turnaround (WD)', key: 'Review Turnaround (WD)', value: '5' }, ...extra];
const build = (ds: Rec[], today = TODAY, more: Partial<Record<string, Rec[]>> = {}) =>
  buildProject({ deliverables: ds, statuses: statusRows, settings: settings(), holidays: [], ...more }, today);

describe('completion rule', () => {
  it('counts only confirmed completions — no status implies completion', () => {
    const p = build([
      del('A', { status: 'Approval' }),
      del('B', { status: 'Under Approval' }),
      del('C', { status: 'Approval', completionConfirmed: 'Yes' }),
      del('D', { status: 'In Progress' }),
    ]);
    expect(p.kpis.completed).toBe(1);
    expect(p.kpis.pct).toBe(25);
    expect(p.byId.get('A')!.complete).toBe(false);
    expect(p.byId.get('C')!.flag).toBe('Completed');
    expect(p.kpis.pendingApprovals).toBe(2); // A and B — C is complete
    expect(p.kpis.inProgress).toBe(1);
  });
  it('excludes archived rows from every count', () => {
    const p = build([del('A'), del('B', { archived: 'Yes' })]);
    expect(p.kpis.total).toBe(1);
  });
});

describe('schedule rules', () => {
  it('never marks a completed deliverable overdue', () => {
    const p = build([
      del('LATE', { plannedStart: '2026-11-02', plannedEnd: '2026-11-05', status: 'In Progress' }),
      del('DONE', { plannedStart: '2026-11-02', plannedEnd: '2026-11-05', completionConfirmed: 'Yes' }),
    ]);
    expect(p.byId.get('LATE')!.overdue).toBe(true);
    expect(p.byId.get('LATE')!.overdueDays).toBe(5);
    expect(p.byId.get('LATE')!.flag).toBe('Overdue');
    expect(p.byId.get('DONE')!.overdue).toBe(false);
    expect(p.kpis.overdue).toBe(1);
  });
  it('treats missing dates as "not confirmed" — never overdue, never due soon', () => {
    const p = build([del('A'), del('B', { status: 'In Progress' })]);
    expect(p.byId.get('A')!.scheduled).toBe(false);
    expect(p.byId.get('A')!.flag).toBe('Upcoming');
    expect(p.kpis.overdue + p.kpis.dueSoon).toBe(0);
    expect(p.kpis.notScheduled).toBe(2);
    expect(p.health).toBe('grey');
    expect(p.projectStart).toBeNull();
  });
  it('flags due in the next 7 days, on track and at risk', () => {
    const p = build([
      del('SOON', { plannedStart: '2026-11-09', plannedEnd: '2026-11-16', status: 'In Progress', durationWd: 6 }),
      del('LATE-START', { plannedStart: '2026-11-05', plannedEnd: '2026-11-30' }),
      del('SHORT', { plannedStart: '2026-12-07', plannedEnd: '2026-12-08', durationWd: 5 }),
      del('FUTURE', { plannedStart: '2026-12-01', plannedEnd: '2026-12-03', durationWd: 3 }),
    ]);
    expect(p.byId.get('SOON')!.dueSoon).toBe(true);
    expect(p.byId.get('SOON')!.flag).toBe('On Track');
    expect(p.byId.get('LATE-START')!.flag).toBe('At Risk');
    expect(p.byId.get('SHORT')!.riskReasons[0]).toMatch(/needs 5 WD/);
    expect(p.byId.get('FUTURE')!.flag).toBe('Upcoming');
    expect(p.kpis.dueSoon).toBe(1);
    expect(p.health).toBe('amber');
  });
  it('turns red when a milestone or approval gate is overdue', () => {
    const p = build([del('G', { type: 'Approval Gate', plannedStart: '2026-11-02', plannedEnd: '2026-11-03' }), ...Array.from({ length: 20 }, (_, i) => del(`T${i}`, { plannedStart: '2026-12-01', plannedEnd: '2026-12-02' }))]);
    expect(p.health).toBe('red');
  });
});

describe('statuses', () => {
  it('maps spelling and capitalisation to the eight configured statuses', () => {
    const p = build([del('A', { status: 'yet to start' }), del('B', { status: 'IN REVIEW' }), del('C', { status: 'Second review' }), del('D', { status: null })]);
    expect(p.byId.get('A')!.status).toBe('Yet to Start');
    expect(p.byId.get('A')!.category).toBe('Not started');
    expect(p.byId.get('B')!.status).toBe('In Review');
    expect(p.byId.get('C')!.category).toBe('Unmapped');
    expect(p.kpis.unmapped).toBe(2);
    expect(DEFAULT_STATUSES.map(s => s.status)).toEqual(['In Progress', 'In Review', 'Yet to Start', 'Yet to Assign', 'On Hold', 'Under Approval', 'Approval', 'Pending']);
    expect(DEFAULT_STATUSES.every(s => !s.countsComplete)).toBe(true);
  });
});

describe('approvals and client inputs', () => {
  it('calculates the approval due date from submission + review turnaround (working days)', () => {
    const p = build([del('G', { type: 'Approval Gate', lead: 'Sun', status: 'Under Approval', approvalStatus: 'Pending Approval', dateSubmitted: '2026-11-02' })]);
    const a = p.approvals[0];
    expect(a.due).toBe('2026-11-09');
    expect(a.dueBasis).toBe('calculated');
    expect(a.turnaroundBasis).toBe('project default (proposed)');
    expect(a.daysAwaiting).toBe(8);
    expect(a.overdue).toBe(true);
    expect(p.byId.get('G')!.awaiting).toBe('Sun Pharma');
    expect(p.byId.get('G')!.flag).toBe('At Risk');
  });
  it('keeps the approval decision separate from the workflow status', () => {
    const p = build([del('G', { type: 'Approval Gate', status: 'Approval', approvalStatus: 'Approved' })]);
    expect(p.byId.get('G')!.complete).toBe(false);
    expect(p.approvals[0].decided).toBe(true);
    expect(crossValidate(p).some(i => i.code === 'approved-not-complete')).toBe(true);
  });
  it('splits open work between Sun Pharma and OneAlphaMed', () => {
    const p = build([del('IN', { type: 'Client Input', lead: 'Sun' }), del('OAM'), del('J', { lead: 'Joint' })]);
    expect(p.kpis.awaitingSun).toBe(1);
    expect(p.kpis.awaitingOam).toBe(2);
  });
});

describe('narrative', () => {
  it('is generated from the data and says what is not confirmed', () => {
    const p = build([del('A'), del('B', { completionConfirmed: 'Yes', actualEnd: '2026-11-09', name: 'Literature review summary' })]);
    const text = narrativeText(p.summary);
    expect(text).toContain('1 of 2 deliverables complete (50%)');
    expect(text).toContain('Literature review summary');
    expect(text).toContain('Project start and end dates are not yet confirmed');
    expect(text).toContain('proposed assumption');
  });
});

describe('data quality', () => {
  it('flags placeholder text, blank status, unowned items and impossible dates', () => {
    const p = build([
      del('A', { description: 'ssss' }),
      del('B', { status: null }),
      del('C', { oamOwner: null, sunOwner: null }),
      del('D', { plannedStart: '2026-11-10', plannedEnd: '2026-11-02' }),
    ]);
    const codes = crossValidate(p).map(i => i.code);
    expect(codes).toEqual(expect.arrayContaining(['placeholder-text', 'blank-status', 'no-owner', 'end-before-start', 'dates-unconfirmed']));
  });
  it('detects dependency cycles', () => {
    const p = build([del('A', { predecessors: 'B' }), del('B', { predecessors: 'A' })]);
    expect(crossValidate(p).some(i => i.code === 'circular-dependency')).toBe(true);
  });
  it('flags duplicate IDs at parse time', () => {
    const header = TABLES.deliverables.columns.map(c => c.header);
    const row = header.map(h => (h === 'Deliverable ID' ? 'PN-1.2.01' : h === 'Task / Activity' ? 'x' : null));
    const parsed = parseTable('deliverables', { header, rows: [row, row] });
    expect(parsed.issues.some(i => i.code === 'duplicate-id')).toBe(true);
    expect(parsed.records.every(r => r._readonly)).toBe(true);
  });
});

describe('dependency suggestions from checklist remarks', () => {
  it('suggests, but does not apply, links stated in the remarks', () => {
    const p = build([
      del('GATE', { name: '◆ Content pack approved – invitations can go out', remarks: 'Gate for all KOL invitations' }),
      del('INV1', { name: 'AB-1: invitations sent with approved agenda', remarks: 'Starts only after content approval' }),
      del('INV5', { name: 'NAB-5: invitations sent with approved agenda' }),
    ]);
    const s = suggestDependencies(p.deliverables);
    expect(s.map(x => `${x.successor}>${x.predecessor}`).sort()).toEqual(['INV1>GATE', 'INV5>GATE']);
    expect(p.graph.linkCount).toBe(0);
  });
});
