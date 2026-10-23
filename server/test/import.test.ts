// Import of the Readiness Checklist. The synthetic tests always run; the real-workbook
// check runs when the client's workbook is available on this machine.
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importChecklist, SOURCE_SHEET } from '../src/checklistImport';

const HEADER = ['Phase', 'Workstream', 'Task / Activity', 'Description & Key Deliverables', 'Type', 'Lead', 'Lead Function', 'OAM Owner', 'Sun Owner', 'Duration (WD)', 'Status', 'Schedule Flag', 'Remarks'];

function syntheticWorkbook() {
  const wb = new ExcelJS.Workbook();
  // A decoy sheet BEFORE the checklist, with task-like rows and conflicting values.
  const ov = wb.addWorksheet('Overview');
  ov.addRow(HEADER);
  ov.addRow(['Phase 1', 'Decoy', 'DECOY TASK FROM OVERVIEW', 'must never be imported', 'Task', 'OAM', 'X', 'Y', 'Z', 99, 'In Progress', 'Overdue', '']);
  const ws = wb.addWorksheet(SOURCE_SHEET);
  ws.addRow(HEADER);
  const heading = (t: string) => ws.addRow(HEADER.map(() => t));
  heading('PHASE 1:  MOBILISATION & CLIENT INPUTS   ·   SOW corrections and scope decisions');
  heading('1.2 Objectives & Programme Direction');
  ws.addRow(['Phase 1', 'Objectives & Programme Direction', 'Objectives working session', 'Questions; ≥75% agreement', 'Task', 'Joint', 'Medical Affairs', 'Dr. Nivedita', 'Prasad N.', 5, 'Yet to start', 'Upcoming', '']);
  ws.addRow(['Phase 1', 'Objectives & Programme Direction', 'Incomplete row', '', null, null, 'Project Lead', 'PM', null, null, null, null, null]);
  heading('PHASE 2:  SCIENTIFIC CONTENT & APPROVALS   ·   Framework → approval');
  heading('2.3 Sun Review & Approval');
  ws.addRow(['Phase 2', 'Sun Review & Approval', '◆ Content pack approved – invitations can go out', "If needed, change Status to 'Second review'", 'Milestone', 'Sun', 'Sun Medical / Compliance', 'Dr. Nivedita', 'Prasad N.', 1, 'Yet to start', 'Upcoming', 'Gate for all KOL invitations']);
  wb.addWorksheet('Reference').addRow(['Yet to start', 'Completed']);
  return wb;
}

describe('Readiness Checklist import', () => {
  it('reads only the Readiness Checklist worksheet', () => {
    const r = importChecklist(syntheticWorkbook(), { sourceName: 'synthetic.xlsx', importedAt: '2026-10-23T00:00:00Z' });
    const t = r.tables.Deliverables;
    expect(t.rows).toHaveLength(3);
    expect(JSON.stringify(r.tables)).not.toContain('DECOY');
    expect(r.report).toContain('`Overview`, `Reference`');
  });
  it('treats phase and workstream headings as structure, not deliverables, and assigns stable IDs', () => {
    const r = importChecklist(syntheticWorkbook(), { sourceName: 'synthetic.xlsx', importedAt: '2026-10-23T00:00:00Z' });
    const t = r.tables.Deliverables;
    const col = (h: string) => t.header.indexOf(h);
    expect(t.rows.map(x => x[0])).toEqual(['PN-1.2.01', 'PN-1.2.02', 'PN-2.3.01']);
    expect(r.tables.Phases.rows.map(x => x[1])).toEqual(['Phase 1: Mobilisation & Client Inputs', 'Phase 2: Scientific Content & Approvals']);
    expect(r.counts.headings).toBe(4);
    // Source text kept exactly, owners mapped to the renamed columns, status spelling normalised.
    expect(t.rows[0][col('Description & Key Deliverables')]).toBe('Questions; ≥75% agreement');
    expect(t.rows[0][col('OneAlphaMed Owner')]).toBe('Dr. Nivedita');
    expect(t.rows[0][col('Sun Pharma Owner')]).toBe('Prasad N.');
    expect(t.rows[0][col('Duration (Working Days)')]).toBe(5);
    expect(t.rows[0][col('Status')]).toBe('Yet to Start');
    expect(t.rows[0][col('Original Status (Checklist)')]).toBe('Yet to start');
    expect(t.rows[2][col('Task / Activity')]).toBe('◆ Content pack approved – invitations can go out');
    expect(t.rows[2][col('Remarks')]).toBe('Gate for all KOL invitations');
  });
  it('never fills in missing information', () => {
    const r = importChecklist(syntheticWorkbook(), { sourceName: 'synthetic.xlsx', importedAt: '2026-10-23T00:00:00Z' });
    const t = r.tables.Deliverables;
    const col = (h: string) => t.header.indexOf(h);
    const blank = t.rows[1];
    for (const h of ['Status', 'Type', 'Lead', 'Sun Pharma Owner', 'Duration (Working Days)', 'Planned Start Date', 'Planned End Date', 'Priority', 'Dependency'])
      expect(blank[col(h)], h).toBeNull();
    for (const row of t.rows) expect(row[col('Planned Start Date')]).toBeNull();
    expect(r.findings.some(f => f.area === 'Incomplete row')).toBe(true);
    expect(r.findings.some(f => /Second review/.test(f.message))).toBe(true);
  });
});

const WORKBOOK = process.env.CHECKLIST_WORKBOOK ?? 'D:/Project Management/Sun Pharma/PN/OneAlphaMed_SunPharma_PN0510_AdBoard_Readiness_Checklist_v1.0.xlsx';
describe.skipIf(!fs.existsSync(WORKBOOK))('import of the real Readiness Checklist', () => {
  it('imports all 114 deliverables into 5 phases and 14 workstreams with unique IDs', async () => {
    const before = fs.readFileSync(WORKBOOK);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(before as unknown as ArrayBuffer);
    const r = importChecklist(wb, { sourceName: 'real', importedAt: '2026-10-23T00:00:00Z' });
    expect(r.counts.deliverables).toBe(114);
    expect(r.counts.phases).toBe(5);
    expect(r.counts.workstreams).toBe(14);
    const t = r.tables.Deliverables;
    const ids = t.rows.map(row => row[0]);
    expect(new Set(ids).size).toBe(114);
    const ph = t.header.indexOf('Phase');
    const count = (p: string) => t.rows.filter(row => row[ph] === p).length;
    expect([1, 2, 3, 4, 5].map(n => count(`Phase ${n}`))).toEqual([14, 14, 60, 21, 5]);
    expect(r.findings.filter(f => f.severity === 'error')).toHaveLength(0);
    // The original file is untouched.
    expect(Buffer.compare(before, fs.readFileSync(WORKBOOK))).toBe(0);
  }, 60_000);
});
