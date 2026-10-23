// Writes the live-tracker tabs to an .xlsx that can be uploaded to Google Drive and
// opened as a Google Sheet. Headers are frozen, internal-only columns are marked in a
// darker header colour, and enum columns carry drop-down validation so direct sheet
// edits stay clean.
import ExcelJS from 'exceljs';
import { parseDate } from '../../shared/dates';
import { TABLES, TABLE_KEYS } from '../../shared/schema';
import type { Tab } from './checklistImport';

export async function writeSourceWorkbook(tabs: Record<string, Tab>, file: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PN0510 dashboard — Readiness Checklist import';
  const statusTab = TABLES.statuses.tab;
  const statusCount = tabs[statusTab]?.rows.length ?? 0;
  for (const key of TABLE_KEYS) {
    const spec = TABLES[key];
    const tab = tabs[spec.tab];
    if (!tab) continue;
    const ws = wb.addWorksheet(spec.tab, { views: [{ state: 'frozen', ySplit: 1, xSplit: key === 'deliverables' ? 1 : 0 }] });
    ws.addRow(tab.header);
    for (const r of tab.rows) {
      ws.addRow(
        r.map((v, i) => {
          const col = spec.columns.find(c => c.header === tab.header[i]);
          if (col?.type === 'date' && typeof v === 'string') {
            const iso = parseDate(v).iso;
            return iso ? new Date(`${iso}T00:00:00Z`) : v;
          }
          return v;
        }),
      );
    }
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14285A' } };
    head.alignment = { vertical: 'middle', wrapText: true };
    head.height = 32;
    const last = Math.max(tab.rows.length + 1, 2);
    tab.header.forEach((h, i) => {
      const col = spec.columns.find(c => c.header === h);
      const wcol = ws.getColumn(i + 1);
      wcol.width = col?.type === 'longtext' ? 48 : col?.type === 'date' ? 14 : col?.key === 'name' ? 52 : Math.min(Math.max(h.length + 2, 12), 28);
      if (col?.type === 'date') wcol.numFmt = 'yyyy-mm-dd';
      if (col?.type === 'longtext') wcol.alignment = { wrapText: true, vertical: 'top' };
      if (col?.internal) head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C2D12' } };
      if (col?.edit === 'none') head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
      // Drop-downs for enums (blanks allowed). The range extends 500 rows below the data for new rows.
      let formula: string | null = null;
      if (col?.type === 'enum' && col.options) formula = `"${col.options.join(',')}"`;
      if (col?.optionsFrom === 'statuses' && statusCount) formula = `'${statusTab}'!$A$2:$A$${statusCount + 1 + 20}`;
      if (formula && formula.length < 255) {
        const letter = ws.getColumn(i + 1).letter;
        (ws as any).dataValidations.add(`${letter}2:${letter}${last + 500}`, {
          type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true, errorStyle: 'warning',
          errorTitle: 'Unrecognised value', error: `Pick a value from the list (${h}).`,
        });
      }
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: tab.header.length } };
  }
  await wb.xlsx.writeFile(file);
}
