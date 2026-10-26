// Read-only store for a Google Sheet shared as "Anyone with the link can view". It downloads
// the whole workbook through Google's export link (no credentials), so every sync sees the
// sheet exactly as it stands. Dashboard tables come from tabs with the live-tracker names
// when present; otherwise they are built from the "Readiness Checklist" tab on each read.
// Nothing can be written back: changes are made in Google Sheets.
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import type { RawTable } from '../../../shared/model';
import { cellValue, importChecklist, SOURCE_SHEET } from '../checklistImport';
import { CellOut, CellUpdate, StoreError, TableStore, WorkbookSnapshot, WorkbookTab } from './types';

export const READ_ONLY_MESSAGE = 'This dashboard reads the Google Sheet through its view-only link, so changes are made in Google Sheets and appear here on the next sync.';

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Spreadsheet cell → plain value for parsing (dates as ISO strings). */
function plain(v: ExcelJS.CellValue): string | number | null {
  // A formula whose result is an error arrives as an unusable date; Google Sheets shows #ERROR!.
  if (v && typeof v === 'object' && 'formula' in v) {
    const r = (v as { result?: unknown }).result;
    if ((r instanceof Date && isNaN(r.getTime())) || (r && typeof r === 'object' && 'error' in r)) return '#ERROR!';
  }
  const x = cellValue(v);
  if (x === null || x === undefined || x === '') return null;
  if (x instanceof Date) return isNaN(x.getTime()) ? null : isoish(x);
  if (typeof x === 'number') return x;
  if (typeof x === 'boolean') return x ? 'TRUE' : 'FALSE';
  return String(x);
}
function isoish(d: Date): string {
  const iso = d.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace(/\.\d{3}Z$/, 'Z').replace('T', ' ');
}

export class PublicSheetStore implements TableStore {
  readonly kind = 'public-sheet' as const;
  readonly readOnly = true;
  private last: WorkbookSnapshot | null = null;
  private inflight: Promise<Record<string, RawTable>> | null = null;

  constructor(private sheetId: string, private fetcher: Fetcher = fetch as unknown as Fetcher) {}

  get description() {
    return `Google Sheet …${this.sheetId.slice(-6)} (view-only link)`;
  }

  get exportUrl() {
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(this.sheetId)}/export?format=xlsx`;
  }

  workbook() {
    return this.last;
  }

  private async download(): Promise<ArrayBuffer> {
    let res: Awaited<ReturnType<Fetcher>>;
    try {
      res = await this.fetcher(this.exportUrl, { signal: AbortSignal.timeout(25000) });
    } catch (e) {
      throw new StoreError(`Could not reach Google Sheets: ${(e as Error).message}`, 503, true);
    }
    if (res.status === 404) throw new StoreError('Google Sheet not found — check GOOGLE_SHEET_ID.', 502);
    if (res.status === 401 || res.status === 403)
      throw new StoreError('Google Sheets refused access. The sheet must be shared as "Anyone with the link can view" (or configure a service account).', 502);
    if (!res.ok) throw new StoreError(`Google Sheets error ${res.status} while reading the sheet.`, 502, res.status >= 500 || res.status === 429);
    // A sheet that is not link-shared answers with Google's sign-in page instead of a file.
    if (!(res.headers.get('content-type') ?? '').includes('spreadsheetml'))
      throw new StoreError('The Google Sheet is not shared as "Anyone with the link can view", so it cannot be read without a service account.', 502);
    return res.arrayBuffer();
  }

  private async load(): Promise<Record<string, RawTable>> {
    const buf = await this.download();
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf);
    } catch (e) {
      throw new StoreError(`The workbook downloaded from Google Sheets could not be read: ${(e as Error).message}`, 502);
    }
    const tables: Record<string, RawTable> = {};
    const tabs: WorkbookTab[] = [];
    for (const ws of wb.worksheets) {
      // Google pads every tab to ~1,000 formatted rows, so only cells holding a value are visited.
      const byRow = new Map<number, { cells: (string | number | null)[]; display: string[] }>();
      let columns = 0;
      let lastRow = 0;
      ws.eachRow({ includeEmpty: false }, (row, r) => {
        const cells: (string | number | null)[] = [];
        // Display copy: cells covered by a merge are blank, as Google Sheets shows them.
        const display: string[] = [];
        row.eachCell({ includeEmpty: false }, (cell, c) => {
          const v = plain(cell.value);
          cells[c - 1] = v;
          display[c - 1] = cell.isMerged && cell.master.address !== cell.address ? '' : v === null ? '' : String(v);
        });
        for (let i = 0; i < cells.length; i++) {
          if (cells[i] === undefined) cells[i] = null;
          if (display[i] === undefined) display[i] = '';
        }
        while (cells.length && cells[cells.length - 1] === null) cells.pop();
        while (display.length && display[display.length - 1] === '') display.pop();
        if (!cells.length) return;
        byRow.set(r, { cells, display });
        columns = Math.max(columns, cells.length);
        lastRow = r;
      });
      const grid: (string | number | null)[][] = [];
      const shown: string[][] = [];
      for (let r = 1; r <= lastRow; r++) {
        grid.push(byRow.get(r)?.cells ?? []);
        shown.push(byRow.get(r)?.display ?? []);
      }
      tables[ws.name] = { header: (grid[0] ?? []).map(v => (v === null ? '' : String(v))), rows: grid.slice(1) };
      tabs.push({
        name: ws.name,
        columns,
        rows: shown.slice(0, grid.length).map((cells, i) => ({ n: i + 1, cells })).filter(r => r.cells.some(Boolean)),
      });
    }
    // Dashboard tables built from the checklist; real tabs with the same names take precedence.
    const derived: Record<string, RawTable> = {};
    if (wb.getWorksheet(SOURCE_SHEET)) {
      const imported = importChecklist(wb, { sourceName: 'Google Sheet', importedAt: new Date().toISOString(), live: true });
      // The audit log stays empty: nothing is edited through the dashboard in this mode.
      for (const [name, tab] of Object.entries(imported.tables)) derived[name] = name === 'Audit Log' ? { header: tab.header, rows: [] } : tab;
    }
    const version = crypto.createHash('sha1').update(JSON.stringify(tabs)).digest('hex').slice(0, 10);
    this.last = { tabs, version, readAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
    return { ...derived, ...tables };
  }

  async readTabs(tabs: string[]): Promise<Record<string, RawTable>> {
    // Concurrent reads share one download.
    this.inflight ??= this.load().finally(() => (this.inflight = null));
    const all = await this.inflight;
    const out: Record<string, RawTable> = {};
    for (const t of tabs) if (all[t]) out[t] = all[t];
    return out;
  }

  updateCells(_tab: string, _updates: CellUpdate[]): Promise<void> {
    return Promise.reject(new StoreError(READ_ONLY_MESSAGE, 409));
  }

  appendRows(_tab: string, _rows: CellOut[][]): Promise<void> {
    return Promise.reject(new StoreError(READ_ONLY_MESSAGE, 409));
  }

  ensureTabs(): Promise<string[]> {
    return Promise.reject(new StoreError(READ_ONLY_MESSAGE, 409));
  }
}
