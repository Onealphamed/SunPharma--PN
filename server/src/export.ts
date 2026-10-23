// Excel / CSV export of any table, limited to what the requesting role may see.
// Deliverable exports include the calculated columns shown in the dashboard, and every
// workbook carries an "About" sheet with the project name and the last sync time.
import ExcelJS from 'exceljs';
import type { Rec } from '../../shared/model';
import { buildProject } from '../../shared/project';
import { Role, TABLES, TableKey } from '../../shared/schema';
import { projectTables, visibleColumns } from './permissions';

export interface ExportSheet {
  name: string;
  header: string[];
  rows: (string | number | null)[][];
  about: [string, string][];
}

export function buildExport(role: Role, table: TableKey, all: Partial<Record<TableKey, Rec[]>>, today: string, meta: { lastSync: string | null; source: string }, keys?: string[]): ExportSheet {
  const tables = projectTables(role, all);
  const spec = TABLES[table];
  let recs = (tables[table] ?? []).filter(r => (spec.archiveKey ? String(r[spec.archiveKey] ?? '').toLowerCase() !== 'yes' : true));
  if (keys?.length) {
    const want = new Set(keys);
    recs = recs.filter(r => want.has(r._key));
  }
  const cols = visibleColumns(role, table).map(k => spec.columns.find(c => c.key === k)!);
  const header = cols.map(c => c.header);
  let rows = recs.map(r => cols.map(c => (r[c.key] ?? null) as string | number | null));
  const p = buildProject(tables, today);
  if (table === 'deliverables') {
    header.push('Lead Organisation', 'Awaiting', 'Complete', 'Schedule Flag (Live)', 'Schedule Note', 'Planned Window (WD)', 'Days Remaining', 'Overdue Days', 'Variance vs Baseline (WD)', 'At-Risk Reasons', 'On Critical Path');
    rows = recs.map((r, i) => {
      const d = p.byId.get(r._key);
      return [
        ...rows[i],
        d?.ownerOrg ?? null,
        d?.awaiting ?? null,
        d ? (d.complete ? 'Yes' : 'No') : null,
        d?.flag ?? null,
        d && !d.scheduled ? (d.dateError ?? 'Date not confirmed') : null,
        d?.windowWd ?? null,
        d?.daysRemaining ?? null,
        d?.overdueDays ?? null,
        d?.varianceWd ?? null,
        d?.riskReasons.join('; ') || null,
        d ? (d.critical ? 'Yes' : 'No') : null,
      ];
    });
  }
  const about: [string, string][] = [
    ['Project', p.settings.projectName],
    ['Client', p.settings.client],
    ['Agency', p.settings.agency],
    ['Export', spec.label],
    ['Rows', String(rows.length)],
    ['Reporting date', today],
    ['Data last synchronised', meta.lastSync ?? 'never'],
    ['Data source', meta.source],
    ['Completion rule', 'A deliverable is complete only when "Completion Confirmed" = Yes.'],
  ];
  return { name: spec.label, header, rows, about };
}

export async function toXlsx(sheet: ExportSheet): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(sheet.header);
  for (const r of sheet.rows) ws.addRow(r.map(v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : v)));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14285A' } };
  ws.columns.forEach((c, i) => {
    c.width = Math.min(50, Math.max(10, sheet.header[i].length + 2));
    if (sheet.rows.some(r => typeof r[i] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r[i] as string))) c.numFmt = 'dd mmm yyyy';
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.header.length } };
  const about = wb.addWorksheet('About');
  for (const [k, v] of sheet.about) about.addRow([k, v]);
  about.getColumn(1).font = { bold: true };
  about.getColumn(1).width = 26;
  about.getColumn(2).width = 80;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toCsv(sheet: ExportSheet): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // CSV injection guard
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [sheet.header, ...sheet.rows].map(r => r.map(esc).join(',')).join('\r\n');
}
