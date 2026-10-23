// Small synthetic dataset for tests (independent of the client workbook).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TABLES, TableKey } from '../../shared/schema';
import { DEFAULT_STATUSES } from '../../shared/status';

type Row = Record<string, string | number | null>;

export function tab(key: TableKey, rows: Row[]) {
  const cols = TABLES[key].columns;
  return { header: cols.map(c => c.header), rows: rows.map(r => cols.map(c => (r[c.key] === undefined ? null : r[c.key]))) };
}

export const D = (id: string, over: Row = {}): Row => ({
  id, phase: 'Phase 1', wsCode: '1.2', workstream: 'Objectives & Programme Direction', name: `Task ${id}`, type: 'Task', lead: 'OAM',
  oamOwner: 'PM', sunOwner: 'Prasad N.', durationWd: 2, status: 'Yet to Start', completionConfirmed: 'No',
  clientVisible: 'Yes', archived: 'No', keyMilestone: 'No', internalNotes: `secret-${id}`, lastUpdated: '2026-10-01T00:00:00Z', ...over,
});

export function fixtureTabs() {
  return {
    [TABLES.deliverables.tab]: tab('deliverables', [
      D('PN-1.2.01', { status: 'Approval', completionConfirmed: 'Yes', actualEnd: '2026-10-20', plannedStart: '2026-10-15', plannedEnd: '2026-10-20' }),
      D('PN-1.2.02', { status: 'In Progress', plannedStart: '2026-10-19', plannedEnd: '2026-10-28' }),
      D('PN-1.2.03', { status: 'Under Approval', type: 'Approval Gate', lead: 'Sun', approvalStatus: 'Pending Approval', dateSubmitted: '2026-10-12' }),
      D('PN-1.2.04', { status: 'Approval', plannedStart: '2026-10-01', plannedEnd: '2026-10-09' }),
      D('PN-2.1.01', { phase: 'Phase 2', wsCode: '2.1', workstream: 'Scientific Framework', type: 'Client Input', lead: 'Sun' }),
      D('PN-2.1.02', { phase: 'Phase 2', wsCode: '2.1', workstream: 'Scientific Framework', clientVisible: 'No', name: 'Internal-only task' }),
    ]),
    [TABLES.statuses.tab]: tab('statuses', DEFAULT_STATUSES.map(s => ({ ...s, countsComplete: s.countsComplete ? 'Yes' : 'No', aliases: null, active: 'Yes' }) as unknown as Row)),
    [TABLES.settings.tab]: tab('settings', [
      { key: 'Project Name', value: 'PN0510 Advisory Board Programme', visibility: 'Client' },
      { key: 'Review Turnaround (WD)', value: 5, visibility: 'Client' },
      { key: 'Internal Budget Note', value: 'commercial-secret', visibility: 'Internal' },
    ]),
    [TABLES.holidays.tab]: tab('holidays', []),
    [TABLES.phases.tab]: tab('phases', [{ phase: 'Phase 1', name: 'Phase 1: Mobilisation & Client Inputs', order: 1 }, { phase: 'Phase 2', name: 'Phase 2: Scientific Content & Approvals', order: 2 }]),
    [TABLES.raid.tab]: tab('raid', [
      { id: 'RSK-001', category: 'Risk', title: 'Client-visible risk', status: 'Open', visibility: 'Client', escalation: 'escalation-secret' },
      { id: 'RSK-002', category: 'Issue', title: 'Internal issue', status: 'Open', visibility: 'Internal', impact: 'High', likelihood: 'High' },
    ]),
    [TABLES.decisions.tab]: tab('decisions', []),
    [TABLES.meetings.tab]: tab('meetings', []),
    [TABLES.actions.tab]: tab('actions', []),
    [TABLES.comments.tab]: tab('comments', [{ id: 'CMT-0001', deliverableId: 'PN-1.2.02', comment: 'internal comment-secret', author: 'PM', visibility: 'Internal', archived: 'No' }]),
    [TABLES.audit.tab]: tab('audit', []),
  };
}

export function tempStore(tabs = fixtureTabs()): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunpm-'));
  const file = path.join(dir, 'store.json');
  fs.writeFileSync(file, JSON.stringify({ tabs }));
  return file;
}
