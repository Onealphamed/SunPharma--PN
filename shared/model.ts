// Parsing of raw sheet tabs into typed records, with data-quality issues collected
// rather than thrown: a bad cell should never take the whole dashboard down.
import { parseDate } from './dates';
import { ColumnSpec, RecordRow, TABLES, TableKey, TableSpec, Value } from './schema';

export interface RawTable {
  header: string[];
  /** Data rows (sheet row 2 onwards). Trailing blank cells may be omitted. */
  rows: unknown[][];
}

export interface Rec extends RecordRow {
  /** 1-based sheet row number. */
  _row: number;
  /** Unique key for UI/lookup (the ID when valid, otherwise a synthetic key). */
  _key: string;
  /** Present when the row cannot be safely edited through the dashboard. */
  _readonly?: string;
}

export type Severity = 'error' | 'warning' | 'info';
export interface Issue {
  severity: Severity;
  code: string;
  table: TableKey;
  recordId?: string;
  row?: number;
  field?: string;
  message: string;
}

export interface ParsedTable {
  records: Rec[];
  issues: Issue[];
  /** column key → 0-based column index in the sheet (only for columns present). */
  columnIndex: Record<string, number>;
  missingColumns: string[];
  present: boolean;
}

export const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function mapHeader(spec: TableSpec, header: string[]): { index: Record<string, number>; missing: string[] } {
  const pos = new Map<string, number>();
  header.forEach((h, i) => {
    const n = norm(h);
    if (n && !pos.has(n)) pos.set(n, i);
  });
  const index: Record<string, number> = {};
  const missing: string[] = [];
  for (const col of spec.columns) {
    const names = [col.header, ...(col.aliases ?? [])].map(norm);
    const hit = names.map(n => pos.get(n)).find(i => i !== undefined);
    if (hit !== undefined) index[col.key] = hit;
    else missing.push(col.key);
  }
  return { index, missing };
}

export function parseCell(col: ColumnSpec, raw: unknown): { value: Value; invalid?: string } {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { value: null };
  switch (col.type) {
    case 'date': {
      const p = parseDate(raw);
      return p.invalid ? { value: null, invalid: String(raw) } : { value: p.iso };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      return isFinite(n) ? { value: n } : { value: null, invalid: String(raw) };
    }
    case 'datetime': {
      if (typeof raw === 'number') {
        const ms = Math.round((raw - 25569) * 86400000);
        return { value: new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') };
      }
      return { value: String(raw).trim() };
    }
    case 'idlist':
      return { value: splitIds(String(raw)).join(', ') || null };
    case 'enum': {
      const s = String(raw).trim();
      if (col.options) {
        const hit = col.options.find(o => norm(o) === norm(s));
        if (hit) return { value: hit };
        return { value: s, invalid: s };
      }
      return { value: s };
    }
    default:
      return { value: typeof raw === 'number' && Number.isInteger(raw) ? String(raw) : String(raw).trim() };
  }
}

export function splitIds(s: string | null | undefined): string[] {
  if (!s) return [];
  return String(s)
    .split(/[,;\n]+|\s{2,}/)
    .map(x => x.trim())
    .filter(Boolean);
}

export function parseTable(key: TableKey, raw: RawTable | undefined): ParsedTable {
  const spec = TABLES[key];
  const issues: Issue[] = [];
  if (!raw) {
    issues.push({ severity: 'error', code: 'tab-missing', table: key, message: `Tab "${spec.tab}" was not found in the source sheet.` });
    return { records: [], issues, columnIndex: {}, missingColumns: spec.columns.map(c => c.key), present: false };
  }
  const { index, missing } = mapHeader(spec, raw.header);
  for (const k of missing) {
    const col = spec.columns.find(c => c.key === k)!;
    issues.push({
      severity: col.required ? 'error' : 'warning',
      code: 'column-missing',
      table: key,
      field: k,
      message: `Column "${col.header}" is missing from tab "${spec.tab}"${col.required ? '' : ' — field shown blank and cannot be edited'}.`,
    });
  }
  const records: Rec[] = [];
  const idCount = new Map<string, number>();
  raw.rows.forEach((cells, i) => {
    const rowNum = i + 2;
    if (!cells || cells.every(c => c === null || c === undefined || String(c).trim() === '')) return;
    const rec: Rec = { _row: rowNum, _key: '' };
    for (const col of spec.columns) {
      const ci = index[col.key];
      if (ci === undefined) {
        rec[col.key] = null;
        continue;
      }
      const { value, invalid } = parseCell(col, cells[ci]);
      rec[col.key] = value;
      if (invalid !== undefined) {
        issues.push({
          severity: 'warning',
          code: col.type === 'date' ? 'invalid-date' : col.type === 'enum' ? 'invalid-option' : 'invalid-value',
          table: key,
          row: rowNum,
          field: col.key,
          message:
            col.type === 'enum'
              ? `"${invalid}" is not a recognised ${col.header} value.`
              : `"${invalid}" in ${col.header} could not be read as a ${col.type === 'date' ? 'date — treated as not scheduled' : col.type}.`,
        });
      }
    }
    const id = rec[spec.idKey];
    if (id === null || id === undefined || String(id).trim() === '') {
      rec._key = `ROW-${rowNum}`;
      rec._readonly = `Missing ${spec.columns.find(c => c.key === spec.idKey)!.header}`;
      issues.push({ severity: 'error', code: 'missing-id', table: key, row: rowNum, message: `Row ${rowNum} has no ID; it is shown read-only until an ID is assigned.` });
    } else {
      const idStr = String(id);
      idCount.set(idStr, (idCount.get(idStr) ?? 0) + 1);
      rec._key = idStr;
    }
    records.push(rec);
  });
  // Duplicate IDs: every occurrence becomes read-only because a write could hit the wrong row.
  for (const [id, n] of idCount) {
    if (n < 2) continue;
    const dupes = records.filter(r => r._key === id);
    dupes.forEach((r, i) => {
      r._readonly = 'Duplicate ID';
      if (i > 0) r._key = `${id}#${r._row}`;
    });
    issues.push({
      severity: 'error',
      code: 'duplicate-id',
      table: key,
      recordId: id,
      message: `ID ${id} appears ${n} times (rows ${dupes.map(d => d._row).join(', ')}). These rows are read-only until the duplicate is fixed in the sheet.`,
    });
  }
  // Required fields.
  for (const r of records) {
    for (const col of spec.columns) {
      if (col.required && col.key !== spec.idKey && index[col.key] !== undefined && (r[col.key] === null || r[col.key] === '')) {
        issues.push({ severity: 'warning', code: 'required-blank', table: key, recordId: r._key, row: r._row, field: col.key, message: `${col.header} is blank.` });
      }
    }
  }
  return { records, issues, columnIndex: index, missingColumns: missing, present: true };
}

/** Convert a typed value back into a cell value for writing. */
export function toCell(col: ColumnSpec, value: Value | undefined): string | number {
  if (value === null || value === undefined || value === '') return '';
  if (col.type === 'number') return Number(value);
  if (col.type === 'date' || col.type === 'datetime') return String(value);
  const s = String(value);
  // Neutralise formula injection: Sheets would evaluate text starting with these characters.
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

/** Normalised comparison used for optimistic-concurrency checks. */
export function sameValue(a: Value | undefined, b: Value | undefined): boolean {
  const na = a === undefined || a === '' ? null : a;
  const nb = b === undefined || b === '' ? null : b;
  if (na === null || nb === null) return na === nb;
  if (typeof na === 'number' || typeof nb === 'number') return Number(na) === Number(nb);
  return String(na).trim() === String(nb).trim();
}
